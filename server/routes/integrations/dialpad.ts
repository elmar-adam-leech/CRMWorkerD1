import type { Express } from "express";
import { storage } from "../../storage";
import { users, contractors } from "@shared/schema";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { dialpadEnhancedService } from "../../dialpad-enhanced-service";
import { requireAuth, requireManagerOrAdmin } from "../../auth-service";
import { syncStatus } from "../../sync-status-store";
import { asyncHandler } from "../../utils/async-handler";
import { logger } from "../../utils/logger";

const log = logger('Dialpad');

export function registerDialpadRoutes(app: Express): void {
  app.post("/api/dialpad/sync-phone-numbers", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user.contractorId, 'dialpad');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const result = await dialpadEnhancedService.syncPhoneNumbers(req.user.contractorId);

    res.json({
      success: true,
      message: `Synced ${result.synced} phone numbers`,
      synced: result.synced,
      phoneNumbers: result.phoneNumbers,
      errors: result.errors
    });
  }));

  app.get("/api/dialpad/phone-numbers", asyncHandler(async (req, res) => {
    const phoneNumbers = await storage.getDialpadPhoneNumbers(req.user.contractorId);
    res.json(phoneNumbers);
  }));

  app.get("/api/dialpad/users/available-phone-numbers", requireAuth, asyncHandler(async (req, res) => {
    const action = req.query.action as 'sms' | 'call' || 'sms';
    const availableNumbers = await dialpadEnhancedService.getUserAvailablePhoneNumbers(
      req.user.userId,
      req.user.contractorId,
      action
    );
    res.json(availableNumbers);
  }));

  app.get("/api/users/:userId/phone-permissions", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const targetUser = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.contractorId, req.user.contractorId)))
      .limit(1);

    if (!targetUser[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const permissions = await storage.getUserPhoneNumberPermissions(userId);

    const permissionsWithDetails = await Promise.all(
      permissions.map(async (perm) => {
        const phoneNumber = await storage.getDialpadPhoneNumber(perm.phoneNumberId, req.user.contractorId);
        return {
          ...perm,
          phoneNumber: phoneNumber?.phoneNumber,
          displayName: phoneNumber?.displayName
        };
      })
    );

    res.json(permissionsWithDetails);
  }));

  app.post("/api/dialpad/phone-numbers/:phoneNumberId/permissions", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { phoneNumberId } = req.params;
    const { userId, canSendSms, canMakeCalls } = req.body;

    if (!userId) {
      res.status(400).json({ message: "User ID is required" });
      return;
    }

    const existingPermission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);

    if (existingPermission) {
      const updatedPermission = await storage.updateUserPhoneNumberPermission(existingPermission.id, {
        canSendSms: canSendSms ?? false,
        canMakeCalls: canMakeCalls ?? false,
        isActive: true
      });
      res.json(updatedPermission);
    } else {
      const newPermission = await storage.createUserPhoneNumberPermission({
        userId,
        phoneNumberId,
        contractorId: req.user.contractorId,
        canSendSms: canSendSms ?? false,
        canMakeCalls: canMakeCalls ?? false,
        assignedBy: req.user.userId
      });
      res.json(newPermission);
    }
  }));

  app.delete("/api/dialpad/phone-numbers/:phoneNumberId/permissions/:userId", requireManagerOrAdmin, asyncHandler(async (req, res) => {
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
  }));

  app.put("/api/dialpad/phone-numbers/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { displayName, department } = req.body;

    const updatedPhoneNumber = await storage.updateDialpadPhoneNumber(id, {
      displayName,
      department
    });

    res.json(updatedPhoneNumber);
  }));

  app.get("/api/dialpad/users", asyncHandler(async (req, res) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user.contractorId, 'dialpad');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const dialpadUsers = await dialpadEnhancedService.fetchDialpadUsers(req.user.contractorId);
    res.json(dialpadUsers);
  }));

  app.post("/api/dialpad/webhooks/create", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user.contractorId, 'dialpad');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const baseWebhookUrl = `${protocol}://${host}`;

    const result = await dialpadEnhancedService.createWebhookWithSubscription(
      req.user.contractorId,
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
  }));

  app.get("/api/dialpad/webhooks/list", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user.contractorId, 'dialpad');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const result = await dialpadEnhancedService.listWebhooks(req.user.contractorId);

    if (!result.success) {
      res.status(500).json({
        message: "Failed to list webhooks",
        error: result.error
      });
      return;
    }

    res.json({ webhooks: result.webhooks || [] });
  }));

  app.delete("/api/dialpad/webhooks/:webhookId", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { webhookId } = req.params;
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user.contractorId, 'dialpad');

    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const result = await dialpadEnhancedService.deleteWebhook(req.user.contractorId, webhookId);

    if (!result.success) {
      res.status(500).json({
        message: "Failed to delete webhook",
        error: result.error
      });
      return;
    }

    res.json({ success: true, message: "Webhook deleted successfully" });
  }));

  app.post("/api/dialpad/sync", asyncHandler(async (req, res) => {
    const contractorId = req.user.contractorId;

    const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'dialpad');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Dialpad integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    syncStatus.set(contractorId, {
      isRunning: true,
      progress: 'Starting Dialpad sync...',
      error: null,
      lastSync: null,
      startTime: new Date()
    });

    log.info(`Starting manual sync for tenant ${contractorId}`);

    const summary = {
      users: { fetched: 0, cached: 0 },
      departments: { fetched: 0, cached: 0 },
      phoneNumbers: { fetched: 0, cached: 0 }
    };

    syncStatus.set(contractorId, {
      isRunning: true,
      progress: 'Syncing Dialpad users...',
      error: null,
      lastSync: null,
      startTime: new Date()
    });

    log.info('Syncing users...');
    const usersResult = await dialpadEnhancedService.syncUsers(contractorId);
    summary.users.fetched = usersResult.fetched;
    summary.users.cached = usersResult.synced;
    log.info(`Fetched ${usersResult.fetched} users, synced ${usersResult.synced} to database`);

    if (usersResult.errors.length > 0) {
      log.warn(`${usersResult.errors.length} errors during user sync: ${JSON.stringify(usersResult.errors)}`);
    }

    syncStatus.set(contractorId, {
      isRunning: true,
      progress: 'Syncing Dialpad departments...',
      error: null,
      lastSync: null,
      startTime: new Date()
    });

    log.info('Syncing departments...');
    const departmentsResult = await dialpadEnhancedService.syncDepartments(contractorId);
    summary.departments.fetched = departmentsResult.fetched;
    summary.departments.cached = departmentsResult.synced;
    log.info(`Fetched ${departmentsResult.fetched} departments, synced ${departmentsResult.synced} to database`);

    if (departmentsResult.errors.length > 0) {
      log.warn(`${departmentsResult.errors.length} errors during department sync: ${JSON.stringify(departmentsResult.errors)}`);
    }

    syncStatus.set(contractorId, {
      isRunning: true,
      progress: 'Syncing Dialpad phone numbers...',
      error: null,
      lastSync: null,
      startTime: new Date()
    });

    log.info('Syncing phone numbers...');
    const numbersResult = await dialpadEnhancedService.syncPhoneNumbers(contractorId);
    summary.phoneNumbers.fetched = numbersResult.fetched;
    summary.phoneNumbers.cached = numbersResult.synced;
    log.info(`Fetched ${numbersResult.fetched} phone numbers, synced ${numbersResult.synced} to database`);

    if (numbersResult.errors.length > 0) {
      log.warn(`${numbersResult.errors.length} errors during phone number sync: ${JSON.stringify(numbersResult.errors)}`);
    }

    log.info('Sync completed: ' + JSON.stringify(summary));

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
  }));

  app.get("/api/dialpad-webhook-config", requireAuth, asyncHandler(async (req, res) => {
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const tenantId = req.user.contractorId;
    const webhookUrl = `${protocol}://${host}/api/webhooks/dialpad/sms/${tenantId}`;

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
  }));
}
