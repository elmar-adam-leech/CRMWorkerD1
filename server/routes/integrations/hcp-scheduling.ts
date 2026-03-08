import type { Express, Response } from "express";
import { storage } from "../../storage";
import { userContractors, type Contractor } from "@shared/schema";
import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../../auth-service";
import { CredentialService } from "../../credential-service";
import { asyncHandler } from "../../utils/async-handler";
import crypto from "crypto";

export function registerHcpSchedulingRoutes(app: Express): void {
  app.post("/api/scheduling/sync-users", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const result = await housecallSchedulingService.syncHousecallUsers(req.user.contractorId);
    res.json(result);
  }));

  app.get("/api/scheduling/salespeople", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const teamMembers = await housecallSchedulingService.getTeamMembers(req.user.contractorId);
    res.json(teamMembers);
  }));

  app.get("/api/scheduling/availability", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate, days } = req.query;

    let start: Date;
    let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    } else {
      start = new Date();
      const daysToFetch = days ? parseInt(days as string) : 14;
      end = new Date();
      end.setDate(end.getDate() + daysToFetch);
    }

    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');

    const contractor = await storage.getContractor(req.user.contractorId) as Contractor | null;
    const timezone = contractor?.timezone || 'America/New_York';

    const slots = await housecallSchedulingService.getUnifiedAvailability(req.user.contractorId, start, end, timezone);

    res.json({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      slotDurationMinutes: 60,
      bufferMinutes: 30,
      slots: slots.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        availableCount: slot.availableSalespersonIds.length,
      }))
    });
  }));

  app.post("/api/scheduling/book", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startTime, title, customerName, customerEmail, customerPhone, customerAddress, customerAddressComponents, notes, contactId, salespersonId, housecallProEmployeeId } = req.body;

    if (!startTime || !title || !customerName) {
      res.status(400).json({ message: "startTime, title, and customerName are required" });
      return;
    }

    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const result = await housecallSchedulingService.bookAppointment(req.user.contractorId, {
      startTime: new Date(startTime),
      title,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerAddressComponents,
      notes,
      contactId,
      salespersonId,
      housecallProEmployeeId,
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json({ message: result.error });
    }
  }));

  app.get("/api/scheduling/bookings", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const { housecallSchedulingService } = await import('../../housecall-scheduling-service');
    const bookings = await housecallSchedulingService.getBookings(
      req.user.contractorId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    res.json(bookings);
  }));

  app.patch("/api/scheduling/salespeople/:userId", requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;
    const { isSalesperson, calendarColor, workingDays, workingHoursStart, workingHoursEnd, hasCustomSchedule } = req.body;

    const updateData: any = {};

    if (isSalesperson !== undefined) updateData.isSalesperson = isSalesperson;
    if (calendarColor !== undefined) updateData.calendarColor = calendarColor;
    if (workingDays !== undefined) updateData.workingDays = workingDays;
    if (workingHoursStart !== undefined) updateData.workingHoursStart = workingHoursStart;
    if (workingHoursEnd !== undefined) updateData.workingHoursEnd = workingHoursEnd;
    if (hasCustomSchedule !== undefined) updateData.hasCustomSchedule = hasCustomSchedule;

    await db.update(userContractors)
      .set(updateData)
      .where(and(
        eq(userContractors.userId, userId),
        eq(userContractors.contractorId, req.user.contractorId)
      ));

    res.json({ message: "Salesperson updated successfully" });
  }));

  app.get("/api/integrations/housecall-pro/webhook-config", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user.contractorId;
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    const baseWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/housecall-pro`;

    // Ensure a URL token exists for this contractor. HCP does not provide a signing
    // secret, so we authenticate incoming webhook requests via a token embedded in
    // the URL instead. The token is generated once and stored as a credential.
    let urlToken: string | undefined;
    try {
      urlToken = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_url_token') || undefined;
    } catch (_) { /* not yet generated */ }
    if (!urlToken) {
      urlToken = crypto.randomBytes(32).toString('hex');
      await CredentialService.setCredential(contractorId, 'housecallpro', 'webhook_url_token', urlToken);
    }

    const webhookUrl = `${baseWebhookUrl}?token=${urlToken}`;

    let secretConfigured = false;
    try {
      const secret = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_secret');
      secretConfigured = !!(secret && secret.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not found') && !msg.includes('No rows') && !msg.includes('no result')) {
        console.warn('[hcp-scheduling] Unexpected error fetching webhook secret:', msg);
      }
    }

    res.json({ webhookUrl, secretConfigured, urlTokenConfigured: true });
  }));

  app.post("/api/integrations/housecall-pro/webhook-secret", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { secret } = req.body;
    if (!secret || typeof secret !== 'string' || !secret.trim()) {
      res.status(400).json({ error: 'Secret is required' });
      return;
    }
    await CredentialService.setCredential(req.user.contractorId, 'housecallpro', 'webhook_secret', secret.trim());
    res.json({ success: true });
  }));
}
