import type { WorkflowStep } from "@shared/schema";
import type { ExecutionContext, StepResult } from "./types";

export function parseDuration(duration: string): number {
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

  match = duration.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 'second': return value * 1000;
      case 'minute': return value * 60 * 1000;
      case 'hour':   return value * 60 * 60 * 1000;
      case 'day':    return value * 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  console.warn(`[Workflow Engine] Could not parse duration: ${duration}`);
  return 0;
}

export async function handleDelay(
  step: WorkflowStep,
  config: Record<string, unknown>
): Promise<StepResult> {
  try {
    const { delayType, delayValue, duration, dateTime } = config;
    const delayValueToUse = (duration || delayValue) as string | undefined;
    const typeToUse = String(delayType ?? 'duration');

    if ((typeToUse === 'until' || step.actionType === 'wait_until') && (delayValueToUse || dateTime)) {
      const rawDate = String(dateTime ?? delayValueToUse ?? '');
      const targetDate = new Date(rawDate);
      const now = new Date();
      const delayMs = targetDate.getTime() - now.getTime();

      if (delayMs > 0) {
        console.log(`[Workflow Engine] Waiting until ${targetDate.toISOString()} (${delayMs}ms)`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.log(`[Workflow Engine] waitUntil target date is in the past (${targetDate.toISOString()}), skipping delay`);
      }
    } else if (typeToUse === 'duration' && delayValueToUse) {
      const delayMs = parseDuration(delayValueToUse);
      if (delayMs > 0) {
        console.log(`[Workflow Engine] Delaying for ${delayMs}ms (${delayValueToUse})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } else {
      console.warn(`[Workflow Engine] Delay node has no valid duration or dateTime configured — skipping`);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute delay',
    };
  }
}
