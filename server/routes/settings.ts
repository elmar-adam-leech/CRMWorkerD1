import type { Express } from "express";
import { storage } from "../storage";
import { requireManagerOrAdmin } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";
import { z } from "zod";

export function registerSettingsRoutes(app: Express): void {
  app.get("/api/business-targets", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const targets = await storage.getBusinessTargets(req.user.contractorId);
    if (!targets) {
      res.json({
        speedToLeadMinutes: 60,
        followUpRatePercent: "80.00",
        setRatePercent: "40.00",
        closeRatePercent: "25.00"
      });
      return;
    }
    res.json(targets);
  }));

  app.post("/api/business-targets", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const targetsSchema = z.object({
      speedToLeadMinutes: z.number().int().min(0),
      followUpRatePercent: z.string(),
      setRatePercent: z.string(),
      closeRatePercent: z.string(),
    }).strict();

    const parsed = targetsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid business targets" });
      return;
    }

    const targets = parsed.data;
    const existingTargets = await storage.getBusinessTargets(req.user.contractorId);
    const result = existingTargets
      ? await storage.updateBusinessTargets(targets, req.user.contractorId)
      : await storage.createBusinessTargets(targets, req.user.contractorId);
    res.json(result);
  }));

  app.get("/api/terminology", asyncHandler(async (req, res) => {
    const settings = await storage.getTerminologySettings(req.user.contractorId);
    if (!settings) {
      res.json({
        leadLabel: 'Lead', leadsLabel: 'Leads',
        estimateLabel: 'Estimate', estimatesLabel: 'Estimates',
        jobLabel: 'Job', jobsLabel: 'Jobs',
        messageLabel: 'Message', messagesLabel: 'Messages',
        templateLabel: 'Template', templatesLabel: 'Templates'
      });
      return;
    }
    res.json(settings);
  }));

  app.post("/api/terminology", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const terminologySchema = z.object({
      leadLabel:       z.string().min(1),
      leadsLabel:      z.string().min(1),
      estimateLabel:   z.string().min(1),
      estimatesLabel:  z.string().min(1),
      jobLabel:        z.string().min(1),
      jobsLabel:       z.string().min(1),
      messageLabel:    z.string().min(1),
      messagesLabel:   z.string().min(1),
      templateLabel:   z.string().min(1),
      templatesLabel:  z.string().min(1),
    });

    const parsed = terminologySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid terminology settings" });
      return;
    }

    const settings = parsed.data;
    const existingSettings = await storage.getTerminologySettings(req.user.contractorId);
    const result = existingSettings
      ? await storage.updateTerminologySettings(settings, req.user.contractorId)
      : await storage.createTerminologySettings(settings, req.user.contractorId);

    const { cacheInvalidation } = await import('../services/cache');
    cacheInvalidation.invalidateTerminologySettings(req.user.contractorId);

    const { broadcastToContractor } = await import('../websocket');
    broadcastToContractor(req.user.contractorId, { type: 'terminology_updated' });

    res.json(result);
  }));

  app.get("/api/booking-slug", asyncHandler(async (req, res) => {
    const contractor = await storage.getContractor(req.user.contractorId);
    if (!contractor) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }
    const protocol = req.protocol;
    const host = req.get('host');
    const bookingUrl = contractor.bookingSlug
      ? `${protocol}://${host}/book/${contractor.bookingSlug}`
      : null;
    res.json({ bookingSlug: contractor.bookingSlug || null, bookingUrl });
  }));

  app.post("/api/booking-slug", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { bookingSlug } = req.body;

    if (bookingSlug) {
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(bookingSlug)) {
        res.status(400).json({ message: "Booking slug can only contain lowercase letters, numbers, and hyphens" });
        return;
      }
      if (bookingSlug.length < 3 || bookingSlug.length > 50) {
        res.status(400).json({ message: "Booking slug must be between 3 and 50 characters" });
        return;
      }
      const existingContractor = await storage.getContractorBySlug(bookingSlug);
      if (existingContractor && existingContractor.id !== req.user.contractorId) {
        res.status(400).json({ message: "This booking slug is already taken" });
        return;
      }
    }

    const updated = await storage.updateContractor(req.user.contractorId, {
      bookingSlug: bookingSlug || null
    });

    if (!updated) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const bookingUrl = bookingSlug
      ? `${protocol}://${host}/book/${bookingSlug}`
      : null;

    res.json({
      bookingSlug: updated.bookingSlug || null,
      bookingUrl,
      message: bookingSlug ? "Booking slug updated successfully" : "Booking slug removed"
    });
  }));
}
