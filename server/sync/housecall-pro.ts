import { housecallProService } from '../housecall-pro-service';
import { storage } from '../storage';
import { db } from '../db';
import { contacts, estimates, jobs } from '@shared/schema';
import { randomUUID } from 'crypto';

const SYNC_BATCH_SIZE = 25;

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

async function convertEstimateToJob(estimate: any, hcpEstimate: any, tenantId: string): Promise<void> {
  try {
    const existingJob = await storage.getJobByEstimateId(estimate.id, tenantId);
    if (existingJob) {
      console.log(`[sync-scheduler] Job already exists for estimate ${estimate.id}`);
      return;
    }

    const jobData = {
      contactId: estimate.contactId,
      estimateId: estimate.id,
      title: estimate.title || 'Job from Approved Estimate',
      type: 'Installation',
      status: 'in_progress' as const,
      value: estimate.amount,
      priority: 'medium' as const,
      contractorId: tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
      scheduledDate: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
      estimatedHours: 4,
      externalId: hcpEstimate.id,
      externalSource: 'housecall-pro' as const,
    };

    const createdJob = await storage.createJob(jobData, tenantId);
    console.log(`[sync-scheduler] Created job from approved estimate: ${estimate.id} -> ${createdJob.id}`);
  } catch (error) {
    console.error(`[sync-scheduler] Failed to convert estimate ${estimate.id} to job:`, error);
  }
}

export async function syncHousecallProEmployees(tenantId: string): Promise<void> {
  console.log(`[sync-scheduler] Syncing employees from Housecall Pro for tenant ${tenantId}`);

  try {
    const employeesResult = await housecallProService.getEmployees(tenantId);
    if (!employeesResult.success) {
      console.error(`[sync-scheduler] Failed to fetch employees: ${employeesResult.error}`);
      return;
    }

    const housecallProEmployees = employeesResult.data || [];
    console.log(`[sync-scheduler] Fetched ${housecallProEmployees.length} employees from Housecall Pro`);

    if (housecallProEmployees.length === 0) {
      return;
    }

    const employeeData = housecallProEmployees.map((hcpEmployee: any) => ({
      externalSource: 'housecall-pro' as const,
      externalId: hcpEmployee.id,
      firstName: hcpEmployee.first_name,
      lastName: hcpEmployee.last_name,
      email: hcpEmployee.email,
      isActive: hcpEmployee.is_active,
      externalRole: hcpEmployee.role,
      roles: [] as string[],
    }));

    const upsertedEmployees = await storage.upsertEmployees(employeeData, tenantId);
    console.log(`[sync-scheduler] Upserted ${upsertedEmployees.length} employees`);
  } catch (error) {
    console.error(`[sync-scheduler] Error syncing employees:`, error);
  }
}

export async function syncHousecallPro(tenantId: string): Promise<void> {
  console.log(`[sync-scheduler] Syncing Housecall Pro data for tenant ${tenantId}`);

  await syncHousecallProEmployees(tenantId);

  const syncStartDate = await storage.getHousecallProSyncStartDate(tenantId);
  console.log(`[sync-scheduler] Using sync start date filter: ${syncStartDate ? syncStartDate.toISOString() : 'none'}`);

  const baseEstimatesParams = syncStartDate ? {
    modified_since: syncStartDate.toISOString(),
    sort_by: 'created_at',
    sort_direction: 'desc',
    page_size: 100
  } : {
    sort_by: 'created_at',
    sort_direction: 'desc',
    page_size: 100
  };

  let allHousecallProEstimates: any[] = [];
  let page = 1;
  let keepGoing = true;
  const maxRunTime = 5 * 60 * 1000;
  const startTime = Date.now();

  while (keepGoing) {
    if (Date.now() - startTime > maxRunTime) {
      console.log(`[sync-scheduler] Time limit reached at page ${page}, aborting pagination`);
      break;
    }

    const estimatesParams = { ...baseEstimatesParams, page };
    console.log(`[sync-scheduler] Fetching estimates page ${page}...`);

    const estimatesResult = await housecallProService.getEstimates(tenantId, estimatesParams);
    if (!estimatesResult.success) {
      throw new Error(`Failed to fetch estimates page ${page}: ${estimatesResult.error}`);
    }

    const pageEstimates = estimatesResult.data || [];
    console.log(`[sync-scheduler] Page ${page}: fetched ${pageEstimates.length} estimates`);

    if (!pageEstimates.length) {
      console.log(`[sync-scheduler] No more estimates found, stopping pagination`);
      break;
    }

    allHousecallProEstimates = allHousecallProEstimates.concat(pageEstimates);

    if (pageEstimates.length < baseEstimatesParams.page_size) {
      console.log(`[sync-scheduler] Page ${page} returned ${pageEstimates.length} estimates (< ${baseEstimatesParams.page_size}), stopping pagination`);
      keepGoing = false;
    } else {
      page++;
    }
  }

  const housecallProEstimates = allHousecallProEstimates;
  console.log(`[sync-scheduler] Fetched ${housecallProEstimates.length} total estimates from Housecall Pro across ${page} pages`);

  let newEstimates = 0;
  let updatedEstimates = 0;
  let failedEstimates = 0;

  const estimateBatches = splitIntoBatches(housecallProEstimates, SYNC_BATCH_SIZE);
  console.log(`[sync-scheduler] Processing ${housecallProEstimates.length} estimates in ${estimateBatches.length} batches of up to ${SYNC_BATCH_SIZE}`);

  for (let batchIndex = 0; batchIndex < estimateBatches.length; batchIndex++) {
    const batch = estimateBatches[batchIndex];
    console.log(`[sync-scheduler] Processing estimate batch ${batchIndex + 1}/${estimateBatches.length} (${batch.length} items)`);

    const batchHcpIds = batch.map((e: any) => e.id);
    const existingEstimatesMap = await storage.getEstimatesByHousecallProIds(batchHcpIds, tenantId);
    console.log(`[sync-scheduler] Found ${existingEstimatesMap.size} existing estimates in batch`);

    for (const hcpEstimate of batch) {
      try {
        const existingEstimate = existingEstimatesMap.get(hcpEstimate.id);

        if (existingEstimate) {
          console.log(`[sync-scheduler] Estimate ${hcpEstimate.id} - status: '${hcpEstimate.status}', work_status: '${hcpEstimate.work_status}'`);

          const newStatus =
            (hcpEstimate.work_status === 'completed' || hcpEstimate.status === 'completed' ||
             hcpEstimate.work_status === 'approved'  || hcpEstimate.status === 'approved'  ||
             hcpEstimate.work_status === 'accepted'  || hcpEstimate.status === 'accepted') ? 'approved' as const :
            (hcpEstimate.work_status === 'canceled'  || hcpEstimate.status === 'canceled'  ||
             hcpEstimate.work_status === 'cancelled' || hcpEstimate.status === 'cancelled' ||
             hcpEstimate.work_status === 'rejected'  || hcpEstimate.status === 'rejected'  ||
             hcpEstimate.work_status === 'declined'  || hcpEstimate.status === 'declined') ? 'rejected' as const :
            (hcpEstimate.work_status === 'pending'   || hcpEstimate.status === 'pending'   ||
             hcpEstimate.work_status === 'draft'     || hcpEstimate.status === 'draft'     ||
             hcpEstimate.work_status === 'needs_scheduling' || hcpEstimate.status === 'needs_scheduling') ? 'pending' as const :
            (hcpEstimate.work_status === 'sent'      || hcpEstimate.status === 'sent'      ||
             hcpEstimate.work_status === 'scheduled' || hcpEstimate.status === 'scheduled' ||
             hcpEstimate.work_status === 'dispatched'|| hcpEstimate.status === 'dispatched') ? 'sent' as const :
            'pending' as const;

          console.log(`[sync-scheduler] Estimate ${hcpEstimate.id} - mapped status: '${newStatus}'`);

          const updatedTitle =
            hcpEstimate.number ||
            hcpEstimate.estimate_number ||
            hcpEstimate.name ||
            (hcpEstimate.description && hcpEstimate.description !== '' ? hcpEstimate.description : null) ||
            `Estimate #${hcpEstimate.id}` ||
            'Estimate from Housecall Pro';

          console.log(`[sync-scheduler] Update Estimate ${hcpEstimate.id} - title: '${updatedTitle}'`);

          let amt = hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.estimate_total ?? hcpEstimate.amount ?? null;
          if (amt === null && Array.isArray(hcpEstimate.options)) {
            amt = hcpEstimate.options.reduce((m: number, o: any) => Math.max(m, Number(o.total_amount) || 0), 0);
          }
          const amountInDollars = (typeof amt === 'number' && amt > 0) ? (amt / 100) : 0;

          const updateData = {
            title: updatedTitle,
            status: newStatus,
            amount: amountInDollars.toString(),
            description: hcpEstimate.description || '',
            scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
          };

          await storage.updateEstimate(existingEstimate.id, updateData, tenantId);
          updatedEstimates++;

          if (newStatus === 'approved' && existingEstimate.status !== 'approved') {
            await convertEstimateToJob(existingEstimate, hcpEstimate, tenantId);
            console.log(`[sync-scheduler] Auto-converted approved estimate ${existingEstimate.id} to job`);
          }
        } else {
          // Create new estimate
          let amt = hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.estimate_total ?? hcpEstimate.amount ?? null;
          if (amt === null && Array.isArray(hcpEstimate.options)) {
            amt = hcpEstimate.options.reduce((m: number, o: any) => Math.max(m, Number(o.total_amount) || 0), 0);
          }
          const amountInDollars = (typeof amt === 'number' && amt > 0) ? (amt / 100) : 0;

          console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - status: '${hcpEstimate.status}', work_status: '${hcpEstimate.work_status}'`);

          const estimateStatus =
            (hcpEstimate.work_status === 'completed' || hcpEstimate.status === 'completed' ||
             hcpEstimate.work_status === 'approved'  || hcpEstimate.status === 'approved'  ||
             hcpEstimate.work_status === 'accepted'  || hcpEstimate.status === 'accepted') ? 'approved' as const :
            (hcpEstimate.work_status === 'canceled'  || hcpEstimate.status === 'canceled'  ||
             hcpEstimate.work_status === 'cancelled' || hcpEstimate.status === 'cancelled' ||
             hcpEstimate.work_status === 'rejected'  || hcpEstimate.status === 'rejected'  ||
             hcpEstimate.work_status === 'declined'  || hcpEstimate.status === 'declined') ? 'rejected' as const :
            (hcpEstimate.work_status === 'pending'   || hcpEstimate.status === 'pending'   ||
             hcpEstimate.work_status === 'draft'     || hcpEstimate.status === 'draft'     ||
             hcpEstimate.work_status === 'needs_scheduling' || hcpEstimate.status === 'needs_scheduling') ? 'pending' as const :
            (hcpEstimate.work_status === 'sent'      || hcpEstimate.status === 'sent'      ||
             hcpEstimate.work_status === 'scheduled' || hcpEstimate.status === 'scheduled' ||
             hcpEstimate.work_status === 'dispatched'|| hcpEstimate.status === 'dispatched') ? 'sent' as const :
            'pending' as const;

          console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - mapped status: '${estimateStatus}'`);

          const estimateTitle =
            hcpEstimate.number ||
            hcpEstimate.estimate_number ||
            hcpEstimate.name ||
            (hcpEstimate.description && hcpEstimate.description !== '' ? hcpEstimate.description : null) ||
            `Estimate #${hcpEstimate.id}` ||
            'Estimate from Housecall Pro';

          console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - title: '${estimateTitle}'`);

          let contactId: string | null = null;
          const hcpCustomerId = hcpEstimate.customer_id;
          const hcpCustomer = hcpEstimate.customer;

          if (hcpCustomerId) {
            const existingContact = await storage.getContactByHousecallProCustomerId(hcpCustomerId, tenantId);
            if (existingContact) {
              contactId = existingContact.id;
              console.log(`[sync-scheduler] Found existing contact ${contactId} for HCP customer ${hcpCustomerId}`);
            }
          }

          if (!contactId && hcpCustomer) {
            const customerPhone = hcpCustomer.mobile_number || hcpCustomer.home_number || hcpCustomer.work_number ||
              (hcpCustomer.phone_numbers && hcpCustomer.phone_numbers[0]?.phone_number);
            const customerEmail = hcpCustomer.email;

            if (customerPhone) {
              const phoneMatch = await storage.getContactByPhone(customerPhone, tenantId);
              if (phoneMatch) {
                contactId = phoneMatch.id;
                if (hcpCustomerId) {
                  await storage.updateContact(phoneMatch.id, { housecallProCustomerId: hcpCustomerId }, tenantId);
                }
                console.log(`[sync-scheduler] Found contact ${contactId} by phone match`);
              }
            }

            if (!contactId && customerEmail) {
              const emailMatch = await storage.findMatchingContact(tenantId, [customerEmail], undefined);
              if (emailMatch) {
                contactId = emailMatch;
                if (hcpCustomerId) {
                  await storage.updateContact(emailMatch, { housecallProCustomerId: hcpCustomerId }, tenantId);
                }
                console.log(`[sync-scheduler] Found contact ${contactId} by email match`);
              }
            }

            if (!contactId) {
              const customerName = [hcpCustomer.first_name, hcpCustomer.last_name].filter(Boolean).join(' ') ||
                hcpCustomer.company || 'Unknown Customer';
              const phones = [hcpCustomer.mobile_number, hcpCustomer.home_number, hcpCustomer.work_number]
                .filter(Boolean) as string[];
              const emails = customerEmail ? [customerEmail] : [];
              const address = hcpCustomer.address ?
                [hcpCustomer.address.street, hcpCustomer.address.city, hcpCustomer.address.state, hcpCustomer.address.zip]
                  .filter(Boolean).join(', ') : undefined;

              const newContactId = randomUUID();
              const newEstimateId = randomUUID();

              await db.transaction(async (tx) => {
                await tx.insert(contacts).values({
                  id: newContactId,
                  name: customerName,
                  emails,
                  phones,
                  address,
                  type: 'customer',
                  status: 'new',
                  source: 'housecall-pro',
                  housecallProCustomerId: hcpCustomerId || undefined,
                  externalId: hcpCustomerId || undefined,
                  externalSource: hcpCustomerId ? 'housecall-pro' : undefined,
                  contractorId: tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });

                await tx.insert(estimates).values({
                  contactId: newContactId,
                  title: estimateTitle,
                  description: hcpEstimate.description || '',
                  amount: amountInDollars.toString(),
                  status: estimateStatus,
                  contractorId: tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
                  externalId: hcpEstimate.id,
                  externalSource: 'housecall-pro',
                });
              });

              console.log(`[sync-scheduler] Created contact ${newContactId} and estimate ${newEstimateId} atomically from HCP data`);
              newEstimates++;
              continue;
            }
          }

          if (!contactId) {
            console.log(`[sync-scheduler] Skipping estimate ${hcpEstimate.id} - no customer data available to create contact`);
            continue;
          }

          const estimateData = {
            contactId,
            title: estimateTitle,
            description: hcpEstimate.description || '',
            amount: amountInDollars.toString(),
            status: estimateStatus,
            contractorId: tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
            scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
            externalId: hcpEstimate.id,
            externalSource: 'housecall-pro' as const,
          };

          await storage.createEstimate(estimateData, tenantId);
          newEstimates++;
        }
      } catch (itemError) {
        console.error(`[sync-scheduler] Failed to process estimate ${hcpEstimate.id}:`, itemError);
        failedEstimates++;
      }
    }

    console.log(`[sync-scheduler] Batch ${batchIndex + 1} complete - Running totals: ${newEstimates} new, ${updatedEstimates} updated, ${failedEstimates} failed`);
  }

  console.log(`[sync-scheduler] Estimate sync completed - New: ${newEstimates}, Updated: ${updatedEstimates}, Failed: ${failedEstimates}`);

  await syncHousecallProJobs(tenantId);
}

export async function syncHousecallProJobs(tenantId: string): Promise<void> {
  console.log(`[sync-scheduler] Syncing Housecall Pro jobs for tenant ${tenantId}`);

  const syncStartDate = await storage.getHousecallProSyncStartDate(tenantId);

  const jobsParams = syncStartDate ? {
    modified_since: syncStartDate.toISOString(),
    sort_by: 'created_at',
    sort_direction: 'desc',
    page_size: 100,
    include: 'tags'
  } : {
    sort_by: 'created_at',
    sort_direction: 'desc',
    page_size: 100,
    include: 'tags'
  };

  const jobsResult = await housecallProService.getJobs(tenantId, jobsParams);
  if (!jobsResult.success) {
    console.error(`[sync-scheduler] Failed to fetch jobs: ${jobsResult.error}`);
    return;
  }

  const housecallProJobs = jobsResult.data || [];
  console.log(`[sync-scheduler] Fetched ${housecallProJobs.length} jobs from Housecall Pro`);

  let newJobs = 0;
  let updatedJobs = 0;
  let failedJobs = 0;

  const jobBatches = splitIntoBatches(housecallProJobs, SYNC_BATCH_SIZE);
  console.log(`[sync-scheduler] Processing ${housecallProJobs.length} jobs in ${jobBatches.length} batches of up to ${SYNC_BATCH_SIZE}`);

  for (let batchIndex = 0; batchIndex < jobBatches.length; batchIndex++) {
    const batch = jobBatches[batchIndex];
    console.log(`[sync-scheduler] Processing job batch ${batchIndex + 1}/${jobBatches.length} (${batch.length} items)`);

    for (const hcpJob of batch) {
      try {
        const existingJob = await storage.getJobByHousecallProJobId(hcpJob.id, tenantId);

        if (existingJob) {
          const scheduledStart = hcpJob.schedule?.scheduled_start || hcpJob.scheduled_start;
          const updateData = {
            title: hcpJob.invoice_number || hcpJob.description || 'Job from Housecall Pro',
            status: hcpJob.work_status === 'completed' ? 'completed' as const :
                   hcpJob.work_status === 'canceled'  ? 'cancelled' as const :
                   hcpJob.work_status === 'scheduled' ? 'scheduled' as const : 'in_progress' as const,
            value: ((hcpJob.total_amount || 0) / 100).toFixed(2),
            scheduledDate: scheduledStart ? new Date(scheduledStart) : null,
          };
          await storage.updateJob(existingJob.id, updateData, tenantId);
          updatedJobs++;
        } else {
          let contactId: string | null = null;
          const hcpCustomerId = hcpJob.customer_id;
          const hcpCustomer = hcpJob.customer;

          if (hcpCustomerId) {
            const existingContact = await storage.getContactByHousecallProCustomerId(hcpCustomerId, tenantId);
            if (existingContact) {
              contactId = existingContact.id;
              console.log(`[sync-scheduler] Found existing contact ${contactId} for HCP customer ${hcpCustomerId} (job)`);
            }
          }

          if (!contactId && hcpCustomer) {
            const customerPhone = hcpCustomer.mobile_number || hcpCustomer.home_number || hcpCustomer.work_number ||
              (hcpCustomer.phone_numbers && hcpCustomer.phone_numbers[0]?.phone_number);
            const customerEmail = hcpCustomer.email;

            if (customerPhone) {
              const phoneMatch = await storage.getContactByPhone(customerPhone, tenantId);
              if (phoneMatch) {
                contactId = phoneMatch.id;
                if (hcpCustomerId) {
                  await storage.updateContact(phoneMatch.id, { housecallProCustomerId: hcpCustomerId }, tenantId);
                }
                console.log(`[sync-scheduler] Found contact ${contactId} by phone match (job)`);
              }
            }

            if (!contactId && customerEmail) {
              const emailMatch = await storage.findMatchingContact(tenantId, [customerEmail], undefined);
              if (emailMatch) {
                contactId = emailMatch;
                if (hcpCustomerId) {
                  await storage.updateContact(emailMatch, { housecallProCustomerId: hcpCustomerId }, tenantId);
                }
                console.log(`[sync-scheduler] Found contact ${contactId} by email match (job)`);
              }
            }

            if (!contactId) {
              const customerName = [hcpCustomer.first_name, hcpCustomer.last_name].filter(Boolean).join(' ') ||
                hcpCustomer.company || 'Unknown Customer';
              const phones = [hcpCustomer.mobile_number, hcpCustomer.home_number, hcpCustomer.work_number]
                .filter(Boolean) as string[];
              const emails = customerEmail ? [customerEmail] : [];
              const address = hcpCustomer.address ?
                [hcpCustomer.address.street, hcpCustomer.address.city, hcpCustomer.address.state, hcpCustomer.address.zip]
                  .filter(Boolean).join(', ') : undefined;

              const newContactId = randomUUID();
              const newJobId = randomUUID();
              const scheduledStartTx = hcpJob.schedule?.scheduled_start || hcpJob.scheduled_start;
              const jobStatus = hcpJob.work_status === 'completed' ? 'completed' as const :
                hcpJob.work_status === 'canceled'  ? 'cancelled' as const :
                hcpJob.work_status === 'scheduled' ? 'scheduled' as const : 'in_progress' as const;

              await db.transaction(async (tx) => {
                await tx.insert(contacts).values({
                  id: newContactId,
                  name: customerName,
                  emails,
                  phones,
                  address,
                  type: 'customer',
                  status: 'new',
                  source: 'housecall-pro',
                  housecallProCustomerId: hcpCustomerId || undefined,
                  externalId: hcpCustomerId || undefined,
                  externalSource: hcpCustomerId ? 'housecall-pro' : undefined,
                  contractorId: tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });

                await tx.insert(jobs).values({
                  id: newJobId,
                  contactId: newContactId,
                  title: hcpJob.invoice_number || hcpJob.description || 'Job from Housecall Pro',
                  type: 'Service',
                  status: jobStatus,
                  value: ((hcpJob.total_amount || 0) / 100).toFixed(2),
                  priority: 'medium',
                  contractorId: tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  scheduledDate: scheduledStartTx ? new Date(scheduledStartTx) : null,
                  estimatedHours: 4,
                  externalId: hcpJob.id,
                  externalSource: 'housecall-pro',
                });
              });

              console.log(`[sync-scheduler] Created contact ${newContactId} and job ${newJobId} atomically from HCP data`);
              newJobs++;
              continue;
            }
          }

          if (!contactId) {
            console.log(`[sync-scheduler] Skipping job ${hcpJob.id} - no customer data available to create contact`);
            continue;
          }

          const scheduledStartNormal = hcpJob.schedule?.scheduled_start || hcpJob.scheduled_start;
          await storage.createJob({
            contactId,
            title: hcpJob.invoice_number || hcpJob.description || 'Job from Housecall Pro',
            type: 'Service',
            status: hcpJob.work_status === 'completed' ? 'completed' as const :
                   hcpJob.work_status === 'canceled'  ? 'cancelled' as const :
                   hcpJob.work_status === 'scheduled' ? 'scheduled' as const : 'in_progress' as const,
            value: ((hcpJob.total_amount || 0) / 100).toFixed(2),
            priority: 'medium' as const,
            scheduledDate: scheduledStartNormal ? new Date(scheduledStartNormal) : null,
            estimatedHours: 4,
            externalId: hcpJob.id,
            externalSource: 'housecall-pro' as const,
          }, tenantId);
          newJobs++;
        }
      } catch (itemError) {
        console.error(`[sync-scheduler] Failed to process job ${hcpJob.id}:`, itemError);
        failedJobs++;
      }
    }

    console.log(`[sync-scheduler] Job batch ${batchIndex + 1} complete - Running totals: ${newJobs} new, ${updatedJobs} updated, ${failedJobs} failed`);
  }

  console.log(`[sync-scheduler] Jobs sync completed - New: ${newJobs}, Updated: ${updatedJobs}, Failed: ${failedJobs}`);
}
