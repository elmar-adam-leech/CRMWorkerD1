import { storage } from "../storage";
import { gmailService } from "../gmail-service";
import type { ExecutionContext, StepResult } from "./types";
import { logger } from "../utils/logger";

const log = logger('WorkflowAction:SendEmail');

export async function handleSendEmail(
  config: Record<string, unknown>,
  context: ExecutionContext,
  replaceVariables: (template: unknown, ctx: ExecutionContext) => string,
  updateEntityStatus: (entityType: string, entityId: string, status: string, contractorId: string) => Promise<void>
): Promise<StepResult> {
  try {
    const { to, subject, body, fromEmail, updateStatus } = config;

    const processedTo = replaceVariables(to, context);
    const processedSubject = replaceVariables(subject, context);
    const processedBody = replaceVariables(body, context);
    const processedFromEmail = fromEmail ? replaceVariables(fromEmail, context) : undefined;

    console.log(`[Workflow Engine] Email config:`, {
      originalTo: to,
      processedTo,
      subject: processedSubject,
      variables: context.variables,
    });

    if (!processedTo || processedTo.trim() === '') {
      return { success: false, error: 'Recipient address required' };
    }

    const creator = await storage.getUser(context.workflowCreatorId);
    if (!creator || creator.contractorId !== context.contractorId) {
      return { success: false, error: 'Workflow creator not found' };
    }

    if (!creator.gmailRefreshToken) {
      return {
        success: false,
        error: `Workflow creator ${creator.name} has not connected their Gmail account`,
      };
    }

    const result = await gmailService.sendEmail({
      to: processedTo,
      subject: processedSubject,
      content: processedBody,
      refreshToken: creator.gmailRefreshToken,
      fromEmail: processedFromEmail,
      fromName: creator.name,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send email' };
    }

    // The email was sent successfully. Now attempt to persist an activity record
    // so it appears in the contact's history. This is best-effort: a DB failure
    // here must NOT mark the step as failed (the email was already delivered).
    // Instead, record a saveWarning in the returned data so the workflow
    // execution audit log captures it for operator review.
    let saveWarning: string | undefined;
    try {
      const emails = processedTo.split(',').map((e: string) => e.trim());
      let contactId: string | null = null;

      for (const email of emails) {
        const matchedContactId = await storage.findMatchingContact(context.contractorId, [email], []);
        if (matchedContactId) {
          contactId = matchedContactId;
          break;
        }
      }

      await storage.createActivity(
        {
          type: 'email',
          title: `Email sent: ${processedSubject}`,
          content: processedBody,
          metadata: JSON.stringify({
            subject: processedSubject,
            to: [processedTo],
            from: processedFromEmail || creator.email,
            messageId: result.messageId,
            direction: 'outbound',
          }),
          contactId,
          userId: context.workflowCreatorId,
        },
        context.contractorId
      );

      log.info(`Saved email to activities (contactId: ${contactId})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      saveWarning = `Failed to save activity record: ${msg}`;
      log.error('Failed to save email to activities — email was sent but will not appear in contact history', { error });
    }

    if (updateStatus && context.triggerData?.id) {
      await updateEntityStatus(
        context.triggerEntityType,
        String(context.triggerData.id),
        String(updateStatus),
        context.contractorId
      );
    }

    return {
      success: true,
      data: { to: processedTo, subject: processedSubject, messageId: result.messageId, ...(saveWarning ? { saveWarning } : {}) },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}
