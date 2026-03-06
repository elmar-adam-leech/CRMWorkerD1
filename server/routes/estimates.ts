import type { Express } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertEstimateSchema } from "@shared/schema";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { createActivityAndBroadcast } from "../utils/activity";
import { housecallProService } from "../housecall-pro-service";
import { z } from "zod";

export function registerEstimateRoutes(app: Express): void {
  app.get("/api/estimates", asyncHandler(async (req, res) => {
    const estimates = await storage.getEstimates(req.user!.contractorId);
    res.json(estimates);
  }));

  app.get("/api/estimates/paginated", asyncHandler(async (req, res) => {
    const cursor = req.query.cursor as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const result = await storage.getEstimatesPaginated(req.user!.contractorId, { cursor, limit, status, search });
    res.json(result);
  }));

  app.get("/api/estimates/status-counts", asyncHandler(async (req, res) => {
    const search = req.query.search as string;
    const counts = await storage.getEstimatesStatusCounts(req.user!.contractorId, { search });
    res.json(counts);
  }));

  app.get("/api/estimates/follow-ups", asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const estimatesList = await storage.getEstimatesWithFollowUp(req.user!.contractorId, limit);
    res.json(estimatesList);
  }));

  app.get("/api/estimates/:id", asyncHandler(async (req, res) => {
    const estimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    res.json(estimate);
  }));

  app.post("/api/estimates", asyncHandler(async (req, res) => {
    const estimateData = parseBody(
      insertEstimateSchema.omit({ contractorId: true }).extend({
        amount: z.union([z.string(), z.number()])
          .transform(val => String(val))
          .optional()
          .default('0.00'),
      }),
      req,
      res
    );
    if (!estimateData) return;
    let estimate: Awaited<ReturnType<typeof storage.createEstimate>>;
    try {
      estimate = await storage.createEstimate(estimateData, req.user!.contractorId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Customer not found')) {
        res.status(400).json({ message: err.message });
        return;
      }
      throw err;
    }

    const hcpEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (hcpEnabled && estimate.contactId) {
      try {
        const contact = await storage.getContact(estimate.contactId, req.user!.contractorId);
        if (contact) {
          let hcpCustomerId: string | undefined = contact.externalId || contact.housecallProCustomerId || undefined;

          if (!hcpCustomerId) {
            const contactEmail = contact.emails?.[0];
            const contactPhone = contact.phones?.[0];

            if (contactEmail || contactPhone) {
              const searchResult = await housecallProService.searchCustomers(
                req.user!.contractorId,
                { email: contactEmail, phone: contactPhone }
              );
              if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
                hcpCustomerId = searchResult.data[0].id;
              }
            }

            if (!hcpCustomerId) {
              const nameParts = contact.name.split(' ');
              const customerResult = await housecallProService.createCustomer(
                req.user!.contractorId,
                {
                  first_name: nameParts[0] || contact.name,
                  last_name: nameParts.slice(1).join(' ') || '',
                  email: contact.emails?.[0] || '',
                  mobile_number: contact.phones?.[0] || '',
                }
              );
              if (customerResult.success && customerResult.data?.id) {
                hcpCustomerId = customerResult.data.id;
              }
            }

            if (hcpCustomerId) {
              await storage.updateContact(
                contact.id,
                { externalId: hcpCustomerId, externalSource: 'housecall-pro', housecallProCustomerId: hcpCustomerId },
                req.user!.contractorId
              );
            }
          }

          let hcpAddress: { street: string; city: string; state: string; zip: string; country: string } | undefined;
          if (contact.address) {
            const parts = contact.address.split(',').map((s: string) => s.trim());
            const stateZip = (parts[2] || '').trim().split(' ');
            hcpAddress = {
              street: parts[0] || contact.address,
              city: parts[1] || '',
              state: stateZip[0] || '',
              zip: stateZip[1] || '',
              country: 'US',
            };
          }

          if (hcpCustomerId) {
            const hcpResult = await housecallProService.createEstimate(
              req.user!.contractorId,
              {
                customer_id: hcpCustomerId,
                message: estimate.description || undefined,
                options: [{
                  name: estimate.title,
                  total_amount: estimate.amount && estimate.amount !== '0.00' ? estimate.amount : undefined,
                }],
                address: hcpAddress,
              }
            );

            if (hcpResult.success && hcpResult.data?.id) {
              estimate = await storage.updateEstimate(
                estimate.id,
                { externalId: hcpResult.data.id, externalSource: 'housecall-pro' },
                req.user!.contractorId
              ) ?? estimate;
              console.log('[HCP Sync] Created HCP estimate:', hcpResult.data.id, 'for estimate:', estimate.id);
            } else {
              console.warn('[HCP Sync] Failed to create HCP estimate:', hcpResult.error);
            }
          }
        }
      } catch (hcpErr) {
        console.error('[HCP Sync] Error syncing estimate to HCP:', hcpErr);
      }
    }

    broadcastToContractor(req.user!.contractorId, { type: 'estimate_created', estimateId: estimate.id });
    workflowEngine.triggerWorkflowsForEvent('estimate_created', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
      console.error('[Workflow] Error triggering workflows for estimate creation:', error);
    });
    res.status(201).json(estimate);
  }));

  app.put("/api/estimates/:id", asyncHandler(async (req, res) => {
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (existingEstimate.externalSource === 'housecall-pro') {
      res.status(403).json({
        message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value. Status updates are managed in Housecall Pro."
      });
      return;
    }
    const updateData = parseBody(insertEstimateSchema.omit({ contractorId: true, contactId: true }).partial(), req, res);
    if (!updateData) return;
    const estimate = await storage.updateEstimate(req.params.id, updateData, req.user!.contractorId);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }

    broadcastToContractor(req.user!.contractorId, { type: 'estimate_updated', estimateId: estimate.id });
    workflowEngine.triggerWorkflowsForEvent('estimate_updated', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
      console.error('[Workflow] Error triggering workflows for estimate update:', error);
    });

    if (updateData.status) {
      workflowEngine.triggerWorkflowsForEvent('estimate_status_changed', estimate as unknown as Record<string, unknown>, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for estimate status change:', error);
      });
    }

    res.json(estimate);
  }));

  app.patch("/api/estimates/:id/follow-up", asyncHandler(async (req, res) => {
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }
    if (existingEstimate.externalSource === 'housecall-pro') {
      res.status(403).json({
        message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value."
      });
      return;
    }
    const followUpSchema = z.object({
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
    const estimate = await storage.updateEstimate(req.params.id, { followUpDate }, req.user!.contractorId);
    if (!estimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }

    try {
      const activityContent = followUpDate
        ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
        : 'Follow-up date cleared';

      await createActivityAndBroadcast(
        req.user!.contractorId,
        { type: 'follow_up', title: 'Follow-up Date Updated', content: activityContent, estimateId: req.params.id, userId: req.user!.userId },
        { type: 'new_activity', estimateId: req.params.id }
      );
    } catch (activityError) {
      console.error('[Follow-up] Error creating activity for estimate:', activityError);
    }

    broadcastToContractor(req.user!.contractorId, { type: 'estimate_updated', estimateId: estimate.id });
    res.json(estimate);
  }));

  app.delete("/api/estimates/:id", asyncHandler(async (req, res) => {
    const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
    if (!existingEstimate) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }

    const deleted = await storage.deleteEstimate(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ message: "Estimate not found" });
      return;
    }

    broadcastToContractor(req.user!.contractorId, { type: 'estimate_deleted', estimateId: req.params.id });
    res.json({ message: "Estimate deleted successfully" });
  }));
}
