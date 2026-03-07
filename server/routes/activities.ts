import type { Express } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertActivitySchema } from "@shared/schema";
import { requireManagerOrAdmin } from "../auth-service";

export function registerActivityRoutes(app: Express): void {
  app.get("/api/activities", asyncHandler(async (req, res) => {
    const { contactId, leadId, customerId, estimateId, jobId, type, limit, offset } = req.query;
    const resolvedContactId = contactId || leadId || customerId;
    const activities = await storage.getActivities(req.user.contractorId, {
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
    const activity = await storage.getActivity(req.params.id, req.user.contractorId);
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
      { ...activityData, userId: req.user.userId },
      req.user.contractorId
    );
    const contactId = activity.contactId;
    if (contactId && ['call', 'email', 'sms'].includes(activity.type)) {
      await storage.markContactContacted(contactId, req.user.contractorId, req.user.userId);
    }
    res.status(201).json(activity);
  }));

  app.put("/api/activities/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const updateData = parseBody(insertActivitySchema.omit({ contractorId: true, userId: true }).partial(), req, res);
    if (!updateData) return;
    const activity = await storage.updateActivity(req.params.id, updateData, req.user.contractorId);
    if (!activity) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }
    res.json(activity);
  }));

  app.delete("/api/activities/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const deleted = await storage.deleteActivity(req.params.id, req.user.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }
    res.json({ message: "Activity deleted successfully" });
  }));
}
