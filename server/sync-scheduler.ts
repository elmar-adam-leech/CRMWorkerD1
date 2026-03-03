import { housecallProService } from './housecall-pro-service';
import { storage } from './storage';
import { db } from './db';
import { contacts, estimates, jobs } from '@shared/schema';
import { randomUUID } from 'crypto';

// Batch size for transaction processing
const SYNC_BATCH_SIZE = 25;

export class SyncScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('[sync-scheduler] Already running');
      return;
    }

    console.log('[sync-scheduler] Starting sync scheduler...');
    this.isRunning = true;
    
    // Check for due syncs every minute
    setInterval(() => {
      this.checkDueSyncs();
    }, 60 * 1000); // Check every minute
    
    // Initial check
    this.checkDueSyncs();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    console.log('[sync-scheduler] Stopping sync scheduler...');
    this.isRunning = false;
    
    // Clear all timers
    this.timers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.timers.clear();
  }

  /**
   * Add or update a sync schedule for a tenant
   */
  async scheduleSync(tenantId: string, integrationName: string, frequency: 'daily' | 'weekly' | 'hourly' | 'every-5-minutes' = 'daily') {
    // Calculate next sync time
    const nextSyncAt = this.calculateNextSyncTime(frequency);
    
    // Check if schedule already exists
    const existing = await storage.getSyncSchedule(tenantId, integrationName);
    
    if (existing) {
      // Update existing schedule
      await storage.updateSyncSchedule(tenantId, integrationName, {
        frequency,
        nextSyncAt,
        isEnabled: true,
      });
      console.log(`[sync-scheduler] Updated ${frequency} sync for ${integrationName} (contractor: ${tenantId}) - next sync: ${nextSyncAt.toISOString()}`);
    } else {
      // Create new schedule
      await storage.createSyncSchedule({
        contractorId: tenantId,
        integrationName,
        frequency,
        nextSyncAt,
        isEnabled: true,
      });
      console.log(`[sync-scheduler] Created ${frequency} sync for ${integrationName} (contractor: ${tenantId}) - next sync: ${nextSyncAt.toISOString()}`);
    }
  }

  /**
   * Remove a sync schedule
   */
  async removeSchedule(tenantId: string, integrationName: string) {
    const scheduleId = `${tenantId}-${integrationName}`;
    
    // Clear any pending timer
    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
    
    await storage.deleteSyncSchedule(tenantId, integrationName);
    console.log(`[sync-scheduler] Removed sync schedule for ${integrationName} (contractor: ${tenantId})`);
  }

  /**
   * Get all schedules for a tenant
   */
  async getTenantSchedules(tenantId: string) {
    return await storage.getSyncSchedules(tenantId);
  }

  /**
   * Manually trigger a sync for a specific tenant and integration
   */
  async triggerSync(tenantId: string, integrationName: string): Promise<void> {
    console.log(`[sync-scheduler] Manual sync triggered for ${integrationName} (tenant: ${tenantId})`);
    await this.performSync(tenantId, integrationName);
  }

  /**
   * Helper to split array into batches
   */
  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of items within a transaction
   * Returns the number of successful operations
   */
  private async processBatchInTransaction<T>(
    batch: T[],
    processor: (item: T, tx: any) => Promise<{ success: boolean; isNew: boolean }>,
    batchIndex: number
  ): Promise<{ newCount: number; updatedCount: number; failedCount: number }> {
    const result = { newCount: 0, updatedCount: 0, failedCount: 0 };
    
    try {
      await db.transaction(async (tx) => {
        for (const item of batch) {
          try {
            const opResult = await processor(item, tx);
            if (opResult.success) {
              if (opResult.isNew) {
                result.newCount++;
              } else {
                result.updatedCount++;
              }
            } else {
              result.failedCount++;
            }
          } catch (itemError) {
            console.error(`[sync-scheduler] Failed to process item in batch ${batchIndex}:`, itemError);
            result.failedCount++;
            // Continue processing other items in the batch
          }
        }
      });
      console.log(`[sync-scheduler] Batch ${batchIndex} committed: ${result.newCount} new, ${result.updatedCount} updated, ${result.failedCount} failed`);
    } catch (txError) {
      console.error(`[sync-scheduler] Transaction failed for batch ${batchIndex}, rolling back:`, txError);
      // All operations in this batch are rolled back
      result.failedCount = batch.length;
      result.newCount = 0;
      result.updatedCount = 0;
    }
    
    return result;
  }

  /**
   * Check for syncs that are due to run
   */
  private async checkDueSyncs() {
    const now = new Date();
    
    // Get all due schedules from database
    const dueSchedules = await storage.getDueSyncSchedules();
    
    for (const schedule of dueSchedules) {
      console.log(`[sync-scheduler] Sync due for ${schedule.integrationName} (contractor: ${schedule.contractorId})`);
      
      // Perform the sync
      try {
        await this.performSync(schedule.contractorId, schedule.integrationName);
        
        // Update the schedule for next sync
        const nextSyncAt = this.calculateNextSyncTime(schedule.frequency, now);
        await storage.updateSyncSchedule(schedule.contractorId, schedule.integrationName, {
          lastSyncAt: now,
          nextSyncAt,
        });
        
        console.log(`[sync-scheduler] Sync completed for ${schedule.integrationName} (contractor: ${schedule.contractorId}) - next sync: ${nextSyncAt.toISOString()}`);
      } catch (error) {
        console.error(`[sync-scheduler] Sync failed for ${schedule.integrationName} (contractor: ${schedule.contractorId}):`, error);
        
        // Schedule retry in 1 hour
        const retryAt = new Date(now.getTime() + 60 * 60 * 1000);
        await storage.updateSyncSchedule(schedule.contractorId, schedule.integrationName, {
          nextSyncAt: retryAt,
        });
        console.log(`[sync-scheduler] Retry scheduled for: ${retryAt.toISOString()}`);
      }
    }
  }

  /**
   * Perform the actual sync operation
   */
  private async performSync(tenantId: string, integrationName: string): Promise<void> {
    console.log(`[sync-scheduler] Starting sync for ${integrationName} (tenant: ${tenantId})`);
    
    try {
      // Check if integration is enabled
      const isEnabled = await storage.isIntegrationEnabled(tenantId, integrationName);
      if (!isEnabled) {
        console.log(`[sync-scheduler] Integration ${integrationName} is disabled for tenant ${tenantId}, skipping sync`);
        return;
      }

      switch (integrationName) {
        case 'housecall-pro':
          await this.syncHousecallPro(tenantId);
          break;
        case 'gmail':
          await this.syncGmail(tenantId);
          break;
        default:
          console.warn(`[sync-scheduler] Unknown integration: ${integrationName}`);
      }
    } catch (error) {
      console.error(`[sync-scheduler] Sync failed for ${integrationName}:`, error);
      throw error;
    }
  }

  /**
   * Sync Housecall Pro data
   */
  private async syncHousecallPro(tenantId: string): Promise<void> {
    console.log(`[sync-scheduler] Syncing Housecall Pro data for tenant ${tenantId}`);
    
    // First, sync employees from Housecall Pro
    await this.syncHousecallProEmployees(tenantId);
    
    // Get sync start date for filtering
    const syncStartDate = await storage.getHousecallProSyncStartDate(tenantId);
    console.log(`[sync-scheduler] Using sync start date filter: ${syncStartDate ? syncStartDate.toISOString() : 'none'}`);
    
    // Fetch ALL estimates from Housecall Pro with pagination (like the working Google Apps Script)
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
    const maxRunTime = 5 * 60 * 1000; // 5-minute guard like Google Apps Script
    const startTime = Date.now();
    
    while (keepGoing) {
      // Check time limit (like Google Apps Script)
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
      
      // Add estimates from this page to our collection
      allHousecallProEstimates = allHousecallProEstimates.concat(pageEstimates);
      
      // If we got less than page_size, we've reached the end
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

    // Process estimates in batches for better logging and transaction management
    const estimateBatches = this.splitIntoBatches(housecallProEstimates, SYNC_BATCH_SIZE);
    console.log(`[sync-scheduler] Processing ${housecallProEstimates.length} estimates in ${estimateBatches.length} batches of up to ${SYNC_BATCH_SIZE}`);

    for (let batchIndex = 0; batchIndex < estimateBatches.length; batchIndex++) {
      const batch = estimateBatches[batchIndex];
      console.log(`[sync-scheduler] Processing estimate batch ${batchIndex + 1}/${estimateBatches.length} (${batch.length} items)`);
      
      // Batch fetch all existing estimates for this batch to avoid N+1 queries
      const batchHcpIds = batch.map((e: any) => e.id);
      const existingEstimatesMap = await storage.getEstimatesByHousecallProIds(batchHcpIds, tenantId);
      console.log(`[sync-scheduler] Found ${existingEstimatesMap.size} existing estimates in batch`);
      
      for (const hcpEstimate of batch) {
      try {
        // Check if estimate already exists in our system (using pre-fetched map)
        const existingEstimate = existingEstimatesMap.get(hcpEstimate.id);
        
        if (existingEstimate) {
          // Update existing estimate with latest data
          console.log(`[sync-scheduler] Estimate ${hcpEstimate.id} - status: '${hcpEstimate.status}', work_status: '${hcpEstimate.work_status}'`);
          
          // Enhanced status mapping to handle Housecall Pro's actual status values
          const newStatus = 
            // Check for approved/completed statuses  
            (hcpEstimate.work_status === 'completed' || hcpEstimate.status === 'completed' ||
             hcpEstimate.work_status === 'approved' || hcpEstimate.status === 'approved' ||
             hcpEstimate.work_status === 'accepted' || hcpEstimate.status === 'accepted') ? 'approved' as const :
            // Check for rejected/canceled statuses
            (hcpEstimate.work_status === 'canceled' || hcpEstimate.status === 'canceled' ||
             hcpEstimate.work_status === 'cancelled' || hcpEstimate.status === 'cancelled' ||
             hcpEstimate.work_status === 'rejected' || hcpEstimate.status === 'rejected' ||
             hcpEstimate.work_status === 'declined' || hcpEstimate.status === 'declined') ? 'rejected' as const :
            // Check for pending statuses
            (hcpEstimate.work_status === 'pending' || hcpEstimate.status === 'pending' ||
             hcpEstimate.work_status === 'draft' || hcpEstimate.status === 'draft' ||
             hcpEstimate.work_status === 'needs_scheduling' || hcpEstimate.status === 'needs_scheduling') ? 'pending' as const :
            // Check for sent statuses
            (hcpEstimate.work_status === 'sent' || hcpEstimate.status === 'sent' ||
             hcpEstimate.work_status === 'scheduled' || hcpEstimate.status === 'scheduled' ||
             hcpEstimate.work_status === 'dispatched' || hcpEstimate.status === 'dispatched') ? 'sent' as const :
            // Default fallback
            'pending' as const;
          
          console.log(`[sync-scheduler] Estimate ${hcpEstimate.id} - mapped status: '${newStatus}'`);
          
          // Enhanced title extraction for existing estimates - try multiple fields for better estimate names
          const updatedTitle = 
            hcpEstimate.number || 
            hcpEstimate.estimate_number || 
            hcpEstimate.name || 
            (hcpEstimate.description && hcpEstimate.description !== '' ? hcpEstimate.description : null) ||
            `Estimate #${hcpEstimate.id}` ||
            'Estimate from Housecall Pro';
          
          console.log(`[sync-scheduler] Update Estimate ${hcpEstimate.id} - title: '${updatedTitle}' (from: number=${hcpEstimate.number}, estimate_number=${hcpEstimate.estimate_number}, name=${hcpEstimate.name}, description=${hcpEstimate.description})`);
          
          // Amount conversion from cents to dollars like the working script
          let amt = hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.estimate_total ?? hcpEstimate.amount ?? null;
          if (amt === null && Array.isArray(hcpEstimate.options)) {
            amt = hcpEstimate.options.reduce((m: number, o: any) => Math.max(m, Number(o.total_amount) || 0), 0);
          }
          // Default to 0.00 if no amount found to satisfy NOT NULL constraint
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
          
          // Auto-convert approved estimates to jobs
          if (newStatus === 'approved' && existingEstimate.status !== 'approved') {
            await this.convertEstimateToJob(existingEstimate, hcpEstimate, tenantId);
            console.log(`[sync-scheduler] Auto-converted approved estimate ${existingEstimate.id} to job`);
          }
        } else {
            // Create new estimate
            // Amount conversion from cents to dollars like the working script
            let amt = hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.estimate_total ?? hcpEstimate.amount ?? null;
            if (amt === null && Array.isArray(hcpEstimate.options)) {
              amt = hcpEstimate.options.reduce((m: number, o: any) => Math.max(m, Number(o.total_amount) || 0), 0);
            }
            // Default to 0.00 if no amount found to satisfy NOT NULL constraint
            const amountInDollars = (typeof amt === 'number' && amt > 0) ? (amt / 100) : 0;
            
            console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - status: '${hcpEstimate.status}', work_status: '${hcpEstimate.work_status}'`);
            
            // Enhanced status mapping for new estimates
            const estimateStatus = 
              // Check for approved/completed statuses  
              (hcpEstimate.work_status === 'completed' || hcpEstimate.status === 'completed' ||
               hcpEstimate.work_status === 'approved' || hcpEstimate.status === 'approved' ||
               hcpEstimate.work_status === 'accepted' || hcpEstimate.status === 'accepted') ? 'approved' as const :
              // Check for rejected/canceled statuses
              (hcpEstimate.work_status === 'canceled' || hcpEstimate.status === 'canceled' ||
               hcpEstimate.work_status === 'cancelled' || hcpEstimate.status === 'cancelled' ||
               hcpEstimate.work_status === 'rejected' || hcpEstimate.status === 'rejected' ||
               hcpEstimate.work_status === 'declined' || hcpEstimate.status === 'declined') ? 'rejected' as const :
              // Check for pending statuses
              (hcpEstimate.work_status === 'pending' || hcpEstimate.status === 'pending' ||
               hcpEstimate.work_status === 'draft' || hcpEstimate.status === 'draft' ||
               hcpEstimate.work_status === 'needs_scheduling' || hcpEstimate.status === 'needs_scheduling') ? 'pending' as const :
              // Check for sent statuses
              (hcpEstimate.work_status === 'sent' || hcpEstimate.status === 'sent' ||
               hcpEstimate.work_status === 'scheduled' || hcpEstimate.status === 'scheduled' ||
               hcpEstimate.work_status === 'dispatched' || hcpEstimate.status === 'dispatched') ? 'sent' as const :
              // Default fallback
              'pending' as const;
            
            console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - mapped status: '${estimateStatus}'`);
            
            // Enhanced title extraction - try multiple fields for better estimate names
            const estimateTitle = 
              hcpEstimate.number || 
              hcpEstimate.estimate_number || 
              hcpEstimate.name || 
              (hcpEstimate.description && hcpEstimate.description !== '' ? hcpEstimate.description : null) ||
              `Estimate #${hcpEstimate.id}` ||
              'Estimate from Housecall Pro';
            
            console.log(`[sync-scheduler] New Estimate ${hcpEstimate.id} - title: '${estimateTitle}' (from: number=${hcpEstimate.number}, estimate_number=${hcpEstimate.estimate_number}, name=${hcpEstimate.name}, description=${hcpEstimate.description})`);

            // Find or create contact from HCP customer data
            let contactId: string | null = null;
            const hcpCustomerId = hcpEstimate.customer_id;
            const hcpCustomer = hcpEstimate.customer;
            
            if (hcpCustomerId) {
              // Try to find existing contact by HCP customer ID
              const existingContact = await storage.getContactByHousecallProCustomerId(hcpCustomerId, tenantId);
              if (existingContact) {
                contactId = existingContact.id;
                console.log(`[sync-scheduler] Found existing contact ${contactId} for HCP customer ${hcpCustomerId}`);
              }
            }
            
            // If no contact found and we have customer data, try phone/email match or create new
            if (!contactId && hcpCustomer) {
              const customerPhone = hcpCustomer.mobile_number || hcpCustomer.home_number || hcpCustomer.work_number || 
                (hcpCustomer.phone_numbers && hcpCustomer.phone_numbers[0]?.phone_number);
              const customerEmail = hcpCustomer.email;
              
              // Try to find by phone
              if (customerPhone) {
                const phoneMatch = await storage.getContactByPhone(customerPhone, tenantId);
                if (phoneMatch) {
                  contactId = phoneMatch.id;
                  // Update with HCP customer ID for future lookups
                  if (hcpCustomerId) {
                    await storage.updateContact(phoneMatch.id, { housecallProCustomerId: hcpCustomerId }, tenantId);
                  }
                  console.log(`[sync-scheduler] Found contact ${contactId} by phone match`);
                }
              }
              
              // Try to find by email if still no match
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
              
              // Create new contact AND estimate atomically if no match found
              if (!contactId) {
                const customerName = [hcpCustomer.first_name, hcpCustomer.last_name].filter(Boolean).join(' ') || 
                  hcpCustomer.company || 'Unknown Customer';
                const phones = [hcpCustomer.mobile_number, hcpCustomer.home_number, hcpCustomer.work_number]
                  .filter(Boolean) as string[];
                const emails = customerEmail ? [customerEmail] : [];
                const address = hcpCustomer.address ? 
                  [hcpCustomer.address.street, hcpCustomer.address.city, hcpCustomer.address.state, hcpCustomer.address.zip]
                    .filter(Boolean).join(', ') : undefined;
                
                // Use transaction to ensure contact + estimate are created atomically
                const newContactId = randomUUID();
                const newEstimateId = randomUUID();
                
                await db.transaction(async (tx) => {
                  // Create contact within transaction
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
                  
                  // Create estimate within same transaction
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
                continue; // Already created estimate in transaction
              }
            }
            
            // Skip estimate if we couldn't resolve a contact
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
        // Continue processing other estimates
      }
      }
      
      // Log batch completion
      console.log(`[sync-scheduler] Batch ${batchIndex + 1} complete - Running totals: ${newEstimates} new, ${updatedEstimates} updated, ${failedEstimates} failed`);
    }

    console.log(`[sync-scheduler] Estimate sync completed - New: ${newEstimates}, Updated: ${updatedEstimates}, Failed: ${failedEstimates}`);
    
    // Now sync jobs from Housecall Pro
    await this.syncHousecallProJobs(tenantId);
  }

  /**
   * Auto-convert approved estimate to job
   */
  private async convertEstimateToJob(estimate: any, hcpEstimate: any, tenantId: string): Promise<void> {
    try {
      // Check if job already exists for this estimate
      const existingJob = await storage.getJobByEstimateId(estimate.id, tenantId);
      if (existingJob) {
        console.log(`[sync-scheduler] Job already exists for estimate ${estimate.id}`);
        return;
      }

      const jobData = {
        contactId: estimate.contactId,
        estimateId: estimate.id,
        title: estimate.title || 'Job from Approved Estimate',
        type: 'Installation', // Default type, could be inferred from estimate
        status: 'in_progress' as const,
        value: estimate.amount,
        priority: 'medium' as const,
        contractorId: tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
        scheduledDate: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
        estimatedHours: 4, // Default hours
        externalId: hcpEstimate.id,
        externalSource: 'housecall-pro' as const,
      };

      const createdJob = await storage.createJob(jobData, tenantId);
      console.log(`[sync-scheduler] Created job from approved estimate: ${estimate.id} -> ${createdJob.id}`);
    } catch (error) {
      console.error(`[sync-scheduler] Failed to convert estimate ${estimate.id} to job:`, error);
    }
  }

  /**
   * Sync jobs from Housecall Pro
   */
  async syncHousecallProJobs(tenantId: string): Promise<void> {
    console.log(`[sync-scheduler] Syncing Housecall Pro jobs for tenant ${tenantId}`);
    
    // Get sync start date for filtering
    const syncStartDate = await storage.getHousecallProSyncStartDate(tenantId);
    
    // Fetch jobs from Housecall Pro with date filter, including tags like working scripts
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

    // Process jobs in batches for better logging and transaction management
    const jobBatches = this.splitIntoBatches(housecallProJobs, SYNC_BATCH_SIZE);
    console.log(`[sync-scheduler] Processing ${housecallProJobs.length} jobs in ${jobBatches.length} batches of up to ${SYNC_BATCH_SIZE}`);

    for (let batchIndex = 0; batchIndex < jobBatches.length; batchIndex++) {
      const batch = jobBatches[batchIndex];
      console.log(`[sync-scheduler] Processing job batch ${batchIndex + 1}/${jobBatches.length} (${batch.length} items)`);
      
      for (const hcpJob of batch) {
        try {
          // Check if job already exists in our system
          const existingJob = await storage.getJobByHousecallProJobId(hcpJob.id, tenantId);
          
          if (existingJob) {
            // Update existing job with latest data
            const scheduledStart = hcpJob.schedule?.scheduled_start || hcpJob.scheduled_start;
            const updateData = {
              title: hcpJob.description || hcpJob.invoice_number || 'Job from Housecall Pro',
              status: hcpJob.work_status === 'completed' ? 'completed' as const :
                     hcpJob.work_status === 'canceled' ? 'cancelled' as const :
                     hcpJob.work_status === 'scheduled' ? 'scheduled' as const : 'in_progress' as const,
              value: ((hcpJob.total_amount || 0) / 100).toFixed(2),
              scheduledDate: scheduledStart ? new Date(scheduledStart) : null,
            };
            
            await storage.updateJob(existingJob.id, updateData, tenantId);
            updatedJobs++;
          } else {
            // Resolve contact from HCP job customer data
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
                // Create contact + job atomically
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
                  hcpJob.work_status === 'canceled' ? 'cancelled' as const :
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
                    title: hcpJob.description || hcpJob.invoice_number || 'Job from Housecall Pro',
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

            // Contact resolved — create job normally
            const scheduledStartNormal = hcpJob.schedule?.scheduled_start || hcpJob.scheduled_start;
            await storage.createJob({
              contactId,
              title: hcpJob.description || hcpJob.invoice_number || 'Job from Housecall Pro',
              type: 'Service',
              status: hcpJob.work_status === 'completed' ? 'completed' as const :
                     hcpJob.work_status === 'canceled' ? 'cancelled' as const :
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
          // Continue processing other jobs
        }
      }
      
      // Log batch completion
      console.log(`[sync-scheduler] Job batch ${batchIndex + 1} complete - Running totals: ${newJobs} new, ${updatedJobs} updated, ${failedJobs} failed`);
    }

    console.log(`[sync-scheduler] Jobs sync completed - New: ${newJobs}, Updated: ${updatedJobs}, Failed: ${failedJobs}`);
  }

  private async syncHousecallProEmployees(tenantId: string): Promise<void> {
    console.log(`[sync-scheduler] Syncing employees from Housecall Pro for tenant ${tenantId}`);
    
    try {
      // Fetch employees from Housecall Pro
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

      // Map Housecall Pro employees to our employee format
      const employeeData = housecallProEmployees.map(hcpEmployee => ({
        externalSource: 'housecall-pro' as const,
        externalId: hcpEmployee.id,
        firstName: hcpEmployee.first_name,
        lastName: hcpEmployee.last_name,
        email: hcpEmployee.email,
        isActive: hcpEmployee.is_active,
        externalRole: hcpEmployee.role,
        roles: [] as string[] // Will be auto-mapped in storage layer
      }));

      // Upsert employees in our database
      const upsertedEmployees = await storage.upsertEmployees(employeeData, tenantId);
      console.log(`[sync-scheduler] Upserted ${upsertedEmployees.length} employees`);
      
    } catch (error) {
      console.error(`[sync-scheduler] Error syncing employees:`, error);
      // Don't throw - continue with other sync operations
    }
  }

  /**
   * Sync Gmail emails for all users in a tenant
   */
  private async syncGmail(tenantId: string): Promise<void> {
    console.log(`[sync-scheduler] Syncing Gmail emails for tenant ${tenantId}`);
    
    try {
      const { gmailService } = await import('./gmail-service');
      const { db } = await import('./db');
      const { users, activities } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Get all users with Gmail connected for this tenant
      const gmailUsers = await db.select().from(users).where(and(
        eq(users.contractorId, tenantId),
        eq(users.gmailConnected, true)
      ));
      
      if (gmailUsers.length === 0) {
        console.log(`[sync-scheduler] No Gmail users found for tenant ${tenantId}`);
        return;
      }
      
      console.log(`[sync-scheduler] Found ${gmailUsers.length} Gmail users to sync`);
      
      // Sync emails for each user
      for (const user of gmailUsers) {
        if (!user.gmailRefreshToken) {
          console.log(`[sync-scheduler] Skipping user ${user.id} - no refresh token`);
          continue;
        }
        
        try {
          console.log(`[sync-scheduler] Syncing emails for user ${user.name} (${user.gmailEmail})`);
          const since = user.gmailLastSyncAt || undefined;
          console.log(`[sync-scheduler] Last sync at: ${since?.toISOString() || 'never'}`);
          
          const result = await gmailService.fetchNewEmails(user.gmailRefreshToken, since);
          
          // Handle token expiration - mark user as disconnected and notify
          if (result.tokenExpired) {
            console.log(`[sync-scheduler] Gmail token expired for user ${user.name}, marking as disconnected and sending notification`);
            
            // Update user to mark Gmail as disconnected
            await db.update(users)
              .set({ 
                gmailConnected: false,
                gmailRefreshToken: null
              })
              .where(eq(users.id, user.id));
            
            // Create notification for the user
            await storage.createNotification({
              userId: user.id,
              type: 'system',
              title: 'Gmail Reconnection Required',
              message: 'Your Gmail connection has expired. Please reconnect your Gmail account in Settings to continue syncing emails.',
              link: '/settings',
            }, tenantId);
            
            console.log(`[sync-scheduler] User ${user.name} notified about Gmail reconnection`);
            continue; // Skip to next user
          }
          
          const emails = result.emails;
          console.log(`[sync-scheduler] Found ${emails.length} new emails for user ${user.name}`);
          
          // Process each email
          let processedCount = 0;
          for (const email of emails) {
            // Check for duplicates
            const existingActivity = await db.select().from(activities).where(and(
              eq(activities.externalId, email.id),
              eq(activities.externalSource, 'gmail'),
              eq(activities.contractorId, tenantId)
            )).limit(1);
            
            if (existingActivity.length > 0) {
              continue;
            }
            
            // Match email to contacts
            const fromEmail = email.from;
            const toEmails = email.to || [];
            const isOutbound = fromEmail.toLowerCase() === user.gmailEmail?.toLowerCase();
            
            // Get all contacts to match against
            const contactsData = await storage.getContacts(tenantId);
            let matchingContact;
            if (isOutbound && toEmails.length > 0) {
              // For outbound, check if any recipient matches a contact's email
              matchingContact = contactsData.find((contact: any) => 
                contact.emails && toEmails.some((toEmail: string) =>
                  contact.emails.some((e: string) => e.toLowerCase() === toEmail.toLowerCase())
                )
              );
            } else if (!isOutbound) {
              // For inbound, match on sender
              matchingContact = contactsData.find((contact: any) => 
                contact.emails && contact.emails.some((e: string) => e.toLowerCase() === fromEmail.toLowerCase())
              );
            }
            
            // Also try to match estimates
            const estimatesData = await storage.getEstimates(tenantId);
            let matchingEstimate;
            if (isOutbound && toEmails.length > 0) {
              // For outbound, check if any recipient matches an estimate's email
              matchingEstimate = estimatesData.find((estimate: any) => 
                estimate.emails && toEmails.some((toEmail: string) =>
                  estimate.emails.some((e: string) => e.toLowerCase() === toEmail.toLowerCase())
                )
              );
            } else if (!isOutbound) {
              // For inbound, match on sender
              matchingEstimate = estimatesData.find((estimate: any) => 
                estimate.emails && estimate.emails.some((e: string) => e.toLowerCase() === fromEmail.toLowerCase())
              );
            }
            
            const emailMetadata = {
              subject: email.subject,
              to: email.to,
              from: email.from,
              messageId: email.id,
              direction: isOutbound ? 'outbound' : 'inbound',
            };
            
            // Only store email as an activity if it matches a CRM contact or estimate
            if (!matchingContact && !matchingEstimate) {
              continue;
            }

            await storage.createActivity({
              type: 'email',
              title: isOutbound ? `Email sent: ${email.subject}` : `Email received: ${email.subject}`,
              content: email.body,
              metadata: JSON.stringify(emailMetadata),
              contactId: matchingContact?.id || null,
              estimateId: matchingEstimate?.id || null,
              userId: user.id,
              externalId: email.id,
              externalSource: 'gmail',
            }, tenantId);
            
            processedCount++;
          }
          
          // Update last sync time
          await db.update(users)
            .set({ gmailLastSyncAt: new Date() })
            .where(eq(users.id, user.id));
          
          console.log(`[sync-scheduler] Processed ${processedCount} emails for user ${user.name}`);
          
        } catch (userError: any) {
          console.error(`[sync-scheduler] Error syncing Gmail for user ${user.name} (${user.gmailEmail}):`, {
            message: userError.message,
            code: userError.code,
            status: userError.status,
            errors: userError.errors
          });
          // Continue with other users
        }
      }
      
    } catch (error: any) {
      console.error(`[sync-scheduler] Error in Gmail sync:`, {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')
      });
      throw error;
    }
  }

  /**
   * Calculate the next sync time based on frequency
   */
  private calculateNextSyncTime(frequency: 'daily' | 'weekly' | 'hourly' | 'every-5-minutes', fromTime: Date = new Date()): Date {
    const next = new Date(fromTime);
    
    switch (frequency) {
      case 'every-5-minutes':
        next.setMinutes(next.getMinutes() + 5);
        break;
      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;
      case 'daily':
        next.setDate(next.getDate() + 1);
        // Set to 2 AM for daily syncs to avoid peak hours
        next.setHours(2, 0, 0, 0);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        next.setHours(2, 0, 0, 0);
        break;
    }
    
    return next;
  }

  /**
   * Enable auto-scheduling when an integration is enabled
   */
  async onIntegrationEnabled(tenantId: string, integrationName: string) {
    if (integrationName === 'housecall-pro') {
      await this.scheduleSync(tenantId, integrationName, 'daily');
    } else if (integrationName === 'gmail') {
      // Sync Gmail every 5 minutes for near real-time updates
      await this.scheduleSync(tenantId, integrationName, 'every-5-minutes');
    }
  }

  /**
   * Remove scheduling when an integration is disabled
   */
  async onIntegrationDisabled(tenantId: string, integrationName: string) {
    await this.removeSchedule(tenantId, integrationName);
  }
}

export const syncScheduler = new SyncScheduler();