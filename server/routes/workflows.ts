import type { Express, Response } from "express";
import { storage } from "../storage";
import { insertWorkflowSchema, insertWorkflowStepSchema } from "@shared/schema";
import { requireAuth, requireManagerOrAdmin, type AuthedRequest } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { asyncHandler } from "../utils/async-handler";
import { broadcastToContractor } from "../websocket";

export function registerWorkflowRoutes(app: Express): void {
  app.get("/api/workflows", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const approvalStatus = req.query.approvalStatus as string | undefined;
    const workflows = await storage.getWorkflows(req.user.contractorId, approvalStatus);
    res.json(workflows);
  }));

  app.get("/api/workflows/active", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflows = await storage.getActiveWorkflows(req.user.contractorId);
    res.json(workflows);
  }));

  app.get("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.id, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  }));

  app.post("/api/workflows", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validation = insertWorkflowSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
      return;
    }

    const userContractor = await storage.getUserContractor(req.user.userId, req.user.contractorId);
    const isElevatedRole = userContractor && ['admin', 'manager', 'super_admin'].includes(userContractor.role);
    const workflowData = isElevatedRole
      ? { ...validation.data, approvalStatus: 'approved' as const }
      : validation.data;

    const workflow = await storage.createWorkflow(
      workflowData,
      req.user.contractorId,
      req.user.userId
    );
    broadcastToContractor(req.user.contractorId, { type: 'workflow_created', workflowId: workflow.id });
    res.status(201).json(workflow);
  }));

  app.patch("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const validation = insertWorkflowSchema.partial().safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
      return;
    }

    if (validation.data.isActive === true) {
      const existingWorkflow = await storage.getWorkflow(req.params.id, req.user.contractorId);
      if (!existingWorkflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }

      if (existingWorkflow.approvalStatus !== 'approved') {
        res.status(403).json({
          error: 'Cannot activate workflow',
          message: existingWorkflow.approvalStatus === 'pending_approval'
            ? 'This workflow requires admin approval before it can be activated'
            : 'This workflow has been rejected and cannot be activated'
        });
        return;
      }
    }

    const workflow = await storage.updateWorkflow(
      req.params.id,
      validation.data,
      req.user.contractorId
    );
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: workflow.id });
    res.json(workflow);
  }));

  app.delete("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const deleted = await storage.deleteWorkflow(req.params.id, req.user.contractorId);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    broadcastToContractor(req.user.contractorId, { type: 'workflow_deleted', workflowId: req.params.id });
    res.json({ success: true });
  }));

  app.get("/api/workflows/pending-approval", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflows = await storage.getWorkflowsPendingApproval(req.user.contractorId);
    res.json(workflows);
  }));

  app.post("/api/workflows/:id/approve", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existingWorkflow = await storage.getWorkflow(req.params.id, req.user.contractorId);
    if (!existingWorkflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const workflow = await storage.approveWorkflow(req.params.id, req.user.contractorId, req.user.userId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: workflow.id });
    res.json(workflow);
  }));

  app.post("/api/workflows/:id/reject", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existingWorkflow = await storage.getWorkflow(req.params.id, req.user.contractorId);
    if (!existingWorkflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const { rejectionReason } = req.body;
    const workflow = await storage.rejectWorkflow(req.params.id, req.user.contractorId, req.user.userId, rejectionReason);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: workflow.id });
    res.json(workflow);
  }));

  app.get("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const steps = await storage.getWorkflowSteps(req.params.workflowId);
    res.json(steps);
  }));

  app.post("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const validation = insertWorkflowStepSchema.safeParse({ ...req.body, workflowId: req.params.workflowId });
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
      return;
    }

    const step = await storage.createWorkflowStep(validation.data);
    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: req.params.workflowId });
    res.status(201).json(step);
  }));

  app.put("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const { steps } = req.body;
    if (!Array.isArray(steps)) {
      res.status(400).json({ error: 'steps must be an array' });
      return;
    }

    const validatedSteps: Array<ReturnType<typeof insertWorkflowStepSchema.parse>> = [];
    for (const stepData of steps) {
      const validation = insertWorkflowStepSchema.safeParse({ ...stepData, workflowId: req.params.workflowId });
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
        return;
      }
      validatedSteps.push(validation.data);
    }

    await storage.deleteWorkflowSteps(req.params.workflowId);
    const createdSteps = await storage.bulkCreateWorkflowSteps(validatedSteps);

    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: req.params.workflowId });
    res.json(createdSteps);
  }));

  app.patch("/api/workflow-steps/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existingStep = await storage.getWorkflowStep(req.params.id);
    if (!existingStep) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }

    const workflow = await storage.getWorkflow(existingStep.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }

    const validation = insertWorkflowStepSchema.omit({ workflowId: true }).partial().safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
      return;
    }

    const step = await storage.updateWorkflowStep(req.params.id, validation.data);
    if (!step) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: existingStep.workflowId });
    res.json(step);
  }));

  app.delete("/api/workflow-steps/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existingStep = await storage.getWorkflowStep(req.params.id);
    if (!existingStep) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }

    const workflow = await storage.getWorkflow(existingStep.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }

    const deleted = await storage.deleteWorkflowStep(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    broadcastToContractor(req.user.contractorId, { type: 'workflow_updated', workflowId: existingStep.workflowId });
    res.json({ success: true });
  }));

  app.get("/api/workflows/:workflowId/executions", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const executions = await storage.getWorkflowExecutions(req.params.workflowId, req.user.contractorId, limit);
    const parsedExecutions = executions.map(e => ({
      ...e,
      stepLogs: e.executionLog ? JSON.parse(e.executionLog) : [],
    }));
    res.json(parsedExecutions);
  }));

  app.get("/api/workflow-executions/recent", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const executions = await storage.getRecentWorkflowExecutions(req.user.contractorId, limit);
    res.json(executions);
  }));

  app.get("/api/workflow-executions/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const execution = await storage.getWorkflowExecution(req.params.id, req.user.contractorId);
    if (!execution) {
      res.status(404).json({ error: 'Workflow execution not found' });
      return;
    }

    res.json({
      ...execution,
      stepLogs: execution.executionLog ? JSON.parse(execution.executionLog) : [],
    });
  }));

  app.post("/api/workflows/:workflowId/execute", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    if (workflow.approvalStatus !== 'approved') {
      res.status(403).json({
        error: 'Cannot execute workflow',
        message: workflow.approvalStatus === 'pending_approval'
          ? 'This workflow requires admin approval before it can be executed'
          : 'This workflow has been rejected and cannot be executed'
      });
      return;
    }

    let triggerData = req.body.triggerData || {};
    if (typeof triggerData !== 'object' || triggerData === null || Array.isArray(triggerData)) {
      res.status(400).json({ error: 'Invalid triggerData - must be a valid object' });
      return;
    }

    let triggerDataStr: string;
    try {
      triggerDataStr = JSON.stringify(triggerData);
      JSON.parse(triggerDataStr);
    } catch (e) {
      res.status(400).json({ error: 'Invalid triggerData - contains non-serializable values' });
      return;
    }

    const execution = await storage.createWorkflowExecution(
      {
        workflowId: req.params.workflowId,
        status: 'pending',
        triggerData: triggerDataStr,
      },
      req.user.contractorId
    );

    workflowEngine.executeWorkflow(execution.id, req.user.contractorId).catch(error => {
      console.error(`[Workflow API] Error executing workflow ${execution.id}:`, error);
    });

    res.status(201).json(execution);
  }));
}
