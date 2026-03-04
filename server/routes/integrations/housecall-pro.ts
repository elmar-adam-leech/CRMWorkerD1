import type { Express, Response } from "express";
import { storage } from "../../storage";
import { userContractors } from "@shared/schema";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { housecallProService } from "../../housecall-pro-service";
import { requireAuth, requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../../auth-service";
import { CredentialService } from "../../credential-service";
import { syncStatus } from "../../sync-status-store";
import crypto from "crypto";
import { asyncHandler } from "../../utils/async-handler";

export function registerHousecallProRoutes(app: Express): void {
  // Housecall Pro integration routes
  app.get("/api/housecall-pro/status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({ 
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true 
      });
      return;
    }

    const isConfigured = await housecallProService.isConfigured(req.user!.contractorId);
    if (!isConfigured) {
      res.json({ configured: false, connected: false });
      return;
    }
    
    const connection = await housecallProService.checkConnection(req.user!.contractorId);
    res.json({ 
      configured: true, 
      connected: connection.connected,
      error: connection.error 
    });
  }));

  app.get("/api/housecall-pro/employees", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({ 
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true 
      });
      return;
    }

    const result = await housecallProService.getEmployees(req.user!.contractorId);
    if (!result.success) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.json(result.data);
  }));

  app.get("/api/housecall-pro/availability", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({ 
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true 
      });
      return;
    }

    const { date, estimatorIds } = req.query;
    
    if (!date || typeof date !== 'string') {
      res.status(400).json({ message: "Date parameter is required (YYYY-MM-DD format)" });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      return;
    }

    let estimatorIdArray: string[] | undefined;
    if (estimatorIds) {
      if (typeof estimatorIds === 'string') {
        estimatorIdArray = estimatorIds.split(',').filter(id => id.trim());
      } else if (Array.isArray(estimatorIds)) {
        estimatorIdArray = (estimatorIds as string[]).filter(id => typeof id === 'string' && id.trim());
      }
    }

    const result = await housecallProService.getEstimatorAvailability(
      req.user!.contractorId, 
      date, 
      estimatorIdArray
    );
    
    if (!result.success) {
      res.status(400).json({ message: result.error });
      return;
    }
    
    res.json(result.data);
  }));

  // Get HCP estimates for a specific employee on a specific date
  app.get("/api/housecall/employee-estimates", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId, date } = req.query;
    
    if (!employeeId || !date) {
      res.status(400).json({ message: "employeeId and date are required" });
      return;
    }
    
    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);
    
    const result = await housecallProService.getEmployeeScheduledEstimates(
      req.user!.contractorId, 
      employeeId as string, 
      startOfDay, 
      endOfDay
    );
    
    if (!result.success) {
      console.error('[HCP] Failed to fetch employee estimates:', result.error);
      res.json([]);
      return;
    }
    
    const scheduledEstimates: Array<{id: string, scheduled_start: string, scheduled_end: string}> = [];
    
    for (const est of (result.data || [])) {
      if (est.scheduled_start && est.scheduled_end) {
        scheduledEstimates.push({
          id: est.id,
          scheduled_start: est.scheduled_start,
          scheduled_end: est.scheduled_end,
        });
      }
      if (est.schedule?.scheduled_start && est.schedule?.scheduled_end) {
        scheduledEstimates.push({
          id: est.id,
          scheduled_start: est.schedule.scheduled_start,
          scheduled_end: est.schedule.scheduled_end,
        });
      }
      if (est.options && Array.isArray(est.options)) {
        for (const opt of est.options) {
          if (opt.schedule?.start_time && opt.schedule?.end_time) {
            scheduledEstimates.push({
              id: est.id,
              scheduled_start: opt.schedule.start_time,
              scheduled_end: opt.schedule.end_time,
            });
          }
          if (opt.scheduled_start && opt.scheduled_end) {
            scheduledEstimates.push({
              id: est.id,
              scheduled_start: opt.scheduled_start,
              scheduled_end: opt.scheduled_end,
            });
          }
        }
      }
    }
    
    res.json(scheduledEstimates);
  }));

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

      // ── Estimates sync ────────────────────────────────────────────────────────
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

      // ── Jobs sync ─────────────────────────────────────────────────────────────
      if (syncType === 'jobs' || syncType === 'all') {
        syncStatus.set(contractorId, {
          isRunning: true,
          progress: 'Syncing jobs...',
          error: null,
          lastSync: null,
          startTime: new Date()
        });

        console.log(`[housecall-pro-sync] Starting jobs sync for tenant ${contractorId}`);

        const jobsBefore = await storage.getJobs(contractorId);
        const jobsCountBefore = jobsBefore.length;

        const { syncScheduler } = await import('../../sync-scheduler');
        await syncScheduler.syncHousecallProJobs(contractorId);

        const jobsAfter = await storage.getJobs(contractorId);
        newJobs = Math.max(0, jobsAfter.length - jobsCountBefore);

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

  // Sync status API endpoint
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

  // Housecall Pro sync start date management
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

  // ========== Unified Scheduling API ==========

  app.post("/api/scheduling/sync-users", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const result = await housecallSchedulingService.syncHousecallUsers(req.user!.contractorId);
    res.json(result);
  }));

  app.get("/api/scheduling/salespeople", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const teamMembers = await housecallSchedulingService.getTeamMembers(req.user!.contractorId);
    res.json(teamMembers);
  }));

  app.get("/api/scheduling/availability", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate, days } = req.query;
    
    let start: Date;
    let end: Date;
    
    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    } else {
      start = new Date();
      const daysToFetch = days ? parseInt(days as string) : 14;
      end = new Date();
      end.setDate(end.getDate() + daysToFetch);
    }
    
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    
    const contractor = await storage.getContractor(req.user!.contractorId);
    const timezone = (contractor as any)?.timezone || 'America/New_York';
    
    const slots = await housecallSchedulingService.getUnifiedAvailability(req.user!.contractorId, start, end, timezone);
    
    res.json({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      slotDurationMinutes: 60,
      bufferMinutes: 30,
      slots: slots.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        availableCount: slot.availableSalespersonIds.length,
      }))
    });
  }));

  app.post("/api/scheduling/book", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startTime, title, customerName, customerEmail, customerPhone, customerAddress, customerAddressComponents, notes, contactId, salespersonId, housecallProEmployeeId } = req.body;
    
    if (!startTime || !title || !customerName) {
      res.status(400).json({ message: "startTime, title, and customerName are required" });
      return;
    }
    
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const result = await housecallSchedulingService.bookAppointment(req.user!.contractorId, {
      startTime: new Date(startTime),
      title,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerAddressComponents,
      notes,
      contactId,
      salespersonId,
      housecallProEmployeeId,
    });
    
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json({ message: result.error });
    }
  }));

  app.get("/api/scheduling/bookings", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;
    
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const bookings = await housecallSchedulingService.getBookings(
      req.user!.contractorId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    
    res.json(bookings);
  }));

  app.patch("/api/scheduling/salespeople/:userId", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;
    const { isSalesperson, calendarColor, workingDays, workingHoursStart, workingHoursEnd, hasCustomSchedule } = req.body;
    
    const updateData: any = {};
    
    if (isSalesperson !== undefined) updateData.isSalesperson = isSalesperson;
    if (calendarColor !== undefined) updateData.calendarColor = calendarColor;
    if (workingDays !== undefined) updateData.workingDays = workingDays;
    if (workingHoursStart !== undefined) updateData.workingHoursStart = workingHoursStart;
    if (workingHoursEnd !== undefined) updateData.workingHoursEnd = workingHoursEnd;
    if (hasCustomSchedule !== undefined) updateData.hasCustomSchedule = hasCustomSchedule;
    
    await db.update(userContractors)
      .set(updateData)
      .where(and(
        eq(userContractors.userId, userId),
        eq(userContractors.contractorId, req.user!.contractorId)
      ));
    
    res.json({ message: "Salesperson updated successfully" });
  }));

  // HCP webhook config routes
  app.get("/api/integrations/housecall-pro/webhook-config", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    const webhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/housecall-pro`;
    let secretConfigured = false;
    try {
      const secret = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_secret');
      secretConfigured = !!(secret && secret.trim());
    } catch { /* no secret stored yet */ }
    res.json({ webhookUrl, secretConfigured });
  }));

  app.post("/api/integrations/housecall-pro/webhook-secret", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { secret } = req.body;
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
      res.status(400).json({ error: 'Secret is required' });
      return;
    }
    await CredentialService.setCredential(req.user!.contractorId, 'housecallpro', 'webhook_secret', secret.trim());
    res.json({ success: true });
  }));
}
