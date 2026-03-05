import { storage } from "./storage";
import type { WorkflowStep } from "@shared/schema";
import { broadcastToContractor } from "./websocket";
import { extractVariablesFromEntity } from "./utils/workflow/variable-extractor";
import { replaceVariablesInObject } from "./utils/workflow/variable-replacer";

import type { ExecutionContext, StepResult } from "./workflow-actions/types";
import { handleSendEmail } from "./workflow-actions/send-email";
import { handleSendSMS } from "./workflow-actions/send-sms";
import { handleCreateNotification } from "./workflow-actions/create-notification";
import { handleUpdateEntity } from "./workflow-actions/update-entity";
import { handleAssignUser } from "./workflow-actions/assign-user";
import { handleAiGenerateContent } from "./workflow-actions/ai-generate";
import { handleAiAnalyze } from "./workflow-actions/ai-analyze";
import { handleEvaluateCondition } from "./workflow-actions/condition";
import { handleDelay } from "./workflow-actions/delay";

export type { ExecutionContext, StepResult };

interface StepLog {
  stepId: string;
  stepOrder: number;
  actionType: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'failed';
  result?: unknown;
  error?: string;
}

export class WorkflowEngine {
  private static instance: WorkflowEngine;

  private constructor() {}

  static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  /**
   * Execute a workflow by execution ID
   * @param executionId - The workflow execution ID
   * @param contractorId - The contractor ID for tenant isolation (required for security)
   */
  async executeWorkflow(executionId: string, contractorId: string): Promise<void> {
    try {
      const execution = await storage.getWorkflowExecution(executionId, contractorId);
      if (!execution) {
        console.error(`[Workflow Engine] Execution ${executionId} not found for contractor ${contractorId}`);
        return;
      }

      const workflow = await storage.getWorkflow(execution.workflowId, contractorId);
      if (!workflow) {
        console.error(`[Workflow Engine] Workflow ${execution.workflowId} not found`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', 'Workflow not found');
        return;
      }

      if (!workflow.isActive) {
        console.log(`[Workflow Engine] Workflow ${workflow.id} is not active, skipping execution`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', 'Workflow is not active');
        return;
      }

      if (workflow.approvalStatus !== 'approved') {
        console.log(`[Workflow Engine] Workflow ${workflow.id} is not approved (status: ${workflow.approvalStatus}), skipping execution`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', `Workflow is not approved (status: ${workflow.approvalStatus})`);
        return;
      }

      const steps = await storage.getWorkflowSteps(workflow.id);
      if (!steps || steps.length === 0) {
        console.log(`[Workflow Engine] Workflow ${workflow.id} has no steps`);
        await this.updateExecutionStatus(executionId, contractorId, 'completed', 'No steps to execute');
        return;
      }

      const triggerData = execution.triggerData ? JSON.parse(execution.triggerData) : {};
      const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};
      const entityType = triggerConfig.entity || 'lead';
      const entityVariables = extractVariablesFromEntity(triggerData, entityType);

      const context: ExecutionContext = {
        workflowId: workflow.id,
        executionId: execution.id,
        contractorId: execution.contractorId,
        workflowCreatorId: workflow.createdBy,
        triggerEntityType: entityType,
        triggerData,
        variables: {
          [entityType]: entityVariables,
          ...entityVariables // Also add flat variables for backwards compatibility
        }
      };

      await this.updateExecutionStatus(executionId, contractorId, 'running');

      broadcastToContractor(execution.contractorId, {
        type: 'workflow_started',
        executionId: execution.id,
        workflowId: workflow.id,
        workflowName: workflow.name
      });

      console.log(`[Workflow Engine] Starting execution ${executionId} for workflow "${workflow.name}"`);

      const sortedSteps = steps.sort((a, b) => a.stepOrder - b.stepOrder);
      const stepGroups = new Map<number, WorkflowStep[]>();

      for (const step of sortedSteps) {
        const order = step.stepOrder;
        if (!stepGroups.has(order)) {
          stepGroups.set(order, []);
        }
        stepGroups.get(order)!.push(step);
      }

      const orderedGroups = Array.from(stepGroups.entries()).sort(([a], [b]) => a - b);
      const stepLogs: StepLog[] = [];

      for (const [stepOrder, stepsInGroup] of orderedGroups) {
        console.log(`[Workflow Engine] Executing ${stepsInGroup.length} step(s) at order ${stepOrder}`);
        await this.updateExecutionProgress(executionId, contractorId, stepOrder);

        const results = await Promise.all(
          stepsInGroup.map(async step => {
            const start = Date.now();
            const startedAt = new Date().toISOString();
            const result = await this.executeStep(step, context);
            stepLogs.push({
              stepId: step.id,
              stepOrder: step.stepOrder,
              actionType: step.actionType,
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - start,
              status: result.success ? 'success' : 'failed',
              result: result.data,
              error: result.error,
            });
            return result;
          })
        );

        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
          const errorMessages = failures.map(f => f.error).join('; ');
          console.error(`[Workflow Engine] ${failures.length} step(s) failed at order ${stepOrder}:`, errorMessages);
          await storage.updateWorkflowExecution(executionId, { executionLog: JSON.stringify(stepLogs) }, contractorId);
          await this.updateExecutionStatus(executionId, contractorId, 'failed', errorMessages);
          broadcastToContractor(execution.contractorId, {
            type: 'workflow_failed',
            executionId: execution.id,
            workflowId: workflow.id,
            workflowName: workflow.name,
            error: errorMessages
          });
          return;
        }

        results.forEach((result, index) => {
          if (result.data) {
            const step = stepsInGroup[index];
            context.variables[`step_${step.stepOrder}_${step.id}_result`] = result.data;
          }
        });
      }

      await storage.updateWorkflowExecution(executionId, { executionLog: JSON.stringify(stepLogs) }, contractorId);
      await this.updateExecutionStatus(executionId, contractorId, 'completed');

      broadcastToContractor(execution.contractorId, {
        type: 'workflow_completed',
        executionId: execution.id,
        workflowId: workflow.id,
        workflowName: workflow.name
      });

      console.log(`[Workflow Engine] Execution ${executionId} completed successfully`);
    } catch (error) {
      console.error(`[Workflow Engine] Error executing workflow:`, error);
      await this.updateExecutionStatus(executionId, contractorId, 'failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Execute a single workflow step, dispatching to the appropriate handler module
   */
  private async executeStep(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    console.log(`[Workflow Engine] Executing step ${step.stepOrder}: ${step.actionType}`);
    try {
      const config = step.actionConfig ? JSON.parse(step.actionConfig) : {};
      const params = this.extractConfig(config);

      switch (step.actionType) {
        case 'send_email':
          return await handleSendEmail(params, context, this.replaceVariables.bind(this), this.updateEntityStatus.bind(this));

        case 'send_sms':
          return await handleSendSMS(params, context, this.replaceVariables.bind(this), this.updateEntityStatus.bind(this));

        case 'create_notification':
          return await handleCreateNotification(params, context, this.replaceVariables.bind(this));

        case 'update_entity':
          return await handleUpdateEntity(params, context);

        case 'assign_user':
          return await handleAssignUser(params, context);

        case 'ai_generate_content':
          return await handleAiGenerateContent(params, context, this.replaceVariables.bind(this));

        case 'ai_analyze':
          return await handleAiAnalyze(params, context);

        case 'conditional_branch':
          return await handleEvaluateCondition(step, params, context, this.getFieldValue.bind(this));

        case 'delay':
        case 'wait_until':
          return await handleDelay(step, params);

        default:
          console.warn(`[Workflow Engine] Unknown action type: ${step.actionType}`);
          return { success: true };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Replace variables in a string template using the comprehensive variable replacer utility.
   */
  private replaceVariables(template: unknown, context: ExecutionContext): string {
    if (!template) return '';
    const str = typeof template === 'string' ? template : String(template);
    return replaceVariablesInObject(str, context.variables) as string;
  }

  /**
   * Get field value from context.
   * Supports:
   *   trigger.<field>    — field directly on the trigger entity
   *   variable.<name>    — named context variable
   *   <entity>.<field>   — dot-path walk through context.variables (e.g. "lead.status")
   */
  private getFieldValue(field: string, context: ExecutionContext): unknown {
    if (!field) return undefined;
    if (field.startsWith('trigger.')) {
      return (context.triggerData as Record<string, unknown>)[field.substring(8)];
    }
    if (field.startsWith('variable.')) {
      return context.variables[field.substring(9)];
    }
    const parts = field.split('.');
    let cursor: unknown = context.variables;
    for (const part of parts) {
      if (cursor && typeof cursor === 'object' && part in (cursor as object)) {
        cursor = (cursor as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return cursor;
  }

  /**
   * Extract the action config payload, handling both the legacy top-level shape
   * and the current nested shape { nodeId, position, data: { … }, edges }.
   */
  private extractConfig(config: unknown): Record<string, unknown> {
    const c = config as Record<string, unknown>;
    return (c?.data as Record<string, unknown>) ?? c ?? {};
  }

  /**
   * Update entity status after sending communication
   */
  private async updateEntityStatus(
    entityType: string,
    entityId: string,
    status: string,
    contractorId: string
  ): Promise<void> {
    try {
      switch (entityType) {
        case 'lead':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await storage.updateContact(entityId, { status: status as any }, contractorId);
          break;
        case 'estimate':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await storage.updateEstimate(entityId, { status: status as any }, contractorId);
          break;
        case 'job':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await storage.updateJob(entityId, { status: status as any }, contractorId);
          break;
        default:
          console.warn(`[Workflow Engine] Unknown entity type for status update: ${entityType}`);
      }
    } catch (error) {
      console.error(`[Workflow Engine] Error updating ${entityType} status:`, error);
      // Don't throw - status update failure shouldn't fail the whole workflow
    }
  }

  /**
   * Update execution status in database with tenant isolation
   */
  private async updateExecutionStatus(
    executionId: string,
    contractorId: string,
    status: 'pending' | 'running' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined
    };
    if (errorMessage) {
      updates.errorMessage = errorMessage;
    }
    await storage.updateWorkflowExecution(executionId, updates, contractorId);
  }

  /**
   * Update the current step number in the execution record (progress tracking)
   */
  private async updateExecutionProgress(
    executionId: string,
    contractorId: string,
    currentStep: number
  ): Promise<void> {
    await storage.updateWorkflowExecution(executionId, { currentStep }, contractorId);
  }

  /**
   * Trigger workflows based on entity events (contact_created, contact_updated, etc.)
   */
  async triggerWorkflowsForEvent(
    eventType: 'contact_created' | 'contact_updated' | 'contact_status_changed' | 'estimate_created' | 'estimate_updated' | 'estimate_status_changed' | 'job_created' | 'job_updated' | 'job_status_changed',
    entityData: Record<string, unknown>,
    contractorId: string
  ): Promise<void> {
    try {
      const eventMapping: Record<string, { entity: string; event: string }> = {
        'contact_created':         { entity: 'lead',     event: 'created' },
        'contact_updated':         { entity: 'lead',     event: 'updated' },
        'contact_status_changed':  { entity: 'lead',     event: 'status_changed' },
        'estimate_created':        { entity: 'estimate', event: 'created' },
        'estimate_updated':        { entity: 'estimate', event: 'updated' },
        'estimate_status_changed': { entity: 'estimate', event: 'status_changed' },
        'job_created':             { entity: 'job',      event: 'created' },
        'job_updated':             { entity: 'job',      event: 'updated' },
        'job_status_changed':      { entity: 'job',      event: 'status_changed' },
      };

      const mapping = eventMapping[eventType];
      if (!mapping) {
        console.log(`[Workflow Engine] Unknown event type: ${eventType}`);
        return;
      }

      // Fetch only active + approved workflows in SQL — no JS filter needed
      const candidateWorkflows = await storage.getActiveApprovedWorkflows(contractorId);

      // Filter workflows that match this trigger
      const matchingWorkflows = candidateWorkflows.filter(workflow => {
        const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};

        // Support both schema variants:
        // New: { entity: 'lead', event: 'created' }
        // Legacy: { type: 'entity_event', entity: 'lead', action: 'created' }
        const matchesNewSchema = triggerConfig.entity === mapping.entity && triggerConfig.event === mapping.event;
        const matchesLegacySchema = triggerConfig.type === 'entity_event' &&
                                     triggerConfig.entity === mapping.entity &&
                                     triggerConfig.action === mapping.event;

        if (!matchesNewSchema && !matchesLegacySchema) {
          return false;
        }

        // For status_changed events, also enforce targetStatus if the workflow specifies one
        if (triggerConfig.event === 'status_changed' && triggerConfig.targetStatus) {
          if (entityData.status !== triggerConfig.targetStatus) {
            return false;
          }
        }

        // Check tag filtering if specified
        if (triggerConfig.tags && Array.isArray(triggerConfig.tags) && triggerConfig.tags.length > 0) {
          const contactRecord = entityData.contact as Record<string, unknown> | undefined;
          const contactTags = (entityData.tags as string[] | undefined) || (contactRecord?.tags as string[] | undefined) || [];
          const hasRequiredTag = triggerConfig.tags.some((requiredTag: string) =>
            contactTags.includes(requiredTag)
          );
          if (!hasRequiredTag) {
            console.log(`[Workflow Engine] Workflow "${workflow.name}" skipped - contact tags ${JSON.stringify(contactTags)} don't match required tags ${JSON.stringify(triggerConfig.tags)}`);
            return false;
          }
        }

        return true;
      });

      console.log(`[Workflow Engine] Found ${matchingWorkflows.length} matching workflows for ${eventType}`);

      for (const workflow of matchingWorkflows) {
        try {
          let triggerData = entityData;
          if (eventType.startsWith('estimate_')) {
            const enrichedEstimate = await storage.getEstimateWithContact(String(entityData.id), contractorId);
            triggerData = (enrichedEstimate as Record<string, unknown> | null) || entityData;
          } else if (eventType.startsWith('job_')) {
            const enrichedJob = await storage.getJobWithContact(String(entityData.id), contractorId);
            triggerData = (enrichedJob as Record<string, unknown> | null) || entityData;
          }

          const execution = await storage.createWorkflowExecution(
            {
              workflowId: workflow.id,
              status: 'pending',
              triggerData: JSON.stringify(triggerData),
            },
            contractorId
          );

          console.log(`[Workflow Engine] Triggered workflow "${workflow.name}" (ID: ${workflow.id}) for ${eventType}`);

          this.executeWorkflow(execution.id, contractorId).catch(error => {
            console.error(`[Workflow Engine] Error executing workflow ${execution.id}:`, error);
          });
        } catch (error) {
          console.error(`[Workflow Engine] Error triggering workflow ${workflow.id}:`, error);
        }
      }
    } catch (error) {
      console.error(`[Workflow Engine] Error in triggerWorkflowsForEvent:`, error);
    }
  }
}

export const workflowEngine = WorkflowEngine.getInstance();
