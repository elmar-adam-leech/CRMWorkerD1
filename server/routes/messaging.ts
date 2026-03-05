import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertMessageSchema, insertTemplateSchema, insertCallSchema, templates, messages, activities, users, contractors } from "@shared/schema";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { dialpadService } from "../dialpad-service";
import { gmailService } from "../gmail-service";
import { AuthService, requireAuth, requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { sendGridService } from "../sendgrid-service";
import { providerService } from "../providers/provider-service";
import { z } from "zod";

export function registerMessagingRoutes(app: Express): void {
  app.get("/api/messages", asyncHandler(async (req, res) => {
    // Support both legacy leadId/customerId params and new contactId for backward compatibility
    const contactId = (req.query.contactId || req.query.leadId || req.query.customerId) as string | undefined;
    const estimateId = req.query.estimateId as string | undefined;
    const messages = await storage.getMessages(req.user!.contractorId, contactId, estimateId);
    res.json(messages);
  }));

  app.post("/api/messages/send-text", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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

    // Send text via Dialpad service directly (with fixed phone formatting)
    const { DialpadService } = await import('../dialpad-service');
    const dialpadService = new DialpadService();
    const smsResponse = await dialpadService.sendText(
      messageData.toNumber,
      messageData.content,
      messageData.fromNumber || undefined,
      req.user!.contractorId
    );

    // Save message to database with external message ID from Dialpad
    // Use contactId directly (schema no longer has leadId/customerId)
    const contactId = messageData.contactId || null;
    const message = await storage.createMessage({
      ...messageData,
      contactId: contactId,
      userId: req.user!.userId,
      status: smsResponse.success ? 'sent' : 'failed',
      externalMessageId: smsResponse.messageId || null,
    }, req.user!.contractorId);

    // Automatically mark contact as contacted if this is a text to a contact
    if (contactId && smsResponse.success) {
      await storage.markContactContacted(contactId, req.user!.contractorId, req.user!.userId);
    }

    // Log activity for the SMS
    if (smsResponse.success) {
      await storage.createActivity({
        type: 'sms',
        title: 'Text message sent',
        content: messageData.content,
        contactId: message.contactId || null,
        estimateId: message.estimateId || null,
        userId: req.user!.userId
      }, req.user!.contractorId);
      
      broadcastToContractor(req.user!.contractorId, {
        type: 'new_message',
        message: message,
        contactId: message.contactId || message.estimateId,
        contactType: message.estimateId ? 'estimate' : 'contact'
      });
    }

    if (smsResponse.success) {
      res.json({ message, success: true });
    } else {
      res.status(500).json({ 
        message, 
        success: false, 
        error: smsResponse.error 
      });
    }
  }));

  app.post("/api/messages/send-email", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { subject, toEmail, ...messageData } = req.body;
    const parsedData = parseBody(insertMessageSchema.omit({ contractorId: true, status: true }), {
      ...req,
      body: {
        ...messageData,
        type: 'email',
        toNumber: toEmail,
      }
    } as AuthenticatedRequest, res);
    if (!parsedData) return;

    if (!toEmail) {
      res.status(400).json({ message: "Email address is required" });
      return;
    }

    if (!subject) {
      res.status(400).json({ message: "Email subject is required" });
      return;
    }

    // Send email via tenant's preferred email provider
    const emailResponse = await providerService.sendEmail({
      to: toEmail,
      subject: subject,
      content: parsedData.content,
      contractorId: req.user!.contractorId
    });

    // Save message to database
    // Use contactId directly (schema no longer has leadId/customerId)
    const contactIdForEmail = parsedData.contactId || null;
    const message = await storage.createMessage({
      ...parsedData,
      contactId: contactIdForEmail,
      status: emailResponse.success ? 'sent' : 'failed',
    }, req.user!.contractorId);

    // Automatically mark contact as contacted if this is an email to a contact
    if (contactIdForEmail && emailResponse.success) {
      await storage.markContactContacted(contactIdForEmail, req.user!.contractorId, req.user!.userId);
    }

    // Log activity for the email
    if (emailResponse.success) {
      await storage.createActivity({
        type: 'email',
        title: `Email: ${subject}`,
        content: parsedData.content,
        contactId: message.contactId || null,
        estimateId: message.estimateId || null,
        userId: req.user!.userId
      }, req.user!.contractorId);
      
      broadcastToContractor(req.user!.contractorId, {
        type: 'new_message',
        message: message,
        contactId: message.contactId || message.estimateId,
        contactType: message.estimateId ? 'estimate' : 'contact'
      });
    }

    if (emailResponse.success) {
      res.json({ 
        message, 
        success: true, 
        statusMessage: `Email sent successfully`,
        messageId: emailResponse.messageId 
      });
    } else {
      res.status(500).json({ 
        message, 
        success: false, 
        error: emailResponse.error 
      });
    }
  }));

  // Validation schema for sending Gmail
  const sendGmailSchema = z.object({
    to: z.string().email("Invalid email address"),
    subject: z.string().min(1, "Subject is required"),
    content: z.string().min(1, "Content is required"),
    contactId: z.string().optional(),
    leadId: z.string().optional(), // Legacy - mapped to contactId
    estimateId: z.string().optional(),
    customerId: z.string().optional(), // Legacy - mapped to contactId
  });

  // Send email via user's connected Gmail account (per-user OAuth)
  app.post("/api/emails/send-gmail", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validatedData = parseBody(sendGmailSchema, req, res);
    if (!validatedData) return;

    const { to, subject, content, contactId, leadId, estimateId, customerId } = validatedData;
    // Support both new (contactId) and legacy (leadId, customerId) parameters
    const resolvedContactId = contactId || leadId || customerId;

    // Get user's Gmail credentials
    const userResult = await db.select().from(users).where(and(
      eq(users.id, req.user!.userId),
      eq(users.contractorId, req.user!.contractorId)
    ));
    const user = userResult[0];
    if (!user || !user.gmailConnected || !user.gmailRefreshToken) {
      res.status(400).json({ message: "Gmail not connected. Please connect your Gmail account in settings." });
      return;
    }

    // Get contractor information for company name
    const contractorResult = await db.select().from(contractors).where(
      eq(contractors.id, req.user!.contractorId)
    );
    const contractor = contractorResult[0];

    // Format sender name as "User Name @ Company Name"
    const fromName = contractor?.name 
      ? `${user.name} @ ${contractor.name}`
      : user.name;

    // Send email via Gmail API
    const emailResponse = await gmailService.sendEmail({
      to,
      subject,
      content,
      fromEmail: user.gmailEmail || undefined,
      fromName: fromName,
      refreshToken: user.gmailRefreshToken,
    });

    if (emailResponse.success) {
      // Create activity record with email metadata including direction
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
        userId: req.user!.userId,
        externalId: emailResponse.messageId || null,
        externalSource: 'gmail',
      }, req.user!.contractorId);

      // Mark contact as contacted if this is an email to a contact
      const contactIdToMark = resolvedContactId || estimateId;
      if (contactIdToMark) {
        await storage.markContactContacted(contactIdToMark, req.user!.contractorId, req.user!.userId);
      }

      // Broadcast new message to WebSocket clients
      // Transform activity to Message format matching getConversationMessages
      // Preserve legacy field semantics: determine leadId/customerId based on contact type
      
      // Determine legacy fields based on contact type for backward compatibility
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
        // When only new contactId is provided, look up contact type
        const resolvedContact = await storage.getContact(resolvedContactId, req.user!.contractorId);
        if (resolvedContact?.type === 'customer') {
          broadcastCustomerId = resolvedContactId;
          broadcastContactType = 'customer';
        } else {
          broadcastLeadId = resolvedContactId;
          broadcastContactType = 'lead';
        }
      }
      
      broadcastToContractor(req.user!.contractorId, {
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

  // Validation schema for fetching Gmail
  const fetchGmailSchema = z.object({
    sinceDate: z.string().optional(),
  });

  // Fetch new emails from user's connected Gmail account
  app.post("/api/emails/fetch-gmail", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validatedData = parseBody(fetchGmailSchema, req, res);
    if (!validatedData) return;

    const { sinceDate } = validatedData;

    // Get user's Gmail credentials
    const userResult = await db.select().from(users).where(and(
      eq(users.id, req.user!.userId),
      eq(users.contractorId, req.user!.contractorId)
    ));
    const user = userResult[0];
    if (!user || !user.gmailConnected || !user.gmailRefreshToken) {
      res.status(400).json({ message: "Gmail not connected. Please connect your Gmail account in settings." });
      return;
    }

    // Fetch emails from Gmail
    const since = sinceDate ? new Date(sinceDate) : (user.gmailLastSyncAt || undefined);
    const result = await gmailService.fetchNewEmails(user.gmailRefreshToken, since);
    
    // Handle potential errors or expired tokens
    if (result.error) {
      console.error('[Email] Gmail fetch error:', result.error);
      res.status(500).json({ message: result.error });
      return;
    }
    
    if (result.tokenExpired) {
      res.status(401).json({ message: "Gmail token expired. Please reconnect your Gmail account." });
      return;
    }
    
    const emails = result.emails || [];

    // Process each email and create activities
    let processedCount = 0;
    for (const email of emails) {
      // Check if we already have an activity for this email to avoid duplicates
      const existingActivity = await db.select().from(activities).where(and(
        eq(activities.externalId, email.id),
        eq(activities.externalSource, 'gmail'),
        eq(activities.contractorId, req.user!.contractorId)
      )).limit(1);

      if (existingActivity.length > 0) {
        console.log('[Email Sync] Skipping duplicate email:', email.id);
        continue;
      }

      // Try to match email to existing lead/customer/estimate by email address
      const fromEmail = email.from;
      const toEmail = email.to;
      
      // Determine if email is inbound (from customer/lead) or outbound (sent by us)
      // If the "from" email matches user's Gmail, it's outbound; otherwise it's inbound
      const isOutbound = fromEmail?.toLowerCase() === user.gmailEmail?.toLowerCase();
      const direction = isOutbound ? 'outbound' : 'inbound';
      
      // For outbound emails, match on 'to', for inbound emails, match on 'from'
      const emailToMatch = isOutbound ? toEmail : fromEmail;
      
      let matchingContact = null;

      // Only search for a match if we have a valid email to match
      if (emailToMatch && typeof emailToMatch === 'string') {
        const matchedId = await storage.findMatchingContact(
          req.user!.contractorId,
          [emailToMatch]
        );
        if (matchedId) {
          matchingContact = await storage.getContact(matchedId, req.user!.contractorId) ?? null;
        }
      }

      const matchingLead = matchingContact?.type === 'lead' ? matchingContact : null;
      const matchingCustomer = matchingContact?.type === 'customer' ? matchingContact : null;

      // Create activity record with email metadata including direction
      const emailMetadata = {
        subject: email.subject,
        to: email.to,
        from: email.from,
        messageId: email.id,
        direction: direction,
      };

      const activity = await storage.createActivity({
        type: 'email',
        title: direction === 'inbound' ? `Email received: ${email.subject}` : `Email sent: ${email.subject}`,
        content: email.body || email.snippet,
        metadata: JSON.stringify(emailMetadata),
        contactId: matchingContact?.id || null,
        userId: req.user!.userId,
        externalId: email.id,
        externalSource: 'gmail',
      }, req.user!.contractorId);

      // Broadcast activity update via WebSocket
      if (matchingContact) {
        broadcastToContractor(req.user!.contractorId, {
          type: 'activity',
          contactId: matchingContact.id,
          ...(matchingLead ? { leadId: matchingLead.id } : {}),
          ...(matchingCustomer ? { customerId: matchingCustomer.id } : {}),
          activity: activity,
        });
      }

      processedCount++;
    }

    // Update user's last sync timestamp
    await db.update(users)
      .set({ gmailLastSyncAt: new Date() })
      .where(and(
        eq(users.id, req.user!.userId),
        eq(users.contractorId, req.user!.contractorId)
      ));

    res.json({
      success: true,
      count: processedCount,
      message: `Fetched ${processedCount} new emails`
    });
  }));

  // Call initiation route
  app.post("/api/calls/initiate", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { toNumber, fromNumber, autoRecord, contactId, customerId, leadId } = req.body;
    // Support both new (contactId) and legacy (leadId, customerId) parameters
    const resolvedContactId = contactId || leadId || customerId;
    
    if (!toNumber) {
      res.status(400).json({ message: "Phone number is required" });
      return;
    }

    // Initiate call via tenant's preferred calling provider
    const callResponse = await providerService.initiateCall({
      to: toNumber,
      fromNumber: fromNumber || undefined,
      autoRecord: autoRecord || false,
      contractorId: req.user!.contractorId,
      userId: req.user!.userId
    });

    console.log('Call response:', callResponse);
    
    if (callResponse.success && callResponse.callId) {
      // Store call metadata for tenant isolation
      const callData = {
        externalCallId: callResponse.callId,
        toNumber,
        fromNumber: fromNumber || null,
        status: 'initiated' as const,
        customerId: customerId || null,
        leadId: leadId || null,
        userId: req.user!.userId,
        callUrl: callResponse.callUrl || null,
        metadata: JSON.stringify({
          autoRecord,
          callResponse: {
            success: callResponse.success,
            timestamp: new Date().toISOString()
          }
        })
      };

      await storage.createCall(callData, req.user!.contractorId);

      // Automatically mark contact as contacted if this is a call to a contact
      if (resolvedContactId) {
        await storage.markContactContacted(resolvedContactId, req.user!.contractorId, req.user!.userId);
      }

      // Log activity for the call
      await storage.createActivity({
        type: 'call',
        title: 'Phone call initiated',
        content: `Call initiated to ${toNumber}${fromNumber ? ` from ${fromNumber}` : ''}`,
        contactId: resolvedContactId || null,
        userId: req.user!.userId
      }, req.user!.contractorId);

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

  // Get call details route with tenant isolation
  app.get("/api/calls/:callId", asyncHandler(async (req, res) => {
    const { callId } = req.params;
    
    // SECURITY: First verify this call belongs to the user's tenant
    const callRecord = await storage.getCallByExternalId(callId, req.user!.contractorId);
    if (!callRecord) {
      res.status(404).json({ 
        success: false, 
        error: "Call not found or access denied" 
      });
      return;
    }

    // Now safely fetch details from Dialpad since we've verified tenant ownership
    const dialpadResponse = await dialpadService.getCallDetails(callId);

    if (dialpadResponse.success) {
      // Look up contact type for legacy field population
      let legacyLeadId: string | null = null;
      let legacyCustomerId: string | null = null;
      if (callRecord.contactId) {
        const callContact = await storage.getContact(callRecord.contactId, req.user!.contractorId);
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

  // Enhanced message routes for unified communications
  app.get("/api/messages/all", asyncHandler(async (req, res) => {
    const { type, status, search, limit, offset } = req.query;
    const options = {
      type: type as 'text' | 'email' | undefined,
      status: status as 'sent' | 'delivered' | 'failed' | undefined,
      search: search as string | undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    };
    
    const messages = await storage.getAllMessages(req.user!.contractorId, options);
    res.json(messages);
  }));

  app.get("/api/conversations", asyncHandler(async (req, res) => {
    const { search, type, status } = req.query;
    const options = {
      search: search as string | undefined,
      type: type as 'text' | 'email' | undefined,
      status: status as 'sent' | 'delivered' | 'failed' | undefined,
    };
    
    const conversations = await storage.getConversations(req.user!.contractorId, options);
    res.json(conversations);
  }));

  // Unified endpoint for fetching conversation messages by contactId (no contactType needed)
  app.get("/api/conversations/:contactId", asyncHandler(async (req, res) => {
    const { contactId } = req.params;
    
    const messages = await storage.getConversationMessages(
      req.user!.contractorId, 
      contactId
    );
    res.json(messages);
  }));

  // Legacy endpoint for backwards compatibility (deprecated - use /api/conversations/:contactId instead)
  app.get("/api/conversations/:contactId/:contactType", asyncHandler(async (req, res) => {
    const { contactId, contactType } = req.params;
    
    if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
      res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
      return;
    }
    
    // contactType parameter is deprecated - getConversationMessages now works with unified contacts table
    const messages = await storage.getConversationMessages(
      req.user!.contractorId, 
      contactId
    );
    res.json(messages);
  }));

  // Lightweight endpoint to check for new messages (returns count only)
  app.get("/api/conversations/:contactId/:contactType/count", asyncHandler(async (req, res) => {
    const { contactId, contactType } = req.params;
    
    if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
      res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
      return;
    }
    
    // contactType parameter is deprecated - getConversationMessageCount now works with unified contacts table
    const count = await storage.getConversationMessageCount(
      req.user!.contractorId, 
      contactId
    );
    res.json({ count });
  }));

  // Template routes for text and email templates
  app.get("/api/templates", asyncHandler(async (req, res) => {
    const type = req.query.type as 'text' | 'email' | undefined;
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
    const userId = req.user!.userId;
    
    // Build query to filter templates
    // Admins see all templates, others see only approved templates OR templates they created
    let query = db.select().from(templates).where(eq(templates.contractorId, req.user!.contractorId));
    
    if (type) {
      query = (query as any).where(and(
        eq(templates.contractorId, req.user!.contractorId),
        eq(templates.type, type)
      ));
    }
    
    const allTemplates = await query;
    
    // Filter based on user role and template status
    const filteredTemplates = allTemplates.filter(template => {
      if (isAdmin) {
        return true; // Admins see all templates
      }
      if (template.status === 'approved') {
        return true; // Everyone sees approved templates
      }
      if (template.createdBy === userId) {
        return true; // Users see their own templates regardless of status
      }
      return false; // Hide non-approved templates from other users
    });
    
    res.json(filteredTemplates);
  }));

  app.get("/api/templates/:id", asyncHandler(async (req, res) => {
    const template = await storage.getTemplate(req.params.id, req.user!.contractorId);
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json(template);
  }));

  app.post("/api/templates", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const templateData = parseBody(insertTemplateSchema.omit({ contractorId: true }), req, res);
    if (!templateData) return;
    
    // Automatically set createdBy to current user
    const dataWithUser = {
      ...templateData,
      createdBy: req.user!.userId,
    };
    
    // Admins can create approved templates directly, others need approval
    const template = await storage.createTemplate(dataWithUser, req.user!.contractorId);
    res.status(201).json(template);
  }));

  app.put("/api/templates/:id", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const updateData = parseBody(insertTemplateSchema.omit({ contractorId: true }).partial(), req, res);
    if (!updateData) return;

    const template = await storage.updateTemplate(req.params.id, updateData, req.user!.contractorId);
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json(template);
  }));

  app.delete("/api/templates/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const success = await storage.deleteTemplate(req.params.id, req.user!.contractorId);
    if (!success) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ message: "Template deleted successfully" });
  }));

  // Approve template (admin only)
  app.post("/api/templates/:id/approve", requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Update template status to approved
    const updated = await db.update(templates)
      .set({ 
        status: 'approved',
        approvedBy: req.user!.userId,
        approvedAt: new Date()
      })
      .where(and(
        eq(templates.id, id),
        eq(templates.contractorId, req.user!.contractorId)
      ))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    res.json({ 
      ...updated[0], 
      message: "Template approved successfully" 
    });
  }));

  // Reject template (admin only)
  app.post("/api/templates/:id/reject", requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    
    // Update template status to rejected
    const updated = await db.update(templates)
      .set({ 
        status: 'rejected',
        rejectionReason: rejectionReason || 'No reason provided',
        approvedBy: req.user!.userId,
        approvedAt: new Date()
      })
      .where(and(
        eq(templates.id, id),
        eq(templates.contractorId, req.user!.contractorId)
      ))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    res.json({ 
      ...updated[0], 
      message: "Template rejected" 
    });
  }));

  // Provider management routes
  app.get("/api/providers", asyncHandler(async (req, res) => {
    const tenantProviders = await storage.getTenantProviders(req.user!.contractorId);
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
    const result = await providerService.setTenantProvider(req.user!.contractorId, providerType as 'email' | 'sms' | 'calling', providerName);
    if (result.success) {
      res.json({ success: true, message: `${providerType} provider set to ${providerName}` });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  }));

  // Integration enablement routes
}
