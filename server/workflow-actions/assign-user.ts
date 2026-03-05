import { storage } from "../storage";
import type { ExecutionContext, StepResult } from "./types";

export async function handleAssignUser(
  config: Record<string, unknown>,
  context: ExecutionContext
): Promise<StepResult> {
  try {
    const { entityType, entityId, userId } = config;
    const entityIdStr = String(entityId ?? context.triggerData?.id ?? '');
    const userIdStr = String(userId ?? '');
    const resolvedEntityType = String(entityType ?? context.triggerEntityType ?? 'lead');

    if (!userIdStr) {
      return { success: false, error: 'Cannot assign user: no userId configured on this node' };
    }
    if (!entityIdStr) {
      return { success: false, error: 'Cannot assign user: no entity ID available (trigger entity has no id)' };
    }

    console.log(`[Workflow Engine] Assigning user ${userIdStr} to ${resolvedEntityType} ${entityIdStr}`);

    switch (resolvedEntityType) {
      case 'lead':
        await storage.updateContact(entityIdStr, { contactedByUserId: userIdStr }, context.contractorId);
        break;
      case 'estimate':
        console.log(`[Workflow Engine] Note: Estimates don't have direct user assignment`);
        return {
          success: true,
          data: { entityType: resolvedEntityType, entityId: entityIdStr, note: 'Estimate assignment is indirect through lead' },
        };
      case 'job':
        console.log(`[Workflow Engine] Note: Jobs don't have direct user assignment`);
        return {
          success: true,
          data: { entityType: resolvedEntityType, entityId: entityIdStr, note: 'Job assignment is indirect through estimate' },
        };
      default:
        return { success: false, error: `Unknown entity type: ${resolvedEntityType}` };
    }

    return { success: true, data: { entityType: resolvedEntityType, entityId: entityIdStr, userId: userIdStr } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to assign user',
    };
  }
}
