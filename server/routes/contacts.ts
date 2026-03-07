import type { Express } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertContactSchema, contactStatusEnum } from "@shared/schema";
import type { UpdateContact } from "../storage-types";
import { requireManagerOrAdmin } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { createActivityAndBroadcast } from "../utils/activity";
import { housecallProService } from "../housecall-pro-service";
import { z } from "zod";

export function registerContactRoutes(app: Express): void {
  // Legacy endpoint: bounded to 100 rows by default.
  // Prefer /api/contacts/paginated for any paginated or search-driven UI.
  // This endpoint is kept for backwards compat with cache-invalidation queryKeys
  // that fire after mutations (they re-fetch the current page, not a full dump).
  app.get("/api/contacts", asyncHandler(async (req, res) => {
    const { type, search, limit } = req.query;
    const contactType = type as 'lead' | 'customer' | 'inactive' | undefined;
    const pageLimit = Math.min(parseInt(limit as string || '100', 10), 100);
    const result = await storage.getContactsPaginated(req.user!.contractorId, {
      type: contactType,
      search: search as string | undefined,
      limit: pageLimit,
      includeAll: true,
    });
    res.json(result.data);
  }));

  app.get("/api/contacts/paginated", asyncHandler(async (req, res) => {
    const { cursor, limit, type, status, search, includeAll } = req.query;
    const options = {
      cursor: cursor as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      type: type as 'lead' | 'customer' | 'inactive' | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
      includeAll: includeAll === "true",
    };
    const paginatedContacts = await storage.getContactsPaginated(req.user!.contractorId, options);
    res.json(paginatedContacts);
  }));

  app.get("/api/contacts/status-counts", asyncHandler(async (req, res) => {
    const { search, type } = req.query;
    const counts = await storage.getContactsStatusCounts(req.user!.contractorId, {
      search: search as string | undefined,
      type: type as 'lead' | 'customer' | 'inactive' | undefined
    });
    res.json(counts);
  }));

  app.get("/api/contacts/follow-ups", asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const contacts = await storage.getContactsWithFollowUp(req.user!.contractorId, limit);
    res.json(contacts);
  }));

  app.get("/api/contacts/lead-trend", asyncHandler(async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await storage.getLeadTrend(req.user!.contractorId, since);
    res.json(rows);
  }));

  app.get("/api/leads/csv-template", asyncHandler(async (_req, res) => {
    const csvHeaders = ['name', 'email', 'phone', 'address', 'source', 'notes', 'followUpDate'];
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
    const contactSchema = insertContactSchema
      .omit({ contractorId: true })
      .extend({ followUpDate: z.coerce.date().nullable().optional() });
    const contactData = parseBody(contactSchema, req, res);
    if (!contactData) return;

    if (
      (contactData.phones && contactData.phones.length > 0) ||
      (contactData.emails && contactData.emails.length > 0)
    ) {
      const matchedId = await storage.findMatchingContact(
        req.user!.contractorId,
        contactData.emails ?? [],
        contactData.phones ?? []
      );

      if (matchedId) {
        const existing = await storage.getContact(matchedId, req.user!.contractorId);
        if (existing) {
          const existingPhones = existing.phones ?? [];
          const newPhones = (contactData.phones ?? []).filter(p => !existingPhones.includes(p));
          const mergedPhones = [...existingPhones, ...newPhones];

          const existingEmailsLower = (existing.emails ?? []).map(e => e.toLowerCase());
          const newEmails = (contactData.emails ?? []).filter(e => !existingEmailsLower.includes(e.toLowerCase()));
          const mergedEmails = [...(existing.emails ?? []), ...newEmails];

          const updatePayload: Partial<UpdateContact> = {};
          if (newPhones.length > 0) updatePayload.phones = mergedPhones;
          if (newEmails.length > 0) updatePayload.emails = mergedEmails;
          if (contactData.type && contactData.type !== existing.type) {
            updatePayload.type = contactData.type;
          }

          if (Object.keys(updatePayload).length === 0) {
            res.status(409).json({
              message: `A contact with this phone or email already exists`,
              duplicateContactId: existing.id,
              duplicateContactName: existing.name,
              isDuplicate: true,
            });
            return;
          }

          const updated = await storage.updateContact(matchedId, updatePayload, req.user!.contractorId);
          res.status(200).json(updated);
          return;
        }
      }
    }

    const contact = await storage.createContact(contactData, req.user!.contractorId);

    const hcpIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (hcpIntegrationEnabled) {
      try {
        const nameParts = contact.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        const hcpResult = await housecallProService.createCustomer(req.user!.contractorId, {
          first_name: firstName,
          last_name: lastName,
          email: contact.emails?.[0],
          mobile_number: contact.phones?.[0],
          lead_source: contact.source || 'CRM',
          notes: contact.notes || undefined,
          addresses: contact.address ? [{ street: contact.address, type: 'service' }] : undefined
        });

        if (hcpResult.success && hcpResult.data?.id) {
          await storage.updateContact(contact.id, {
            housecallProCustomerId: hcpResult.data.id,
            externalId: hcpResult.data.id,
            externalSource: 'housecall-pro',
          }, req.user!.contractorId);
          console.log('[HCP Sync] Created HCP customer:', hcpResult.data.id, 'for contact:', contact.id);
        } else {
          console.warn('[HCP Sync] Failed to create HCP customer:', hcpResult.error);
        }
      } catch (hcpError) {
        console.error('[HCP Sync] Error creating customer in HCP:', hcpError);
      }
    }

    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_created',
      contactId: contact.id,
      contactType: contact.type
    });

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

    if (updateData.status === 'scheduled') {
      updateData.scheduledByUserId = req.user!.userId;
    }

    const emailsChanging = Array.isArray(updateData.emails);

    const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    if (emailsChanging) {
      storage.unlinkOrphanedEmailActivities(contact.id, contact.emails || [], req.user!.contractorId).catch(err => {
        console.error('[contacts] Error unlinking orphaned email activities:', err);
      });
    }

    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_updated',
      contactId: contact.id,
      contactType: contact.type
    });

    if (contact.type === 'lead') {
      workflowEngine.triggerWorkflowsForEvent('contact_updated', contact as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for contact update:', error);
      });
    }

    res.json(contact);
  }));

  app.patch("/api/contacts/:id", asyncHandler(async (req, res) => {
    const updateData = parseBody(insertContactSchema.omit({ contractorId: true }).partial(), req, res);
    if (!updateData) return;

    if (updateData.status === 'scheduled') {
      updateData.scheduledByUserId = req.user!.userId;
    }

    const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_updated',
      contactId: contact.id,
      contactType: contact.type
    });

    if (contact.type === 'lead') {
      workflowEngine.triggerWorkflowsForEvent('contact_updated', contact as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for contact update:', error);
      });
    }

    res.json(contact);
  }));

  app.patch("/api/contacts/:id/status", asyncHandler(async (req, res) => {
    const statusSchema = z.object({
      status: z.enum(contactStatusEnum.enumValues)
    });
    const parsed = parseBody(statusSchema, req, res);
    if (!parsed) return;
    const { status } = parsed;

    const updateData: any = { status };
    if (status === 'scheduled') {
      updateData.scheduledByUserId = req.user!.userId;
    }

    const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
    if (!contact) {
      res.status(404).json({ message: "Contact not found" });
      return;
    }

    try {
      const statusLabels: Record<string, string> = {
        'new': 'New', 'contacted': 'Contacted', 'scheduled': 'Scheduled',
        'active': 'Active', 'disqualified': 'Disqualified', 'inactive': 'Inactive'
      };
      const activityContent = `Contact status changed to ${statusLabels[status]}`;

      await createActivityAndBroadcast(
        req.user!.contractorId,
        { type: 'status_change', title: 'Status Changed', content: activityContent, contactId: req.params.id, userId: req.user!.userId },
        { type: 'new_activity', contactId: req.params.id }
      );
    } catch (activityError) {
      console.error('[Status Change] Failed to create activity:', activityError);
    }

    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_updated',
      contactId: contact.id,
      contactType: contact.type
    });

    workflowEngine.triggerWorkflowsForEvent('contact_status_changed', { ...contact } as Record<string, unknown>, req.user!.contractorId).catch(error => {
      console.error('[Workflow] Error triggering workflows for contact status change:', error);
    });

    res.json(contact);
  }));

  app.patch("/api/contacts/:id/follow-up", asyncHandler(async (req, res) => {
    // Derived from insertContactSchema — ensures followUpDate validation stays in sync with the schema
    const followUpSchema = insertContactSchema.pick({ followUpDate: true }).extend({
      followUpDate: z.string().nullable().optional().transform((val, ctx) => {
        if (!val) return null;
        const date = new Date(val);
        if (isNaN(date.getTime())) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date format" });
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

    try {
      const activityContent = followUpDate
        ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
        : 'Follow-up date cleared';

      await createActivityAndBroadcast(
        req.user!.contractorId,
        { type: 'follow_up', title: 'Follow-up Date Updated', content: activityContent, contactId: req.params.id, userId: req.user!.userId },
        { type: 'new_activity', contactId: req.params.id }
      );
    } catch (activityError) {
      console.error('[Follow-up] Error creating activity:', activityError);
    }

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

    broadcastToContractor(req.user!.contractorId, {
      type: 'contact_deleted',
      contactId: req.params.id
    });

    res.status(200).json({ message: "Contact deleted successfully" });
  }));
}
