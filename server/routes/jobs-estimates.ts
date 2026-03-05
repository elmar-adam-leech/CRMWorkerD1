import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertJobSchema, insertEstimateSchema, insertActivitySchema, paginatedEstimatesSchema, paginatedJobsSchema, jobsPaginationQuerySchema } from "@shared/schema";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { z } from "zod";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { housecallProService } from "../housecall-pro-service";

export function registerJobEstimateRoutes(app: Express): void {
  app.get("/api/jobs", asyncHandler(async (req, res) => {
    const jobs = await storage.getJobs(req.user!.contractorId);
    res.json(jobs);
  }));

  // Paginated jobs endpoint
  app.get("/api/jobs/paginated", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query parameters with schema
      const validatedQuery = jobsPaginationQuerySchema.parse(req.query);
      
      const paginatedJobs = await storage.getJobsPaginated(req.user!.contractorId, validatedQuery);
      
      res.json(paginatedJobs);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid query parameters", errors: error.errors });
        return;
      }
      console.error('Paginated jobs error:', error);
      res.status(500).json({ message: "Failed to fetch paginated jobs" });
    }
  });

  // Jobs status counts endpoint
  app.get("/api/jobs/status-counts", asyncHandler(async (req, res) => {
    const search = req.query.search as string;
    const counts = await storage.getJobsStatusCounts(req.user!.contractorId, { search });
    res.json(counts);
  }));

  app.get("/api/jobs/:id", asyncHandler(async (req, res) => {
    const job = await storage.getJob(req.params.id, req.user!.contractorId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    res.json(job);
  }));

  app.post("/api/jobs", asyncHandler(async (req, res) => {
    const jobData = parseBody(insertJobSchema.omit({ contractorId: true }), req, res);
    if (!jobData) return;
    let job: Awaited<ReturnType<typeof storage.createJob>>;
    try {
      job = await storage.createJob(jobData, req.user!.contractorId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Customer not found')) {
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }
      
      // Automatically add "Customer" tag to the contact
      try {
        const contact = await storage.getContact(job.contactId, req.user!.contractorId);
        if (contact && !contact.tags?.includes('Customer')) {
          const updatedTags = [...(contact.tags || []), 'Customer'];
          await storage.updateContact(contact.id, { tags: updatedTags }, req.user!.contractorId);
          
          // Broadcast contact update for real-time tag display
          broadcastToContractor(req.user!.contractorId, {
            type: 'contact_updated',
            contactId: contact.id,
            contactType: contact.type
          });
        }
      } catch (tagError) {
        console.error('[Job Creation] Failed to add Customer tag:', tagError);
        // Don't fail the job creation if tagging fails
      }
      
      // Broadcast job creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'job_created',
        jobId: job.id
      });

      // Trigger workflows for job creation
      workflowEngine.triggerWorkflowsForEvent('job_created', job as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for job creation:', error);
      });
      
    res.status(201).json(job);
  }));

  app.put("/api/jobs/:id", asyncHandler(async (req, res) => {
    const existingJob = await storage.getJob(req.params.id, req.user!.contractorId);
    if (!existingJob) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    if (existingJob.externalSource === 'housecall-pro') {
      res.status(403).json({ 
        message: "Cannot edit Housecall Pro jobs - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
      });
      return;
    }
    const updateData = parseBody(insertJobSchema.omit({ contractorId: true, contactId: true }).partial(), req, res);
    if (!updateData) return;
      const job = await storage.updateJob(req.params.id, updateData, req.user!.contractorId);
      if (!job) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      // Broadcast job update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'job_updated',
        jobId: job.id
      });

      // Trigger workflows for job update
      workflowEngine.triggerWorkflowsForEvent('job_updated', job as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for job update:', error);
      });

      // Also trigger status_changed workflows when status is being updated
      if (updateData.status) {
        workflowEngine.triggerWorkflowsForEvent('job_status_changed', job as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for job status change:', error);
        });
      }
      
    res.json(job);
  }));

  app.delete("/api/jobs/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const job = await storage.getJob(req.params.id, req.user!.contractorId);
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    
    const deleted = await storage.deleteJob(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Job not found or already deleted" });
      return;
    }
    
    // Broadcast job deletion to all connected clients for real-time updates
    broadcastToContractor(req.user!.contractorId, {
      type: 'job_deleted',
      jobId: req.params.id
    });
    
    res.status(200).json({ message: "Job deleted successfully" });
  }));

  // Estimate routes
  app.get("/api/estimates", asyncHandler(async (req, res) => {
    const estimates = await storage.getEstimates(req.user!.contractorId);
    res.json(estimates);
  }));

  // Paginated estimates endpoint
  app.get("/api/estimates/paginated", asyncHandler(async (req, res) => {
    const cursor = req.query.cursor as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const search = req.query.search as string;

    const result = await storage.getEstimatesPaginated(req.user!.contractorId, {
      cursor,
      limit,
      status,
      search,
    });

    res.json(result);
  }));

  // Estimates status counts endpoint
  app.get("/api/estimates/status-counts", asyncHandler(async (req, res) => {
    const search = req.query.search as string;
    const counts = await storage.getEstimatesStatusCounts(req.user!.contractorId, { search });
    res.json(counts);
  }));

  app.get("/api/estimates/follow-ups", asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const estimatesList = await storage.getEstimatesWithFollowUp(req.user!.contractorId, limit);
    res.json(estimatesList);
  }));

  app.get("/api/estimates/:id", asyncHandler(async (req, res) => {
    const estimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    res.json(estimate);
  }));

  app.post("/api/estimates", asyncHandler(async (req, res) => {
    const estimateData = parseBody(
      insertEstimateSchema.omit({ contractorId: true }).extend({
        amount: z.union([z.string(), z.number()])
          .transform(val => String(val))
          .optional()
          .default('0.00'),
      }),
      req,
      res
    );
    if (!estimateData) return;
    let estimate: Awaited<ReturnType<typeof storage.createEstimate>>;
    try {
      estimate = await storage.createEstimate(estimateData, req.user!.contractorId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Customer not found')) {
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }

    // Sync to Housecall Pro if integration is enabled
    const hcpEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (hcpEnabled && estimate.contactId) {
      try {
        const contact = await storage.getContact(estimate.contactId, req.user!.contractorId);
        if (contact) {
          // Check both columns during transition period (before column cleanup)
          let hcpCustomerId: string | undefined = contact.externalId || contact.housecallProCustomerId || undefined;

          if (!hcpCustomerId) {
            const contactEmail = contact.emails?.[0];
            const contactPhone = contact.phones?.[0];

            // Search HCP for existing customer by email/phone
            if (contactEmail || contactPhone) {
              const searchResult = await housecallProService.searchCustomers(
                req.user!.contractorId,
                { email: contactEmail, phone: contactPhone }
              );
              if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
                hcpCustomerId = searchResult.data[0].id;
              }
            }

            // Create new HCP customer if still not found
            if (!hcpCustomerId) {
              const nameParts = contact.name.split(' ');
              const customerResult = await housecallProService.createCustomer(
                req.user!.contractorId,
                {
                  first_name: nameParts[0] || contact.name,
                  last_name: nameParts.slice(1).join(' ') || '',
                  email: contact.emails?.[0] || '',
                  mobile_number: contact.phones?.[0] || '',
                }
              );
              if (customerResult.success && customerResult.data?.id) {
                hcpCustomerId = customerResult.data.id;
              }
            }

            // Persist HCP customer ID back to contact
            if (hcpCustomerId) {
              await storage.updateContact(
                contact.id,
                { externalId: hcpCustomerId, externalSource: 'housecall-pro', housecallProCustomerId: hcpCustomerId },
                req.user!.contractorId
              );
            }
          }

          // Build optional address from contact's stored address string
          let hcpAddress: { street: string; city: string; state: string; zip: string; country: string } | undefined;
          if (contact.address) {
            const parts = contact.address.split(',').map((s: string) => s.trim());
            const stateZip = (parts[2] || '').trim().split(' ');
            hcpAddress = {
              street: parts[0] || contact.address,
              city: parts[1] || '',
              state: stateZip[0] || '',
              zip: stateZip[1] || '',
              country: 'US',
            };
          }

          // Create estimate in HCP
          if (hcpCustomerId) {
            const hcpResult = await housecallProService.createEstimate(
              req.user!.contractorId,
              {
                customer_id: hcpCustomerId,
                message: estimate.description || undefined,
                options: [{
                  name: estimate.title,
                  total_amount: estimate.amount && estimate.amount !== '0.00' ? estimate.amount : undefined,
                }],
                address: hcpAddress,
              }
            );

            if (hcpResult.success && hcpResult.data?.id) {
              estimate = await storage.updateEstimate(
                estimate.id,
                { externalId: hcpResult.data.id, externalSource: 'housecall-pro' },
                req.user!.contractorId
              ) ?? estimate;
              console.log('[HCP Sync] Created HCP estimate:', hcpResult.data.id, 'for estimate:', estimate.id);
            } else {
              console.warn('[HCP Sync] Failed to create HCP estimate:', hcpResult.error);
            }
          }
        }
      } catch (hcpErr) {
        console.error('[HCP Sync] Error syncing estimate to HCP:', hcpErr);
        // Don't fail the request — estimate is already saved locally
      }
    }

    broadcastToContractor(req.user!.contractorId, {
      type: 'estimate_created',
      estimateId: estimate.id
    });
    workflowEngine.triggerWorkflowsForEvent('estimate_created', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
      console.error('[Workflow] Error triggering workflows for estimate creation:', error);
    });
    res.status(201).json(estimate);
  }));

  app.put("/api/estimates/:id", asyncHandler(async (req, res) => {
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (existingEstimate.externalSource === 'housecall-pro') {
      res.status(403).json({ 
        message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
      });
      return;
    }
    const updateData = parseBody(insertEstimateSchema.omit({ contractorId: true, contactId: true }).partial(), req, res);
    if (!updateData) return;
      const estimate = await storage.updateEstimate(req.params.id, updateData, req.user!.contractorId);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Broadcast estimate update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_updated',
        estimateId: estimate.id
      });

      // Trigger workflows for estimate update
      workflowEngine.triggerWorkflowsForEvent('estimate_updated', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for estimate update:', error);
      });

      // Also trigger status_changed workflows when status is being updated
      if (updateData.status) {
        workflowEngine.triggerWorkflowsForEvent('estimate_status_changed', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for estimate status change:', error);
        });
      }
      
    res.json(estimate);
  }));

  app.patch("/api/estimates/:id/follow-up", asyncHandler(async (req, res) => {
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (existingEstimate.externalSource === 'housecall-pro') {
      res.status(403).json({ 
        message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value." 
      });
      return;
    }
    const followUpSchema = z.object({
      followUpDate: z.string().nullable().optional().transform((val, ctx) => {
        if (!val) return null;
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid date format",
          });
          return z.NEVER;
        }
        return date;
      })
    });
    const parsed = parseBody(followUpSchema, req, res);
    if (!parsed) return;
    const { followUpDate } = parsed;
      const estimate = await storage.updateEstimate(req.params.id, { followUpDate }, req.user!.contractorId);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Log activity for follow-up date change
      try {
        const activityContent = followUpDate 
          ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          : 'Follow-up date cleared';
        
        console.log('[Follow-up] Creating activity for estimate:', { estimateId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'follow_up',
          title: 'Follow-up Date Updated',
          content: activityContent,
          estimateId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Follow-up] Activity created for estimate:', activity.id);
        
        // Broadcast real-time update via WebSocket
        const { broadcastToContractor } = await import('../websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          estimateId: req.params.id,
        });
        
        console.log('[Follow-up] WebSocket broadcast sent for estimate');
      } catch (activityError) {
        console.error('[Follow-up] Error creating activity for estimate:', activityError);
      }
      
      // Broadcast estimate update to all connected clients for real-time estimate list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_updated',
        estimateId: estimate.id
      });
      
    res.json(estimate);
  }));

  app.delete("/api/estimates/:id", asyncHandler(async (req, res) => {
    // Check if estimate exists and belongs to this contractor
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    
    const deleted = await storage.deleteEstimate(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    
    // Broadcast estimate deletion to all connected clients
    broadcastToContractor(req.user!.contractorId, {
      type: 'estimate_deleted',
      estimateId: req.params.id
    });
    
    res.json({ message: "Estimate deleted successfully" });
  }));

  // Activity routes for tracking timestamped notes and interactions
  app.get("/api/activities", asyncHandler(async (req, res) => {
    const { contactId, leadId, customerId, estimateId, jobId, type, limit, offset } = req.query;
    // Support both old (leadId, customerId) and new (contactId) parameter names for backward compatibility
    const resolvedContactId = contactId || leadId || customerId;
    const activities = await storage.getActivities(req.user!.contractorId, {
      contactId: resolvedContactId as string,
      estimateId: estimateId as string,
      jobId: jobId as string,
      type: type as any,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });
    res.json(activities);
  }));

  app.get("/api/activities/:id", asyncHandler(async (req, res) => {
    const activity = await storage.getActivity(req.params.id, req.user!.contractorId);
    if (!activity) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }
    res.json(activity);
  }));

  app.post("/api/activities", asyncHandler(async (req, res) => {
    const activityData = parseBody(insertActivitySchema.omit({ contractorId: true }), req, res);
    if (!activityData) return;
    const activity = await storage.createActivity(
      { ...activityData, userId: req.user!.userId },
      req.user!.contractorId
    );
    const contactId = activity.contactId;
    if (contactId && ['call', 'email', 'sms'].includes(activity.type)) {
      await storage.markContactContacted(contactId, req.user!.contractorId, req.user!.userId);
    }
    res.status(201).json(activity);
  }));

  app.put("/api/activities/:id", asyncHandler(async (req, res) => {
    const updateData = parseBody(insertActivitySchema.omit({ contractorId: true, userId: true }).partial(), req, res);
    if (!updateData) return;
    const activity = await storage.updateActivity(req.params.id, updateData, req.user!.contractorId);
    if (!activity) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }
    res.json(activity);
  }));

  app.delete("/api/activities/:id", asyncHandler(async (req, res) => {
    const deleted = await storage.deleteActivity(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }
    res.json({ message: "Activity deleted successfully" });
  }));


  // Message routes for texting functionality
}
