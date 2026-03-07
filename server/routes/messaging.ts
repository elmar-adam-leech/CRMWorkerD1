import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertMessageSchema, users, contractors } from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { dialpadService } from "../dialpad-service";
import { gmailService } from "../gmail-service";
import { type AuthedRequest } from "../auth-service";
import { broadcastToContractor } from "../websocket";
import { providerService } from "../providers/provider-service";

export function registerMessagingRoutes(app: Express): void {
  app.get("/api/messages", asyncHandler(async (req, res) => {
    const contactId = (req.query.contactId || req.query.leadId || req.query.customerId) as string | undefined;
    const estimateId = req.query.estimateId as string | undefined;
    const messages = await storage.getMessages(req.user.contractorId, contactId, estimateId);
    res.json(messages);
  }));

  app.post("/api/messages/send-text", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const messageData = parseBody(insertMessageSchema.omit({ contractorId: true, status: true }), req, res);
    if (!messageData) return;

    if (messageData.type !== 'text') {
      res.status(400).json({ message: "This endpoint is only for text messages" });
      return;
    }

    if (!messageData.toNumber) {
      res.status(400).json({ message: "Phone number is required" });
      return;
    }

    const { DialpadService } = await import('../dialpad-service');
    const dialpadService = new DialpadService();
    const smsResponse = await dialpadService.sendText(
      messageData.toNumber,
      messageData.content,
      messageData.fromNumber || undefined,
      req.user.contractorId
    );

    const resolvedContactId = messageData.contactId || (req.body.leadId as string | undefined) || (req.body.customerId as string | undefined);

    if (smsResponse.success) {
      const savedMessage = await storage.createMessage({
        ...messageData,
        status: 'sent',
        externalMessageId: smsResponse.messageId || null,
      }, req.user.contractorId);

      await Promise.all([
        resolvedContactId
          ? storage.markContactContacted(resolvedContactId, req.user.contractorId, req.user.userId)
          : Promise.resolve(),
        storage.createActivity({
          type: 'sms',
          title: 'SMS sent',
          content: messageData.content,
          contactId: resolvedContactId || null,
          userId: req.user.userId,
          externalId: smsResponse.messageId || null,
          externalSource: 'dialpad',
        }, req.user.contractorId),
      ]);

      broadcastToContractor(req.user.contractorId, {
        type: 'new_message',
        message: savedMessage,
        contactId: resolvedContactId || null,
      });

      res.json({
        success: true,
        message: savedMessage,
        messageId: smsResponse.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        error: smsResponse.error,
        message: "Failed to send text message"
      });
    }
  }));

  app.post("/api/messages/send-email", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const emailBodySchema = z.object({
      to: z.string().email({ message: "A valid recipient email address is required" }),
      subject: z.string().min(1, { message: "Subject is required" }),
      content: z.string().min(1, { message: "Email body is required" }),
      contactId: z.string().optional(),
      leadId: z.string().optional(),
      customerId: z.string().optional(),
      estimateId: z.string().optional(),
    });

    const parsed = emailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const { to, subject, content, contactId, leadId, customerId, estimateId } = parsed.data;

    const resolvedContactId = contactId || leadId || customerId;

    // Fetch user and contractor in parallel — independent queries
    const [userResult, contractorResult] = await Promise.all([
      db.select().from(users).where(and(
        eq(users.id, req.user.userId),
        eq(users.contractorId, req.user.contractorId)
      )),
      db.select().from(contractors).where(eq(contractors.id, req.user.contractorId)),
    ]);
    const user = userResult[0];
    const contractor = contractorResult[0];
    if (!user || !user.gmailConnected || !user.gmailRefreshToken) {
      res.status(400).json({ message: "Gmail not connected. Please connect your Gmail account in settings." });
      return;
    }

    const fromName = contractor?.name
      ? `${user.name} @ ${contractor.name}`
      : user.name;

    const emailResponse = await gmailService.sendEmail({
      to,
      subject,
      content,
      fromEmail: user.gmailEmail || undefined,
      fromName: fromName,
      refreshToken: user.gmailRefreshToken,
    });

    if (emailResponse.success) {
      const emailMetadata = {
        subject,
        to: [to],
        from: user.gmailEmail || '',
        messageId: emailResponse.messageId,
        direction: 'outbound',
      };

      const activity = await storage.createActivity({
        type: 'email',
        title: `Email: ${subject}`,
        content,
        metadata: JSON.stringify(emailMetadata),
        contactId: resolvedContactId || null,
        estimateId: estimateId || null,
        userId: req.user.userId,
        externalId: emailResponse.messageId || null,
        externalSource: 'gmail',
      }, req.user.contractorId);

      const contactIdToMark = resolvedContactId || estimateId;
      if (contactIdToMark) {
        await storage.markContactContacted(contactIdToMark, req.user.contractorId, req.user.userId);
      }

      let broadcastLeadId: string | null = leadId || null;
      let broadcastCustomerId: string | null = customerId || null;
      let broadcastContactType: 'estimate' | 'customer' | 'lead' = 'lead';

      if (estimateId) {
        broadcastContactType = 'estimate';
      } else if (customerId) {
        broadcastCustomerId = customerId;
        broadcastContactType = 'customer';
      } else if (leadId) {
        broadcastLeadId = leadId;
        broadcastContactType = 'lead';
      } else if (contactId && resolvedContactId) {
        const resolvedContact = await storage.getContact(resolvedContactId, req.user.contractorId);
        if (resolvedContact?.type === 'customer') {
          broadcastCustomerId = resolvedContactId;
          broadcastContactType = 'customer';
        } else {
          broadcastLeadId = resolvedContactId;
          broadcastContactType = 'lead';
        }
      }

      broadcastToContractor(req.user.contractorId, {
        type: 'new_message',
        message: {
          id: activity.id,
          type: 'email' as const,
          status: 'sent' as const,
          direction: emailMetadata.direction as 'outbound',
          content: activity.content || content,
          toNumber: emailMetadata.to[0],
          fromNumber: emailMetadata.from,
          contactId: activity.contactId || null,
          leadId: broadcastLeadId,
          customerId: broadcastCustomerId,
          estimateId: activity.estimateId || null,
          userId: activity.userId || null,
          externalMessageId: emailMetadata.messageId || null,
          contractorId: activity.contractorId,
          createdAt: activity.createdAt,
          userName: user.name,
        },
        contactId: resolvedContactId || estimateId || null,
        contactType: broadcastContactType
      });

      res.json({
        success: true,
        messageId: emailResponse.messageId,
        message: "Email sent successfully"
      });
    } else {
      res.status(500).json({
        success: false,
        error: emailResponse.error,
        message: "Failed to send email"
      });
    }
  }));

  app.post("/api/calls/initiate", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const callBodySchema = z.object({
      toNumber: z.string().min(1, { message: "Destination phone number is required" }),
      fromNumber: z.string().optional(),
      autoRecord: z.boolean().optional(),
      contactId: z.string().optional(),
      customerId: z.string().optional(),
      leadId: z.string().optional(),
    });

    const parsed = callBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const { toNumber, fromNumber, autoRecord, contactId, customerId, leadId } = parsed.data;
    const resolvedContactId = contactId || leadId || customerId;

    const callResponse = await providerService.initiateCall({
      to: toNumber,
      fromNumber: fromNumber || undefined,
      autoRecord: autoRecord || false,
      contractorId: req.user.contractorId,
      userId: req.user.userId
    });

    console.log('Call response:', callResponse);

    if (callResponse.success && callResponse.callId) {
      const callData = {
        externalCallId: callResponse.callId,
        toNumber,
        fromNumber: fromNumber || null,
        status: 'initiated' as const,
        customerId: customerId || null,
        leadId: leadId || null,
        userId: req.user.userId,
        callUrl: callResponse.callUrl || null,
        metadata: JSON.stringify({
          autoRecord,
          callResponse: {
            success: callResponse.success,
            timestamp: new Date().toISOString()
          }
        })
      };

      await storage.createCall(callData, req.user.contractorId);

      if (resolvedContactId) {
        await storage.markContactContacted(resolvedContactId, req.user.contractorId, req.user.userId);
      }

      await storage.createActivity({
        type: 'call',
        title: 'Phone call initiated',
        content: `Call initiated to ${toNumber}${fromNumber ? ` from ${fromNumber}` : ''}`,
        contactId: resolvedContactId || null,
        userId: req.user.userId
      }, req.user.contractorId);

      res.json({
        success: true,
        callId: callResponse.callId,
        callUrl: callResponse.callUrl
      });
    } else {
      console.error('Call initiation failed:', callResponse.error);
      res.status(500).json({
        success: false,
        error: callResponse.error
      });
    }
  }));

  app.get("/api/calls/:callId", asyncHandler(async (req, res) => {
    const { callId } = req.params;

    const callRecord = await storage.getCallByExternalId(callId, req.user.contractorId);
    if (!callRecord) {
      res.status(404).json({
        success: false,
        error: "Call not found or access denied"
      });
      return;
    }

    const dialpadResponse = await dialpadService.getCallDetails(callId);

    if (dialpadResponse.success) {
      let legacyLeadId: string | null = null;
      let legacyCustomerId: string | null = null;
      if (callRecord.contactId) {
        const callContact = await storage.getContact(callRecord.contactId, req.user.contractorId);
        if (callContact?.type === 'customer') {
          legacyCustomerId = callRecord.contactId;
        } else {
          legacyLeadId = callRecord.contactId;
        }
      }

      res.json({
        success: true,
        callDetails: dialpadResponse.callDetails,
        localCallInfo: {
          id: callRecord.id,
          toNumber: callRecord.toNumber,
          fromNumber: callRecord.fromNumber,
          status: callRecord.status,
          contactId: callRecord.contactId,
          customerId: legacyCustomerId,
          leadId: legacyLeadId,
          createdAt: callRecord.createdAt
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: dialpadResponse.error
      });
    }
  }));

  app.get("/api/messages/all", asyncHandler(async (req, res) => {
    const { type, status, search, limit, offset } = req.query;
    const options = {
      type: type as 'text' | 'email' | undefined,
      status: status as 'sent' | 'delivered' | 'failed' | undefined,
      search: search as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    };

    const messages = await storage.getAllMessages(req.user.contractorId, options);
    res.json(messages);
  }));

  app.get("/api/conversations", asyncHandler(async (req, res) => {
    const { search, type, status } = req.query;
    const options = {
      search: search as string | undefined,
      type: type as 'text' | 'email' | undefined,
      status: status as 'sent' | 'delivered' | 'failed' | undefined,
    };

    const conversations = await storage.getConversations(req.user.contractorId, options);
    res.json(conversations);
  }));

  app.get("/api/conversations/:contactId", asyncHandler(async (req, res) => {
    const { contactId } = req.params;
    const messages = await storage.getConversationMessages(req.user.contractorId, contactId);
    res.json(messages);
  }));

  app.get("/api/conversations/:contactId/:contactType", asyncHandler(async (req, res) => {
    const { contactId, contactType } = req.params;

    if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
      res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
      return;
    }

    const messages = await storage.getConversationMessages(req.user.contractorId, contactId);
    res.json(messages);
  }));

  app.get("/api/conversations/:contactId/:contactType/count", asyncHandler(async (req, res) => {
    const { contactId, contactType } = req.params;

    if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
      res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
      return;
    }

    const count = await storage.getConversationMessageCount(req.user.contractorId, contactId);
    res.json({ count });
  }));

  app.post("/api/calls/log-personal", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { contactId, phone, name } = req.body as { contactId?: string; phone?: string; name?: string };
    if (!phone) {
      res.status(400).json({ message: "phone is required" });
      return;
    }
    const label = name ? `${name} (${phone})` : phone;
    await storage.createActivity({
      contractorId: req.user.contractorId,
      userId: req.user.userId,
      contactId: contactId || null,
      type: "call",
      description: `Outbound call to ${label} via personal phone`,
    });
    res.json({ success: true });
  }));

  app.get("/api/providers", asyncHandler(async (req, res) => {
    const tenantProviders = await storage.getTenantProviders(req.user.contractorId);
    const availableProviders = {
      email: providerService.getAvailableProviders('email'),
      sms: providerService.getAvailableProviders('sms'),
      calling: providerService.getAvailableProviders('calling')
    };
    res.json({ available: availableProviders, configured: tenantProviders });
  }));

  app.post("/api/providers", asyncHandler(async (req, res) => {
    const { providerType, providerName } = req.body;
    if (!providerType || !providerName) {
      res.status(400).json({ message: "Provider type and name are required" });
      return;
    }
    if (!['email', 'sms', 'calling'].includes(providerType)) {
      res.status(400).json({ message: "Invalid provider type" });
      return;
    }
    const result = await providerService.setTenantProvider(req.user.contractorId, providerType as 'email' | 'sms' | 'calling', providerName);
    if (result.success) {
      res.json({ success: true, message: `${providerType} provider set to ${providerName}` });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  }));
}
