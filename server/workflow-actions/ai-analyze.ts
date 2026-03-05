import { aiService } from "../ai-service";
import type { ExecutionContext, StepResult } from "./types";

export async function handleAiAnalyze(
  config: Record<string, unknown>,
  context: ExecutionContext
): Promise<StepResult> {
  try {
    if (!aiService.isAvailable()) {
      return { success: false, error: 'AI service is not available - OPENAI_API_KEY not configured' };
    }

    const { dataSource, analysisType, outputVariable } = config;

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

    const analysis = await aiService.analyzeData(
      data as Record<string, unknown>,
      String(analysisType ?? 'general')
    );

    if (outputVariable) {
      context.variables[String(outputVariable)] = analysis;
    }

    return { success: true, data: analysis };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to analyze data with AI',
    };
  }
}
