import type { Express, Response } from "express";
import { storage } from "../storage";
import { dialpadEnhancedService } from "../dialpad-enhanced-service";
import { providerService, INTEGRATION_NAMES } from "../providers/provider-service";
import { requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { CredentialService } from "../credential-service";
import crypto from "crypto";

export function registerIntegrationRoutes(app: Express): void {
  // Integration management routes
  app.get("/api/integrations", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to view integrations" });
        return;
      }

      const tenantIntegrations = await storage.getTenantIntegrations(req.user!.contractorId);
      const enabledIntegrations = await storage.getEnabledIntegrations(req.user!.contractorId);
      
      const integrationStatus = [];
      
      for (const integrationName of INTEGRATION_NAMES) {
        const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
        const isEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, integrationName);
        
        integrationStatus.push({
          name: integrationName,
          hasCredentials,
          isEnabled,
          canEnable: hasCredentials && !isEnabled
        });
      }
      
      res.json({ 
        integrations: integrationStatus,
        configured: tenantIntegrations,
        enabled: enabledIntegrations 
      });
    } catch (error) {
      console.error('Failed to fetch integration status:', error);
      res.status(500).json({ message: "Failed to fetch integration information" });
    }
  });

  app.post("/api/integrations/:integrationName/enable", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to enable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
      if (!hasCredentials) {
        res.status(400).json({ 
          message: `Cannot enable ${integrationName} integration. Please configure credentials first.`,
          missingCredentials: true
        });
        return;
      }
      
      const integration = await storage.enableTenantIntegration(
        req.user!.contractorId, 
        integrationName, 
        req.user!.userId
      );
      
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('../sync-scheduler');
          await syncScheduler.onIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to schedule sync for Housecall Pro integration:', error);
        }
      }
      
      let webhookCreated = false;
      let webhookError: string | undefined;
      
      if (integrationName === 'dialpad') {
        try {
          const protocol = req.get('x-forwarded-proto') || req.protocol;
          const host = req.get('x-forwarded-host') || req.get('host');
          const baseWebhookUrl = `${protocol}://${host}`;
          
          const result = await dialpadEnhancedService.createWebhookWithSubscription(
            req.user!.contractorId,
            'inbound',
            baseWebhookUrl
          );
          if (result.success) {
            webhookCreated = true;
          } else {
            webhookError = result.error || 'Failed to create webhook';
            console.error('Failed to auto-create Dialpad webhook:', result.error);
          }
        } catch (error) {
          webhookError = error instanceof Error ? error.message : 'Unknown error occurred';
          console.error('Failed to auto-create Dialpad webhook:', error);
        }
      }
      
      res.json({ 
        success: true, 
        message: `${integrationName} integration enabled successfully`,
        integration,
        webhookCreated: integrationName === 'dialpad' ? webhookCreated : undefined,
        webhookError: integrationName === 'dialpad' ? webhookError : undefined
      });
    } catch (error) {
      console.error('Failed to enable integration:', error);
      res.status(500).json({ message: "Failed to enable integration" });
    }
  });

  app.post("/api/integrations/:integrationName/disable", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to disable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      await storage.disableTenantIntegration(req.user!.contractorId, integrationName);
      
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('../sync-scheduler');
          await syncScheduler.onIntegrationDisabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to cancel scheduled sync for Housecall Pro integration:', error);
        }
      }
      
      res.json({ 
        success: true, 
        message: `${integrationName} integration disabled successfully` 
      });
    } catch (error) {
      console.error('Failed to disable integration:', error);
      res.status(500).json({ message: "Failed to disable integration" });
    }
  });

  app.get("/api/integrations/:integrationName/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
      const isEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, integrationName);
      const integration = await storage.getTenantIntegration(req.user!.contractorId, integrationName);
      
      res.json({
        integrationName,
        hasCredentials,
        isEnabled,
        canEnable: hasCredentials && !isEnabled,
        canDisable: isEnabled,
        enabledAt: integration?.enabledAt,
        disabledAt: integration?.disabledAt
      });
    } catch (error) {
      console.error('Failed to get integration status:', error);
      res.status(500).json({ message: "Failed to get integration status" });
    }
  });

  app.post("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      const { credentials } = req.body;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      if (!credentials || Object.keys(credentials).length === 0) {
        res.status(400).json({ message: "Credentials are required" });
        return;
      }
      
      const result = await providerService.saveCredentials(req.user!.contractorId, integrationName, credentials);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `${integrationName} credentials saved successfully` 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error || "Failed to save credentials" 
        });
      }
    } catch (error) {
      console.error('Failed to save integration credentials:', error);
      res.status(500).json({ message: "Failed to save integration credentials" });
    }
  });

  app.get("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      const credentials = await CredentialService.getMaskedCredentials(req.user!.contractorId, integrationName);
      
      res.json({ credentials });
    } catch (error) {
      console.error('Failed to get integration credentials:', error);
      res.status(500).json({ message: "Failed to get integration credentials" });
    }
  });

  app.delete("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      await CredentialService.deleteIntegrationCredentials(req.user!.contractorId, integrationName);
      
      res.json({ 
        success: true, 
        message: `${integrationName} credentials deleted successfully` 
      });
    } catch (error) {
      console.error('Failed to delete integration credentials:', error);
      res.status(500).json({ message: "Failed to delete integration credentials" });
    }
  });

  // Webhook configuration endpoint
  app.get("/api/webhook-config", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      let apiKey: string;
      try {
        const existingKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        if (!existingKey) {
          throw new Error('No API key found');
        }
        apiKey = existingKey;
      } catch {
        apiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
      }

      const protocol = req.protocol;
      const host = req.get('host');
      const webhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/leads`;

      res.json({
        webhookUrl,
        apiKey,
        documentation: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey
          },
          requiredFields: ["name"],
          optionalFields: ["email", "emails", "phone", "phones", "address", "source", "notes", "followUpDate"],
          phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
          multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
          example: {
            name: "John Smith",
            phone: "(555) 123-4567",
            email: "john@example.com",
            address: "123 Main St, City, State 12345",
            source: "Website Contact Form",
            notes: "Interested in HVAC installation",
            followUpDate: "2024-01-15T10:00:00Z"
          },
          exampleWithArrays: {
            name: "Jane Doe",
            phones: ["(555) 123-4567", "555-987-6543", "+1 555 111 2222"],
            emails: ["jane@example.com", "jane.doe@work.com"],
            address: "456 Oak Ave",
            source: "Referral"
          }
        }
      });
    } catch (error) {
      console.error('Failed to get webhook config:', error);
      res.status(500).json({ message: "Failed to get webhook configuration" });
    }
  });
}
