import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { webhookEvents, webhooks, dialpadPhoneNumbers, contractors, users, userContractors, insertContactSchema } from "@shared/schema";
import { db } from "../db";
import { eq, and, isNotNull } from "drizzle-orm";
import { dialpadService } from "../dialpad-service";
import { dialpadEnhancedService, DialpadEnhancedService } from "../dialpad-enhanced-service";
import { housecallProService } from "../housecall-pro-service";
import { providerService, INTEGRATION_NAMES } from "../providers/provider-service";
import { AuthService, requireAuth, requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../auth-service";
import { CredentialService } from "../credential-service";
import { GoogleSheetsService, suggestColumnMappings, type ColumnMapping, type LeadRowData } from "../google-sheets-service";
import { workflowEngine } from "../workflow-engine";
import { weeklyReporter } from "../services/weekly-reporter";
import { aiMonitor } from "../services/ai-monitor";
import { businessMetrics } from "../services/business-metrics";
import { getErrorStats, getErrorLogs } from "../middleware/error-monitor";
import { aiRateLimiter } from "../middleware/rate-limiter";
import { z } from "zod";
import crypto from "crypto";

export function registerIntegrationRoutes(app: Express): void {
  app.get('/api/version', (_req, res) => {
    const BUILD_VERSION = process.env.REPLIT_DEPLOYMENT_ID || process.env.REPL_ID || Date.now().toString();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ 
      version: BUILD_VERSION,
      timestamp: Date.now()
    });
  });

  // Google Places API proxy — server-side calls bypass browser referrer/domain restrictions
  app.get('/api/places/autocomplete', async (req: AuthenticatedRequest, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      return res.json({ suggestions: [] });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'Referer': appUrl,
        },
        body: JSON.stringify({
          input: input.trim(),
          includedRegionCodes: ['us'],
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Autocomplete] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json({ suggestions: data.suggestions || [] });
    } catch (e) {
      console.error('[Places Autocomplete] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  app.get('/api/places/details', async (req: AuthenticatedRequest, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,addressComponents`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'Referer': appUrl,
          },
        }
      );
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Details] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json(data);
    } catch (e) {
      console.error('[Places Details] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  // Dashboard metrics route
  app.get("/api/dashboard/metrics", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { timeframe, startDate, endDate } = req.query;
      
      let start: Date | undefined;
      let end: Date | undefined;
      
      const now = new Date();
      now.setHours(23, 59, 59, 999);
      
      if (timeframe === 'this_week') {
        start = new Date(now);
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'custom' && startDate && endDate) {
        start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
      }
      
      const metrics = await storage.getDashboardMetrics(
        req.user!.contractorId, 
        req.user!.userId, 
        req.user!.role, 
        start, 
        end
      );
      res.json(metrics);
    } catch (error) {
      console.error('Dashboard metrics error:', error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  // Unified Contacts routes (replaces separate Customer and Lead routes)
  app.get("/api/integrations", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user has permission to manage integrations
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
      
      // Get available providers for each integration that has credentials
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
      // Check if user has permission to manage integrations
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to enable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Check if tenant has required credentials
      const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
      if (!hasCredentials) {
        res.status(400).json({ 
          message: `Cannot enable ${integrationName} integration. Please configure credentials first.`,
          missingCredentials: true
        });
        return;
      }
      
      // Enable the integration
      const integration = await storage.enableTenantIntegration(
        req.user!.contractorId, 
        integrationName, 
        req.user!.userId
      );
      
      // If this is the Housecall Pro integration, schedule daily syncs
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('../sync-scheduler');
          await syncScheduler.onIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to schedule sync for Housecall Pro integration:', error);
          // Don't fail the request if scheduling fails
        }
      }
      
      // If this is the Dialpad integration, automatically create SMS webhook
      let webhookCreated = false;
      let webhookError: string | undefined;
      
      if (integrationName === 'dialpad') {
        try {
          // Build the base webhook URL from the request
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
      // Check if user has permission to manage integrations
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to disable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Disable the integration
      await storage.disableTenantIntegration(req.user!.contractorId, integrationName);
      
      // If this is the Housecall Pro integration, cancel scheduled syncs
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('../sync-scheduler');
          await syncScheduler.onIntegrationDisabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to cancel scheduled sync for Housecall Pro integration:', error);
          // Don't fail the request if cancellation fails
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
      
      // Validate integration name
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
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Validate credentials are provided
      if (!credentials || Object.keys(credentials).length === 0) {
        res.status(400).json({ message: "Credentials are required" });
        return;
      }
      
      // Save credentials using the credential service
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
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Get masked credentials for display
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
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Delete all credentials for this integration
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

  // Enhanced Dialpad integration routes
  app.post("/api/dialpad/sync-phone-numbers", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.syncPhoneNumbers(req.user!.contractorId);
      
      res.json({
        success: true,
        message: `Synced ${result.synced} phone numbers`,
        synced: result.synced,
        phoneNumbers: result.phoneNumbers,
        errors: result.errors
      });
    } catch (error) {
      console.error('Failed to sync Dialpad phone numbers:', error);
      res.status(500).json({ 
        message: "Failed to sync Dialpad phone numbers",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/dialpad/phone-numbers", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const phoneNumbers = await storage.getDialpadPhoneNumbers(req.user!.contractorId);
      res.json(phoneNumbers);
    } catch (error) {
      console.error('Failed to fetch Dialpad phone numbers:', error);
      res.status(500).json({ message: "Failed to fetch Dialpad phone numbers" });
    }
  });

  app.get("/api/dialpad/users/available-phone-numbers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const action = req.query.action as 'sms' | 'call' || 'sms';
      const availableNumbers = await dialpadEnhancedService.getUserAvailablePhoneNumbers(
        req.user!.userId,
        req.user!.contractorId,
        action
      );
      res.json(availableNumbers);
    } catch (error) {
      console.error('Failed to fetch available phone numbers for user:', error);
      res.status(500).json({ message: "Failed to fetch available phone numbers" });
    }
  });

  // Get user's default Dialpad phone number
  app.get("/api/users/:userId/phone-permissions", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      
      // Verify user belongs to same contractor
      const targetUser = await db.select().from(users)
        .where(and(eq(users.id, userId), eq(users.contractorId, req.user!.contractorId)))
        .limit(1);
      
      if (!targetUser[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const permissions = await storage.getUserPhoneNumberPermissions(userId);
      
      // Join with phone number details
      const permissionsWithDetails = await Promise.all(
        permissions.map(async (perm) => {
          const phoneNumber = await storage.getDialpadPhoneNumber(perm.phoneNumberId, req.user!.contractorId);
          return {
            ...perm,
            phoneNumber: phoneNumber?.phoneNumber,
            displayName: phoneNumber?.displayName
          };
        })
      );
      
      res.json(permissionsWithDetails);
    } catch (error) {
      console.error('Failed to fetch user phone permissions:', error);
      res.status(500).json({ message: "Failed to fetch user phone permissions" });
    }
  });

  app.post("/api/dialpad/phone-numbers/:phoneNumberId/permissions", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumberId } = req.params;
      const { userId, canSendSms, canMakeCalls } = req.body;
      
      if (!userId) {
        res.status(400).json({ message: "User ID is required" });
        return;
      }

      // Check if permission already exists
      const existingPermission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);
      
      if (existingPermission) {
        // Update existing permission
        const updatedPermission = await storage.updateUserPhoneNumberPermission(existingPermission.id, {
          canSendSms: canSendSms ?? false,
          canMakeCalls: canMakeCalls ?? false,
          isActive: true
        });
        res.json(updatedPermission);
      } else {
        // Create new permission
        const newPermission = await storage.createUserPhoneNumberPermission({
          userId,
          phoneNumberId,
          contractorId: req.user!.contractorId,
          canSendSms: canSendSms ?? false,
          canMakeCalls: canMakeCalls ?? false,
          assignedBy: req.user!.userId
        });
        res.json(newPermission);
      }
    } catch (error) {
      console.error('Failed to manage phone number permission:', error);
      res.status(500).json({ message: "Failed to manage phone number permission" });
    }
  });

  app.delete("/api/dialpad/phone-numbers/:phoneNumberId/permissions/:userId", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumberId, userId } = req.params;
      
      const permission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);
      if (!permission) {
        res.status(404).json({ message: "Permission not found" });
        return;
      }

      const deleted = await storage.deleteUserPhoneNumberPermission(permission.id);
      if (deleted) {
        res.json({ success: true, message: "Permission removed successfully" });
      } else {
        res.status(500).json({ message: "Failed to remove permission" });
      }
    } catch (error) {
      console.error('Failed to remove phone number permission:', error);
      res.status(500).json({ message: "Failed to remove phone number permission" });
    }
  });

  app.put("/api/dialpad/phone-numbers/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { displayName, department } = req.body;
      
      const updatedPhoneNumber = await storage.updateDialpadPhoneNumber(id, {
        displayName,
        department
      });
      
      res.json(updatedPhoneNumber);
    } catch (error) {
      console.error('Failed to update Dialpad phone number:', error);
      res.status(500).json({ message: "Failed to update phone number" });
    }
  });

  app.get("/api/dialpad/users", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const dialpadUsers = await dialpadEnhancedService.fetchDialpadUsers(req.user!.contractorId);
      res.json(dialpadUsers);
    } catch (error) {
      console.error('Failed to fetch Dialpad users:', error);
      res.status(500).json({ 
        message: "Failed to fetch Dialpad users",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dialpad webhook management routes (requires manager/admin or canManageIntegrations)
  app.post("/api/dialpad/webhooks/create", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Build the base webhook URL from the request
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const baseWebhookUrl = `${protocol}://${host}`;
      
      // Create webhook and SMS subscription using the helper method
      // The service will build the tenant-specific URL
      const result = await dialpadEnhancedService.createWebhookWithSubscription(
        req.user!.contractorId,
        'inbound',
        baseWebhookUrl
      );

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to create webhook",
          error: result.error 
        });
        return;
      }

      res.json({
        success: true,
        webhookId: result.webhookId,
        subscriptionId: result.subscriptionId,
        webhookUrl: result.hookUrl
      });
    } catch (error) {
      console.error('Failed to create Dialpad webhook:', error);
      res.status(500).json({ 
        message: "Failed to create Dialpad webhook",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/dialpad/webhooks/list", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.listWebhooks(req.user!.contractorId);

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to list webhooks",
          error: result.error 
        });
        return;
      }

      res.json({ webhooks: result.webhooks || [] });
    } catch (error) {
      console.error('Failed to list Dialpad webhooks:', error);
      res.status(500).json({ 
        message: "Failed to list Dialpad webhooks",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.delete("/api/dialpad/webhooks/:webhookId", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { webhookId } = req.params;
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.deleteWebhook(req.user!.contractorId, webhookId);

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to delete webhook",
          error: result.error 
        });
        return;
      }

      res.json({ success: true, message: "Webhook deleted successfully" });
    } catch (error) {
      console.error('Failed to delete Dialpad webhook:', error);
      res.status(500).json({ 
        message: "Failed to delete Dialpad webhook",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Housecall Pro integration routes
  app.get("/api/housecall-pro/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
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
    } catch (error) {
      res.status(500).json({ message: "Failed to check Housecall Pro status" });
    }
  });

  app.get("/api/housecall-pro/employees", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
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
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Housecall Pro employees" });
    }
  });

  app.get("/api/housecall-pro/availability", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
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

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
        return;
      }

      // Parse estimatorIds if provided
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
    } catch (error) {
      console.error('Error fetching estimator availability:', error);
      res.status(500).json({ message: "Failed to fetch estimator availability" });
    }
  });

  // Get HCP estimates for a specific employee on a specific date
  app.get("/api/housecall/employee-estimates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { employeeId, date } = req.query;
      
      if (!employeeId || !date) {
        res.status(400).json({ message: "employeeId and date are required" });
        return;
      }
      
      // Create start and end of day for the given date
      const startOfDay = new Date(`${date}T00:00:00`);
      const endOfDay = new Date(`${date}T23:59:59`);
      
      // Fetch estimates from HCP for this employee and date range
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
      
      // Extract schedule times from estimates (handles both direct and options formats)
      const scheduledEstimates: Array<{id: string, scheduled_start: string, scheduled_end: string}> = [];
      
      for (const est of (result.data || [])) {
        // Check direct schedule on estimate
        if (est.scheduled_start && est.scheduled_end) {
          scheduledEstimates.push({
            id: est.id,
            scheduled_start: est.scheduled_start,
            scheduled_end: est.scheduled_end,
          });
        }
        // Check schedule object on estimate (HCP format: schedule.scheduled_start/scheduled_end)
        if (est.schedule?.scheduled_start && est.schedule?.scheduled_end) {
          scheduledEstimates.push({
            id: est.id,
            scheduled_start: est.schedule.scheduled_start,
            scheduled_end: est.schedule.scheduled_end,
          });
        }
        // Check options array for schedule (current HCP format)
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
    } catch (error) {
      console.error('[HCP] Error fetching employee estimates:', error);
      res.json([]);
    }
  });

  app.post("/api/housecall-pro/sync", async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    // type: 'estimates' | 'jobs' | 'all' (default: 'all')
    const syncType = (req.query.type as string) || 'all';
    
    try {
      // Check if Housecall Pro integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Set sync status to running
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Starting sync...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[housecall-pro-sync] Starting manual sync (type=${syncType}) for tenant ${contractorId}`);
      
      // Get sync start date for filtering
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

        // Fetch ALL estimates from Housecall Pro with pagination
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

        // Helper function to extract phone number
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

        // Helper function to extract address
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

        // Count jobs before sync so we can calculate how many were added
        const jobsBefore = await storage.getJobs(contractorId);
        const jobsCountBefore = jobsBefore.length;

        const { syncScheduler } = await import('../sync-scheduler');
        await syncScheduler.syncHousecallProJobs(contractorId);

        const jobsAfter = await storage.getJobs(contractorId);
        newJobs = Math.max(0, jobsAfter.length - jobsCountBefore);

        console.log(`[housecall-pro-sync] Jobs sync complete. New jobs: ${newJobs}`);
      }

      console.log(`[housecall-pro-sync] Sync (type=${syncType}) completed for tenant ${contractorId}`);
      
      // Update sync status to completed
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
    } catch (error) {
      console.error('[housecall-pro-sync] Sync failed:', error);
      
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: error instanceof Error ? error.message : 'Sync failed',
        lastSync: null,
        startTime: null
      });
      
      res.status(500).json({ message: "Failed to sync with Housecall Pro" });
    }
  });

  // Dialpad sync endpoint
  app.post("/api/dialpad/sync", async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Set sync status to running
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Starting Dialpad sync...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Starting manual sync for tenant ${contractorId}`);
      
      // Initialize summary counters
      const summary = {
        users: { fetched: 0, cached: 0 },
        departments: { fetched: 0, cached: 0 },
        phoneNumbers: { fetched: 0, cached: 0 }
      };

      // Sync users (persist to database)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad users...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing users...`);
      const usersResult = await dialpadEnhancedService.syncUsers(contractorId);
      summary.users.fetched = usersResult.fetched;
      summary.users.cached = usersResult.synced;
      console.log(`[dialpad-sync] Fetched ${usersResult.fetched} users, synced ${usersResult.synced} to database`);

      if (usersResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${usersResult.errors.length} errors during user sync:`, usersResult.errors);
      }

      // Sync departments (limited functionality for now)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad departments...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing departments...`);
      const departmentsResult = await dialpadEnhancedService.syncDepartments(contractorId);
      summary.departments.fetched = departmentsResult.fetched;
      summary.departments.cached = departmentsResult.synced;
      console.log(`[dialpad-sync] Fetched ${departmentsResult.fetched} departments, synced ${departmentsResult.synced} to database`);

      if (departmentsResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${departmentsResult.errors.length} errors during department sync:`, departmentsResult.errors);
      }

      // Sync phone numbers (this actually caches to database)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad phone numbers...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing phone numbers...`);
      const numbersResult = await dialpadEnhancedService.syncPhoneNumbers(contractorId);
      summary.phoneNumbers.fetched = numbersResult.fetched;
      summary.phoneNumbers.cached = numbersResult.synced;
      console.log(`[dialpad-sync] Fetched ${numbersResult.fetched} phone numbers, synced ${numbersResult.synced} to database`);

      if (numbersResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${numbersResult.errors.length} errors during phone number sync:`, numbersResult.errors);
      }

      console.log(`[dialpad-sync] Sync completed:`, summary);
      
      // Update sync status to completed
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: null,
        lastSync: new Date().toISOString(),
        startTime: null
      });
      
      res.json({
        message: "Dialpad sync completed successfully",
        summary
      });
    } catch (error) {
      console.error('[dialpad-sync] Sync failed:', error);
      
      // Update sync status to error
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: error instanceof Error ? error.message : 'Dialpad sync failed',
        lastSync: null,
        startTime: null
      });
      
      res.status(500).json({ message: "Failed to sync with Dialpad" });
    }
  });

  // In-memory sync status tracking per contractor
  const syncStatus = new Map<string, {
    isRunning: boolean;
    progress: string | null;
    error: string | null;
    lastSync: string | null;
    startTime: Date | null;
  }>();

  // Sync status API endpoint
  app.get("/api/sync-status", async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('[api] Failed to get sync status:', error);
      res.status(500).json({ message: "Failed to get sync status" });
    }
  });

  // Housecall Pro sync start date management
  app.get("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const syncStartDate = await storage.getHousecallProSyncStartDate(req.user!.contractorId);
      res.json({ syncStartDate: syncStartDate ? syncStartDate.toISOString() : null });
    } catch (error) {
      console.error('[housecall-pro-sync-settings] Failed to get sync start date:', error);
      res.status(500).json({ message: "Failed to get sync start date" });
    }
  });

  app.post("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { syncStartDate } = req.body;
      const parsedDate = syncStartDate ? new Date(syncStartDate) : null;

      await storage.setHousecallProSyncStartDate(req.user!.contractorId, parsedDate);
      res.json({ 
        message: "Sync start date updated successfully",
        syncStartDate: parsedDate ? parsedDate.toISOString() : null
      });
    } catch (error) {
      console.error('[housecall-pro-sync-settings] Failed to set sync start date:', error);
      res.status(500).json({ message: "Failed to set sync start date" });
    }
  });

  // ========== Unified Scheduling API ==========
  // These routes provide a unified calendar view across all salespeople
  
  // Sync Housecall Pro users as salespeople
  app.post("/api/scheduling/sync-users", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      const result = await housecallSchedulingService.syncHousecallUsers(req.user!.contractorId);
      res.json(result);
    } catch (error: any) {
      console.error('[scheduling] Failed to sync users:', error);
      res.status(500).json({ message: "Failed to sync Housecall Pro users", error: error.message });
    }
  });

  // Get all team members for the contractor (for management UI - shows isSalesperson toggle)
  app.get("/api/scheduling/salespeople", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      const teamMembers = await housecallSchedulingService.getTeamMembers(req.user!.contractorId);
      res.json(teamMembers);
    } catch (error: any) {
      console.error('[scheduling] Failed to get team members:', error);
      res.status(500).json({ message: "Failed to get team members", error: error.message });
    }
  });

  // Get unified availability across all salespeople (1-hour slots, 30-min buffer)
  app.get("/api/scheduling/availability", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate, days } = req.query;
      
      let start: Date;
      let end: Date;
      
      if (startDate && endDate) {
        start = new Date(startDate as string);
        end = new Date(endDate as string);
      } else {
        // Default: next 14 days
        start = new Date();
        const daysToFetch = days ? parseInt(days as string) : 14;
        end = new Date();
        end.setDate(end.getDate() + daysToFetch);
      }
      
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      
      // Get contractor timezone for proper availability calculation
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
    } catch (error: any) {
      console.error('[scheduling] Failed to get availability:', error);
      res.status(500).json({ message: "Failed to get availability", error: error.message });
    }
  });

  // Book an appointment (auto-assigns or uses specified salesperson)
  app.post("/api/scheduling/book", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startTime, title, customerName, customerEmail, customerPhone, customerAddress, customerAddressComponents, notes, contactId, salespersonId, housecallProEmployeeId } = req.body;
      
      if (!startTime || !title || !customerName) {
        res.status(400).json({ message: "startTime, title, and customerName are required" });
        return;
      }
      
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
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
    } catch (error: any) {
      console.error('[scheduling] Failed to book appointment:', error);
      res.status(500).json({ message: "Failed to book appointment", error: error.message });
    }
  });

  // Get scheduled bookings
  app.get("/api/scheduling/bookings", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      
      const { housecallSchedulingService } = await import('../housecall-scheduling-service');
      const bookings = await housecallSchedulingService.getBookings(
        req.user!.contractorId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      
      res.json(bookings);
    } catch (error: any) {
      console.error('[scheduling] Failed to get bookings:', error);
      res.status(500).json({ message: "Failed to get bookings", error: error.message });
    }
  });

  // Mark a user as salesperson (admin only)
  app.patch("/api/scheduling/salespeople/:userId", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error: any) {
      console.error('[scheduling] Failed to update salesperson:', error);
      res.status(500).json({ message: "Failed to update salesperson", error: error.message });
    }
  });

  app.get("/api/integrations/housecall-pro/webhook-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error fetching HCP webhook config:', error);
      res.status(500).json({ error: 'Failed to fetch webhook configuration' });
    }
  });

  app.post("/api/integrations/housecall-pro/webhook-secret", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { secret } = req.body;
      if (!secret || typeof secret !== 'string' || !secret.trim()) {
        res.status(400).json({ error: 'Secret is required' });
        return;
      }
      await CredentialService.setCredential(req.user!.contractorId, 'housecallpro', 'webhook_secret', secret.trim());
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving HCP webhook secret:', error);
      res.status(500).json({ error: 'Failed to save webhook secret' });
    }
  });

  // Get Webhook Configuration for Authenticated Contractor
  app.get("/api/webhook-config", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      // Get or generate API key for this contractor
      let apiKey: string;
      try {
        const storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        
        // If no key exists (null, undefined, or empty/whitespace string), generate a new one
        if (!storedApiKey || storedApiKey.trim().length === 0) {
          apiKey = crypto.randomBytes(32).toString('hex');
          await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
        } else {
          apiKey = storedApiKey.trim();
        }
      } catch {
        // Generate new API key if there's an error accessing credentials
        apiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
      }
      
      // Build webhook URLs - handle proxy headers for HTTPS deployments
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const leadsWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/leads`;
      const estimatesWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/estimates`;
      const jobsWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/jobs`;
      
      res.status(200).json({
        apiKey,
        webhooks: {
          leads: {
            url: leadsWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["name"],
              optionalFields: [
                "email", "emails", "phone", "phones",
                "address",
                "source",
                "notes",
                "followUpDate",
                "utmSource",
                "utmMedium",
                "utmCampaign",
                "utmTerm",
                "utmContent",
                "pageUrl"
              ],
              phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
              multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
              example: {
                name: "John Smith",
                email: "john@example.com",
                phone: "555-123-4567",
                address: "123 Main St, City, State 12345",
                source: "Website Contact Form",
                notes: "Interested in HVAC installation",
                followUpDate: "2024-01-15T10:00:00Z",
                utmSource: "google",
                utmMedium: "cpc",
                utmCampaign: "summer-hvac",
                pageUrl: "https://example.com/contact"
              }
            }
          },
          estimates: {
            url: estimatesWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["title", "amount", "customerName"],
              optionalFields: ["description", "status", "validUntil", "followUpDate", "leadId", "customerEmail", "customerPhone", "customerAddress"],
              example: {
                title: "HVAC Installation Quote",
                amount: 5500.00,
                description: "Complete HVAC system installation for 2000 sq ft home",
                customerName: "John Smith",
                customerEmail: "john@example.com",
                customerPhone: "(555) 123-4567",
                customerAddress: "123 Main St, City, State 12345",
                status: "sent",
                validUntil: "2024-02-15",
                followUpDate: "2024-01-20T10:00:00Z",
                leadId: "optional-lead-uuid"
              }
            }
          },
          jobs: {
            url: jobsWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["title", "scheduledDate", "customerName"],
              optionalFields: ["description", "status", "estimateId", "amount", "customerEmail", "customerPhone", "customerAddress", "notes"],
              example: {
                title: "HVAC Installation",
                scheduledDate: "2024-02-15T09:00:00Z",
                description: "Complete HVAC system installation for 2000 sq ft home",
                customerName: "John Smith",
                customerEmail: "john@example.com",
                customerPhone: "(555) 123-4567",
                customerAddress: "123 Main St, City, State 12345",
                status: "scheduled",
                amount: 5500.00,
                estimateId: "optional-estimate-uuid",
                notes: "Customer prefers morning installation"
              }
            }
          }
        },
        // Legacy support - keep webhookUrl for backwards compatibility
        webhookUrl: leadsWebhookUrl,
        documentation: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey
          },
          requiredFields: ["name"],
          optionalFields: [
            "email", "emails", "phone", "phones",
            "address",
            "source",
            "notes",
            "followUpDate",
            "utmSource",
            "utmMedium",
            "utmCampaign",
            "utmTerm",
            "utmContent",
            "pageUrl"
          ],
          phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
          multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
          example: {
            name: "John Smith",
            email: "john@example.com",
            phone: "555-123-4567",
            address: "123 Main St, City, State 12345",
            source: "Website Contact Form",
            notes: "Interested in HVAC installation",
            followUpDate: "2024-01-15T10:00:00Z",
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "summer-hvac",
            pageUrl: "https://example.com/contact"
          }
        }
      });
    } catch (error) {
      console.error('Error getting webhook config:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to get webhook configuration"
      });
    }
  });

  // Validation schemas for secure Google Sheets import
  const googleSheetsCredentialSchema = z.object({
    serviceAccountEmail: z.string().email("Valid service account email is required"),
    privateKey: z.string().min(1, "Private key is required")
  });

  const googleSheetsOperationSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional()
  });

  const googleSheetsImportSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional(),
    columnMapping: z.record(z.string(), z.string()),
    startRow: z.number().int().min(1).optional().default(2)
  });

  app.post("/api/leads/google-sheets/credentials", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const credentials = googleSheetsCredentialSchema.parse(req.body);
      
      // Validate credentials by testing authentication
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: '', // Not needed for credential validation
        sheetName: ''
      });

      // Test authentication with a minimal operation
      try {
        await service.validateCredentials();
      } catch (error) {
        return res.status(400).json({ 
          message: 'Invalid Google Sheets credentials. Please verify your service account email and private key.',
          error: error instanceof Error ? error.message : 'Authentication failed'
        });
      }

      // Store credentials securely using CredentialService
      await Promise.all([
        CredentialService.setCredential(contractorId, 'google-sheets', 'serviceAccountEmail', credentials.serviceAccountEmail),
        CredentialService.setCredential(contractorId, 'google-sheets', 'privateKey', credentials.privateKey)
      ]);
      
      res.json({ 
        success: true,
        message: 'Google Sheets credentials stored securely',
        configured: true
      });
    } catch (error) {
      console.error('Error storing Google Sheets credentials:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid credential format", errors: error.errors });
        return;
      }
      res.status(500).json({ 
        message: 'Failed to store credentials. Please try again.' 
      });
    }
  });

  // Check Google Sheets credential status
  app.get("/api/leads/google-sheets/credentials/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      const hasCredentials = await CredentialService.hasRequiredCredentials(
        contractorId, 
        'google-sheets'
      );
      
      res.json({ configured: hasCredentials });
    } catch (error) {
      console.error('Error checking Google Sheets credentials:', error);
      res.status(500).json({ message: 'Failed to check credential status' });
    }
  });

  // Validate Google Sheets connection with stored credentials
  app.post("/api/leads/google-sheets/validate", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          valid: false,
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const isValid = await service.validateConnection(config.spreadsheetId);
      
      if (isValid) {
        res.json({ valid: true, message: "Connection successful" });
      } else {
        res.status(400).json({ valid: false, message: "Failed to connect to Google Sheets" });
      }
    } catch (error) {
      console.error('Google Sheets validation error:', error);
      const message = error instanceof Error ? error.message : 'Validation failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ valid: false, message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          valid: false,
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          valid: false,
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ valid: false, message: `Validation failed: ${message}` });
    }
  });

  // Get Google Sheets info and headers with stored credentials
  app.post("/api/leads/google-sheets/info", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const [sheetInfo, headers] = await Promise.all([
        service.getSheetInfo(config.spreadsheetId),
        service.getSheetHeaders(config.spreadsheetId, config.sheetName)
      ]);

      // Suggest column mappings based on header names
      const suggestedMappings = suggestColumnMappings(headers);

      res.json({
        sheetInfo,
        headers,
        suggestedMappings
      });
    } catch (error) {
      console.error('Google Sheets info error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get sheet information';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Failed to get Google Sheets information: ${message}` });
    }
  });

  // Preview Google Sheets data with stored credentials
  app.post("/api/leads/google-sheets/preview", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.extend({
        maxRows: z.number().int().min(1).max(50).optional().default(10)
      }).parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const previewData = await service.previewSheetData(
        config.spreadsheetId, 
        config.sheetName, 
        config.maxRows
      );

      res.json(previewData);
    } catch (error) {
      console.error('Google Sheets preview error:', error);
      const message = error instanceof Error ? error.message : 'Preview failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Preview failed: ${message}` });
    }
  });

  // Import leads from Google Sheets with stored credentials
  app.post("/api/leads/google-sheets/import", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const importConfig = googleSheetsImportSchema.parse(req.body);
      
      // Validate column mapping
      if (!Object.values(importConfig.columnMapping).includes('name')) {
        return res.status(400).json({ 
          message: 'Column mapping must include a "name" field mapping' 
        });
      }

      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }
      
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: importConfig.spreadsheetId,
        sheetName: importConfig.sheetName
      });

      // Import raw data from the sheet
      const rawLeads = await service.importLeadsFromSheet(
        importConfig.spreadsheetId,
        importConfig.columnMapping,
        importConfig.sheetName,
        importConfig.startRow
      );

      console.log(`Starting Google Sheets import for contractor ${contractorId}: ${rawLeads.length} leads to process`);

      const results = {
        total: rawLeads.length,
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>
      };

      // Process each lead
      for (let i = 0; i < rawLeads.length; i++) {
        try {
          const leadData = rawLeads[i];
          
          // Skip empty rows
          if (!leadData.name && !leadData.email) {
            continue;
          }
          
          // Convert single values to arrays for new schema format
          const emails = leadData.email?.trim() ? [leadData.email.trim()] : [];
          const phones = leadData.phone?.trim() ? [leadData.phone.trim()] : [];
          
          // Use Zod validation with insertContactSchema (Google Sheets imports create leads)
          const validationResult = insertContactSchema.omit({ contractorId: true }).safeParse({
            name: leadData.name?.trim(),
            type: 'lead' as const,
            emails,
            phones,
            address: leadData.address?.trim() || undefined,
            source: leadData.source?.trim() || 'Google Sheets Import',
            notes: leadData.notes?.trim() || undefined,
            followUpDate: leadData.followUpDate || undefined,
            utmSource: leadData.utmSource?.trim() || undefined,
            utmMedium: leadData.utmMedium?.trim() || undefined,
            utmCampaign: leadData.utmCampaign?.trim() || undefined,
            utmTerm: leadData.utmTerm?.trim() || undefined,
            utmContent: leadData.utmContent?.trim() || undefined,
            pageUrl: leadData.pageUrl?.trim() || undefined
          });
          
          if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({
              row: importConfig.startRow + i,
              error: `Validation failed: ${errorMessages}`,
              data: leadData
            });
            continue;
          }
          
          // Check for duplicate phone numbers before creating
          if (validationResult.data.phones && validationResult.data.phones.length > 0) {
            const existingContacts = await storage.getContacts(contractorId, 'lead');
            const duplicate = existingContacts.find(existingContact =>
              existingContact.phones && existingContact.phones.some(existingPhone =>
                validationResult.data.phones!.includes(existingPhone)
              )
            );
            if (duplicate) {
              const duplicatePhone = duplicate.phones?.find(p => validationResult.data.phones!.includes(p));
              results.skipped++;
              results.errors.push({
                row: importConfig.startRow + i,
                error: `Skipped - Duplicate phone number ${duplicatePhone} (already exists for contact: ${duplicate.name})`,
                data: leadData
              });
              continue;
            }
          }
          
          // Create the contact as a lead with proper tenant isolation
          const newContact = await storage.createContact(validationResult.data, contractorId);
          results.imported++;
          
        } catch (error) {
          results.errors.push({
            row: importConfig.startRow + i,
            error: error instanceof Error ? error.message : "Unknown error",
            data: rawLeads[i]
          });
        }
      }
      
      console.log(`Google Sheets import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported, ${results.skipped} skipped (duplicates)`);
      
      // Return 207 Multi-Status if some imports failed, 200 if all succeeded
      const statusCode = results.errors.length > 0 ? 207 : 200;
      
      const message = results.skipped > 0
        ? `Successfully imported ${results.imported} out of ${results.total} leads (${results.skipped} skipped as duplicates)`
        : `Successfully imported ${results.imported} out of ${results.total} leads from Google Sheets`;
      
      res.status(statusCode).json({
        success: true,
        message,
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10) // Limit error reporting to first 10 errors
      });
      
    } catch (error) {
      console.error('Google Sheets import error:', error);
      const message = error instanceof Error ? error.message : 'Import failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid import configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      if (message.includes('mapping')) {
        return res.status(400).json({ 
          message: `Column mapping error: ${message}` 
        });
      }
      
      res.status(500).json({ 
        message: `Failed to import leads from Google Sheets: ${message}`
      });
    }
  });

  // ================================
  // AI MONITORING ROUTES
  // ================================
  
  // Get error statistics and analysis
  app.get("/api/ai/errors", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const stats = getErrorStats(req.user!.contractorId);
      res.json(stats);
    } catch (error) {
      console.error('Failed to get error stats:', error);
      res.status(500).json({ message: "Failed to get error statistics" });
    }
  });

  // Get detailed error logs with AI analysis
  app.get("/api/ai/error-logs", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = getErrorLogs(req.user!.contractorId, limit);
      res.json(logs);
    } catch (error) {
      console.error('Failed to get error logs:', error);
      res.status(500).json({ message: "Failed to get error logs" });
    }
  });

  // Generate weekly AI report
  app.post("/api/ai/weekly-report", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const report = await weeklyReporter.generateWeeklyReport(req.user!.contractorId);
      res.json(report);
    } catch (error) {
      console.error('Failed to generate weekly report:', error);
      res.status(500).json({ message: "Failed to generate weekly report" });
    }
  });

  // Get latest weekly report
  app.get("/api/ai/weekly-report", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const report = weeklyReporter.getLatestReport(req.user!.contractorId);
      if (!report) {
        res.status(404).json({ message: "No weekly report found" });
        return;
      }
      res.json(report);
    } catch (error) {
      console.error('Failed to get weekly report:', error);
      res.status(500).json({ message: "Failed to get weekly report" });
    }
  });

  // Get all weekly reports
  app.get("/api/ai/weekly-reports", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const reports = weeklyReporter.getReports(req.user!.contractorId);
      res.json(reports);
    } catch (error) {
      console.error('Failed to get weekly reports:', error);
      res.status(500).json({ message: "Failed to get weekly reports" });
    }
  });

  // Analyze code quality for a specific file
  app.post("/api/ai/analyze-code", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filePath, codeContent } = req.body;
      
      if (!filePath || !codeContent) {
        res.status(400).json({ message: "filePath and codeContent are required" });
        return;
      }
      
      const analysis = await aiMonitor.analyzeCodeQuality(filePath, codeContent);
      res.json(analysis);
    } catch (error) {
      console.error('Failed to analyze code:', error);
      res.status(500).json({ message: "Failed to analyze code quality" });
    }
  });

  // Business metrics for contractors
  app.get("/api/ai/business-metrics", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only non-super-admin users get business metrics
      if (req.user!.role === 'super_admin') {
        res.status(403).json({ message: "Business metrics not available for super admins" });
        return;
      }

      const daysPeriod = parseInt(req.query.days as string) || 30;
      const metrics = await businessMetrics.calculateMetrics(req.user!.contractorId, daysPeriod);
      res.json(metrics);
    } catch (error) {
      console.error('Failed to get business metrics:', error);
      res.status(500).json({ message: "Failed to get business metrics" });
    }
  });

  // Business insights for contractors
  app.get("/api/ai/business-insights", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only non-super-admin users get business insights
      if (req.user!.role === 'super_admin') {
        res.status(403).json({ message: "Business insights not available for super admins" });
        return;
      }

      const daysPeriod = parseInt(req.query.days as string) || 30;
      const metrics = await businessMetrics.calculateMetrics(req.user!.contractorId, daysPeriod);
      const insights = await businessMetrics.generateBusinessInsights(metrics);
      res.json(insights);
    } catch (error) {
      console.error('Failed to get business insights:', error);
      res.status(500).json({ message: "Failed to get business insights" });
    }
  });

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

  // Webhook configuration endpoint
  app.get("/api/webhook-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      // Get or generate API key for this contractor
      let apiKey: string;
      try {
        const existingKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        if (!existingKey) {
          throw new Error('No API key found');
        }
        apiKey = existingKey;
      } catch {
        // Generate a new API key if none exists
        apiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
      }

      // Build the webhook URL
      const protocol = req.protocol;
      const host = req.get('host');
      const webhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/leads`;

      // Return the webhook configuration with documentation
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

  // Dialpad SMS webhook configuration endpoint
  app.get("/api/dialpad-webhook-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Build the Dialpad SMS webhook URL with tenant ID
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const tenantId = req.user!.contractorId;
      const webhookUrl = `${protocol}://${host}/api/webhooks/dialpad/sms/${tenantId}`;

      // Get contractor's webhook API key
      const contractor = await db.select()
        .from(contractors)
        .where(eq(contractors.id, tenantId))
        .limit(1);

      const apiKey = contractor && contractor.length > 0 ? contractor[0].webhookApiKey : null;

      res.json({
        webhookUrl,
        apiKey,
        service: "dialpad",
        documentation: {
          title: "Dialpad SMS Webhook Configuration",
          description: "Configure this webhook URL in your Dialpad account or Zapier to receive incoming text messages in your CRM",
          setupInstructions: [
            "1. Copy the Webhook URL above",
            "2. Copy the API Key above",
            "3. In Zapier, create a Webhook POST action:",
            "   - URL: Paste the webhook URL",
            "   - Headers: Add 'x-api-key' with the API Key value",
            "   - Data: Map your SMS fields (text, from_number, to_number)",
            "2. Navigate to Settings → Integrations → Webhooks",
            "3. Create a new webhook or edit an existing one",
            "4. Set the webhook URL to the URL provided below",
            "5. Select 'SMS Received' as the event type",
            "6. Save the webhook configuration",
            "7. Test by sending a text message to one of your Dialpad numbers"
          ],
          webhookUrl,
          expectedPayload: {
            text: "Message content",
            from_number: "+14155551234",
            to_number: "+14155555678",
            contact_name: "John Doe",
            message_id: "msg_123456",
            timestamp: "2024-01-15T10:00:00Z"
          },
          requiredFields: ["text", "from_number", "to_number"],
          optionalFields: {
            contact_name: "Name of the contact (optional)",
            message_id: "External message ID for deduplication (optional)",
            timestamp: "Message timestamp (optional)"
          },
          automaticBehavior: {
            direction: "Automatically detected - if from_number matches one of your Dialpad numbers, it's marked as outbound (and skipped). Otherwise, it's marked as inbound and processed."
          }
        }
      });
    } catch (error) {
      console.error('Failed to get Dialpad webhook config:', error);
      res.status(500).json({ message: "Failed to get Dialpad webhook configuration" });
    }
  });

  // Helper function to normalize phone numbers to E.164 format
  const normalizePhoneNumber = (phone: string): string => {
    if (!phone) return '';
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    // Add +1 if it's a 10-digit US number
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    // Add + if it's an 11-digit number starting with 1
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    // Already in E.164 format or other format
    return phone.startsWith('+') ? phone : `+${digits}`;
  };

  // Dialpad SMS Webhook endpoint (tenant-specific)
}
