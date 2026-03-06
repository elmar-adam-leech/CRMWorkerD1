import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";
import { z } from "zod";

export function registerSettingsRoutes(app: Express): void {
  // Business targets for contractors
  app.get("/api/business-targets", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Only admins can view business targets
    if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ message: "Only administrators can view business targets" });
      return;
    }

    // Get current targets for the contractor
    const targets = await storage.getBusinessTargets(req.user!.contractorId);
    
    // If no targets exist, return default values
    if (!targets) {
      const defaultTargets = {
        speedToLeadMinutes: 60,
        followUpRatePercent: "80.00",
        setRatePercent: "40.00", 
        closeRatePercent: "25.00"
      };
      res.json(defaultTargets);
      return;
    }
    
    res.json(targets);
  }));

  app.post("/api/business-targets", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Only admins can set business targets
    if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ message: "Only administrators can set business targets" });
      return;
    }

    const targetsSchema = z.object({
      speedToLeadMinutes: z.number().int().min(0),
      // Percentages are stored as NUMERIC(5,2) strings in the DB (e.g. "80.00")
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
    
    // Check if targets already exist for this contractor
    const existingTargets = await storage.getBusinessTargets(req.user!.contractorId);
    
    let result;
    if (existingTargets) {
      // Update existing targets
      result = await storage.updateBusinessTargets(targets, req.user!.contractorId);
    } else {
      // Create new targets
      result = await storage.createBusinessTargets(targets, req.user!.contractorId);
    }
    
    res.json(result);
  }));

  // Terminology settings endpoints
  app.get("/api/terminology", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Get current terminology settings for the contractor
    const settings = await storage.getTerminologySettings(req.user!.contractorId);
    
    // If no settings exist, return default values
    if (!settings) {
      const defaultSettings = {
        leadLabel: 'Lead',
        leadsLabel: 'Leads',
        estimateLabel: 'Estimate',
        estimatesLabel: 'Estimates',
        jobLabel: 'Job',
        jobsLabel: 'Jobs',
        messageLabel: 'Message',
        messagesLabel: 'Messages',
        templateLabel: 'Template',
        templatesLabel: 'Templates'
      };
      res.json(defaultSettings);
      return;
    }
    
    res.json(settings);
  }));

  app.post("/api/terminology", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Only admins can update terminology settings
    if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ message: "Only administrators can update terminology settings" });
      return;
    }

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
    
    // Check if settings already exist for this contractor
    const existingSettings = await storage.getTerminologySettings(req.user!.contractorId);
    
    let result;
    if (existingSettings) {
      // Update existing settings
      result = await storage.updateTerminologySettings(settings, req.user!.contractorId);
    } else {
      // Create new settings
      result = await storage.createTerminologySettings(settings, req.user!.contractorId);
    }
    
    // Invalidate terminology cache so changes take effect immediately
    const { cacheInvalidation } = await import('../services/cache');
    cacheInvalidation.invalidateTerminologySettings(req.user!.contractorId);
    
    res.json(result);
  }));

  // Booking slug configuration endpoints
  app.get("/api/booking-slug", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractor = await storage.getContractor(req.user!.contractorId);
    if (!contractor) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }
    
    // Build the public booking URL
    const protocol = req.protocol;
    const host = req.get('host');
    const bookingUrl = contractor.bookingSlug 
      ? `${protocol}://${host}/book/${contractor.bookingSlug}`
      : null;
    
    res.json({ 
      bookingSlug: contractor.bookingSlug || null,
      bookingUrl 
    });
  }));

  app.post("/api/booking-slug", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Only admins can update booking slug
    if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
      res.status(403).json({ message: "Only administrators can update booking settings" });
      return;
    }

    const { bookingSlug } = req.body;
    
    // Validate slug format (alphanumeric, hyphens, lowercase)
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
      
      // Check if slug is already taken by another contractor
      const existingContractor = await storage.getContractorBySlug(bookingSlug);
      if (existingContractor && existingContractor.id !== req.user!.contractorId) {
        res.status(400).json({ message: "This booking slug is already taken" });
        return;
      }
    }
    
    // Update the contractor's booking slug
    const updated = await storage.updateContractor(req.user!.contractorId, { 
      bookingSlug: bookingSlug || null 
    });
    
    if (!updated) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }
    
    // Build the public booking URL
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
