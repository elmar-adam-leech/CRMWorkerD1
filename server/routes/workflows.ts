import type { Express, Response } from "express";
import { storage } from "../storage";
import { insertWorkflowSchema, insertWorkflowStepSchema } from "@shared/schema";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { workflowEngine } from "../workflow-engine";
import { broadcastToContractor } from "../websocket";

export function registerWorkflowRoutes(app: Express): void {
  app.get("/api/notifications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getNotifications(req.user!.userId, req.user!.contractorId, limit);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.get("/api/notifications/unread", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notifications = await storage.getUnreadNotifications(req.user!.userId, req.user!.contractorId);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
      res.status(500).json({ error: 'Failed to fetch unread notifications' });
    }
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notification = await storage.markNotificationAsRead(req.params.id, req.user!.userId);
      if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.json(notification);
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await storage.markAllNotificationsAsRead(req.user!.userId, req.user!.contractorId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  app.delete("/api/notifications/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteNotification(req.params.id, req.user!.userId);
      if (!deleted) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });

  // Workflow API endpoints
  app.get("/api/workflows", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const approvalStatus = req.query.approvalStatus as string | undefined;
      const workflows = await storage.getWorkflows(req.user!.contractorId, approvalStatus);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching workflows:', error);
      res.status(500).json({ error: 'Failed to fetch workflows' });
    }
  });

  app.get("/api/workflows/active", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflows = await storage.getActiveWorkflows(req.user!.contractorId);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching active workflows:', error);
      res.status(500).json({ error: 'Failed to fetch active workflows' });
    }
  });

  app.get("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json(workflow);
    } catch (error) {
      console.error('Error fetching workflow:', error);
      res.status(500).json({ error: 'Failed to fetch workflow' });
    }
  });

  app.post("/api/workflows", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error creating workflow:', error);
      res.status(500).json({ error: 'Failed to create workflow' });
    }
  });

  app.patch("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error updating workflow:', error);
      res.status(500).json({ error: 'Failed to update workflow' });
    }
  });

  app.delete("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteWorkflow(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      res.status(500).json({ error: 'Failed to delete workflow' });
    }
  });

  // Workflow approval endpoints
  app.get("/api/workflows/pending-approval", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflows = await storage.getWorkflowsPendingApproval(req.user!.contractorId);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching pending approval workflows:', error);
      res.status(500).json({ error: 'Failed to fetch pending approval workflows' });
    }
  });

  app.post("/api/workflows/:id/approve", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error approving workflow:', error);
      res.status(500).json({ error: 'Failed to approve workflow' });
    }
  });

  app.post("/api/workflows/:id/reject", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error rejecting workflow:', error);
      res.status(500).json({ error: 'Failed to reject workflow' });
    }
  });

  // Workflow step endpoints
  app.get("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Verify workflow belongs to contractor
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const steps = await storage.getWorkflowSteps(req.params.workflowId);
      res.json(steps);
    } catch (error) {
      console.error('Error fetching workflow steps:', error);
      res.status(500).json({ error: 'Failed to fetch workflow steps' });
    }
  });

  app.post("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error creating workflow step:', error);
      res.status(500).json({ error: 'Failed to create workflow step' });
    }
  });

  app.put("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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

      // All valid — now atomically replace
      await storage.deleteWorkflowSteps(req.params.workflowId);
      const createdSteps = await Promise.all(validatedSteps.map((s) => storage.createWorkflowStep(s)));

      res.json(createdSteps);
    } catch (error) {
      console.error('Error replacing workflow steps:', error);
      res.status(500).json({ error: 'Failed to replace workflow steps' });
    }
  });

  app.patch("/api/workflow-steps/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error updating workflow step:', error);
      res.status(500).json({ error: 'Failed to update workflow step' });
    }
  });

  app.delete("/api/workflow-steps/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error deleting workflow step:', error);
      res.status(500).json({ error: 'Failed to delete workflow step' });
    }
  });

  // Workflow execution endpoints
  app.get("/api/workflows/:workflowId/executions", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error fetching workflow executions:', error);
      res.status(500).json({ error: 'Failed to fetch workflow executions' });
    }
  });

  app.get("/api/workflow-executions/recent", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const executions = await storage.getRecentWorkflowExecutions(req.user!.contractorId, limit);
      res.json(executions);
    } catch (error) {
      console.error('Error fetching recent workflow executions:', error);
      res.status(500).json({ error: 'Failed to fetch recent workflow executions' });
    }
  });

  app.get("/api/workflow-executions/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error fetching workflow execution:', error);
      res.status(500).json({ error: 'Failed to fetch workflow execution' });
    }
  });

  app.post("/api/workflows/:workflowId/execute", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
    } catch (error) {
      console.error('Error triggering workflow execution:', error);
      res.status(500).json({ error: 'Failed to trigger workflow execution' });
    }
  });

  // Service worker unregistration endpoint for cache busting
}
