import type { Express, Response } from "express";
import { storage } from "../../storage";
import { housecallProService } from "../../housecall-pro-service";
import { requireAuth, requireAdmin, type AuthenticatedRequest } from "../../auth-service";
import { syncStatus } from "../../sync-status-store";
import crypto from "crypto";
import { asyncHandler } from "../../utils/async-handler";

export function registerHcpSyncRoutes(app: Express): void {
  app.post("/api/housecall-pro/sync", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const syncType = (req.query.type as string) || 'all';

    const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    syncStatus.set(contractorId, {
      isRunning: true,
      progress: 'Starting sync...',
      error: null,
      lastSync: null,
      startTime: new Date()
    });

    console.log(`[housecall-pro-sync] Starting manual sync (type=${syncType}) for tenant ${contractorId}`);

    const syncStartDate = await storage.getHousecallProSyncStartDate(req.user!.contractorId);
    console.log(`[housecall-pro-sync] Using sync start date filter: ${syncStartDate ? syncStartDate.toISOString() : 'none'}`);

    let newEstimates = 0;
    let updatedEstimates = 0;
    let newJobs = 0;

    if (syncType === 'estimates' || syncType === 'all') {
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing estimates...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

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
          console.log(`[housecall-pro-sync] Time limit reached at page ${page}, aborting pagination`);
          break;
        }

        const estimatesParams = { ...baseEstimatesParams, page };
        console.log(`[housecall-pro-sync] Fetching estimates page ${page}...`);

        syncStatus.set(contractorId, {
          isRunning: true,
          progress: `Fetching estimates page ${page}...`,
          error: null,
          lastSync: null,
          startTime: new Date()
        });

        const estimatesResult = await housecallProService.getEstimates(req.user!.contractorId, estimatesParams);
        if (!estimatesResult.success) {
          console.error(`[housecall-pro-sync] Failed to fetch estimates page ${page}: ${estimatesResult.error}`);
          res.status(400).json({ message: estimatesResult.error });
          return;
        }

        const pageEstimates = estimatesResult.data || [];
        console.log(`[housecall-pro-sync] Page ${page}: fetched ${pageEstimates.length} estimates`);

        if (!pageEstimates.length) {
          console.log(`[housecall-pro-sync] No more estimates found, stopping pagination`);
          break;
        }

        allHousecallProEstimates = allHousecallProEstimates.concat(pageEstimates);

        if (pageEstimates.length < baseEstimatesParams.page_size) {
          console.log(`[housecall-pro-sync] Page ${page} returned ${pageEstimates.length} estimates (< ${baseEstimatesParams.page_size}), stopping pagination`);
          keepGoing = false;
        } else {
          page++;
        }
      }

      console.log(`[housecall-pro-sync] Fetched ${allHousecallProEstimates.length} total estimates from Housecall Pro across ${page} pages`);

      const extractPhone = (customer?: any) => {
        if (!customer) return '';
        return customer.phone_numbers?.[0]?.phone_number ||
               customer.mobile_number ||
               customer.home_number ||
               customer.work_number ||
               customer.phone ||
               customer.primary_phone ||
               customer.contact_phone ||
               customer.phone_number ||
               '';
      };

      const extractAddress = (location?: any) => {
        if (!location) return '';
        const addr = location.service_location || location.address || location;
        if (!addr) return '';
        return `${addr.street || ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`.replace(/^,\s*/, '').trim();
      };

      for (const hcpEstimate of allHousecallProEstimates) {
        try {
          const existingEstimate = await storage.getEstimateByHousecallProEstimateId(hcpEstimate.id, req.user!.contractorId);

          if (existingEstimate) {
            const updateData = {
              status: hcpEstimate.work_status === 'completed' ? 'approved' as const :
                     hcpEstimate.work_status === 'canceled' ? 'rejected' as const : 'pending' as const,
              amount: (Math.round((hcpEstimate.total_amount || hcpEstimate.total || hcpEstimate.total_price || hcpEstimate.amount || 0) / 100 * 100) / 100).toFixed(2),
              description: hcpEstimate.description || '',
              scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
            };

            await storage.updateEstimate(existingEstimate.id, updateData, req.user!.contractorId);
            updatedEstimates++;
            console.log(`[housecall-pro-sync] Updated estimate ${existingEstimate.id} from HCP ${hcpEstimate.id}`);
          } else {
            const customerData = hcpEstimate.customer;
            if (!customerData) {
              console.warn(`[housecall-pro-sync] Skipping estimate ${hcpEstimate.id} - no customer data`);
              continue;
            }

            let localCustomer = await storage.getContactByExternalId(customerData.id, 'housecall-pro', req.user!.contractorId);

            if (!localCustomer) {
              const extractEmail = (customer?: any) => {
                if (!customer) return '';
                return customer.email || customer.email_address || customer.primary_email || customer.contact_email || '';
              };

              const newCustomerData = {
                id: crypto.randomUUID(),
                name: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim() || 'Unknown Customer',
                type: 'customer' as const,
                email: extractEmail(customerData),
                phone: extractPhone(customerData),
                address: extractAddress(hcpEstimate),
                externalId: customerData.id,
                externalSource: 'housecall-pro' as const,
                createdAt: hcpEstimate.created_at ? new Date(hcpEstimate.created_at) : new Date(),
                updatedAt: hcpEstimate.modified_at ? new Date(hcpEstimate.modified_at) : new Date(),
              };

              localCustomer = await storage.createContact(newCustomerData, req.user!.contractorId);
              console.log(`[housecall-pro-sync] Created customer ${localCustomer.id} from embedded data in estimate ${hcpEstimate.id}`);
            }

            let amount = hcpEstimate.total_amount ?? hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.amount ?? null;
            if (amount === null && Array.isArray(hcpEstimate.options)) {
              amount = hcpEstimate.options.reduce((max: number, option: any) => Math.max(max, Number(option.total_amount || 0)), 0);
            }
            const amountInDollars = typeof amount === 'number' ? (amount / 100).toFixed(2) : '0.00';

            let estimateTitle = 'Estimate from Housecall Pro';
            if (hcpEstimate.number) {
              estimateTitle = `Estimate #${hcpEstimate.number}`;
            } else if (hcpEstimate.estimate_number) {
              estimateTitle = `Estimate #${hcpEstimate.estimate_number}`;
            } else if (hcpEstimate.name) {
              estimateTitle = hcpEstimate.name;
            } else if (hcpEstimate.id) {
              estimateTitle = `Estimate #${hcpEstimate.id}`;
            }

            const estimateData = {
              id: crypto.randomUUID(),
              contactId: localCustomer.id,
              title: estimateTitle,
              description: hcpEstimate.description || '',
              amount: amountInDollars,
              status: hcpEstimate.work_status === 'completed' ? 'approved' as const :
                     hcpEstimate.work_status === 'canceled' ? 'rejected' as const : 'pending' as const,
              createdAt: hcpEstimate.created_at ? new Date(hcpEstimate.created_at) : new Date(),
              updatedAt: hcpEstimate.modified_at ? new Date(hcpEstimate.modified_at) : new Date(),
              validUntil: hcpEstimate.expires_at ? new Date(hcpEstimate.expires_at) :
                         hcpEstimate.expiry_date ? new Date(hcpEstimate.expiry_date) :
                         hcpEstimate.valid_until ? new Date(hcpEstimate.valid_until) : null,
              scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
              externalId: hcpEstimate.id,
              externalSource: 'housecall-pro' as const,
            };

            await storage.createEstimate(estimateData, req.user!.contractorId);
            newEstimates++;
            console.log(`[housecall-pro-sync] Created estimate ${estimateData.id} from HCP ${hcpEstimate.id}`);
          }
        } catch (itemError) {
          console.error(`[housecall-pro-sync] Failed to process estimate ${hcpEstimate.id}:`, itemError);
        }
      }
    }

    if (syncType === 'jobs' || syncType === 'all') {
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing jobs...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[housecall-pro-sync] Starting jobs sync for tenant ${contractorId}`);

      const jobsCountBefore = await storage.getJobsCount(contractorId);

      const { syncScheduler } = await import('../../sync-scheduler');
      await syncScheduler.syncHousecallProJobs(contractorId);

      const jobsCountAfter = await storage.getJobsCount(contractorId);
      newJobs = Math.max(0, jobsCountAfter - jobsCountBefore);

      console.log(`[housecall-pro-sync] Jobs sync complete. New jobs: ${newJobs}`);
    }

    console.log(`[housecall-pro-sync] Sync (type=${syncType}) completed for tenant ${contractorId}`);

    syncStatus.set(contractorId, {
      isRunning: false,
      progress: null,
      error: null,
      lastSync: new Date().toISOString(),
      startTime: null
    });

    res.json({
      message: "Sync completed successfully",
      newEstimates,
      updatedEstimates,
      newJobs,
      syncedAt: new Date().toISOString(),
    });
  }));

  app.get("/api/sync-status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const status = syncStatus.get(contractorId) || {
      isRunning: false,
      progress: null,
      error: null,
      lastSync: null,
      startTime: null
    };

    res.json({
      isRunning: status.isRunning,
      progress: status.progress,
      error: status.error,
      lastSync: status.lastSync
    });
  }));

  app.get("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const syncStartDate = await storage.getHousecallProSyncStartDate(req.user!.contractorId);
    res.json({ syncStartDate: syncStartDate ? syncStartDate.toISOString() : null });
  }));

  app.post("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { syncStartDate } = req.body;
    const parsedDate = syncStartDate ? new Date(syncStartDate) : null;
    await storage.setHousecallProSyncStartDate(req.user!.contractorId, parsedDate);
    res.json({
      message: "Sync start date updated successfully",
      syncStartDate: parsedDate ? parsedDate.toISOString() : null
    });
  }));
}
