import type { Express, Response } from "express";
import { storage } from "../../storage";
import { dialpadEnhancedService } from "../../dialpad-enhanced-service";
import { providerService, INTEGRATION_NAMES } from "../../providers/provider-service";
import { requireManagerOrAdmin, type AuthenticatedRequest } from "../../auth-service";
import { CredentialService } from "../../credential-service";
import { asyncHandler } from "../../utils/async-handler";
import crypto from "crypto";

export function registerIntegrationRoutes(app: Express): void {
  // Integration management routes
  app.get("/api/integrations", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const canManageIntegrations = req.user!.role === 'admin' 
      || req.user!.role === 'super_admin' 
      || req.user!.role === 'manager'
      || req.user!.canManageIntegrations === true;
    
    if (!canManageIntegrations) {
      res.status(403).json({ message: "You do not have permission to view integrations" });
      return;
    }

    // Fetch tenant integration list and enabled set in parallel — independent queries
    const [tenantIntegrations, enabledIntegrations] = await Promise.all([
      storage.getTenantIntegrations(req.user!.contractorId),
      storage.getEnabledIntegrations(req.user!.contractorId),
    ]);
    
    const integrationStatus = await Promise.all(
      INTEGRATION_NAMES.map(async (integrationName) => {
        const [hasCredentials, isEnabled] = await Promise.all([
          providerService.hasRequiredCredentials(req.user!.contractorId, integrationName),
          storage.isIntegrationEnabled(req.user!.contractorId, integrationName),
        ]);
        return { name: integrationName, hasCredentials, isEnabled, canEnable: hasCredentials && !isEnabled };
      })
    );
    
    res.json({ 
      integrations: integrationStatus,
      configured: tenantIntegrations,
      enabled: enabledIntegrations 
    });
  }));

  app.post("/api/integrations/:integrationName/enable", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
        const { syncScheduler } = await import('../../sync-scheduler');
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
  }));

  app.post("/api/integrations/:integrationName/disable", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
        const { syncScheduler } = await import('../../sync-scheduler');
        await syncScheduler.onIntegrationDisabled(req.user!.contractorId, 'housecall-pro');
      } catch (error) {
        // Non-fatal: integration is already disabled in the DB. The sync scheduler
        // will not pick it up on the next run even if the in-memory cancel failed.
        // Log enough context for an operator to diagnose if syncs keep running.
        console.error(
          `[integrations] Failed to cancel scheduled sync after disabling housecall-pro ` +
          `— contractorId=${req.user!.contractorId}, error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    
    res.json({ 
      success: true, 
      message: `${integrationName} integration disabled successfully` 
    });
  }));

  app.get("/api/integrations/:integrationName/status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { integrationName } = req.params;
    
    if (!INTEGRATION_NAMES.includes(integrationName as any)) {
      res.status(400).json({ message: "Invalid integration name" });
      return;
    }
    
    // Three independent queries — run in parallel
    const [hasCredentials, isEnabled, integration] = await Promise.all([
      providerService.hasRequiredCredentials(req.user!.contractorId, integrationName),
      storage.isIntegrationEnabled(req.user!.contractorId, integrationName),
      storage.getTenantIntegration(req.user!.contractorId, integrationName),
    ]);
    
    res.json({
      integrationName,
      hasCredentials,
      isEnabled,
      canEnable: hasCredentials && !isEnabled,
      canDisable: isEnabled,
      enabledAt: integration?.enabledAt,
      disabledAt: integration?.disabledAt
    });
  }));

  app.post("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
  }));

  app.get("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { integrationName } = req.params;
    
    if (!INTEGRATION_NAMES.includes(integrationName as any)) {
      res.status(400).json({ message: "Invalid integration name" });
      return;
    }
    
    const credentials = await CredentialService.getMaskedCredentials(req.user!.contractorId, integrationName);
    
    res.json({ credentials });
  }));

  app.delete("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
  }));

  // Webhook configuration endpoint — returns the public webhook URL and a persistent API key
  // for this contractor's lead intake webhook. Generates and saves the key on first call.
  app.get("/api/webhook-config", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
  }));
}
