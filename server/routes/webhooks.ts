import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../storage";
import { webhookEvents, webhooks, contractors, dialpadPhoneNumbers, messages } from "@shared/schema";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { CredentialService } from "../credential-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { housecallProService } from "../housecall-pro-service";
import { dialpadEnhancedService } from "../dialpad-enhanced-service";
import { webhookRateLimiter } from "../middleware/rate-limiter";
import crypto from "crypto";

export function registerWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/housecall-pro", 
    webhookRateLimiter,
    express.raw({ type: 'application/json' }), // Route-specific raw body middleware
    async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('Invalid contractor ID in webhook:', contractorId);
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      // Verify webhook signature for security using raw body
      // Try both possible header names defensively
      const signature = (req.headers['x-housecall-pro-signature'] || req.headers['x-housecall-signature']) as string;
      
      // Try to get contractor-specific webhook secret first, fall back to global secret
      let webhookSecret: string | undefined;
      try {
        const contractorSecret = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_secret');
        webhookSecret = contractorSecret || process.env.HOUSECALL_PRO_WEBHOOK_SECRET;
      } catch {
        webhookSecret = process.env.HOUSECALL_PRO_WEBHOOK_SECRET;
      }
      
      if (!webhookSecret) {
        console.error('HOUSECALL_PRO_WEBHOOK_SECRET not configured');
        res.status(500).json({ message: "Webhook secret not configured" });
        return;
      }
      
      if (!signature) {
        console.error('Missing webhook signature');
        res.status(401).json({ message: "Missing signature" });
        return;
      }
      
      // Get raw body for signature verification
      const rawBody = req.body as Buffer;
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      const providedSignature = signature.replace('sha256=', '');
      
      if (!crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'))) {
        console.error('Invalid webhook signature');
        res.status(401).json({ message: "Invalid signature" });
        return;
      }
      
      // Parse the JSON from raw body
      const payload = JSON.parse(rawBody.toString('utf8'));
      const { event_type, data } = payload;

      console.log(`[HCP Webhook] Received event: ${event_type} for contractor: ${contractorId}`);

      // Log every incoming event to webhookEvents for auditing
      const webhookEventRecord = await db.insert(webhookEvents).values({
        contractorId,
        service: 'housecall-pro',
        eventType: event_type,
        payload: JSON.stringify(payload),
        processed: false,
      }).returning();
      const webhookEventId = webhookEventRecord[0]?.id;

      // Map Housecall Pro work_status values to internal status values
      const mapHcpWorkStatus = (workStatus: string): string => {
        const statusMap: Record<string, string> = {
          'scheduled': 'scheduled',
          'needs_scheduling': 'scheduled',
          'in_progress': 'in_progress',
          'started': 'in_progress',
          'completed': 'completed',
          'canceled': 'cancelled',
          'cancellation_requested': 'cancelled',
          'pending': 'pending',
        };
        return statusMap[workStatus] || workStatus;
      };

      if (event_type === 'estimate.updated' || event_type === 'estimate.completed') {
        const estimate = await storage.getEstimateByHousecallProEstimateId(data.id, contractorId);
        if (estimate) {
          const newStatus = data.work_status === 'completed' ? 'approved'
                          : data.work_status === 'canceled' ? 'rejected'
                          : estimate.status;
          const updated = await storage.updateEstimate(estimate.id, {
            status: newStatus as any,
            syncedAt: new Date(),
          }, contractorId);
          if (updated) {
            workflowEngine.triggerWorkflowsForEvent('estimate_updated', updated as unknown as Record<string, unknown>, contractorId).catch(err =>
              console.error('[HCP Webhook] estimate_updated trigger error:', err));
            if (updated.status !== estimate.status) {
              workflowEngine.triggerWorkflowsForEvent('estimate_status_changed', updated as unknown as Record<string, unknown>, contractorId).catch(err =>
                console.error('[HCP Webhook] estimate_status_changed trigger error:', err));
            }
          }
        }
      } else if (['job.created', 'job.updated', 'job.completed', 'job.scheduled', 'job.started'].includes(event_type)) {
        const job = await storage.getJobByHousecallProJobId(data.id, contractorId);
        if (job) {
          const newStatus = mapHcpWorkStatus(data.work_status || '');
          if (newStatus && newStatus !== job.status) {
            const updated = await storage.updateJob(job.id, { status: newStatus as any }, contractorId);
            if (updated) {
              workflowEngine.triggerWorkflowsForEvent('job_updated', updated as unknown as Record<string, unknown>, contractorId).catch(err =>
                console.error('[HCP Webhook] job_updated trigger error:', err));
              workflowEngine.triggerWorkflowsForEvent('job_status_changed', updated as unknown as Record<string, unknown>, contractorId).catch(err =>
                console.error('[HCP Webhook] job_status_changed trigger error:', err));
            }
          } else if (event_type === 'job.created') {
            workflowEngine.triggerWorkflowsForEvent('job_created', job as unknown as Record<string, unknown>, contractorId).catch(err =>
              console.error('[HCP Webhook] job_created trigger error:', err));
          } else {
            workflowEngine.triggerWorkflowsForEvent('job_updated', job as unknown as Record<string, unknown>, contractorId).catch(err =>
              console.error('[HCP Webhook] job_updated trigger error:', err));
          }
        }
      } else if (event_type === 'customer.created' || event_type === 'customer.updated') {
        const contact = await storage.getContactByExternalId(data.id, 'housecall-pro', contractorId);
        if (contact) {
          const eventKey = event_type === 'customer.created' ? 'contact_created' : 'contact_updated';
          workflowEngine.triggerWorkflowsForEvent(eventKey, contact as unknown as Record<string, unknown>, contractorId).catch(err =>
            console.error(`[HCP Webhook] ${eventKey} trigger error:`, err));
        }
      } else {
        console.log(`[HCP Webhook] Unhandled event type: ${event_type}`);
      }

      // Mark event as processed
      if (webhookEventId) {
        await db.update(webhookEvents)
          .set({ processed: true })
          .where(eq(webhookEvents.id, webhookEventId));
      }

      // Always respond quickly with 200 to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Still return 200 to prevent webhook retries for processing errors
      res.status(200).json({ received: true, error: 'Processing failed' });
    }
  });

  // Dynamic Lead Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/leads
  app.post("/api/webhooks/:contractorId/leads", webhookRateLimiter, async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Verify API key against contractor's stored credentials
      let isValidKey = false;
      try {
        const storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        isValidKey = storedApiKey === apiKey;
      } catch {
        // If no API key is stored, generate one for this contractor
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
        // For first-time setup, accept any key and return the generated one
        res.status(200).json({
          message: "API key generated for contractor",
          apiKey: newApiKey,
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/leads`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
            },
            requiredFields: ["name"],
            optionalFields: ["email", "emails", "phone", "phones", "address", "source", "notes", "followUpDate", "tags"],
            phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
            multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
            tags: "Optional array of strings for segmentation and workflow targeting. Example: ['Ductless', 'Residential', 'Emergency']",
            example: {
              name: "John Smith",
              phone: "(555) 123-4567",
              email: "john@example.com",
              address: "123 Main St, City, State 12345",
              source: "Website Contact Form",
              notes: "Interested in HVAC installation",
              followUpDate: "2024-01-15T10:00:00Z",
              tags: ["Ductless", "Residential", "High-Priority"]
            },
            exampleWithArrays: {
              name: "Jane Doe",
              phones: ["(555) 123-4567", "555-987-6543", "+1 555 111 2222"],
              emails: ["jane@example.com", "jane.doe@work.com"],
              address: "456 Oak Ave",
              source: "Referral",
              tags: ["Commercial", "Emergency"]
            }
          }
        });
        return;
      }
      
      if (!isValidKey) {
        res.status(401).json({ 
          error: "Invalid API key",
          message: "The provided API key is not valid for this contractor"
        });
        return;
      }
      
      // Extract lead data - support both direct format and Zapier's nested format
      // Zapier sends: { data: { name, email, ... } }
      // Direct API sends: { name, email, ... }
      
      // Handle different Zapier formats:
      // 1. { data: { name, email, ... } } - wrapped in data property
      // 2. { name, email, ... } - direct object
      // 3. [{ name, email, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook] Extracted data:', JSON.stringify(requestData, null, 2));
      
      const { 
        name, 
        email, emails, // Support both single email and emails array
        phone, phones, // Support both single phone and phones array
        address, source, notes, followUpDate, pageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
        tags // Optional array of strings for segmentation
      } = requestData;
      
      // Detailed validation with specific error messages
      const validationErrors: string[] = [];
      
      // Validate name (required)
      if (!name) {
        validationErrors.push("'name' field is required but was not provided");
      } else if (typeof name !== 'string') {
        validationErrors.push(`'name' must be a string, received: ${typeof name}`);
      } else if (name.trim().length === 0) {
        validationErrors.push("'name' cannot be empty");
      }
      
      // Validate email (optional, but must be valid if provided)
      if (email !== undefined && email !== null && email !== '') {
        if (typeof email !== 'string') {
          validationErrors.push(`'email' must be a string, received: ${typeof email}`);
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          validationErrors.push(`'email' format is invalid: "${email}"`);
        }
      }
      
      // Validate phone (optional, but must be valid if provided)
      if (phone !== undefined && phone !== null && phone !== '') {
        if (typeof phone !== 'string' && typeof phone !== 'number') {
          validationErrors.push(`'phone' must be a string or number, received: ${typeof phone}`);
        }
      }
      
      // Validate address (optional)
      if (address !== undefined && address !== null && address !== '') {
        if (typeof address !== 'string') {
          validationErrors.push(`'address' must be a string, received: ${typeof address}`);
        }
      }
      
      // Validate source (optional)
      if (source !== undefined && source !== null && source !== '') {
        if (typeof source !== 'string') {
          validationErrors.push(`'source' must be a string, received: ${typeof source}`);
        }
      }
      
      // Validate notes (optional)
      if (notes !== undefined && notes !== null && notes !== '') {
        if (typeof notes !== 'string') {
          validationErrors.push(`'notes' must be a string, received: ${typeof notes}`);
        }
      }
      
      // Validate tags (optional array of strings)
      if (tags !== undefined && tags !== null) {
        if (!Array.isArray(tags)) {
          validationErrors.push(`'tags' must be an array, received: ${typeof tags}`);
        } else {
          // Validate each tag is a string
          const invalidTags = tags.filter((tag: any) => typeof tag !== 'string');
          if (invalidTags.length > 0) {
            validationErrors.push(`'tags' array must contain only strings, found invalid values: ${JSON.stringify(invalidTags)}`);
          }
        }
      }
      
      if (validationErrors.length > 0) {
        console.error('[webhook] Validation errors:', validationErrors);
        
        // Create a detailed error message that includes all specific errors
        const detailedMessage = `Validation failed: ${validationErrors.join('; ')}`;
        
        res.status(400).json({ 
          error: "Validation failed",
          message: detailedMessage,
          validationErrors,
          receivedData: {
            name: name,
            email: email,
            phone: phone,
            address: address,
            source: source,
            notes: notes,
            followUpDate: followUpDate
          },
          fix: "Review the validation errors above and ensure all required fields are provided with correct data types"
        });
        return;
      }
      
      // Parse followUpDate with flexible format support using date-fns
      let parsedFollowUpDate: Date | undefined = undefined;
      if (followUpDate && followUpDate !== '') {
        const dateStr = String(followUpDate).trim();
        
        try {
          // Import date-fns parse function
          const { parse, parseISO, isValid } = await import('date-fns');
          
          // Try ISO format first (most common for APIs)
          let parsedDate = parseISO(dateStr);
          
          // If ISO fails, try common formats
          if (!isValid(parsedDate)) {
            const formats = [
              'MMMM dd, yyyy',           // October 16, 2025
              'MMM dd, yyyy',            // Oct 16, 2025
              'MM/dd/yyyy',              // 10/16/2025
              'MM-dd-yyyy',              // 10-16-2025
              'yyyy-MM-dd',              // 2025-10-16
              'EEEE MMMM dd, yyyy',      // Thursday October 16, 2025
            ];
            
            // Try parsing the full string first
            for (const format of formats) {
              try {
                parsedDate = parse(dateStr, format, new Date());
                if (isValid(parsedDate)) {
                  break;
                }
              } catch {
                continue;
              }
            }
            
            // If still not valid, try extracting date patterns from text with extra content
            // Example: "Thursday October 16, 2025 arriving between 10:00am - 12:00pm" -> "Thursday October 16, 2025"
            if (!isValid(parsedDate)) {
              // Try to extract common date patterns using regex
              const datePatterns = [
                // Match: Thursday October 16, 2025 (or any day/month combo)
                /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                // Match: Oct 16, 2025
                /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i,
                // Match: 10/16/2025 or 10-16-2025
                /\d{1,2}[-/]\d{1,2}[-/]\d{4}/,
                // Match: 2025-10-16
                /\d{4}-\d{1,2}-\d{1,2}/
              ];
              
              for (const pattern of datePatterns) {
                const match = dateStr.match(pattern);
                if (match) {
                  const extractedDate = match[0];
                  console.log(`[webhook] Extracted date pattern: "${extractedDate}" from "${dateStr}"`);
                  
                  // Try parsing the extracted portion
                  for (const format of formats) {
                    try {
                      parsedDate = parse(extractedDate, format, new Date());
                      if (isValid(parsedDate)) {
                        break;
                      }
                    } catch {
                      continue;
                    }
                  }
                  
                  if (isValid(parsedDate)) {
                    break;
                  }
                }
              }
            }
          }
          
          if (isValid(parsedDate)) {
            parsedFollowUpDate = parsedDate;
            console.log(`[webhook] Successfully parsed date: "${dateStr}" -> ${parsedDate.toISOString()}`);
          } else {
            // Date parsing failed
            console.error(`[webhook] Failed to parse date: "${dateStr}"`);
            res.status(400).json({ 
              error: "Invalid date format",
              message: `Could not parse followUpDate: "${dateStr}". Please use ISO format (2025-10-16T10:00:00Z) or common formats like "October 16, 2025" or "10/16/2025"`,
              receivedValue: dateStr
            });
            return;
          }
        } catch (dateError) {
          console.error('[webhook] Date parsing error:', dateError);
          res.status(400).json({ 
            error: "Date parsing failed",
            message: `Error parsing followUpDate: "${dateStr}"`,
            receivedValue: dateStr
          });
          return;
        }
      }
      
      // Normalize phone numbers to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage, normalizePhoneArrayForStorage } = await import('../utils/phone-normalizer');
      
      // Build emails array from either single email or emails array
      let emailsArray: string[] = [];
      if (emails && Array.isArray(emails)) {
        emailsArray = emails.map((e: any) => String(e).trim()).filter((e: string) => e !== '');
      } else if (email) {
        emailsArray = [String(email).trim()];
      }
      
      // Build phones array from either single phone or phones array, with normalization
      let phonesArray: string[] = [];
      if (phones && Array.isArray(phones)) {
        phonesArray = normalizePhoneArrayForStorage(phones);
      } else if (phone) {
        const normalized = normalizePhoneForStorage(String(phone).trim());
        if (normalized) phonesArray = [normalized];
      }
      
      // Step 1: Find or create contact (deduplicate by email/phone)
      let contactId: string;
      let isNewContact = false;
      
      const existingContactId = await storage.findMatchingContact(contractorId, emailsArray, phonesArray);
      
      if (existingContactId) {
        // Contact already exists - use the existing one
        contactId = existingContactId;
        console.log(`[webhook-lead] Found existing contact: ${contactId}`);
      } else {
        // No matching contact - create new one
        const contactData = {
          name: name.trim(),
          type: 'lead' as const,
          emails: emailsArray,
          phones: phonesArray,
          address: address ? String(address).trim() : undefined,
          source: source ? String(source).trim() : 'External API',
          notes: notes ? String(notes).trim() : undefined,
          tags: tags && Array.isArray(tags) ? tags.map((t: any) => String(t).trim()).filter((t: string) => t !== '') : undefined,
          followUpDate: parsedFollowUpDate,
          pageUrl: pageUrl ? String(pageUrl).trim() : undefined,
          utmSource: utmSource ? String(utmSource).trim() : undefined,
          utmMedium: utmMedium ? String(utmMedium).trim() : undefined,
          utmCampaign: utmCampaign ? String(utmCampaign).trim() : undefined,
          utmTerm: utmTerm ? String(utmTerm).trim() : undefined,
          utmContent: utmContent ? String(utmContent).trim() : undefined,
        };
        
        console.log('[webhook-lead] Creating new contact with data:', contactData);
        const newContact = await storage.createContact(contactData, contractorId);
        contactId = newContact.id;
        isNewContact = true;
        console.log(`[webhook-lead] ✓ New contact created: ${contactId}`);
      }
      
      // Step 2: Always create a new lead record (even if contact exists)
      const leadData = {
        contactId,
        status: 'new' as const,
        source: source ? String(source).trim() : 'External API',
        message: notes ? String(notes).trim() : undefined,
        utmSource: utmSource ? String(utmSource).trim() : undefined,
        utmMedium: utmMedium ? String(utmMedium).trim() : undefined,
        utmCampaign: utmCampaign ? String(utmCampaign).trim() : undefined,
        utmTerm: utmTerm ? String(utmTerm).trim() : undefined,
        utmContent: utmContent ? String(utmContent).trim() : undefined,
        pageUrl: pageUrl ? String(pageUrl).trim() : undefined,
        rawPayload: JSON.stringify(requestData),
        followUpDate: parsedFollowUpDate,
      };
      
      console.log('[webhook-lead] Creating new lead record with data:', leadData);
      const newLead = await storage.createLead(leadData, contractorId);
      console.log(`[webhook-lead] ✓ Lead created successfully for contractor ${contractor.name}: ${newLead.id} (${isNewContact ? 'new contact' : 'existing contact'})`);
      
      // Sync to Housecall Pro if integration is enabled
      const hcpIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
      if (hcpIntegrationEnabled) {
        try {
          // Get contact details for HCP sync
          const contact = await storage.getContact(contactId, contractorId);
          if (contact && !contact.housecallProCustomerId) {
            // Parse name into first/last
            const nameParts = contact.name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            // First, search for existing HCP customer by email or phone
            let hcpCustomerId: string | undefined;
            const searchEmail = contact.emails?.[0];
            const searchPhone = contact.phones?.[0];
            
            if (searchEmail || searchPhone) {
              console.log('[HCP Sync] Searching for existing HCP customer:', { email: searchEmail, phone: searchPhone });
              const searchResult = await housecallProService.searchCustomers(contractorId, {
                email: searchEmail,
                phone: searchPhone
              });
              
              if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
                hcpCustomerId = searchResult.data[0].id;
                console.log('[HCP Sync] Found existing HCP customer:', hcpCustomerId);
              }
            }
            
            // If no existing customer found, create one
            if (!hcpCustomerId) {
              console.log('[HCP Sync] No existing customer found, creating new one');
              const hcpCustomerResult = await housecallProService.createCustomer(contractorId, {
                first_name: firstName,
                last_name: lastName,
                email: searchEmail,
                mobile_number: searchPhone,
                lead_source: source || 'Webhook',
                notes: notes || undefined,
                addresses: address ? [{
                  street: address,
                  type: 'service'
                }] : undefined
              });
              
              if (hcpCustomerResult.success && hcpCustomerResult.data?.id) {
                hcpCustomerId = hcpCustomerResult.data.id;
                console.log('[HCP Sync] Created HCP customer:', hcpCustomerId);
              } else {
                console.warn('[HCP Sync] Failed to create HCP customer:', hcpCustomerResult.error);
              }
            }
            
            // Store the HCP customer ID in the contact
            if (hcpCustomerId) {
              await storage.updateContact(contact.id, { 
                housecallProCustomerId: hcpCustomerId 
              }, contractorId);
              console.log('[HCP Sync] Stored HCP customer ID:', hcpCustomerId, 'for contact:', contact.id);
              
              // Now create lead in HCP (requires customer_id)
              const hcpLeadResult = await housecallProService.createLead(contractorId, {
                customer_id: hcpCustomerId,
                lead_source: source || 'Webhook',
                note: notes || undefined
              });
              
              if (hcpLeadResult.success && hcpLeadResult.data?.id) {
                await storage.updateLead(newLead.id, { 
                  housecallProLeadId: hcpLeadResult.data.id 
                }, contractorId);
                console.log('[HCP Sync] Created HCP lead:', hcpLeadResult.data.id, 'for CRM lead:', newLead.id);
              } else {
                console.warn('[HCP Sync] Failed to create HCP lead:', hcpLeadResult.error);
              }
            }
          } else if (contact?.housecallProCustomerId) {
            // Customer already exists in HCP, just create the lead
            const hcpLeadResult = await housecallProService.createLead(contractorId, {
              customer_id: contact.housecallProCustomerId,
              lead_source: source || 'Webhook',
              note: notes || undefined
            });
            
            if (hcpLeadResult.success && hcpLeadResult.data?.id) {
              await storage.updateLead(newLead.id, { 
                housecallProLeadId: hcpLeadResult.data.id 
              }, contractorId);
              console.log('[HCP Sync] Created HCP lead:', hcpLeadResult.data.id, 'for CRM lead:', newLead.id);
            } else {
              console.warn('[HCP Sync] Failed to create HCP lead:', hcpLeadResult.error);
            }
          }
        } catch (hcpError) {
          console.error('[HCP Sync] Error syncing to HCP:', hcpError);
          // Don't fail the webhook if HCP sync fails
        }
      }
      
      // Return success response with lead ID
      res.status(201).json({
        success: true,
        message: isNewContact ? "Lead created with new contact" : "Lead created for existing contact",
        leadId: newLead.id,
        contactId: contactId,
        isNewContact: isNewContact,
        lead: {
          id: newLead.id,
          contactId: newLead.contactId,
          status: newLead.status,
          source: newLead.source,
          createdAt: newLead.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process lead webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dynamic Estimate Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/estimates
  app.post("/api/webhooks/:contractorId/estimates", webhookRateLimiter, async (req: Request, res: Response) => {
    console.log('[webhook-estimate] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook-estimate] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-estimate] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Retrieve stored API key for this contractor
      let storedApiKey: string | null;
      try {
        storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
      } catch {
        storedApiKey = null;
      }
      
      // If no API key exists, generate one and return setup instructions
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
      
      // Validate API key
      if (apiKey !== storedApiKey) {
        res.status(403).json({ 
          error: "Invalid API key",
          message: "The provided API key is incorrect"
        });
        return;
      }
      
      // Parse the request body to handle Zapier's array and nested data formats
      // Handle different Zapier formats:
      // 1. { data: { title, amount, ... } } - wrapped in data property
      // 2. { title, amount, ... } - direct object
      // 3. [{ title, amount, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook-estimate] Extracted data:', JSON.stringify(requestData, null, 2));
      
      // Extract fields - handle both direct properties and Zapier-style nested objects
      const extractField = (fieldName: string): any => {
        // Direct property access
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        // Zapier nested format (e.g., { title: { title: "value" } })
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
      const leadId = extractField('leadId');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      
      // Validate required fields
      if (!title || !amount || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'amount', and 'customerName' are required",
          received: { title, amount, customerName }
        });
        return;
      }
      
      // Normalize and validate amount
      const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(amountNum) || amountNum < 0) {
        res.status(400).json({ 
          error: "Invalid amount",
          message: "Amount must be a valid positive number"
        });
        return;
      }
      
      // Find or create customer
      let customerId: string;
      
      // First, try to find existing customer by email or phone
      const customers = await storage.getContacts(contractorId, 'customer');
      let existingCustomer = customers.find((c: any) => 
        (customerEmail && c.emails?.some((e: string) => e.toLowerCase() === customerEmail.toLowerCase())) ||
        (customerPhone && c.phones?.includes(customerPhone))
      );
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[webhook-estimate] Using existing customer:', customerId);
      } else {
        // Create new contact as customer
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
      
      // Helper function to parse dates (handles ISO strings, Unix timestamps, etc.)
      const parseDate = (value: any): Date | null => {
        if (!value) return null;
        
        // Handle "none" or empty strings
        if (typeof value === 'string' && (value.toLowerCase() === 'none' || value.trim() === '')) {
          return null;
        }
        
        // Check if it's a Unix timestamp (numeric string or number)
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        if (!isNaN(numValue)) {
          // Unix timestamps are typically 10 digits (seconds since epoch)
          // JavaScript Date expects milliseconds, so multiply by 1000
          if (numValue < 10000000000) { // Less than 10 digits = seconds
            return new Date(numValue * 1000);
          } else { // Already in milliseconds
            return new Date(numValue);
          }
        }
        
        // Try parsing as ISO string or other date format
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
      };
      
      // Normalize status values
      const normalizeStatus = (value: any): string => {
        if (!value) return 'draft';
        const val = String(value).toLowerCase().trim();
        
        // Map common values to valid statuses
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
      
      // Normalize phone number to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage } = await import('../utils/phone-normalizer');
      const normalizedPhone = customerPhone ? normalizePhoneForStorage(String(customerPhone).trim()) : null;
      
      // Prepare estimate data
      const estimateData: any = {
        title: String(title).trim(),
        amount: amountNum.toString(),
        description: description ? String(description).trim() : null,
        status: normalizeStatus(status),
        validUntil: parseDate(validUntil),
        followUpDate: parseDate(followUpDate),
        contactId: customerId,
        emails: customerEmail ? [String(customerEmail).trim()] : [],
        phones: normalizedPhone ? [normalizedPhone] : [],
      };
      
      console.log('[webhook-estimate] Creating estimate with data:', estimateData);
      
      // Create the estimate in the database
      const newEstimate = await storage.createEstimate(estimateData, contractorId);
      
      console.log(`[webhook-estimate] ✓ Estimate created successfully for contractor ${contractor.name}:`, newEstimate.title);
      
      // Broadcast WebSocket update to notify connected clients
      broadcastToContractor(contractorId, {
        type: 'new_estimate',
        estimate: newEstimate,
      });
      
      // Return success response with estimate ID
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
  });

  // Dynamic Job Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/jobs
  app.post("/api/webhooks/:contractorId/jobs", webhookRateLimiter, async (req: Request, res: Response) => {
    console.log('[webhook-job] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook-job] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-job] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Retrieve stored API key for this contractor
      let storedApiKey: string | null;
      try {
        storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
      } catch {
        storedApiKey = null;
      }
      
      // If no API key exists, generate one and return setup instructions
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
              type: "service", // Optional: service, installation, repair, maintenance (defaults to 'service')
              scheduledDate: "2024-02-15T09:00:00Z", // Accepts ISO format, MM/DD/YYYY, or Unix timestamp
              description: "Complete HVAC system installation for 2000 sq ft home",
              customerName: "John Smith",
              customerEmail: "john@example.com", // Optional: creates/links to customer
              customerPhone: "(555) 123-4567", // Optional: creates/links to customer
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
      
      // Validate API key
      if (apiKey !== storedApiKey) {
        res.status(403).json({ 
          error: "Invalid API key",
          message: "The provided API key is incorrect"
        });
        return;
      }
      
      // Parse the request body to handle Zapier's array and nested data formats
      // Handle different Zapier formats:
      // 1. { data: { title, scheduledDate, ... } } - wrapped in data property
      // 2. { title, scheduledDate, ... } - direct object
      // 3. [{ title, scheduledDate, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook-job] Extracted data:', JSON.stringify(requestData, null, 2));
      
      // Extract fields - handle both direct properties and Zapier-style nested objects
      const extractField = (fieldName: string): any => {
        // Direct property access
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        // Zapier nested format (e.g., { title: { title: "value" } })
        if (requestData[fieldName] && typeof requestData[fieldName] === 'object' && requestData[fieldName][fieldName]) {
          return requestData[fieldName][fieldName];
        }
        return undefined;
      };
      
      const title = extractField('title');
      const scheduledDate = extractField('scheduledDate');
      const description = extractField('description');
      const status = extractField('status');
      const type = extractField('type'); // Job type: service, installation, repair, etc.
      const estimateId = extractField('estimateId');
      const amount = extractField('amount');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      const notes = extractField('notes');
      
      // Validate required fields
      if (!title || !scheduledDate || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'scheduledDate', and 'customerName' are required",
          received: { title, scheduledDate, customerName }
        });
        return;
      }
      
      // Find or create customer
      let customerId: string;
      
      // First, try to find existing customer by email or phone
      const customers = await storage.getContacts(contractorId, 'customer');
      let existingCustomer = customers.find((c: any) => 
        (customerEmail && c.emails?.some((e: string) => e.toLowerCase() === customerEmail.toLowerCase())) ||
        (customerPhone && c.phones?.includes(customerPhone))
      );
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[webhook-job] Using existing customer:', customerId);
      } else {
        // Create new contact as customer
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
      
      // Helper function to parse dates (handles ISO strings, Unix timestamps, MM/DD/YYYY, etc.)
      const parseDate = (value: any): Date | null => {
        if (!value) return null;
        
        // Handle "none" or empty strings
        if (typeof value === 'string' && (value.toLowerCase() === 'none' || value.trim() === '')) {
          return null;
        }
        
        // If it's a string, try parsing as date first (handles MM/DD/YYYY, ISO, etc.)
        if (typeof value === 'string') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
        
        // Check if it's a Unix timestamp (pure number or numeric string without slashes/dashes)
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (!isNaN(numValue) && (typeof value !== 'string' || /^\d+$/.test(value))) {
          // Unix timestamps are typically 10 digits (seconds since epoch)
          // JavaScript Date expects milliseconds, so multiply by 1000
          if (numValue < 10000000000) { // Less than 10 digits = seconds
            return new Date(numValue * 1000);
          } else { // Already in milliseconds
            return new Date(numValue);
          }
        }
        
        return null;
      };
      
      // Normalize status values for jobs
      const normalizeJobStatus = (value: any): string => {
        if (!value) return 'scheduled';
        const val = String(value).toLowerCase().trim();
        
        // Map common values to valid statuses
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
      
      // Normalize phone number to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage } = await import('../utils/phone-normalizer');
      const normalizedPhone = customerPhone ? normalizePhoneForStorage(String(customerPhone).trim()) : null;
      
      // Parse scheduled date
      const parsedScheduledDate = parseDate(scheduledDate);
      if (!parsedScheduledDate) {
        res.status(400).json({ 
          error: "Invalid scheduled date",
          message: "The scheduledDate must be a valid date"
        });
        return;
      }
      
      // Prepare job data
      const jobData: any = {
        title: String(title).trim(),
        type: type ? String(type).trim() : 'service', // Default to 'service' if not provided
        scheduledDate: parsedScheduledDate,
        description: description ? String(description).trim() : null,
        status: normalizeJobStatus(status),
        contactId: customerId,
        estimateId: (estimateId && String(estimateId).toLowerCase() !== 'none') ? estimateId : null,
        value: amount ? (typeof amount === 'string' ? parseFloat(amount) : amount).toString() : '0', // Map amount to value for database
        notes: notes ? String(notes).trim() : null,
      };
      
      console.log('[webhook-job] Creating job with data:', jobData);
      
      // Create the job in the database
      const newJob = await storage.createJob(jobData, contractorId);
      
      console.log(`[webhook-job] ✓ Job created successfully for contractor ${contractor.name}:`, newJob.title);
      
      // Broadcast WebSocket update to notify connected clients
      broadcastToContractor(contractorId, {
        type: 'new_job',
        job: newJob,
      });
      
      // Return success response with job ID
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
  });

  // Helper function to normalize phone numbers to E.164 format
  const normalizePhoneNumber = (phone: string): string => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return phone.startsWith('+') ? phone : `+${digits}`;
  };

  // Dialpad SMS Webhook endpoint (tenant-specific)
  app.post("/api/webhooks/dialpad/sms/:tenantId", webhookRateLimiter, express.json(), async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      console.log(`[Dialpad Webhook] Received SMS webhook for tenant ${tenantId}`);
      
      const payload = req.body;
      
      // Validate API key
      const apiKey = req.headers['x-api-key'] as string;
      
      if (!apiKey) {
        console.log('[Dialpad Webhook] Missing x-api-key header');
        res.status(401).json({ success: false, error: 'Missing x-api-key header' });
        return;
      }
      
      // Verify tenant exists and validate API key
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
      
      // Store the webhook event for logging
      const webhookEvent = await db.insert(webhookEvents).values({
        contractorId,
        service: 'dialpad',
        eventType: 'sms.received',
        payload: JSON.stringify(payload),
        processed: false,
      }).returning();
      
      // Extract SMS details from Dialpad payload
      // Dialpad sends: { text, from_number, to_number (array), direction, timestamp, message_id, etc. }
      // Zapier can send: { text, from_number, to_number, sms_id, timestamp }
      // NOTE: 'text' field requires message_content_export OAuth scope
      const {
        text: webhookText,
        from_number: fromNumber,
        to_number: toNumberRaw,
        message_id: messageId,
        sms_id: smsId,
        id: dialpadMessageId,
      } = payload;
      
      // Use sms_id from Zapier, or message_id from Dialpad, or dialpad message id as fallback
      const externalMessageId = smsId || messageId || dialpadMessageId;
      
      // Handle to_number as either array or string
      const toNumber = Array.isArray(toNumberRaw) ? toNumberRaw[0] : toNumberRaw;
      
      // Normalize phone numbers for consistent matching
      const normalizedFromNumber = normalizePhoneNumber(fromNumber);
      const normalizedToNumber = normalizePhoneNumber(toNumber);
      
      // Auto-detect direction: if from_number is one of our Dialpad numbers, it's outbound
      // Otherwise it's inbound (someone texting us)
      const dialpadNumbers = await db.select()
        .from(dialpadPhoneNumbers)
        .where(eq(dialpadPhoneNumbers.contractorId, contractorId));
      
      const isFromOurNumber = dialpadNumbers.some(dpn => {
        const normalizedDialpadNumber = normalizePhoneNumber(dpn.phoneNumber);
        return normalizedDialpadNumber === normalizedFromNumber || dpn.phoneNumber === fromNumber;
      });
      
      const direction = isFromOurNumber ? 'outbound' : 'inbound';
      
      // Check for duplicate messages based on external message ID or timestamp + phone numbers + content
      // This prevents duplicates when the same message comes through multiple webhooks
      const { timestamp } = payload;
      
      // First check: external message ID (most reliable)
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
      
      // Second check: timestamp + phone numbers + content (fallback for Zapier/webhooks without message_id)
      if (timestamp && webhookText) {
        // Look for messages with same timestamp, phone numbers, and content
        // Parse timestamp to compare (allow 1-second tolerance for timing differences)
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
      
      // Handle missing message text (requires message_content_export OAuth scope)
      // Note: Dialpad webhooks don't include message text by default, even with the scope enabled
      const placeholderText = direction === 'inbound' ? '[Inbound text]' : '[Outbound text]';
      let messageText = webhookText || placeholderText;
      const needsContentFetch = !webhookText && externalMessageId;
      
      // Find contact by phone number - try normalized and original formats
      // For inbound: match from_number (sender), for outbound: match to_number (recipient)
      let contactId: string | null = null;
      
      const contactPhoneNormalized = direction === 'inbound' ? normalizedFromNumber : normalizePhoneNumber(toNumber);
      const contactPhoneOriginal = direction === 'inbound' ? fromNumber : toNumber;
      
      console.log(`[Dialpad Webhook] Looking for contact - Direction: ${direction}, From: ${fromNumber}, To: ${toNumber}`);
      console.log(`[Dialpad Webhook] Contact phone normalized: ${contactPhoneNormalized}, original: ${contactPhoneOriginal}`);
      
      // Try to find contact using unified contacts table
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
      
      // Store the message with auto-detected direction
      // Use normalizePhoneForStorage to ensure consistent format
      const { normalizePhoneForStorage } = await import('../utils/phone-normalizer');
      const newMessage = await storage.createMessage({
        type: 'text',
        status: 'delivered',
        direction,  // Use auto-detected direction
        content: messageText,
        toNumber: normalizePhoneForStorage(toNumber),
        fromNumber: normalizePhoneForStorage(fromNumber),
        contactId: contactId,
        externalMessageId,
      }, contractorId);
      
      // Broadcast new message to all connected WebSocket clients for this contractor
      // Include legacy fields for backward compatibility
      const { broadcastToContractor } = await import('../websocket');
      broadcastToContractor(contractorId, {
        type: 'new_message',
        message: newMessage,
        contactId: contactId,
        leadId: contact?.type === 'lead' ? contactId : null,
        customerId: contact?.type === 'customer' ? contactId : null,
        contactType: contact?.type === 'customer' ? 'customer' : 'lead'
      });
      
      // Mark webhook as processed
      await db.update(webhookEvents)
        .set({ 
          processed: true, 
          processedAt: new Date() 
        })
        .where(eq(webhookEvents.id, webhookEvent[0].id));
      
      console.log('[Dialpad Webhook] Successfully processed SMS webhook');
      res.status(200).json({ success: true, message: 'Webhook processed successfully' });
      
      // If message text is missing, fetch it from Dialpad API after a delay
      if (needsContentFetch) {
        const messageId = newMessage.id;
        console.log(`[Dialpad Webhook] Scheduling content fetch for message ${messageId} (SMS ID: ${externalMessageId})`);
        
        setTimeout(async () => {
          try {
            console.log(`[Dialpad Webhook] Fetching content for SMS ID: ${externalMessageId}`);
            const result = await dialpadEnhancedService.getSmsById(contractorId, externalMessageId!);
            
            if (result.text) {
              console.log(`[Dialpad Webhook] Fetched message content, updating database`);
              
              // Update message in database
              await db.update(messages)
                .set({ content: result.text })
                .where(eq(messages.id, messageId));
              
              // Get updated message
              const updatedMessage = await storage.getMessage(messageId, contractorId);
              
              if (updatedMessage) {
                // Broadcast update to WebSocket clients
                // Include legacy fields for backward compatibility
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
        }, 5000); // 5 second delay as per documentation
      }
    } catch (error) {
      console.error('[Dialpad Webhook] Error processing webhook:', error);
      res.status(500).json({ success: false, error: 'Failed to process webhook' });
    }
  });

  // Notification API endpoints
}
