import type { Express, Response } from "express";
import { storage } from "../../storage";
import { housecallProService } from "../../housecall-pro-service";
import { type AuthenticatedRequest } from "../../auth-service";
import { asyncHandler } from "../../utils/async-handler";

export function registerHousecallProRoutes(app: Express): void {
  app.get("/api/housecall-pro/status", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const isConfigured = await housecallProService.isConfigured(req.user!.contractorId);
    if (!isConfigured) {
      res.json({ configured: false, connected: false });
      return;
    }

    const connection = await housecallProService.checkConnection(req.user!.contractorId);
    res.json({
      configured: true,
      connected: connection.connected,
      error: connection.error
    });
  }));

  app.get("/api/housecall-pro/employees", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const result = await housecallProService.getEmployees(req.user!.contractorId);
    if (!result.success) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.json(result.data);
  }));

  app.get("/api/housecall-pro/availability", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
    if (!isIntegrationEnabled) {
      res.status(403).json({
        message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
        integrationDisabled: true
      });
      return;
    }

    const { date, estimatorIds } = req.query;

    if (!date || typeof date !== 'string') {
      res.status(400).json({ message: "Date parameter is required (YYYY-MM-DD format)" });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      return;
    }

    let estimatorIdArray: string[] | undefined;
    if (estimatorIds) {
      if (typeof estimatorIds === 'string') {
        estimatorIdArray = estimatorIds.split(',').filter(id => id.trim());
      } else if (Array.isArray(estimatorIds)) {
        estimatorIdArray = (estimatorIds as string[]).filter(id => typeof id === 'string' && id.trim());
      }
    }

    const result = await housecallProService.getEstimatorAvailability(
      req.user!.contractorId,
      date,
      estimatorIdArray
    );

    if (!result.success) {
      res.status(400).json({ message: result.error });
      return;
    }

    res.json(result.data);
  }));

  app.get("/api/housecall/employee-estimates", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId, date } = req.query;

    if (!employeeId || !date) {
      res.status(400).json({ message: "employeeId and date are required" });
      return;
    }

    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    const result = await housecallProService.getEmployeeScheduledEstimates(
      req.user!.contractorId,
      employeeId as string,
      startOfDay,
      endOfDay
    );

    if (!result.success) {
      console.error('[HCP] Failed to fetch employee estimates:', result.error);
      res.json([]);
      return;
    }

    const scheduledEstimates: Array<{id: string, scheduled_start: string, scheduled_end: string}> = [];

    for (const est of (result.data || [])) {
      if (est.scheduled_start && est.scheduled_end) {
        scheduledEstimates.push({ id: est.id, scheduled_start: est.scheduled_start, scheduled_end: est.scheduled_end });
      }
      if (est.schedule?.scheduled_start && est.schedule?.scheduled_end) {
        scheduledEstimates.push({ id: est.id, scheduled_start: est.schedule.scheduled_start, scheduled_end: est.schedule.scheduled_end });
      }
      if (est.options && Array.isArray(est.options)) {
        for (const opt of est.options) {
          if (opt.schedule?.start_time && opt.schedule?.end_time) {
            scheduledEstimates.push({ id: est.id, scheduled_start: opt.schedule.start_time, scheduled_end: opt.schedule.end_time });
          }
          if (opt.scheduled_start && opt.scheduled_end) {
            scheduledEstimates.push({ id: est.id, scheduled_start: opt.scheduled_start, scheduled_end: opt.scheduled_end });
          }
        }
      }
    }

    res.json(scheduledEstimates);
  }));
}
