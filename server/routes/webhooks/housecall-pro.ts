import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../../storage";
import { webhookEvents } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { CredentialService } from "../../credential-service";
import { broadcastToContractor } from "../../websocket";
import { workflowEngine } from "../../workflow-engine";
import { mapHcpEstimateStatus } from "../../sync/housecall-pro";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import { asyncHandler } from "../../utils/async-handler";
import { toWorkflowEvent } from "../../utils/workflow/entity-adapter";
import { logger } from "../../utils/logger";
import crypto from "crypto";

const log = logger('HCPWebhook');

export function registerHousecallProWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/housecall-pro", 
    webhookRateLimiter,
    express.raw({ type: 'application/json' }),
    asyncHandler(async (req: Request, res: Response) => {
      const { contractorId } = req.params;
      
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        log.error('Invalid contractor ID in webhook', { contractorId });
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      const signature = (req.headers['x-housecall-pro-signature'] || req.headers['x-housecall-signature']) as string;
      
      // Each contractor must have their own webhook secret configured through
      // the Housecall Pro integration setup flow. There is intentionally no
      // fallback to a shared environment variable: a single leaked global secret
      // would compromise signature validation for every tenant simultaneously.
      let webhookSecret: string | undefined;
      try {
        webhookSecret = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_secret') || undefined;
      } catch (err) {
        log.error('Failed to load webhook secret for contractor', { contractorId, err });
      }

      if (!webhookSecret) {
        log.error('No webhook secret configured for contractor — rejecting request', { contractorId });
        res.status(401).json({ message: "Webhook not configured for this contractor" });
        return;
      }
      
      if (!signature) {
        log.error('Missing webhook signature', { contractorId });
        res.status(401).json({ message: "Missing signature" });
        return;
      }
      
      const rawBody = req.body as Buffer;
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      const providedSignature = signature.replace('sha256=', '');
      
      if (!crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'))) {
        log.error('Invalid webhook signature', { contractorId });
        res.status(401).json({ message: "Invalid signature" });
        return;
      }
      
      const payload = JSON.parse(rawBody.toString('utf8'));
      const { event_type, data } = payload;

      log.info(`Received event: ${event_type} for contractor: ${contractorId}`);

      const webhookEventRecord = await db.insert(webhookEvents).values({
        contractorId,
        service: 'housecall-pro',
        eventType: event_type,
        payload: JSON.stringify(payload),
        processed: false,
      }).returning();
      const webhookEventId = webhookEventRecord[0]?.id;

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
          const mapped = mapHcpEstimateStatus(data);
          const newStatus = mapped !== 'pending' ? mapped : estimate.status;
          const updated = await storage.updateEstimate(estimate.id, {
            status: newStatus as any,
            syncedAt: new Date(),
          }, contractorId);
          if (updated) {
            broadcastToContractor(contractorId, { type: 'estimate_updated', estimateId: updated.id });
            workflowEngine.triggerWorkflowsForEvent('estimate_updated', toWorkflowEvent(updated), contractorId).catch(err =>
              log.error('estimate_updated trigger error', err));
            if (updated.status !== estimate.status) {
              workflowEngine.triggerWorkflowsForEvent('estimate_status_changed', toWorkflowEvent(updated), contractorId).catch(err =>
                log.error('estimate_status_changed trigger error', err));
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
              broadcastToContractor(contractorId, { type: 'job_updated', jobId: updated.id });
              workflowEngine.triggerWorkflowsForEvent('job_updated', toWorkflowEvent(updated), contractorId).catch(err =>
                log.error('job_updated trigger error', err));
              workflowEngine.triggerWorkflowsForEvent('job_status_changed', toWorkflowEvent(updated), contractorId).catch(err =>
                log.error('job_status_changed trigger error', err));
            }
          } else if (event_type === 'job.created') {
            broadcastToContractor(contractorId, { type: 'job_created', jobId: job.id });
            workflowEngine.triggerWorkflowsForEvent('job_created', toWorkflowEvent(job), contractorId).catch(err =>
              log.error('job_created trigger error', err));
          } else {
            broadcastToContractor(contractorId, { type: 'job_updated', jobId: job.id });
            workflowEngine.triggerWorkflowsForEvent('job_updated', toWorkflowEvent(job), contractorId).catch(err =>
              log.error('job_updated trigger error', err));
          }
        }
      } else if (event_type === 'customer.created' || event_type === 'customer.updated') {
        const contact = await storage.getContactByExternalId(data.id, 'housecall-pro', contractorId);
        if (contact) {
          const eventKey = event_type === 'customer.created' ? 'contact_created' : 'contact_updated';
          broadcastToContractor(contractorId, { type: eventKey, contactId: contact.id });
          workflowEngine.triggerWorkflowsForEvent(eventKey, toWorkflowEvent(contact), contractorId).catch(err =>
            log.error(`${eventKey} trigger error`, err));
        }
      } else {
        log.info(`Unhandled event type: ${event_type}`);
      }

      if (webhookEventId) {
        await db.update(webhookEvents)
          .set({ processed: true })
          .where(eq(webhookEvents.id, webhookEventId));
      }

      res.status(200).json({ received: true });
  }));
}
