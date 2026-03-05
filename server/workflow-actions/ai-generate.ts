import { aiService } from "../ai-service";
import type { ExecutionContext, StepResult } from "./types";

export async function handleAiGenerateContent(
  config: Record<string, unknown>,
  context: ExecutionContext,
  replaceVariables: (template: unknown, ctx: ExecutionContext) => string
): Promise<StepResult> {
  try {
    if (!aiService.isAvailable()) {
      return { success: false, error: 'AI service is not available - OPENAI_API_KEY not configured' };
    }

    const { prompt, outputVariable } = config;
    const processedPrompt = replaceVariables(prompt, context);

    console.log(`[Workflow Engine] Generating AI content with prompt: ${processedPrompt.substring(0, 100)}...`);

    const content = await aiService.generateContent(processedPrompt, context.triggerData);

    if (outputVariable) {
      context.variables[String(outputVariable)] = content;
    }

    return { success: true, data: { content, outputVariable } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate AI content',
    };
  }
}
