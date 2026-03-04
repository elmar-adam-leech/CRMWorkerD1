import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../auth-service";

export function registerSettingsRoutes(app: Express): void {
  // Business targets for contractors
  app.get("/api/business-targets", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Failed to get business targets:', error);
      res.status(500).json({ message: "Failed to get business targets" });
    }
  });

  app.post("/api/business-targets", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can set business targets
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can set business targets" });
        return;
      }

      const targets = req.body;
      
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
    } catch (error) {
      console.error('Failed to set business targets:', error);
      res.status(500).json({ message: "Failed to set business targets" });
    }
  });

  // Terminology settings endpoints
  app.get("/api/terminology", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Failed to get terminology settings:', error);
      res.status(500).json({ message: "Failed to get terminology settings" });
    }
  });

  app.post("/api/terminology", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can update terminology settings
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can update terminology settings" });
        return;
      }

      const settings = req.body;
      
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
    } catch (error) {
      console.error('Failed to update terminology settings:', error);
      res.status(500).json({ message: "Failed to update terminology settings" });
    }
  });

  // Booking slug configuration endpoints
  app.get("/api/booking-slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Failed to get booking slug:', error);
      res.status(500).json({ message: "Failed to get booking slug" });
    }
  });

  app.post("/api/booking-slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Failed to update booking slug:', error);
      res.status(500).json({ message: "Failed to update booking slug" });
    }
  });

}
