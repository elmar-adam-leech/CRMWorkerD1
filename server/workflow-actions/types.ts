export interface ExecutionContext {
  workflowId: string;
  executionId: string;
  contractorId: string;
  workflowCreatorId: string;
  triggerEntityType: string;
  triggerData: any;
  variables: Record<string, any>;
}

export interface StepResult {
  success: boolean;
  error?: string;
  data?: any;
}
