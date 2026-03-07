export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  contractorId: string;
  workflowCreatorId: string;
  triggerEntityType: string;
  triggerData: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export interface StepResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}
