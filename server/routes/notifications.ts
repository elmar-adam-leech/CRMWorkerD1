import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";

export function registerNotificationRoutes(app: Express): void {
  app.get("/api/notifications", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const notifications = await storage.getNotifications(req.user!.userId, req.user!.contractorId, limit);
    res.json(notifications);
  }));

  app.get("/api/notifications/unread", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const notifications = await storage.getUnreadNotifications(req.user!.userId, req.user!.contractorId);
    res.json(notifications);
  }));

  app.post("/api/notifications/:id/read", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const notification = await storage.markNotificationAsRead(req.params.id, req.user!.userId);
    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json(notification);
  }));

  app.post("/api/notifications/mark-all-read", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await storage.markAllNotificationsAsRead(req.user!.userId, req.user!.contractorId);
    res.json({ success: true });
  }));

  app.delete("/api/notifications/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const deleted = await storage.deleteNotification(req.params.id, req.user!.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json({ success: true });
  }));
}
