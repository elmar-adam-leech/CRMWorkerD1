import type { Express, Response } from "express";
import { asyncHandler } from "../utils/async-handler";
import { parseBody } from "../utils/validate-body";
import { storage } from "../storage";
import { insertTemplateSchema, templates } from "@shared/schema";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../auth-service";

export function registerTemplateRoutes(app: Express): void {
  app.get("/api/templates", asyncHandler(async (req, res) => {
    const type = req.query.type as 'text' | 'email' | undefined;
    const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
    const userId = req.user!.userId;

    let query = db.select().from(templates).where(eq(templates.contractorId, req.user!.contractorId));

    if (type) {
      query = (query as any).where(and(
        eq(templates.contractorId, req.user!.contractorId),
        eq(templates.type, type)
      ));
    }

    const allTemplates = await query;

    const filteredTemplates = allTemplates.filter(template => {
      if (isAdmin) return true;
      if (template.status === 'approved') return true;
      if (template.createdBy === userId) return true;
      return false;
    });

    res.json(filteredTemplates);
  }));

  app.get("/api/templates/:id", asyncHandler(async (req, res) => {
    const template = await storage.getTemplate(req.params.id, req.user!.contractorId);
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json(template);
  }));

  app.post("/api/templates", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const templateData = parseBody(insertTemplateSchema.omit({ contractorId: true }), req, res);
    if (!templateData) return;

    const dataWithUser = {
      ...templateData,
      createdBy: req.user!.userId,
    };

    const template = await storage.createTemplate(dataWithUser, req.user!.contractorId);
    res.status(201).json(template);
  }));

  app.put("/api/templates/:id", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const updateData = parseBody(insertTemplateSchema.omit({ contractorId: true }).partial(), req, res);
    if (!updateData) return;

    const template = await storage.updateTemplate(req.params.id, updateData, req.user!.contractorId);
    if (!template) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json(template);
  }));

  app.delete("/api/templates/:id", requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const success = await storage.deleteTemplate(req.params.id, req.user!.contractorId);
    if (!success) {
      res.status(404).json({ message: "Template not found" });
      return;
    }
    res.json({ message: "Template deleted successfully" });
  }));

  app.post("/api/templates/:id/approve", requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const updated = await db.update(templates)
      .set({
        status: 'approved',
        approvedBy: req.user!.userId,
        approvedAt: new Date()
      })
      .where(and(
        eq(templates.id, id),
        eq(templates.contractorId, req.user!.contractorId)
      ))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    res.json({ ...updated[0], message: "Template approved successfully" });
  }));

  app.post("/api/templates/:id/reject", requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    const updated = await db.update(templates)
      .set({
        status: 'rejected',
        rejectionReason: rejectionReason || 'No reason provided',
        approvedBy: req.user!.userId,
        approvedAt: new Date()
      })
      .where(and(
        eq(templates.id, id),
        eq(templates.contractorId, req.user!.contractorId)
      ))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ message: "Template not found" });
      return;
    }

    res.json({ ...updated[0], message: "Template rejected" });
  }));
}
