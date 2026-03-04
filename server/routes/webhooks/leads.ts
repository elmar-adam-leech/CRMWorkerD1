import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { CredentialService } from "../../credential-service";
import { housecallProService } from "../../housecall-pro-service";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import crypto from "crypto";

export function registerLeadWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/leads", webhookRateLimiter, async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      console.log('[webhook] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
      });
      
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook] Invalid contractor ID:', contractorId);
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
      
      let isValidKey = false;
      try {
        const storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        isValidKey = storedApiKey === apiKey;
      } catch {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
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
      
      let requestData = req.body.data || req.body;
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook] Extracted data:', JSON.stringify(requestData, null, 2));
      
      const { 
        name, 
        email, emails,
        phone, phones,
        address, source, notes, followUpDate, pageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
        tags
      } = requestData;
      
      const validationErrors: string[] = [];
      
      if (!name) {
        validationErrors.push("'name' field is required but was not provided");
      } else if (typeof name !== 'string') {
        validationErrors.push(`'name' must be a string, received: ${typeof name}`);
      } else if (name.trim().length === 0) {
        validationErrors.push("'name' cannot be empty");
      }
      
      if (email !== undefined && email !== null && email !== '') {
        if (typeof email !== 'string') {
          validationErrors.push(`'email' must be a string, received: ${typeof email}`);
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          validationErrors.push(`'email' format is invalid: "${email}"`);
        }
      }
      
      if (phone !== undefined && phone !== null && phone !== '') {
        if (typeof phone !== 'string' && typeof phone !== 'number') {
          validationErrors.push(`'phone' must be a string or number, received: ${typeof phone}`);
        }
      }
      
      if (address !== undefined && address !== null && address !== '') {
        if (typeof address !== 'string') {
          validationErrors.push(`'address' must be a string, received: ${typeof address}`);
        }
      }
      
      if (source !== undefined && source !== null && source !== '') {
        if (typeof source !== 'string') {
          validationErrors.push(`'source' must be a string, received: ${typeof source}`);
        }
      }
      
      if (notes !== undefined && notes !== null && notes !== '') {
        if (typeof notes !== 'string') {
          validationErrors.push(`'notes' must be a string, received: ${typeof notes}`);
        }
      }
      
      if (tags !== undefined && tags !== null) {
        if (!Array.isArray(tags)) {
          validationErrors.push(`'tags' must be an array, received: ${typeof tags}`);
        } else {
          const invalidTags = tags.filter((tag: any) => typeof tag !== 'string');
          if (invalidTags.length > 0) {
            validationErrors.push(`'tags' array must contain only strings, found invalid values: ${JSON.stringify(invalidTags)}`);
          }
        }
      }
      
      if (validationErrors.length > 0) {
        console.error('[webhook] Validation errors:', validationErrors);
        const detailedMessage = `Validation failed: ${validationErrors.join('; ')}`;
        res.status(400).json({ 
          error: "Validation failed",
          message: detailedMessage,
          validationErrors,
          receivedData: { name, email, phone, address, source, notes, followUpDate },
          fix: "Review the validation errors above and ensure all required fields are provided with correct data types"
        });
        return;
      }
      
      let parsedFollowUpDate: Date | undefined = undefined;
      if (followUpDate && followUpDate !== '') {
        const dateStr = String(followUpDate).trim();
        
        try {
          const { parse, parseISO, isValid } = await import('date-fns');
          
          let parsedDate = parseISO(dateStr);
          
          if (!isValid(parsedDate)) {
            const formats = [
              'MMMM dd, yyyy',
              'MMM dd, yyyy',
              'MM/dd/yyyy',
              'MM-dd-yyyy',
              'yyyy-MM-dd',
              'EEEE MMMM dd, yyyy',
            ];
            
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
            
            if (!isValid(parsedDate)) {
              const datePatterns = [
                /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i,
                /\d{1,2}[-/]\d{1,2}[-/]\d{4}/,
                /\d{4}-\d{1,2}-\d{1,2}/
              ];
              
              for (const pattern of datePatterns) {
                const match = dateStr.match(pattern);
                if (match) {
                  const extractedDate = match[0];
                  console.log(`[webhook] Extracted date pattern: "${extractedDate}" from "${dateStr}"`);
                  
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
      
      const { normalizePhoneForStorage, normalizePhoneArrayForStorage } = await import('../../utils/phone-normalizer');
      
      let emailsArray: string[] = [];
      if (emails && Array.isArray(emails)) {
        emailsArray = emails.map((e: any) => String(e).trim()).filter((e: string) => e !== '');
      } else if (email) {
        emailsArray = [String(email).trim()];
      }
      
      let phonesArray: string[] = [];
      if (phones && Array.isArray(phones)) {
        phonesArray = normalizePhoneArrayForStorage(phones);
      } else if (phone) {
        const normalized = normalizePhoneForStorage(String(phone).trim());
        if (normalized) phonesArray = [normalized];
      }
      
      let contactId: string;
      let isNewContact = false;
      
      const existingContactId = await storage.findMatchingContact(contractorId, emailsArray, phonesArray);
      
      if (existingContactId) {
        contactId = existingContactId;
        console.log(`[webhook-lead] Found existing contact: ${contactId}`);
      } else {
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
      
      const hcpIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
      if (hcpIntegrationEnabled) {
        try {
          const contact = await storage.getContact(contactId, contractorId);
          if (contact && !contact.housecallProCustomerId) {
            const nameParts = contact.name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
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
            
            if (hcpCustomerId) {
              await storage.updateContact(contact.id, { 
                housecallProCustomerId: hcpCustomerId 
              }, contractorId);
              console.log('[HCP Sync] Stored HCP customer ID:', hcpCustomerId, 'for contact:', contact.id);
              
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
        }
      }
      
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
}
