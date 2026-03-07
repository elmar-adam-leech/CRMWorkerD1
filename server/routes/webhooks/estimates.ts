import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { broadcastToContractor } from "../../websocket";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import { normalizePhoneForStorage } from "../../utils/phone-normalizer";
import { parseWebhookDate } from "../../utils/parse-webhook-date";
import { asyncHandler } from "../../utils/async-handler";
import { validateWebhookAuth, parseWebhookPayload } from "../../utils/webhook-auth";

export function registerEstimateWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/estimates", webhookRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    console.log('[webhook-estimate] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;

      const auth = await validateWebhookAuth(req, res, contractorId, 'webhook-estimate');
      if (!auth) return;
      const { contractor } = auth;

      const requestData = parseWebhookPayload(req);
      console.log('[webhook-estimate] Extracted data:', JSON.stringify(requestData, null, 2));
      
      const extractField = (fieldName: string): any => {
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        if (requestData[fieldName] && typeof requestData[fieldName] === 'object' && requestData[fieldName][fieldName]) {
          return requestData[fieldName][fieldName];
        }
        return undefined;
      };
      
      const title = extractField('title');
      const amount = extractField('amount');
      const description = extractField('description');
      const status = extractField('status');
      const validUntil = extractField('validUntil');
      const followUpDate = extractField('followUpDate');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      
      if (!title || !amount || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'amount', and 'customerName' are required",
          received: { title, amount, customerName }
        });
        return;
      }
      
      const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(amountNum) || amountNum < 0) {
        res.status(400).json({ 
          error: "Invalid amount",
          message: "Amount must be a valid positive number"
        });
        return;
      }
      
      const matchedCustomerId = await storage.findMatchingContact(
        contractorId,
        customerEmail ? [customerEmail] : [],
        customerPhone ? [customerPhone] : []
      );
      let existingCustomer = matchedCustomerId
        ? await storage.getContact(matchedCustomerId, contractorId)
        : undefined;
      
      let customerId: string;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[webhook-estimate] Using existing customer:', customerId);
      } else {
        const newCustomer = await storage.createContact({
          name: String(customerName).trim(),
          type: 'customer' as const,
          emails: customerEmail ? [String(customerEmail).trim()] : [],
          phones: customerPhone ? [String(customerPhone).trim()] : [],
          address: customerAddress ? String(customerAddress).trim() : undefined,
        }, contractorId);
        customerId = newCustomer.id;
        console.log('[webhook-estimate] Created new customer:', customerId);
      }
      
      
      const normalizeStatus = (value: any): string => {
        if (!value) return 'draft';
        const val = String(value).toLowerCase().trim();
        const statusMap: Record<string, string> = {
          'open': 'draft',
          'draft': 'draft',
          'sent': 'sent',
          'pending': 'pending',
          'approved': 'approved',
          'accepted': 'approved',
          'rejected': 'rejected',
          'declined': 'rejected'
        };
        return statusMap[val] || 'draft';
      };
      
      const normalizedPhone = customerPhone ? normalizePhoneForStorage(String(customerPhone).trim()) : null;
      
      const estimateData: any = {
        title: String(title).trim(),
        amount: amountNum.toString(),
        description: description ? String(description).trim() : null,
        status: normalizeStatus(status),
        validUntil: parseWebhookDate(validUntil),
        followUpDate: parseWebhookDate(followUpDate),
        contactId: customerId,
      };
      
      console.log('[webhook-estimate] Creating estimate with data:', estimateData);
      
      const newEstimate = await storage.createEstimate(estimateData, contractorId);
      
      console.log(`[webhook-estimate] ✓ Estimate created successfully for contractor ${contractor.name}:`, newEstimate.title);
      
      broadcastToContractor(contractorId, {
        type: 'new_estimate',
        estimate: newEstimate,
      });
      
      res.status(201).json({
        success: true,
        message: "Estimate created successfully",
        estimateId: newEstimate.id,
        customerId: customerId,
        estimate: {
          id: newEstimate.id,
          title: newEstimate.title,
          amount: newEstimate.amount,
          status: newEstimate.status,
          customerId: customerId,
          createdAt: newEstimate.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook-estimate] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process estimate webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }));
}
