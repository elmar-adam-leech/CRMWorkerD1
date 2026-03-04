import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
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

  app.post("/api/jobs", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const jobData = insertJobSchema.omit({ contractorId: true }).parse(req.body);
      const job = await storage.createJob(jobData, req.user!.contractorId);
      
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid job data", errors: error.errors });
        return;
      }
      if (error instanceof Error && error.message.includes('Customer not found')) {
        res.status(400).json({ message: error.message });
        return;
      }
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  app.put("/api/jobs/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro job (read-only for tracking purposes)
      const existingJob = await storage.getJob(req.params.id, req.user!.contractorId);
      if (!existingJob) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro jobs - they're read-only for tracking only
      if (existingJob.externalSource === 'housecall-pro') {
        res.status(403).json({ 
          message: "Cannot edit Housecall Pro jobs - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
        });
        return;
      }

      const updateData = insertJobSchema.omit({ contractorId: true, contactId: true }).partial().parse(req.body);
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid job data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update job" });
    }
  });

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

  app.get("/api/estimates/:id", asyncHandler(async (req, res) => {
    const estimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    res.json(estimate);
  }));

  app.post("/api/estimates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const estimateData = insertEstimateSchema.omit({ contractorId: true }).parse(req.body);
      const estimate = await storage.createEstimate(estimateData, req.user!.contractorId);
      
      // Broadcast estimate creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_created',
        estimateId: estimate.id
      });

      // Trigger workflows for estimate creation
      workflowEngine.triggerWorkflowsForEvent('estimate_created', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for estimate creation:', error);
      });
      
      res.status(201).json(estimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
        return;
      }
      if (error instanceof Error && error.message.includes('Customer not found')) {
        res.status(400).json({ message: error.message });
        return;
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  app.put("/api/estimates/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro estimate (read-only for tracking purposes)
      const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!existingEstimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro estimates - they're read-only for tracking only
      if (existingEstimate.externalSource === 'housecall-pro') {
        res.status(403).json({ 
          message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
        });
        return;
      }

      const updateData = insertEstimateSchema.omit({ contractorId: true, contactId: true }).partial().parse(req.body);
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update estimate" });
    }
  });

  app.patch("/api/estimates/:id/follow-up", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro estimate (read-only for tracking purposes)
      const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!existingEstimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro estimates - they're read-only for tracking only
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
      const { followUpDate } = followUpSchema.parse(req.body);
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid follow-up date", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update follow-up date" });
    }
  });

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

  app.post("/api/activities", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activityData = insertActivitySchema.omit({ contractorId: true }).parse({
        ...req.body,
        userId: req.user!.userId // Automatically set the current user as the creator
      });
      const activity = await storage.createActivity(activityData, req.user!.contractorId);
      
      // Automatically mark contact as contacted for communication activities
      const contactId = activity.contactId;
      if (contactId && ['call', 'email', 'sms'].includes(activity.type)) {
        await storage.markContactContacted(contactId, req.user!.contractorId, req.user!.userId);
      }
      
      res.status(201).json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid activity data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  app.put("/api/activities/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData = insertActivitySchema.omit({ contractorId: true, userId: true }).partial().parse(req.body);
      const activity = await storage.updateActivity(req.params.id, updateData, req.user!.contractorId);
      if (!activity) {
        res.status(404).json({ message: "Activity not found" });
        return;
      }
      res.json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid activity data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update activity" });
    }
  });

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
