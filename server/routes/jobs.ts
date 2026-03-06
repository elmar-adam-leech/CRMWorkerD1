import type { Express } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertJobSchema, jobsPaginationQuerySchema } from "@shared/schema";
import { requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { z } from "zod";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";

export function registerJobRoutes(app: Express): void {
  app.get("/api/jobs", asyncHandler(async (req, res) => {
    const jobs = await storage.getJobs(req.user!.contractorId);
    res.json(jobs);
  }));

  app.get("/api/jobs/paginated", async (req: AuthenticatedRequest, res: any, next: any) => {
    try {
      // ZodError from .parse() propagates to next() → global ZodError middleware → 400 response
      const validatedQuery = jobsPaginationQuerySchema.parse(req.query);
      const paginatedJobs = await storage.getJobsPaginated(req.user!.contractorId, validatedQuery);
      res.json(paginatedJobs);
    } catch (error) {
      if (error instanceof z.ZodError) return next(error);
      console.error('Paginated jobs error:', error);
      res.status(500).json({ message: "Failed to fetch paginated jobs" });
    }
  });

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

    try {
      const contact = await storage.getContact(job.contactId, req.user!.contractorId);
      if (contact && !contact.tags?.includes('Customer')) {
        const updatedTags = [...(contact.tags || []), 'Customer'];
        await storage.updateContact(contact.id, { tags: updatedTags }, req.user!.contractorId);
        broadcastToContractor(req.user!.contractorId, { type: 'contact_updated', contactId: contact.id, contactType: contact.type });
      }
    } catch (tagError) {
      console.error('[Job Creation] Failed to add Customer tag:', tagError);
    }

    broadcastToContractor(req.user!.contractorId, { type: 'job_created', jobId: job.id });
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

    broadcastToContractor(req.user!.contractorId, { type: 'job_updated', jobId: job.id });
    workflowEngine.triggerWorkflowsForEvent('job_updated', job as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
      console.error('[Workflow] Error triggering workflows for job update:', error);
    });

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

    broadcastToContractor(req.user!.contractorId, { type: 'job_deleted', jobId: req.params.id });
    res.status(200).json({ message: "Job deleted successfully" });
  }));
}
