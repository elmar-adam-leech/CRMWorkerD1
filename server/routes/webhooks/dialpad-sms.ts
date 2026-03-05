import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../../storage";
import { webhookEvents, dialpadPhoneNumbers, messages, contractors } from "@shared/schema";
import { db } from "../../db";
import { eq, and, sql } from "drizzle-orm";
import { dialpadEnhancedService } from "../../dialpad-enhanced-service";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import { normalizePhoneNumber, normalizePhoneForStorage } from "../../utils/phone-normalizer";

export function registerDialpadSmsWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/dialpad/sms/:tenantId", webhookRateLimiter, express.json(), async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      console.log(`[Dialpad Webhook] Received SMS webhook for tenant ${tenantId}`);
      
      const payload = req.body;
      
      const apiKey = req.headers['x-api-key'] as string;
      
      if (!apiKey) {
        console.log('[Dialpad Webhook] Missing x-api-key header');
        res.status(401).json({ success: false, error: 'Missing x-api-key header' });
        return;
      }
      
      const contractor = await db.select()
        .from(contractors)
        .where(eq(contractors.id, tenantId))
        .limit(1);
      
      if (!contractor || contractor.length === 0) {
        console.error(`[Dialpad Webhook] Invalid tenant ID: ${tenantId}`);
        res.status(404).json({ success: false, error: 'Invalid tenant ID' });
        return;
      }
      
      if (contractor[0].webhookApiKey !== apiKey) {
        console.log('[Dialpad Webhook] Invalid API key');
        res.status(403).json({ success: false, error: 'Invalid API key' });
        return;
      }
      
      const contractorId = tenantId;
      
      const webhookEvent = await db.insert(webhookEvents).values({
        contractorId,
        service: 'dialpad',
        eventType: 'sms.received',
        payload: JSON.stringify(payload),
        processed: false,
      }).returning();
      
      const {
        text: webhookText,
        from_number: fromNumber,
        to_number: toNumberRaw,
        message_id: messageId,
        sms_id: smsId,
        id: dialpadMessageId,
      } = payload;
      
      const externalMessageId = smsId || messageId || dialpadMessageId;
      
      const toNumber = Array.isArray(toNumberRaw) ? toNumberRaw[0] : toNumberRaw;
      
      const normalizedFromNumber = normalizePhoneNumber(fromNumber);
      const normalizedToNumber = normalizePhoneNumber(toNumber);
      
      const dialpadNumbers = await db.select()
        .from(dialpadPhoneNumbers)
        .where(eq(dialpadPhoneNumbers.contractorId, contractorId));
      
      const isFromOurNumber = dialpadNumbers.some(dpn => {
        const normalizedDialpadNumber = normalizePhoneNumber(dpn.phoneNumber);
        return normalizedDialpadNumber === normalizedFromNumber || dpn.phoneNumber === fromNumber;
      });
      
      const direction = isFromOurNumber ? 'outbound' : 'inbound';
      
      const { timestamp } = payload;
      
      if (externalMessageId) {
        const existingMessage = await db.select()
          .from(messages)
          .where(and(
            eq(messages.externalMessageId, externalMessageId),
            eq(messages.contractorId, contractorId)
          ))
          .limit(1);
        
        if (existingMessage && existingMessage.length > 0) {
          await db.update(webhookEvents)
            .set({ 
              processed: true, 
              processedAt: new Date(),
              errorMessage: 'Skipped: Duplicate message (external_message_id already exists)' 
            })
            .where(eq(webhookEvents.id, webhookEvent[0].id));
          
          console.log('[Dialpad Webhook] Skipping duplicate message with external_message_id:', externalMessageId);
          res.status(200).json({ success: true, message: 'Duplicate message skipped' });
          return;
        }
      }
      
      if (timestamp && webhookText) {
        const messageTimestamp = new Date(timestamp);
        const oneSecondBefore = new Date(messageTimestamp.getTime() - 1000);
        const oneSecondAfter = new Date(messageTimestamp.getTime() + 1000);
        
        const duplicateByContent = await db.select()
          .from(messages)
          .where(and(
            eq(messages.contractorId, contractorId),
            eq(messages.fromNumber, fromNumber),
            eq(messages.toNumber, toNumber),
            eq(messages.content, webhookText),
            sql`${messages.createdAt} >= ${oneSecondBefore}`,
            sql`${messages.createdAt} <= ${oneSecondAfter}`
          ))
          .limit(1);
        
        if (duplicateByContent && duplicateByContent.length > 0) {
          await db.update(webhookEvents)
            .set({ 
              processed: true, 
              processedAt: new Date(),
              errorMessage: 'Skipped: Duplicate message (same timestamp, numbers, and content)' 
            })
            .where(eq(webhookEvents.id, webhookEvent[0].id));
          
          console.log('[Dialpad Webhook] Skipping duplicate message based on timestamp+content match');
          res.status(200).json({ success: true, message: 'Duplicate message skipped' });
          return;
        }
      }
      
      const placeholderText = direction === 'inbound' ? '[Inbound text]' : '[Outbound text]';
      let messageText = webhookText || placeholderText;
      const needsContentFetch = !webhookText && externalMessageId;
      
      let contactId: string | null = null;
      
      const contactPhoneNormalized = direction === 'inbound' ? normalizedFromNumber : normalizePhoneNumber(toNumber);
      const contactPhoneOriginal = direction === 'inbound' ? fromNumber : toNumber;
      
      console.log(`[Dialpad Webhook] Looking for contact - Direction: ${direction}, From: ${fromNumber}, To: ${toNumber}`);
      console.log(`[Dialpad Webhook] Contact phone normalized: ${contactPhoneNormalized}, original: ${contactPhoneOriginal}`);
      
      let contact = await storage.getContactByPhone(contactPhoneNormalized, contractorId);
      if (!contact) {
        contact = await storage.getContactByPhone(contactPhoneOriginal, contractorId);
      }
      
      if (contact) {
        contactId = contact.id;
        console.log(`[Dialpad Webhook] Found contact: ${contact.id} (${contact.name}) - Type: ${contact.type}`);
      } else {
        console.log(`[Dialpad Webhook] No contact match found`);
      }
      
      const newMessage = await storage.createMessage({
        type: 'text',
        status: 'delivered',
        direction,
        content: messageText,
        toNumber: normalizePhoneForStorage(toNumber),
        fromNumber: normalizePhoneForStorage(fromNumber),
        contactId: contactId,
        externalMessageId,
      }, contractorId);
      
      const { broadcastToContractor } = await import('../../websocket');
      broadcastToContractor(contractorId, {
        type: 'new_message',
        message: newMessage,
        contactId: contactId,
        leadId: contact?.type === 'lead' ? contactId : null,
        customerId: contact?.type === 'customer' ? contactId : null,
        contactType: contact?.type === 'customer' ? 'customer' : 'lead'
      });
      
      await db.update(webhookEvents)
        .set({ 
          processed: true, 
          processedAt: new Date() 
        })
        .where(eq(webhookEvents.id, webhookEvent[0].id));
      
      console.log('[Dialpad Webhook] Successfully processed SMS webhook');
      res.status(200).json({ success: true, message: 'Webhook processed successfully' });
      
      if (needsContentFetch) {
        const messageDbId = newMessage.id;
        console.log(`[Dialpad Webhook] Scheduling content fetch for message ${messageDbId} (SMS ID: ${externalMessageId})`);
        
        setTimeout(async () => {
          try {
            console.log(`[Dialpad Webhook] Fetching content for SMS ID: ${externalMessageId}`);
            const result = await dialpadEnhancedService.getSmsById(contractorId, externalMessageId!);
            
            if (result.text) {
              console.log(`[Dialpad Webhook] Fetched message content, updating database`);
              
              await db.update(messages)
                .set({ content: result.text })
                .where(eq(messages.id, messageDbId));
              
              const updatedMessage = await storage.getMessage(messageDbId, contractorId);
              
              if (updatedMessage) {
                broadcastToContractor(contractorId, {
                  type: 'message_updated',
                  message: updatedMessage,
                  contactId: contactId,
                  leadId: contact?.type === 'lead' ? contactId : null,
                  customerId: contact?.type === 'customer' ? contactId : null,
                  contactType: contact?.type === 'customer' ? 'customer' : 'lead'
                });
                
                console.log(`[Dialpad Webhook] Successfully updated message content`);
              }
            } else {
              console.error(`[Dialpad Webhook] Failed to fetch SMS content:`, result.error);
            }
          } catch (error) {
            console.error(`[Dialpad Webhook] Error fetching SMS content:`, error);
          }
        }, 5000);
      }
    } catch (error) {
      console.error('[Dialpad Webhook] Error processing webhook:', error);
      res.status(500).json({ success: false, error: 'Failed to process webhook' });
    }
  });
}
