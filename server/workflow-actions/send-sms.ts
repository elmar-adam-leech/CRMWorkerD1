import { storage } from "../storage";
import { providerService } from "../providers/provider-service";
import type { ExecutionContext, StepResult } from "./types";
import { normalizePhoneForStorage } from "../utils/phone-normalizer";
import { logger } from "../utils/logger";

const log = logger('WorkflowAction:SendSMS');

export async function handleSendSMS(
  config: Record<string, unknown>,
  context: ExecutionContext,
  replaceVariables: (template: unknown, ctx: ExecutionContext) => string,
  updateEntityStatus: (entityType: string, entityId: string, status: string, contractorId: string) => Promise<void>
): Promise<StepResult> {
  try {
    const { to, message, fromNumber, updateStatus } = config;

    const processedTo = replaceVariables(to, context);
    const processedMessage = replaceVariables(message, context);
    let processedFromNumber = fromNumber ? replaceVariables(fromNumber, context) : undefined;

    console.log(`[Workflow Engine] Sending SMS to ${processedTo}: ${processedMessage}`);

    if (!processedFromNumber) {
      const creator = await storage.getUser(context.workflowCreatorId);
      if (!creator || creator.contractorId !== context.contractorId) {
        return { success: false, error: 'Workflow creator not found' };
      }

      console.log(`[Workflow Engine] SMS: No fromNumber override. Creator:`, {
        userId: creator.id,
        dialpadDefaultNumber: creator.dialpadDefaultNumber,
      });

      if (creator.dialpadDefaultNumber) {
        processedFromNumber = creator.dialpadDefaultNumber;
        console.log(`[Workflow Engine] SMS: Using creator's default number: ${processedFromNumber}`);
      } else {
        const phoneNumbers = await storage.getDialpadPhoneNumbers(context.contractorId);
        console.log(`[Workflow Engine] SMS: No creator default. Organization has ${phoneNumbers.length} numbers`);
        if (phoneNumbers.length > 0) {
          processedFromNumber = phoneNumbers[0].phoneNumber;
          console.log(`[Workflow Engine] SMS: Using first org number: ${processedFromNumber}`);
        }
      }

      if (!processedFromNumber) {
        return {
          success: false,
          error: 'No phone number available for sending SMS. Please configure a default phone number.',
        };
      }
    }

    console.log(`[Workflow Engine] SMS: Sending with params:`, {
      to: processedTo,
      fromNumber: processedFromNumber,
      contractorId: context.contractorId,
    });

    const result = await providerService.sendSms({
      to: processedTo,
      message: processedMessage,
      fromNumber: processedFromNumber,
      contractorId: context.contractorId,
      userId: context.workflowCreatorId,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send SMS' };
    }

    // The SMS was sent successfully. Now attempt to persist a message record
    // so it appears in the conversation thread. This is best-effort: a DB
    // failure here must NOT mark the step as failed (the message was already
    // delivered). Instead, record a saveWarning in the returned data so the
    // workflow execution audit log captures it for operator review.
    let saveWarning: string | undefined;
    try {
      const contactId = await storage.findMatchingContact(context.contractorId, [], [processedTo]);
      const msg = await storage.createMessage(
        {
          type: 'text',
          status: 'sent',
          direction: 'outbound',
          content: processedMessage,
          toNumber: normalizePhoneForStorage(processedTo),
          fromNumber: normalizePhoneForStorage(processedFromNumber),
          contactId,
          userId: context.workflowCreatorId,
          externalMessageId: result.messageId,
        },
        context.contractorId
      );

      log.info(`Saved SMS to messages (contactId: ${contactId}, messageId: ${msg.id})`);

      const { broadcastToContractor } = await import('../websocket');
      broadcastToContractor(context.contractorId, {
        type: 'new_message',
        message: msg,
        contactId,
        contactType: 'lead',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      saveWarning = `Failed to save message record: ${msg}`;
      log.error('Failed to save SMS to messages — message was sent but will not appear in conversation thread', { error });
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
      data: { to: processedTo, message: processedMessage, messageId: result.messageId, ...(saveWarning ? { saveWarning } : {}) },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}
