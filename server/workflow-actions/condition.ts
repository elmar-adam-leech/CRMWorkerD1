import type { WorkflowStep } from "@shared/schema";
import type { ExecutionContext, StepResult } from "./types";

export async function handleEvaluateCondition(
  step: WorkflowStep,
  config: Record<string, unknown>,
  context: ExecutionContext,
  getFieldValue: (field: string, ctx: ExecutionContext) => unknown
): Promise<StepResult> {
  try {
    const field    = String(config.conditionField    ?? config.field    ?? '');
    const operator = String(config.conditionOperator ?? config.operator ?? '');
    const value    =        config.conditionValue    ?? config.value;

    const fieldValue = getFieldValue(field, context);

    let result = false;
    switch (operator) {
      case 'equals':         result = String(fieldValue) === String(value); break;
      case 'not_equals':     result = String(fieldValue) !== String(value); break;
      case 'contains':       result = String(fieldValue).includes(String(value)); break;
      case 'not_contains':   result = !String(fieldValue).includes(String(value)); break;
      case 'greater_than':   result = Number(fieldValue) > Number(value); break;
      case 'less_than':      result = Number(fieldValue) < Number(value); break;
      case 'greater_or_equal': result = Number(fieldValue) >= Number(value); break;
      case 'less_or_equal':  result = Number(fieldValue) <= Number(value); break;
      case 'starts_with':    result = String(fieldValue).startsWith(String(value)); break;
      case 'ends_with':      result = String(fieldValue).endsWith(String(value)); break;
      case 'is_empty':       result = !fieldValue || String(fieldValue).trim() === ''; break;
      case 'is_not_empty':   result = Boolean(fieldValue) && String(fieldValue).trim() !== ''; break;
      default:
        return { success: false, error: `Unknown operator: ${operator}` };
    }

    console.log(`[Workflow Engine] Condition "${field} ${operator} ${value}" → ${result}`);

    return { success: true, data: { result } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to evaluate condition',
    };
  }
}
