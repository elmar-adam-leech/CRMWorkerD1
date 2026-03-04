import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../../storage";
import { webhookEvents } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { CredentialService } from "../../credential-service";
import { workflowEngine } from "../../workflow-engine";
import { broadcastToContractor } from "../../websocket";
import { housecallProService } from "../../housecall-pro-service";
import { webhookRateLimiter } from "../../middleware/rate-limiter";
import crypto from "crypto";

export function registerHousecallProWebhookRoutes(app: Express): void {
  app.post("/api/webhooks/:contractorId/housecall-pro", 
    webhookRateLimiter,
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('Invalid contractor ID in webhook:', contractorId);
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      const signature = (req.headers['x-housecall-pro-signature'] || req.headers['x-housecall-signature']) as string;
      
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
      
      const payload = JSON.parse(rawBody.toString('utf8'));
      const { event_type, data } = payload;

      console.log(`[HCP Webhook] Received event: ${event_type} for contractor: ${contractorId}`);

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

      if (webhookEventId) {
        await db.update(webhookEvents)
          .set({ processed: true })
          .where(eq(webhookEvents.id, webhookEventId));
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(200).json({ received: true, error: 'Processing failed' });
    }
  });
}
