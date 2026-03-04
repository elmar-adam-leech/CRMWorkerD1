import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertContactSchema } from "@shared/schema";
import { ilike } from "drizzle-orm";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { housecallProService } from "../housecall-pro-service";
import { z } from "zod";

const scheduleContactSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  scheduledStart: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format"
  }),
  scheduledEnd: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format" 
  }),
  description: z.string().optional()
});

export function registerContactRoutes(app: Express): void {
  app.get("/api/contacts", asyncHandler(async (req, res) => {
    const { type } = req.query;
    const contactType = type as 'lead' | 'customer' | 'inactive' | undefined;
    
    const contacts = await storage.getContacts(req.user!.contractorId, contactType);
    res.json(contacts);
  }));

  // Paginated contacts endpoint
  app.get("/api/contacts/paginated", asyncHandler(async (req, res) => {
    const { cursor, limit, type, status, search } = req.query;
    
    const options = {
      cursor: cursor as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      type: type as 'lead' | 'customer' | 'inactive' | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
    };

    const paginatedContacts = await storage.getContactsPaginated(req.user!.contractorId, options);
    
    res.json(paginatedContacts);
  }));

  // Contacts status counts endpoint
  app.get("/api/contacts/status-counts", asyncHandler(async (req, res) => {
    const { search, type } = req.query;
    const counts = await storage.getContactsStatusCounts(req.user!.contractorId, {
      search: search as string | undefined,
      type: type as 'lead' | 'customer' | 'inactive' | undefined
    });
    res.json(counts);
  }));

  // Contact deduplication endpoint (admin only)
  app.post("/api/contacts/deduplicate", asyncHandler(async (req, res) => {
    // Only admins can trigger deduplication
    if (req.user!.role !== 'admin') {
      res.status(403).json({ message: "Only administrators can deduplicate contacts" });
      return;
    }
    
    const result = await storage.deduplicateContacts(req.user!.contractorId);
    res.json(result);
  }));

  // CSV Template Download Endpoint - Must be before :id route to avoid conflicts
  app.get("/api/leads/csv-template", asyncHandler(async (req, res) => {
    const csvHeaders = [
      'name',           // Required
      'email',          // Optional
      'phone',          // Optional  
      'address',        // Optional
      'source',         // Optional
      'notes',          // Optional
      'followUpDate'    // Optional (YYYY-MM-DD format)
    ];
    
    const csvTemplate = csvHeaders.join(',') + '\n' +
      'John Smith,john@example.com,555-123-4567,"123 Main St, City, State 12345",Website Contact Form,"Interested in HVAC installation",2024-01-15\n' +
      'Jane Doe,jane@example.com,555-987-6543,"456 Oak Ave, City, State 12345",Referral,"Needs AC repair",2024-01-20';
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads_template.csv"');
    res.send(csvTemplate);
  }));

  app.get("/api/contacts/:id", asyncHandler(async (req, res) => {
    const contact = await storage.getContact(req.params.id, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }
    res.json(contact);
  }));

  app.get("/api/contacts/:contactId/leads", asyncHandler(async (req, res) => {
    const leads = await storage.getLeadsByContact(req.params.contactId, req.user!.contractorId);
    res.json(leads);
  }));

  app.post("/api/contacts", asyncHandler(async (req, res) => {
    const contactData = parseBody(insertContactSchema.omit({ contractorId: true }), req, res);
    if (!contactData) return;
      
      // Check for existing contact with overlapping phone numbers
      if (contactData.phones && contactData.phones.length > 0) {
        const existingContacts = await storage.getContacts(req.user!.contractorId);
        const duplicate = existingContacts.find(existingContact => 
          existingContact.phones && existingContact.phones.some(existingPhone => 
            contactData.phones!.includes(existingPhone)
          )
        );
        if (duplicate) {
          const duplicatePhone = duplicate.phones?.find(p => contactData.phones!.includes(p));
          res.status(409).json({ 
            message: `A contact with phone number ${duplicatePhone} already exists`,
            duplicateContactId: duplicate.id,
            duplicateContactName: duplicate.name,
            isDuplicate: true
          });
          return;
        }
      }
      
      const contact = await storage.createContact(contactData, req.user!.contractorId);
      
      // Sync to Housecall Pro if integration is enabled
      const hcpIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (hcpIntegrationEnabled) {
        try {
          // Parse name into first/last
          const nameParts = contact.name.split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';
          
          // Create customer in HCP
          const hcpResult = await housecallProService.createCustomer(req.user!.contractorId, {
            first_name: firstName,
            last_name: lastName,
            email: contact.emails?.[0],
            mobile_number: contact.phones?.[0],
            lead_source: contact.source || 'CRM',
            notes: contact.notes || undefined,
            addresses: contact.address ? [{
              street: contact.address,
              type: 'service'
            }] : undefined
          });
          
          if (hcpResult.success && hcpResult.data?.id) {
            // Update contact with HCP customer ID
            await storage.updateContact(contact.id, { 
              housecallProCustomerId: hcpResult.data.id 
            }, req.user!.contractorId);
            console.log('[HCP Sync] Created HCP customer:', hcpResult.data.id, 'for contact:', contact.id);
          } else {
            console.warn('[HCP Sync] Failed to create HCP customer:', hcpResult.error);
          }
        } catch (hcpError) {
          console.error('[HCP Sync] Error creating customer in HCP:', hcpError);
          // Don't fail the request if HCP sync fails
        }
      }
      
      // Broadcast contact creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_created',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact creation (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_created', contact as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact creation:', error);
        });
      }
      
    res.status(201).json(contact);
  }));

  app.put("/api/contacts/:id", asyncHandler(async (req, res) => {
    const contactUpdateSchema = insertContactSchema.omit({ contractorId: true }).partial().extend({
      followUpDate: z.coerce.date().nullable().optional(),
    });
    const updateData = parseBody(contactUpdateSchema, req, res);
    if (!updateData) return;
      
      // Track who scheduled the contact
      if (updateData.status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }

      // If emails are being updated, re-evaluate gmail activity links after saving
      const emailsChanging = Array.isArray(updateData.emails);

      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      // Unlink email activities whose matched address was removed from this contact
      if (emailsChanging) {
        storage.unlinkOrphanedEmailActivities(contact.id, contact.emails || [], req.user!.contractorId).catch(err => {
          console.error('[contacts] Error unlinking orphaned email activities:', err);
        });
      }
      
      // Broadcast contact update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact update (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_updated', contact as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact update:', error);
        });
      }
      
    res.json(contact);
  }));

  // PATCH endpoint for partial contact updates (including tags)
  app.patch("/api/contacts/:id", asyncHandler(async (req, res) => {
    const updateData = parseBody(insertContactSchema.omit({ contractorId: true }).partial(), req, res);
    if (!updateData) return;
      
      // Track who scheduled the contact
      if (updateData.status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }
      
      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Broadcast contact update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact update (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_updated', contact as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact update:', error);
        });
      }
      
    res.json(contact);
  }));

  app.patch("/api/contacts/:id/status", asyncHandler(async (req, res) => {
    const statusSchema = z.object({
      status: z.enum(['new', 'contacted', 'scheduled', 'active', 'disqualified', 'inactive'])
    });
    const parsed = parseBody(statusSchema, req, res);
    if (!parsed) return;
    const { status } = parsed;
      
      // Track who scheduled the contact
      const updateData: any = { status };
      if (status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }
      
      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Log activity for status change
      try {
        const statusLabels = {
          'new': 'New',
          'contacted': 'Contacted',
          'scheduled': 'Scheduled',
          'active': 'Active',
          'disqualified': 'Disqualified',
          'inactive': 'Inactive'
        };
        const activityContent = `Contact status changed to ${statusLabels[status]}`;
        
        console.log('[Status Change] req.user:', JSON.stringify(req.user));
        console.log('[Status Change] Creating activity:', { contactId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'status_change',
          title: 'Status Changed',
          content: activityContent,
          contactId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Status Change] Activity created:', activity.id);
        
        // Broadcast WebSocket message for real-time updates
        const { broadcastToContractor } = await import('../websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          contactId: req.params.id,
        });
        
        console.log('[Status Change] WebSocket broadcast sent');
      } catch (activityError) {
        console.error('[Status Change] Failed to create activity:', activityError);
        // Don't fail the request if activity creation fails
      }
      
      // Broadcast contact update to all connected clients for real-time lead list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger status_changed workflows in addition to the general updated workflows
      workflowEngine.triggerWorkflowsForEvent('contact_status_changed', { ...contact } as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for contact status change:', error);
      });
      
    res.json(contact);
  }));

  app.patch("/api/contacts/:id/follow-up", asyncHandler(async (req, res) => {
    const followUpSchema = z.object({
      followUpDate: z.string().nullable().optional().transform((val, ctx) => {
          if (!val) return null;
          const date = new Date(val);
          if (isNaN(date.getTime())) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid date format",
            });
            return z.NEVER;
          }
          return date;
        })
      });
    const parsed = parseBody(followUpSchema, req, res);
    if (!parsed) return;
    const { followUpDate } = parsed;
    const contact = await storage.updateContact(req.params.id, { followUpDate }, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Log activity for follow-up date change
      try {
        const activityContent = followUpDate 
          ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          : 'Follow-up date cleared';
        
        console.log('[Follow-up] Creating activity:', { contactId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'follow_up',
          title: 'Follow-up Date Updated',
          content: activityContent,
          contactId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Follow-up] Activity created:', activity.id);
        
        // Broadcast real-time update via WebSocket
        const { broadcastToContractor } = await import('../websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          contactId: req.params.id,
        });
        
        console.log('[Follow-up] WebSocket broadcast sent');
      } catch (activityError) {
        console.error('[Follow-up] Error creating activity:', activityError);
      }
      
      // Broadcast contact update to all connected clients for real-time lead list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });
      
    res.json(contact);
  }));

  app.delete("/api/contacts/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const deleted = await storage.deleteContact(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }
    
    // Broadcast contact deletion to all connected clients for real-time lead list updates
    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_deleted',
      contactId: req.params.id
    });
    
    res.status(200).json({ message: "Contact deleted successfully" });
  }));

  // Job routes
  app.get("/api/contacts/scheduled", asyncHandler(async (req, res) => {
    const scheduledContacts = await storage.getScheduledContacts(req.user!.contractorId);
    res.json(scheduledContacts);
  }));

  app.get("/api/contacts/unscheduled", asyncHandler(async (req, res) => {
    const unscheduledContacts = await storage.getUnscheduledContacts(req.user!.contractorId);
    res.json(unscheduledContacts);
  }));

  app.post("/api/contacts/:id/schedule", asyncHandler(async (req, res) => {
    const { id: contactId } = req.params;
    
    // Check if Housecall Pro integration is enabled (required for scheduling)
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({ 
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it to schedule contacts.",
        integrationDisabled: true 
      });
      return;
    }
    
    // Validate request body with Zod
    const validation = scheduleContactSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ 
        message: "Invalid request data", 
        errors: validation.error.issues.map(issue => ({ 
          path: issue.path.join('.'), 
          message: issue.message 
        }))
      });
      return;
    }
    
    const { employeeId, scheduledStart, scheduledEnd, description } = validation.data;
    const startDate = new Date(scheduledStart);
    const endDate = new Date(scheduledEnd);

    // Get the contact to schedule
    const contact = await storage.getContact(contactId, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    // Check if contact is already scheduled
    if (contact.isScheduled) {
      res.status(400).json({ message: "Contact is already scheduled" });
      return;
    }

    // Step 1: Find or create customer in Housecall Pro (prevent duplicates)
    let housecallProCustomerId = contact.housecallProCustomerId;
    
    // Get first email and phone from arrays
    const contactEmail = contact.emails?.[0];
    const contactPhone = contact.phones?.[0];
    
    if (!housecallProCustomerId) {
      // First try to find existing customer by email/phone
      if (contactEmail || contactPhone) {
        const searchResult = await housecallProService.searchCustomers(req.user!.contractorId, {
          email: contactEmail || undefined,
          phone: contactPhone || undefined
        });
        
        if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
          // Found existing customer, use it
          housecallProCustomerId = searchResult.data[0].id;
        }
      }
      
      // If no existing customer found, create a new one
      if (!housecallProCustomerId) {
        const customerResult = await housecallProService.createCustomer(req.user!.contractorId, {
          first_name: contact.name.split(' ')[0] || contact.name,
          last_name: contact.name.split(' ').slice(1).join(' ') || '',
          email: contactEmail || '',
          mobile_number: contactPhone || '',
          addresses: contact.address ? [{
            street: contact.address,
            city: '',
            state: '',
            zip: '',
            country: 'US'
          }] : undefined
        });

        if (!customerResult.success) {
          res.status(400).json({ message: `Failed to create customer in Housecall Pro: ${customerResult.error}` });
          return;
        }

        housecallProCustomerId = customerResult.data!.id;
      }
    }

    // Step 2: Create estimate in Housecall Pro
    const estimateResult = await housecallProService.createEstimate(req.user!.contractorId, {
      customer_id: housecallProCustomerId,
      employee_id: employeeId,
      message: description || `Estimate for ${contact.name}`,
      options: [{
        name: 'Option 1',
        schedule: {
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
        },
      }],
      address: contact.address ? {
        street: contact.address,
        city: '',
        state: '',
        zip: '',
        country: 'US'
      } : undefined
    });

    if (!estimateResult.success) {
      res.status(400).json({ message: `Failed to create estimate in Housecall Pro: ${estimateResult.error}` });
      return;
    }

    // Step 3: Atomic contact-to-estimate conversion (updates contact AND creates local estimate)
    const result = await storage.scheduleContactAsEstimate(contactId, {
      housecallProCustomerId,
      housecallProEstimateId: estimateResult.data!.id,
      scheduledAt: startDate,
      scheduledEmployeeId: employeeId,
      scheduledStart: startDate,
      scheduledEnd: endDate,
      description: description || `Estimate for ${contact.name}`
    }, req.user!.contractorId);

    if (!result) {
      res.status(500).json({ message: "Failed to complete contact-to-estimate conversion" });
      return;
    }

    res.json({
      message: "Contact scheduled and converted to estimate successfully",
      contact: result.contact,
      estimate: result.estimate,
      housecallProEstimateId: estimateResult.data!.id
    });
  }));

  // Contractor-specific webhook endpoint for Housecall Pro estimate updates
  app.post("/api/leads/csv-upload", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { csvData } = req.body;
      
      if (!csvData || typeof csvData !== 'string') {
        res.status(400).json({ 
          error: "Missing CSV data",
          message: "Please provide CSV data in the request body"
        });
        return;
      }

      // Enforce tenant isolation - always use the authenticated user's contractor ID
      const contractorId = req.user!.contractorId;
      
      // Limit CSV size to prevent abuse (max ~1MB)
      if (csvData.length > 1024 * 1024) {
        res.status(400).json({ 
          error: "CSV file too large",
          message: "CSV data must be less than 1MB"
        });
        return;
      }
      
      // Parse CSV data
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        res.status(400).json({ 
          error: "Invalid CSV format",
          message: "CSV must contain at least a header row and one data row"
        });
        return;
      }
      
      // Limit number of rows to prevent abuse
      if (lines.length > 1001) { // 1 header + 1000 data rows
        res.status(400).json({ 
          error: "Too many rows",
          message: "CSV cannot contain more than 1000 leads"
        });
        return;
      }
      
      // Parse header row
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      
      // Validate required headers
      if (!headers.includes('name')) {
        res.status(400).json({ 
          error: "Missing required column",
          message: "CSV must include 'name' column"
        });
        return;
      }
      
      const results = {
        total: lines.length - 1, // Exclude header row
        imported: 0,
        errors: [] as Array<{row: number, error: string, data: any}>
      };
      
      // Process each data row
      for (let i = 1; i < lines.length; i++) {
        try {
          // Robust CSV parsing (handles escaped quotes and CSV injection prevention)
          const values: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
              // Handle escaped quotes ("" represents a single ")
              if (inQuotes && lines[i][j + 1] === '"') {
                current += '"';
                j++; // Skip the next quote
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());
          
          // CSV injection prevention: sanitize values starting with formula characters
          const sanitizedValues = values.map(val => {
            if (val && /^[=+\-@\t\r]/.test(val)) {
              return "'" + val; // Prefix with single quote to prevent formula execution
            }
            return val;
          });
          
          // Create lead object from CSV row (using sanitized values)
          const leadData: any = {};
          headers.forEach((header, index) => {
            if (sanitizedValues[index] && sanitizedValues[index] !== '') {
              leadData[header] = sanitizedValues[index];
            }
          });
          
          // Parse followUpDate if provided
          if (leadData.followUpDate) {
            const date = new Date(leadData.followUpDate);
            if (isNaN(date.getTime())) {
              results.errors.push({
                row: i + 1,
                error: "Invalid date format (use YYYY-MM-DD)",
                data: leadData
              });
              continue;
            }
            leadData.followUpDate = date;
          }
          
          // Use Zod validation with insertContactSchema (CSV imports create leads)
          const validationResult = insertContactSchema.omit({ contractorId: true }).safeParse({
            name: leadData.name?.trim(),
            type: 'lead' as const,
            email: leadData.email?.trim() || undefined,
            phone: leadData.phone?.trim() || undefined,
            address: leadData.address?.trim() || undefined,
            source: leadData.source?.trim() || 'CSV Import',
            notes: leadData.notes?.trim() || undefined,
            followUpDate: leadData.followUpDate
          });
          
          if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({
              row: i + 1,
              error: `Validation failed: ${errorMessages}`,
              data: leadData
            });
            continue;
          }
          
          // Create the contact as a lead with proper tenant isolation
          const newContact = await storage.createContact(validationResult.data, contractorId);
          results.imported++;
          
        } catch (error) {
          results.errors.push({
            row: i + 1,
            error: error instanceof Error ? error.message : "Unknown error",
            data: lines[i]
          });
        }
      }
      
      console.log(`CSV import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported`);
      
      // Return 207 Multi-Status if some imports failed, 200 if all succeeded
      const statusCode = results.errors.length > 0 ? 207 : 200;
      
      res.status(statusCode).json({
        success: true,
        message: `Successfully imported ${results.imported} out of ${results.total} leads`,
        total: results.total,
        imported: results.imported,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10) // Limit error reporting to first 10 errors
      });
      
    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process CSV upload"
      });
    }
  });

  // ================================
  // GOOGLE SHEETS SECURE IMPORT ROUTES
  // ================================

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

  // Store Google Sheets credentials securely
}
