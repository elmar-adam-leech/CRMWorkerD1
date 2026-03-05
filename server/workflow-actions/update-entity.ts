import { storage } from "../storage";
import type { ExecutionContext, StepResult } from "./types";

export async function handleUpdateEntity(
  config: Record<string, unknown>,
  context: ExecutionContext
): Promise<StepResult> {
  try {
    const { entityType, entityId, updates } = config;
    const entityIdStr = String(entityId ?? context.triggerData?.id ?? '');
    const resolvedEntityType = String(entityType ?? context.triggerEntityType ?? 'lead');

    if (!entityIdStr) {
      return { success: false, error: 'Cannot update entity: no entity ID available (trigger entity has no id)' };
    }

    console.log(`[Workflow Engine] Updating ${resolvedEntityType} ${entityIdStr}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typedUpdates = updates as any;
    switch (resolvedEntityType) {
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
        return { success: false, error: `Unknown entity type: ${resolvedEntityType}` };
    }

    return { success: true, data: { entityType: resolvedEntityType, entityId: entityIdStr } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update entity',
    };
  }
}
