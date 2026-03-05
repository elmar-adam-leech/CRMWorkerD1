import type { Express, Response } from "express";
import { storage } from "../storage";
import { insertWorkflowSchema, insertWorkflowStepSchema } from "@shared/schema";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";
import { asyncHandler } from "../utils/async-handler";

export function registerWorkflowRoutes(app: Express): void {
  // Workflow API endpoints
  app.get("/api/workflows", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const approvalStatus = req.query.approvalStatus as string | undefined;
    const workflows = await storage.getWorkflows(req.user!.contractorId, approvalStatus);
    res.json(workflows);
  }));

  app.get("/api/workflows/active", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workflows = await storage.getActiveWorkflows(req.user!.contractorId);
    res.json(workflows);
  }));

  app.get("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  }));

  app.post("/api/workflows", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validation = insertWorkflowSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
      return;
    }

    // Admins, managers, and super_admins auto-approve their own workflows
    const userContractor = await storage.getUserContractor(req.user!.userId, req.user!.contractorId);
    const isElevatedRole = userContractor && ['admin', 'manager', 'super_admin'].includes(userContractor.role);
    const workflowData = isElevatedRole
      ? { ...validation.data, approvalStatus: 'approved' as const }
      : validation.data;

    const workflow = await storage.createWorkflow(
      workflowData,
      req.user!.contractorId,
      req.user!.userId
    );
    res.status(201).json(workflow);
  }));

  app.patch("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Validate request body
    const validation = insertWorkflowSchema.partial().safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
      return;
    }
    
    // If trying to activate workflow, check approval status
    if (validation.data.isActive === true) {
      const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
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
      req.user!.contractorId
    );
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  }));

  app.delete("/api/workflows/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const deleted = await storage.deleteWorkflow(req.params.id, req.user!.contractorId);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json({ success: true });
  }));

  // Workflow approval endpoints
  app.get("/api/workflows/pending-approval", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workflows = await storage.getWorkflowsPendingApproval(req.user!.contractorId);
    res.json(workflows);
  }));

  app.post("/api/workflows/:id/approve", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
    if (!existingWorkflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    const workflow = await storage.approveWorkflow(req.params.id, req.user!.contractorId, req.user!.userId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    res.json(workflow);
  }));

  app.post("/api/workflows/:id/reject", requireAuth, requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
    if (!existingWorkflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    const { rejectionReason } = req.body;
    const workflow = await storage.rejectWorkflow(req.params.id, req.user!.contractorId, req.user!.userId, rejectionReason);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    res.json(workflow);
  }));

  // Workflow step endpoints
  app.get("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Verify workflow belongs to contractor
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    const steps = await storage.getWorkflowSteps(req.params.workflowId);
    res.json(steps);
  }));

  app.post("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Verify workflow belongs to contractor
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
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
    res.status(201).json(step);
  }));

  app.put("/api/workflows/:workflowId/steps", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const { steps } = req.body;
    if (!Array.isArray(steps)) {
      res.status(400).json({ error: 'steps must be an array' });
      return;
    }

    // Validate all steps first — fail before touching the DB
    const validatedSteps: Array<ReturnType<typeof insertWorkflowStepSchema.parse>> = [];
    for (const stepData of steps) {
      const validation = insertWorkflowStepSchema.safeParse({ ...stepData, workflowId: req.params.workflowId });
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
        return;
      }
      validatedSteps.push(validation.data);
    }

    // All valid — now atomically replace (single bulk insert)
    await storage.deleteWorkflowSteps(req.params.workflowId);
    const createdSteps = await storage.bulkCreateWorkflowSteps(validatedSteps);

    res.json(createdSteps);
  }));

  app.patch("/api/workflow-steps/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // First get the step to find its workflow
    const existingStep = await storage.getWorkflowStep(req.params.id);
    if (!existingStep) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    
    // Verify the workflow belongs to the contractor
    const workflow = await storage.getWorkflow(existingStep.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    
    // Validate request body
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
    res.json(step);
  }));

  app.delete("/api/workflow-steps/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // First get the step to find its workflow
    const existingStep = await storage.getWorkflowStep(req.params.id);
    if (!existingStep) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    
    // Verify the workflow belongs to the contractor
    const workflow = await storage.getWorkflow(existingStep.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    
    const deleted = await storage.deleteWorkflowStep(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow step not found' });
      return;
    }
    res.json({ success: true });
  }));

  // Workflow execution endpoints
  app.get("/api/workflows/:workflowId/executions", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Verify workflow belongs to contractor
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const executions = await storage.getWorkflowExecutions(req.params.workflowId, req.user!.contractorId, limit);
    const parsedExecutions = executions.map(e => ({
      ...e,
      stepLogs: e.executionLog ? JSON.parse(e.executionLog) : [],
    }));
    res.json(parsedExecutions);
  }));

  app.get("/api/workflow-executions/recent", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const executions = await storage.getRecentWorkflowExecutions(req.user!.contractorId, limit);
    res.json(executions);
  }));

  app.get("/api/workflow-executions/:id", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Direct tenant-isolated fetch - no need for secondary workflow check
    const execution = await storage.getWorkflowExecution(req.params.id, req.user!.contractorId);
    if (!execution) {
      res.status(404).json({ error: 'Workflow execution not found' });
      return;
    }
    
    res.json({
      ...execution,
      stepLogs: execution.executionLog ? JSON.parse(execution.executionLog) : [],
    });
  }));

  app.post("/api/workflows/:workflowId/execute", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Verify workflow belongs to contractor
    const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    
    // Check if workflow is approved
    if (workflow.approvalStatus !== 'approved') {
      res.status(403).json({ 
        error: 'Cannot execute workflow', 
        message: workflow.approvalStatus === 'pending_approval' 
          ? 'This workflow requires admin approval before it can be executed'
          : 'This workflow has been rejected and cannot be executed'
      });
      return;
    }
    
    // Validate triggerData - ensure it's a valid object
    let triggerData = req.body.triggerData || {};
    if (typeof triggerData !== 'object' || triggerData === null || Array.isArray(triggerData)) {
      res.status(400).json({ error: 'Invalid triggerData - must be a valid object' });
      return;
    }
    
    // Validate that triggerData can be safely serialized to JSON
    let triggerDataStr: string;
    try {
      triggerDataStr = JSON.stringify(triggerData);
      // Verify it can be parsed back
      JSON.parse(triggerDataStr);
    } catch (e) {
      res.status(400).json({ error: 'Invalid triggerData - contains non-serializable values' });
      return;
    }
    
    // Create execution record
    const execution = await storage.createWorkflowExecution(
      {
        workflowId: req.params.workflowId,
        status: 'pending',
        triggerData: triggerDataStr,
      },
      req.user!.contractorId
    );
    
    // Execute workflow asynchronously (don't wait for completion)
    workflowEngine.executeWorkflow(execution.id, req.user!.contractorId).catch(error => {
      console.error(`[Workflow API] Error executing workflow ${execution.id}:`, error);
    });
    
    res.status(201).json(execution);
  }));

  // Service worker unregistration endpoint for cache busting
}
