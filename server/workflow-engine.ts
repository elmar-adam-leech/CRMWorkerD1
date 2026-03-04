import { storage } from "./storage";
import { providerService } from "./providers/provider-service";
import { aiService } from "./ai-service";
import { gmailService } from "./gmail-service";
import type { Workflow, WorkflowStep, WorkflowExecution } from "@shared/schema";
import { broadcastToContractor } from "./websocket";
import { extractVariablesFromEntity } from "./utils/workflow/variable-extractor";
import { replaceVariablesInObject } from "./utils/workflow/variable-replacer";

interface ExecutionContext {
  workflowId: string;
  executionId: string;
  contractorId: string;
  workflowCreatorId: string; // User who created the workflow
  triggerData: any;
  variables: Record<string, any>;
}

interface StepResult {
  success: boolean;
  error?: string;
  data?: any;
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
      // Load execution record with tenant isolation
      const execution = await storage.getWorkflowExecution(executionId, contractorId);
      if (!execution) {
        console.error(`[Workflow Engine] Execution ${executionId} not found for contractor ${contractorId}`);
        return;
      }

      // Load workflow
      const workflow = await storage.getWorkflow(execution.workflowId, contractorId);
      if (!workflow) {
        console.error(`[Workflow Engine] Workflow ${execution.workflowId} not found`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', 'Workflow not found');
        return;
      }

      // Check if workflow is active
      if (!workflow.isActive) {
        console.log(`[Workflow Engine] Workflow ${workflow.id} is not active, skipping execution`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', 'Workflow is not active');
        return;
      }

      // Check if workflow is approved
      if (workflow.approvalStatus !== 'approved') {
        console.log(`[Workflow Engine] Workflow ${workflow.id} is not approved (status: ${workflow.approvalStatus}), skipping execution`);
        await this.updateExecutionStatus(executionId, contractorId, 'failed', `Workflow is not approved (status: ${workflow.approvalStatus})`);
        return;
      }

      // Load workflow steps
      const steps = await storage.getWorkflowSteps(workflow.id);
      if (!steps || steps.length === 0) {
        console.log(`[Workflow Engine] Workflow ${workflow.id} has no steps`);
        await this.updateExecutionStatus(executionId, contractorId, 'completed', 'No steps to execute');
        return;
      }

      // Parse trigger data
      const triggerData = execution.triggerData ? JSON.parse(execution.triggerData) : {};
      
      // Extract variables from trigger entity
      const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};
      const entityType = triggerConfig.entity || 'lead';
      const entityVariables = extractVariablesFromEntity(triggerData, entityType);
      
      // Initialize execution context with entity variables
      const context: ExecutionContext = {
        workflowId: workflow.id,
        executionId: execution.id,
        contractorId: execution.contractorId,
        workflowCreatorId: workflow.createdBy,
        triggerData,
        variables: {
          [entityType]: entityVariables,
          ...entityVariables // Also add flat variables for backwards compatibility
        }
      };

      // Update status to running
      await this.updateExecutionStatus(executionId, contractorId, 'running');

      // Broadcast workflow started event
      broadcastToContractor(execution.contractorId, {
        type: 'workflow_started',
        executionId: execution.id,
        workflowId: workflow.id,
        workflowName: workflow.name
      });

      console.log(`[Workflow Engine] Starting execution ${executionId} for workflow "${workflow.name}"`);

      // Group steps by stepOrder for parallel execution
      const sortedSteps = steps.sort((a, b) => a.stepOrder - b.stepOrder);
      const stepGroups = new Map<number, WorkflowStep[]>();
      
      for (const step of sortedSteps) {
        const order = step.stepOrder;
        if (!stepGroups.has(order)) {
          stepGroups.set(order, []);
        }
        stepGroups.get(order)!.push(step);
      }

      // Execute step groups in order, with parallel execution within each group
      const orderedGroups = Array.from(stepGroups.entries()).sort(([a], [b]) => a - b);
      
      for (const [stepOrder, stepsInGroup] of orderedGroups) {
        console.log(`[Workflow Engine] Executing ${stepsInGroup.length} step(s) at order ${stepOrder}`);
        
        // Execute all steps in this group in parallel
        const results = await Promise.all(
          stepsInGroup.map(step => this.executeStep(step, context))
        );
        
        // Check if any step failed
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
          const errorMessages = failures.map(f => f.error).join('; ');
          console.error(`[Workflow Engine] ${failures.length} step(s) failed at order ${stepOrder}:`, errorMessages);
          await this.updateExecutionStatus(executionId, contractorId, 'failed', errorMessages);
          
          // Broadcast workflow failed event
          broadcastToContractor(execution.contractorId, {
            type: 'workflow_failed',
            executionId: execution.id,
            workflowId: workflow.id,
            workflowName: workflow.name,
            error: errorMessages
          });
          
          return;
        }

        // Store step results in context variables
        results.forEach((result, index) => {
          if (result.data) {
            const step = stepsInGroup[index];
            context.variables[`step_${step.stepOrder}_${step.id}_result`] = result.data;
          }
        });
      }

      // Mark execution as completed
      await this.updateExecutionStatus(executionId, contractorId, 'completed');
      
      // Broadcast workflow completed event
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
   * Execute a single workflow step
   */
  private async executeStep(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    console.log(`[Workflow Engine] Executing step ${step.stepOrder}: ${step.actionType}`);

    try {
      // Parse action configuration
      const config = step.actionConfig ? JSON.parse(step.actionConfig) : {};

      // Handle different action types
      switch (step.actionType) {
        // Communication actions
        case 'send_email':
        case 'send_sms':
        case 'create_notification':
          return await this.executeAction(step, config, context);

        // Data actions
        case 'update_entity':
        case 'assign_user':
          return await this.executeAction(step, config, context);

        // Logic actions
        case 'conditional_branch':
          return await this.evaluateCondition(step, config, context);

        // AI actions
        case 'ai_generate_content':
        case 'ai_analyze':
          return await this.executeAction(step, config, context);

        // Delay actions
        case 'delay':
        case 'wait_until':
          return await this.executeDelay(step, config, context);

        default:
          console.warn(`[Workflow Engine] Unknown action type: ${step.actionType}`);
          return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Execute an action step
   */
  private async executeAction(
    step: WorkflowStep,
    config: unknown,
    context: ExecutionContext
  ): Promise<StepResult> {
    // Use step.actionType instead of config.actionType
    const actionType = step.actionType;

    switch (actionType) {
      case 'send_email':
        return await this.sendEmail(config, context);

      case 'send_sms':
        return await this.sendSMS(config, context);

      case 'create_notification':
        return await this.createNotification(config, context);

      case 'update_entity':
        return await this.updateEntity(config, context);

      case 'assign_user':
        return await this.assignUser(config, context);

      case 'ai_generate_content':
        return await this.aiGenerateContent(config, context);

      case 'ai_analyze':
        return await this.aiAnalyze(config, context);

      default:
        return {
          success: false,
          error: `Unknown action type: ${actionType}`
        };
    }
  }

  /**
   * Send email action
   */
  private async sendEmail(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { to, subject, body, fromEmail, updateStatus } = params;
      
      // Replace variables in fields
      const processedTo = this.replaceVariables(to, context);
      const processedSubject = this.replaceVariables(subject, context);
      const processedBody = this.replaceVariables(body, context);
      const processedFromEmail = fromEmail ? this.replaceVariables(fromEmail, context) : undefined;

      console.log(`[Workflow Engine] Email config:`, {
        originalTo: to,
        processedTo,
        subject: processedSubject,
        variables: context.variables
      });

      // Validate recipient
      if (!processedTo || processedTo.trim() === '') {
        return {
          success: false,
          error: 'Recipient address required'
        };
      }

      // Get workflow creator's credentials
      const creator = await storage.getUser(context.workflowCreatorId);
      if (!creator || creator.contractorId !== context.contractorId) {
        return {
          success: false,
          error: 'Workflow creator not found'
        };
      }

      // Check if creator has Gmail connected
      if (!creator.gmailRefreshToken) {
        return {
          success: false,
          error: `Workflow creator ${creator.name} has not connected their Gmail account`
        };
      }

      // Send email using Gmail service
      const result = await gmailService.sendEmail({
        to: processedTo,
        subject: processedSubject,
        content: processedBody,
        refreshToken: creator.gmailRefreshToken,
        fromEmail: processedFromEmail,
        fromName: creator.name
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to send email'
        };
      }

      // Save email to activities table for conversation history
      try {
        // Try to find contact by email address
        const emails = processedTo.split(',').map((e: string) => e.trim());
        let contactId: string | null = null;
        
        for (const email of emails) {
          const matchedContactId = await storage.findMatchingContact(context.contractorId, [email], []);
          if (matchedContactId) {
            contactId = matchedContactId;
            break;
          }
        }

        // Create activity record
        await storage.createActivity({
          type: 'email',
          title: `Email sent: ${processedSubject}`,
          content: processedBody,
          metadata: JSON.stringify({
            subject: processedSubject,
            to: [processedTo],
            from: processedFromEmail || creator.email,
            messageId: result.messageId,
            direction: 'outbound'
          }),
          contactId,
          userId: context.workflowCreatorId
        }, context.contractorId);

        console.log(`[Workflow Engine] Saved email to activities (contactId: ${contactId})`);
      } catch (error) {
        console.error('[Workflow Engine] Failed to save email to activities:', error);
        // Don't fail the workflow if saving to activities fails
      }

      // Update entity status if configured
      if (updateStatus && context.triggerData?.entityType && context.triggerData?.entityId) {
        await this.updateEntityStatus(
          context.triggerData.entityType,
          context.triggerData.entityId,
          String(updateStatus),
          context.contractorId
        );
      }

      return {
        success: true,
        data: { to: processedTo, subject: processedSubject, messageId: result.messageId }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email'
      };
    }
  }

  /**
   * Send SMS action
   */
  private async sendSMS(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { to, message, fromNumber, updateStatus } = params;
      
      // Replace variables in fields
      const processedTo = this.replaceVariables(to, context);
      const processedMessage = this.replaceVariables(message, context);
      let processedFromNumber = fromNumber ? this.replaceVariables(fromNumber, context) : undefined;

      console.log(`[Workflow Engine] Sending SMS to ${processedTo}: ${processedMessage}`);

      // If no fromNumber override, use creator's default phone number
      if (!processedFromNumber) {
        const creator = await storage.getUser(context.workflowCreatorId);
        if (!creator || creator.contractorId !== context.contractorId) {
          return {
            success: false,
            error: 'Workflow creator not found'
          };
        }

        console.log(`[Workflow Engine] SMS: No fromNumber override. Creator:`, {
          userId: creator.id,
          dialpadDefaultNumber: creator.dialpadDefaultNumber
        });

        // Use creator's default phone number or fall back to first available
        if (creator.dialpadDefaultNumber) {
          processedFromNumber = creator.dialpadDefaultNumber;
          console.log(`[Workflow Engine] SMS: Using creator's default number: ${processedFromNumber}`);
        } else {
          // Get organization's phone numbers and use the first one
          const phoneNumbers = await storage.getDialpadPhoneNumbers(context.contractorId);
          console.log(`[Workflow Engine] SMS: No creator default. Organization has ${phoneNumbers.length} numbers`);
          if (phoneNumbers.length > 0) {
            processedFromNumber = phoneNumbers[0].phoneNumber;
            console.log(`[Workflow Engine] SMS: Using first org number: ${processedFromNumber}`);
          }
        }

        if (!processedFromNumber) {
          return {
            success: false,
            error: 'No phone number available for sending SMS. Please configure a default phone number.'
          };
        }
      }

      console.log(`[Workflow Engine] SMS: Sending with params:`, {
        to: processedTo,
        fromNumber: processedFromNumber,
        contractorId: context.contractorId
      });

      // Send SMS using provider service with creator's userId for permission checking
      const result = await providerService.sendSms({
        to: processedTo,
        message: processedMessage,
        fromNumber: processedFromNumber,
        contractorId: context.contractorId,
        userId: context.workflowCreatorId
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to send SMS'
        };
      }

      // Save SMS to messages table for conversation history
      try {
        // Try to find contact by phone number
        const contactId = await storage.findMatchingContact(context.contractorId, [], [processedTo]);

        // Normalize phone numbers for storage
        const { normalizePhoneForStorage } = await import('./utils/phone-normalizer');
        
        // Create message record
        const message = await storage.createMessage({
          type: 'text',
          status: 'sent',
          direction: 'outbound',
          content: processedMessage,
          toNumber: normalizePhoneForStorage(processedTo),
          fromNumber: normalizePhoneForStorage(processedFromNumber),
          contactId,
          userId: context.workflowCreatorId,
          externalMessageId: result.messageId
        }, context.contractorId);

        console.log(`[Workflow Engine] Saved SMS to messages (contactId: ${contactId}, messageId: ${message.id})`);

        // Broadcast message to WebSocket clients
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(context.contractorId, {
          type: 'new_message',
          message,
          contactId,
          contactType: 'lead' // Default to lead for workflow messages
        });
      } catch (error) {
        console.error('[Workflow Engine] Failed to save SMS to messages:', error);
        // Don't fail the workflow if saving to messages fails
      }

      // Update entity status if configured
      if (updateStatus && context.triggerData?.entityType && context.triggerData?.entityId) {
        await this.updateEntityStatus(
          context.triggerData.entityType,
          context.triggerData.entityId,
          String(updateStatus),
          context.contractorId
        );
      }

      return {
        success: true,
        data: { to: processedTo, message: processedMessage, messageId: result.messageId }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send SMS'
      };
    }
  }

  /**
   * Create notification action
   */
  private async createNotification(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { userId, title, message } = params;
      
      // Replace variables in title and message
      const processedTitle = this.replaceVariables(title, context);
      const processedMessage = this.replaceVariables(message, context);

      console.log(`[Workflow Engine] Creating notification for user ${userId}: ${processedTitle}`);

      // Create notification in database
      await storage.createNotification(
        {
          userId: String(userId ?? ''),
          title: processedTitle,
          message: processedMessage,
          type: 'system',
          read: false
        },
        context.contractorId
      );

      return {
        success: true,
        data: { userId, title: processedTitle }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create notification'
      };
    }
  }

  /**
   * Update entity action
   */
  private async updateEntity(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { entityType, entityId, updates } = params;
      const entityIdStr = String(entityId ?? '');

      console.log(`[Workflow Engine] Updating ${entityType} ${entityIdStr}`);

      // Update entity based on type (updates is typed as unknown from params — cast here)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typedUpdates = updates as any;
      switch (entityType) {
        case 'lead':
          await storage.updateContact(entityIdStr, typedUpdates, context.contractorId);
          break;
        case 'estimate':
          await storage.updateEstimate(entityIdStr, typedUpdates, context.contractorId);
          break;
        case 'job':
          await storage.updateJob(entityIdStr, typedUpdates, context.contractorId);
          break;
        default:
          return { success: false, error: `Unknown entity type: ${entityType}` };
      }

      return {
        success: true,
        data: { entityType, entityId }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update entity'
      };
    }
  }

  /**
   * Assign user action
   */
  private async assignUser(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { entityType, entityId, userId } = params;
      const entityIdStr = String(entityId ?? '');
      const userIdStr   = String(userId   ?? '');

      console.log(`[Workflow Engine] Assigning user ${userIdStr} to ${entityType} ${entityIdStr}`);

      // Update entity assignment
      switch (entityType) {
        case 'lead':
          // For leads, update contactedByUserId field
          await storage.updateContact(entityIdStr, { contactedByUserId: userIdStr }, context.contractorId);
          break;
        case 'estimate':
          // Estimates don't have a direct assignment field - assignment is through linked lead
          console.log(`[Workflow Engine] Note: Estimates don't have direct user assignment`);
          return { success: true, data: { entityType, entityId, note: 'Estimate assignment is indirect through lead' } };
        case 'job':
          // Jobs don't have a direct assignment field - assignment is through estimate/customer
          console.log(`[Workflow Engine] Note: Jobs don't have direct user assignment`);
          return { success: true, data: { entityType, entityId, note: 'Job assignment is indirect through estimate' } };
        default:
          return { success: false, error: `Unknown entity type: ${entityType}` };
      }

      return {
        success: true,
        data: { entityType, entityId, userId }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to assign user'
      };
    }
  }

  /**
   * AI generate content action
   */
  private async aiGenerateContent(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      // Check if AI service is available
      if (!aiService.isAvailable()) {
        return {
          success: false,
          error: 'AI service is not available - OPENAI_API_KEY not configured'
        };
      }

      const params = this.extractConfig(config);
      const { prompt, outputVariable } = params;
      
      // Replace variables in prompt
      const processedPrompt = this.replaceVariables(prompt, context);

      console.log(`[Workflow Engine] Generating AI content with prompt: ${processedPrompt.substring(0, 100)}...`);

      // Generate content using AI service
      const content = await aiService.generateContent(processedPrompt, context.triggerData);

      // Store result in context variable if specified
      if (outputVariable) {
        context.variables[String(outputVariable)] = content;
      }

      return {
        success: true,
        data: { content, outputVariable }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate AI content'
      };
    }
  }

  /**
   * AI analyze data action
   */
  private async aiAnalyze(config: unknown, context: ExecutionContext): Promise<StepResult> {
    try {
      // Check if AI service is available
      if (!aiService.isAvailable()) {
        return {
          success: false,
          error: 'AI service is not available - OPENAI_API_KEY not configured'
        };
      }

      const params = this.extractConfig(config);
      const { dataSource, analysisType, outputVariable } = params;
      
      // Get data to analyze
      let data: unknown;
      const dataSourceStr = String(dataSource ?? '');
      if (dataSourceStr === 'trigger') {
        data = context.triggerData;
      } else if (dataSourceStr.startsWith('variable.')) {
        const varName = dataSourceStr.replace('variable.', '');
        data = context.variables[varName];
      } else {
        data = dataSourceStr;
      }

      console.log(`[Workflow Engine] Analyzing data with AI (type: ${analysisType})`);

      // Analyze data using AI service
      const analysis = await aiService.analyzeData(data as Record<string, unknown>, String(analysisType ?? 'general'));

      // Store result in context variable if specified
      if (outputVariable) {
        context.variables[String(outputVariable)] = analysis;
      }

      return {
        success: true,
        data: analysis
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze data with AI'
      };
    }
  }

  /**
   * Evaluate a condition step
   */
  private async evaluateCondition(
    step: WorkflowStep,
    config: unknown,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      // NodeEditDialog saves as conditionField/conditionOperator/conditionValue;
      // fall back to legacy field/operator/value keys for backwards compatibility.
      const field    = String(params.conditionField    ?? params.field    ?? '');
      const operator = String(params.conditionOperator ?? params.operator ?? '');
      const value    =        params.conditionValue    ?? params.value;
      
      // Get field value from context
      const fieldValue = this.getFieldValue(field, context);
      
      // Evaluate condition
      let result = false;
      switch (operator) {
        case 'equals':
          result = String(fieldValue) === String(value);
          break;
        case 'not_equals':
          result = String(fieldValue) !== String(value);
          break;
        case 'contains':
          result = String(fieldValue).includes(String(value));
          break;
        case 'not_contains':
          result = !String(fieldValue).includes(String(value));
          break;
        case 'greater_than':
          result = Number(fieldValue) > Number(value);
          break;
        case 'less_than':
          result = Number(fieldValue) < Number(value);
          break;
        case 'greater_or_equal':
          result = Number(fieldValue) >= Number(value);
          break;
        case 'less_or_equal':
          result = Number(fieldValue) <= Number(value);
          break;
        case 'starts_with':
          result = String(fieldValue).startsWith(String(value));
          break;
        case 'ends_with':
          result = String(fieldValue).endsWith(String(value));
          break;
        case 'is_empty':
          result = !fieldValue || String(fieldValue).trim() === '';
          break;
        case 'is_not_empty':
          result = Boolean(fieldValue) && String(fieldValue).trim() !== '';
          break;
        default:
          return { success: false, error: `Unknown operator: ${operator}` };
      }

      console.log(`[Workflow Engine] Condition "${field} ${operator} ${value}" → ${result}`);

      return {
        success: true,
        data: { result }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to evaluate condition'
      };
    }
  }

  /**
   * Execute a delay step
   */
  private async executeDelay(
    step: WorkflowStep,
    config: unknown,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const params = this.extractConfig(config);
      const { delayType, delayValue, duration } = params;
      
      // Support both duration field (new) and delayValue field (old)
      const delayValueToUse = (duration || delayValue) as string | undefined;

      // If no delayType specified, assume 'duration' (new pattern with just duration field)
      const typeToUse = String(delayType ?? 'duration');

      if (typeToUse === 'duration' && delayValueToUse) {
        // Parse delay duration (e.g., "1h", "30m", "2d", "15 seconds")
        const delayMs = this.parseDuration(delayValueToUse);
        console.log(`[Workflow Engine] Delaying for ${delayMs}ms (${delayValueToUse})`);
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else if (typeToUse === 'until' && delayValueToUse) {
        // Delay until a specific date/time
        const targetDate = new Date(delayValueToUse);
        const now = new Date();
        const delayMs = targetDate.getTime() - now.getTime();
        
        if (delayMs > 0) {
          console.log(`[Workflow Engine] Delaying until ${targetDate.toISOString()}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute delay'
      };
    }
  }

  /**
   * Replace variables in a string template using the comprehensive variable replacer utility.
   * Accepts unknown so callers don't need to cast destructured params.
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

    // Trigger data shorthand
    if (field.startsWith('trigger.')) {
      const fieldName = field.substring(8);
      return (context.triggerData as Record<string, unknown>)[fieldName];
    }

    // Named variable shorthand
    if (field.startsWith('variable.')) {
      const varName = field.substring(9);
      return context.variables[varName];
    }

    // General dot-path navigation through context.variables (e.g. "lead.status")
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
   * Parse duration string to milliseconds
   * Supports both short format (1s, 30m, 2h, 1d) and long format (15 seconds, 1 minute, 2 hours, 3 days)
   */
  private parseDuration(duration: string): number {
    // Try short format first (e.g., "1s", "30m", "2h", "1d")
    let match = duration.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];

      switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 0;
      }
    }

    // Try long format (e.g., "15 seconds", "1 minute", "2 hours", "3 days")
    match = duration.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      switch (unit) {
        case 'second': return value * 1000;
        case 'minute': return value * 60 * 1000;
        case 'hour': return value * 60 * 60 * 1000;
        case 'day': return value * 24 * 60 * 60 * 1000;
        default: return 0;
      }
    }

    // If no match, return 0
    console.warn(`[Workflow Engine] Could not parse duration: ${duration}`);
    return 0;
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
   * Trigger workflows based on entity events (contact_created, contact_updated, etc.)
   */
  async triggerWorkflowsForEvent(
    eventType: 'contact_created' | 'contact_updated' | 'contact_status_changed' | 'estimate_created' | 'estimate_updated' | 'estimate_status_changed' | 'job_created' | 'job_updated' | 'job_status_changed',
    entityData: Record<string, unknown>,
    contractorId: string
  ): Promise<void> {
    try {
      // Map event types to entity types and events
      const eventMapping: Record<string, { entity: string; event: string }> = {
        'contact_created':          { entity: 'lead',     event: 'created' },
        'contact_updated':          { entity: 'lead',     event: 'updated' },
        'contact_status_changed':   { entity: 'lead',     event: 'status_changed' },
        'estimate_created':         { entity: 'estimate', event: 'created' },
        'estimate_updated':         { entity: 'estimate', event: 'updated' },
        'estimate_status_changed':  { entity: 'estimate', event: 'status_changed' },
        'job_created':              { entity: 'job',      event: 'created' },
        'job_updated':              { entity: 'job',      event: 'updated' },
        'job_status_changed':       { entity: 'job',      event: 'status_changed' },
      };

      const mapping = eventMapping[eventType];
      if (!mapping) {
        console.log(`[Workflow Engine] Unknown event type: ${eventType}`);
        return;
      }

      // Find all active, approved workflows for this contractor
      const allWorkflows = await storage.getWorkflows(contractorId);
      
      // Filter workflows that match this trigger
      const matchingWorkflows = allWorkflows.filter(workflow => {
        if (!workflow.isActive || workflow.approvalStatus !== 'approved') {
          return false;
        }

        const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};
        
        // Support both schema variants:
        // New: { entity: 'lead', event: 'created' }
        // Legacy: { type: 'entity_event', entity: 'lead', action: 'created' }
        const matchesNewSchema = triggerConfig.entity === mapping.entity && triggerConfig.event === mapping.event;
        const matchesLegacySchema = triggerConfig.type === 'entity_event' && 
                                     triggerConfig.entity === mapping.entity && 
                                     triggerConfig.action === mapping.event;
        
        let matchesTrigger = matchesNewSchema || matchesLegacySchema;
        if (!matchesTrigger) {
          return false;
        }

        // For status_changed events, also enforce targetStatus if the workflow specifies one
        if (triggerConfig.event === 'status_changed' && triggerConfig.targetStatus) {
          const newStatus = entityData.status;
          if (newStatus !== triggerConfig.targetStatus) {
            return false;
          }
        }
        
        // Check tag filtering if specified
        // triggerConfig.tags = ['Ductless', 'Emergency'] means workflow only runs for contacts with those tags
        if (triggerConfig.tags && Array.isArray(triggerConfig.tags) && triggerConfig.tags.length > 0) {
          // Get contact tags from entityData (for contacts) or entityData.contact (for estimates/jobs)
          const contactRecord = entityData.contact as Record<string, unknown> | undefined;
          const contactTags = (entityData.tags as string[] | undefined) || (contactRecord?.tags as string[] | undefined) || [];
          
          // Check if contact has at least one of the required tags
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

      // Create and execute workflow for each match
      for (const workflow of matchingWorkflows) {
        try {
          // For contact events, fetch the full contact with enriched data if needed
          let triggerData = entityData;
          if (eventType.startsWith('contact_') && entityData.type === 'lead') {
            // For contacts (leads), use the contact data directly
            triggerData = entityData;
          } else if (eventType.startsWith('estimate_')) {
            // For estimates, fetch with contact data
            const enrichedEstimate = await storage.getEstimateWithContact(String(entityData.id), contractorId);
            triggerData = (enrichedEstimate as Record<string, unknown> | null) || entityData;
          } else if (eventType.startsWith('job_')) {
            // For jobs, fetch with contact data
            const enrichedJob = await storage.getJobWithContact(String(entityData.id), contractorId);
            triggerData = (enrichedJob as Record<string, unknown> | null) || entityData;
          }

          // Create execution record
          const execution = await storage.createWorkflowExecution(
            {
              workflowId: workflow.id,
              status: 'pending',
              triggerData: JSON.stringify(triggerData),
            },
            contractorId
          );

          console.log(`[Workflow Engine] Triggered workflow "${workflow.name}" (ID: ${workflow.id}) for ${eventType}`);

          // Execute workflow asynchronously with tenant isolation
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
