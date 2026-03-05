import { storage } from "../storage";
import type { ExecutionContext, StepResult } from "./types";

export async function handleCreateNotification(
  config: Record<string, unknown>,
  context: ExecutionContext,
  replaceVariables: (template: unknown, ctx: ExecutionContext) => string
): Promise<StepResult> {
  try {
    const { userId, title, message } = config;

    const processedTitle = replaceVariables(title, context);
    const processedMessage = replaceVariables(message, context);

    console.log(`[Workflow Engine] Creating notification for user ${userId}: ${processedTitle}`);

    await storage.createNotification(
      {
        userId: String(userId ?? ''),
        title: processedTitle,
        message: processedMessage,
        type: 'system',
        read: false,
      },
      context.contractorId
    );

    return { success: true, data: { userId, title: processedTitle } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create notification',
    };
  }
}
