import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { storage } from "../storage";
import { insertContactSchema } from "@shared/schema";
import { housecallProService } from "../housecall-pro-service";
import { type AuthenticatedRequest } from "../auth-service";
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

export function registerContactActionRoutes(app: Express): void {
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

    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it to schedule contacts.",
        integrationDisabled: true
      });
      return;
    }

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

    const contact = await storage.getContact(contactId, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    if (contact.isScheduled) {
      res.status(400).json({ message: "Contact is already scheduled" });
      return;
    }

    let housecallProCustomerId = contact.housecallProCustomerId;
    const contactEmail = contact.emails?.[0];
    const contactPhone = contact.phones?.[0];

    if (!housecallProCustomerId) {
      if (contactEmail || contactPhone) {
        const searchResult = await housecallProService.searchCustomers(req.user!.contractorId, {
          email: contactEmail || undefined,
          phone: contactPhone || undefined
        });

        if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
          housecallProCustomerId = searchResult.data[0].id;
        }
      }

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

  app.post("/api/contacts/deduplicate", asyncHandler(async (req, res) => {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ message: "Only administrators can deduplicate contacts" });
      return;
    }
    const result = await storage.deduplicateContacts(req.user!.contractorId);
    res.json(result);
  }));

  app.post("/api/leads/csv-upload", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { csvData } = req.body;

      if (!csvData || typeof csvData !== 'string') {
        res.status(400).json({ error: "Missing CSV data", message: "Please provide CSV data in the request body" });
        return;
      }

      const contractorId = req.user!.contractorId;

      if (csvData.length > 1024 * 1024) {
        res.status(400).json({ error: "CSV file too large", message: "CSV data must be less than 1MB" });
        return;
      }

      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        res.status(400).json({ error: "Invalid CSV format", message: "CSV must contain at least a header row and one data row" });
        return;
      }

      if (lines.length > 1001) {
        res.status(400).json({ error: "Too many rows", message: "CSV cannot contain more than 1000 leads" });
        return;
      }

      const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''));

      if (!headers.includes('name')) {
        res.status(400).json({ error: "Missing required column", message: "CSV must include 'name' column" });
        return;
      }

      const results = {
        total: lines.length - 1,
        imported: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>
      };

      const validContacts: Array<ReturnType<typeof insertContactSchema.omit> extends { parse: (v: any) => infer T } ? T : never> = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const values: string[] = [];
          let current = '';
          let inQuotes = false;

          for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
              if (inQuotes && lines[i][j + 1] === '"') {
                current += '"';
                j++;
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

          const sanitizedValues = values.map((val: string) => {
            if (val && /^[=+\-@\t\r]/.test(val)) return "'" + val;
            return val;
          });

          const leadData: any = {};
          headers.forEach((header: string, index: number) => {
            if (sanitizedValues[index] && sanitizedValues[index] !== '') {
              leadData[header] = sanitizedValues[index];
            }
          });

          if (leadData.followUpDate) {
            const date = new Date(leadData.followUpDate);
            if (isNaN(date.getTime())) {
              results.errors.push({ row: i + 1, error: "Invalid date format (use YYYY-MM-DD)", data: leadData });
              continue;
            }
            leadData.followUpDate = date;
          }

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
            const errorMessages = validationResult.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({ row: i + 1, error: `Validation failed: ${errorMessages}`, data: leadData });
            continue;
          }

          (validContacts as any[]).push(validationResult.data);
        } catch (error) {
          results.errors.push({
            row: i + 1,
            error: error instanceof Error ? error.message : "Unknown error",
            data: lines[i]
          });
        }
      }

      if (validContacts.length > 0) {
        const bulkResult = await storage.bulkCreateContacts(validContacts as any[], contractorId);
        results.imported = bulkResult.inserted;
      }

      console.log(`CSV import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported`);

      const statusCode = results.errors.length > 0 ? 207 : 200;
      res.status(statusCode).json({
        success: true,
        message: `Successfully imported ${results.imported} out of ${results.total} leads`,
        total: results.total,
        imported: results.imported,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10)
      });
    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ error: "Internal server error", message: "Failed to process CSV upload" });
    }
  });
}
