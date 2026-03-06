import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { CredentialService } from "../../credential-service";
import { broadcastToContractor } from "../../websocket";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import crypto from "crypto";
import { parseWebhookDate } from "../../utils/parse-webhook-date";
import { asyncHandler } from "../../utils/async-handler";

export function registerJobWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/jobs", webhookRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    console.log('[webhook-job] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      console.log('[webhook-job] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-job] Invalid contractor ID:', contractorId);
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
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/jobs`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
            },
            requiredFields: ["title", "scheduledDate", "customerName"],
            optionalFields: ["type", "description", "status", "estimateId", "amount", "customerEmail", "customerPhone", "customerAddress", "notes"],
            example: {
              title: "HVAC Installation",
              type: "service",
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
      
      console.log('[webhook-job] Extracted data:', JSON.stringify(requestData, null, 2));
      
      const extractField = (fieldName: string): any => {
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        if (requestData[fieldName] && typeof requestData[fieldName] === 'object' && requestData[fieldName][fieldName]) {
          return requestData[fieldName][fieldName];
        }
        return undefined;
      };
      
      const title = extractField('title');
      const scheduledDate = extractField('scheduledDate');
      const description = extractField('description');
      const status = extractField('status');
      const type = extractField('type');
      const estimateId = extractField('estimateId');
      const amount = extractField('amount');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      const notes = extractField('notes');
      
      if (!title || !scheduledDate || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'scheduledDate', and 'customerName' are required",
          received: { title, scheduledDate, customerName }
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
        console.log('[webhook-job] Using existing customer:', customerId);
      } else {
        const newCustomer = await storage.createContact({
          name: String(customerName).trim(),
          type: 'customer' as const,
          emails: customerEmail ? [String(customerEmail).trim()] : [],
          phones: customerPhone ? [String(customerPhone).trim()] : [],
          address: customerAddress ? String(customerAddress).trim() : undefined,
        }, contractorId);
        customerId = newCustomer.id;
        console.log('[webhook-job] Created new customer:', customerId);
      }
      
      
      const normalizeJobStatus = (value: any): string => {
        if (!value) return 'scheduled';
        const val = String(value).toLowerCase().trim();
        const statusMap: Record<string, string> = {
          'scheduled': 'scheduled',
          'pending': 'scheduled',
          'in_progress': 'in_progress',
          'in progress': 'in_progress',
          'active': 'in_progress',
          'working': 'in_progress',
          'completed': 'completed',
          'complete': 'completed',
          'done': 'completed',
          'finished': 'completed',
          'cancelled': 'cancelled',
          'canceled': 'cancelled'
        };
        return statusMap[val] || 'scheduled';
      };
      
      const parsedScheduledDate = parseWebhookDate(scheduledDate);
      if (!parsedScheduledDate) {
        res.status(400).json({ 
          error: "Invalid scheduled date",
          message: "The scheduledDate must be a valid date"
        });
        return;
      }
      
      const jobData: any = {
        title: String(title).trim(),
        type: type ? String(type).trim() : 'service',
        scheduledDate: parsedScheduledDate,
        description: description ? String(description).trim() : null,
        status: normalizeJobStatus(status),
        contactId: customerId,
        estimateId: (estimateId && String(estimateId).toLowerCase() !== 'none') ? estimateId : null,
        value: amount ? (typeof amount === 'string' ? parseFloat(amount) : amount).toString() : '0',
        notes: notes ? String(notes).trim() : null,
      };
      
      console.log('[webhook-job] Creating job with data:', jobData);
      
      const newJob = await storage.createJob(jobData, contractorId);
      
      console.log(`[webhook-job] ✓ Job created successfully for contractor ${contractor.name}:`, newJob.title);
      
      broadcastToContractor(contractorId, {
        type: 'new_job',
        job: newJob,
      });
      
      res.status(201).json({
        success: true,
        message: "Job created successfully",
        jobId: newJob.id,
        customerId: customerId,
        job: {
          id: newJob.id,
          title: newJob.title,
          scheduledDate: newJob.scheduledDate,
          status: newJob.status,
          customerId: customerId,
          createdAt: newJob.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook-job] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process job webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }));
}
