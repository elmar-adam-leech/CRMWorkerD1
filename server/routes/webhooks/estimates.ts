import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { CredentialService } from "../../credential-service";
import { broadcastToContractor } from "../../websocket";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import crypto from "crypto";
import { normalizePhoneForStorage } from "../../utils/phone-normalizer";
import { parseWebhookDate } from "../../utils/parse-webhook-date";
import { asyncHandler } from "../../utils/async-handler";

export function registerEstimateWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/estimates", webhookRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    console.log('[webhook-estimate] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      console.log('[webhook-estimate] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-estimate] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      let storedApiKey: string | null;
      try {
        storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
      } catch {
        storedApiKey = null;
      }
      
      if (!storedApiKey) {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
        res.status(401).json({ 
          error: "First-time setup",
          message: "API key generated for contractor",
          apiKey: newApiKey,
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/estimates`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
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
        });
        return;
      }
      
      if (apiKey !== storedApiKey) {
        res.status(403).json({ 
          error: "Invalid API key",
          message: "The provided API key is incorrect"
        });
        return;
      }
      
      let requestData = req.body.data || req.body;
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
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
        emails: customerEmail ? [String(customerEmail).trim()] : [],
        phones: normalizedPhone ? [normalizedPhone] : [],
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
