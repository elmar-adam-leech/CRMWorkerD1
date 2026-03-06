import { storage } from '../storage';
import { db } from '../db';
import { users, activities } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { withRetry } from '../utils/retry';

export async function syncGmail(tenantId: string): Promise<void> {
  console.log(`[sync-scheduler] Syncing Gmail emails for tenant ${tenantId}`);

  try {
    const { gmailService } = await import('../gmail-service');

    const gmailUsers = await db.select().from(users).where(and(
      eq(users.contractorId, tenantId),
      eq(users.gmailConnected, true)
    ));

    if (gmailUsers.length === 0) {
      console.log(`[sync-scheduler] No Gmail users found for tenant ${tenantId}`);
      return;
    }

    console.log(`[sync-scheduler] Found ${gmailUsers.length} Gmail users to sync`);

    for (const user of gmailUsers) {
      if (!user.gmailRefreshToken) {
        console.log(`[sync-scheduler] Skipping user ${user.id} - no refresh token`);
        continue;
      }

      try {
        console.log(`[sync-scheduler] Syncing emails for user ${user.name} (${user.gmailEmail})`);
        const since = user.gmailLastSyncAt || undefined;
        console.log(`[sync-scheduler] Last sync at: ${since?.toISOString() || 'never'}`);

        const result = await withRetry(
          () => gmailService.fetchNewEmails(user.gmailRefreshToken!, since),
          `fetchNewEmails for ${user.name}`
        );

        if (result.tokenExpired) {
          console.log(`[sync-scheduler] Gmail token expired for user ${user.name}, marking as disconnected and sending notification`);

          await db.update(users)
            .set({ gmailConnected: false, gmailRefreshToken: null })
            .where(eq(users.id, user.id));

          await storage.createNotification({
            userId: user.id,
            type: 'system',
            title: 'Gmail Reconnection Required',
            message: 'Your Gmail connection has expired. Please reconnect your Gmail account in Settings to continue syncing emails.',
            link: '/settings',
          }, tenantId);

          console.log(`[sync-scheduler] User ${user.name} notified about Gmail reconnection`);
          continue;
        }

        const emails = result.emails;
        console.log(`[sync-scheduler] Found ${emails.length} new emails for user ${user.name}`);

        // Batch dedup: one query for all email IDs instead of one per email
        const allEmailIds = emails.map((e: any) => e.id).filter(Boolean);
        let knownEmailIds = new Set<string>();
        if (allEmailIds.length > 0) {
          const existingRows = await db
            .select({ externalId: activities.externalId })
            .from(activities)
            .where(and(
              inArray(activities.externalId, allEmailIds),
              eq(activities.externalSource, 'gmail'),
              eq(activities.contractorId, tenantId),
            ));
          knownEmailIds = new Set(existingRows.map(r => r.externalId!));
        }

        // Collect all activity records for the emails, then insert them in one
        // bulk INSERT instead of one INSERT per email. For a user with 100 new
        // emails this reduces DB round-trips from 100 sequential INSERTs to 1.
        type ActivityPayload = Parameters<typeof storage.createActivity>[0];
        const activitiesToInsert: ActivityPayload[] = [];

        for (const email of emails) {
          if (knownEmailIds.has(email.id)) {
            continue;
          }

          const fromEmail = email.from;
          const toEmails = email.to || [];
          const isOutbound = fromEmail.toLowerCase() === user.gmailEmail?.toLowerCase();

          const emailsToSearch = isOutbound ? toEmails : (fromEmail ? [fromEmail] : []);
          const matchedContactId = emailsToSearch.length > 0
            ? await storage.findMatchingContact(tenantId, emailsToSearch, [])
            : null;
          const matchingContact = matchedContactId
            ? await storage.getContact(matchedContactId, tenantId)
            : undefined;

          if (!matchingContact) {
            continue;
          }

          const emailMetadata = {
            subject: email.subject,
            to: email.to,
            from: email.from,
            messageId: email.id,
            direction: isOutbound ? 'outbound' : 'inbound',
          };

          activitiesToInsert.push({
            type: 'email',
            title: isOutbound ? `Email sent: ${email.subject}` : `Email received: ${email.subject}`,
            content: email.body,
            metadata: JSON.stringify(emailMetadata),
            contactId: matchingContact.id,
            estimateId: null,
            userId: user.id,
            externalId: email.id,
            externalSource: 'gmail',
          });
        }

        // Single bulk INSERT for all new emails this sync run
        if (activitiesToInsert.length > 0) {
          await storage.bulkCreateActivities(activitiesToInsert, tenantId);
        }
        const processedCount = activitiesToInsert.length;

        await db.update(users)
          .set({ gmailLastSyncAt: new Date() })
          .where(eq(users.id, user.id));

        console.log(`[sync-scheduler] Processed ${processedCount} emails for user ${user.name}`);
      } catch (userError: any) {
        console.error(`[sync-scheduler] Error syncing Gmail for user ${user.name} (${user.gmailEmail}):`, {
          message: userError.message,
          code: userError.code,
          status: userError.status,
          errors: userError.errors,
        });
      }
    }
  } catch (error: any) {
    console.error(`[sync-scheduler] Error in Gmail sync:`, {
      message: error.message,
      code: error.code,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
    });
    throw error;
  }
}
