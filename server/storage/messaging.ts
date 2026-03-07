import {
  type Message, type InsertMessage,
  type Call, type InsertCall,
  messages, calls, activities, contacts, users,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, inArray, like, sql } from "drizzle-orm";
import type { UpdateCall } from "../storage-types";

// Row limits for non-paginated queries. These prevent runaway memory usage on
// large tenants and act as a safety valve. Each is accompanied by a note on
// where to add cursor-based pagination if the limit becomes a bottleneck.
//
// TODO: Replace conversation/call queries with cursor-based pagination when
// individual tenant call volumes reliably exceed these thresholds.
const CONVERSATION_MESSAGE_LIMIT = 500;  // per conversation view
const CALLS_LIMIT = 500;                 // safety cap on calls list
const CONVERSATIONS_PAGE_LIMIT = 50;     // max conversations shown on the list page

async function getMessages(contractorId: string, contactId?: string, estimateId?: string): Promise<Message[]> {
  const conditions = [eq(messages.contractorId, contractorId)];
  if (contactId) conditions.push(eq(messages.contactId, contactId));
  if (estimateId) conditions.push(eq(messages.estimateId, estimateId));
  return await db.select().from(messages)
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(200);
}

async function getMessage(id: string, contractorId: string): Promise<Message | undefined> {
  const result = await db.select().from(messages).where(and(
    eq(messages.id, id),
    eq(messages.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function createMessage(message: Omit<InsertMessage, 'contractorId'>, contractorId: string): Promise<Message> {
  const result = await db.insert(messages).values({ ...message, contractorId }).returning();
  return result[0];
}

async function getAllMessages(contractorId: string, options: {
  type?: 'text' | 'email';
  status?: 'sent' | 'delivered' | 'failed';
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<Message[]> {
  const conditions = [eq(messages.contractorId, contractorId)];
  if (options.type) conditions.push(eq(messages.type, options.type));
  if (options.status) conditions.push(eq(messages.status, options.status));
  if (options.search) {
    conditions.push(like(sql`lower(${messages.content})`, `%${options.search.toLowerCase()}%`));
  }
  return await db.select().from(messages).where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(options.limit || 50)
    .offset(options.offset || 0);
}

// Private helper: maps a joined Activity row (with userName from users join) to a Message shape
function emailActivityToMessage(activity: {
  id: string;
  content: string | null;
  contactId: string | null;
  estimateId: string | null;
  userId: string | null;
  contractorId: string;
  createdAt: Date;
  metadata: string | null;
  userName: string | null;
}): Message {
  const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
  return {
    id: activity.id,
    type: 'email' as const,
    status: 'sent' as const,
    direction: metadata.direction || 'outbound',
    content: activity.content || '',
    toNumber: metadata.to?.[0] || '',
    fromNumber: metadata.from || '',
    contactId: activity.contactId,
    estimateId: activity.estimateId,
    userId: activity.userId,
    externalMessageId: metadata.messageId || null,
    contractorId: activity.contractorId,
    createdAt: activity.createdAt,
    userName: activity.userName,
  } as Message;
}

// DONE (scale refactored 2026): getConversations now uses a single DB-side UNION ALL
// query to discover the top N conversations, replacing the old approach of fetching up
// to 2000 rows (500 SMS + 500 email × 2 code paths) and merging them in-memory.
//
// Architecture:
//   1. UNION ALL SQL — groups messages + email-activities by contact_id, returning
//      MAX(created_at) per contact. Postgres returns at most CONVERSATIONS_PAGE_LIMIT
//      rows over the wire. The existing contractor_contact_created index covers both branches.
//   2. Two Drizzle ORM batch queries (inArray on the ≤50 contact_ids) fetch the recent
//      messages for last-message preview. Results are already ordered DESC, so Node just
//      picks the first occurrence per contactId in a single O(n) pass.
//   3. One contact info lookup (inArray).
//   = 4 DB round-trips total, O(CONVERSATIONS_PAGE_LIMIT) rows over the wire for step 1.
//
// LONG TERM: Introduce a denormalized `conversations` table (one row per contractor_id +
// contact_id with last_message_at and unread_count) updated by triggers or background
// jobs. The list page then reads only that table (tiny scan). See SendBird / Twilio
// Conversations for reference implementations.
async function getConversations(contractorId: string, options: {
  search?: string;
  type?: 'text' | 'email';
  status?: 'sent' | 'delivered' | 'failed';
} = {}): Promise<Array<{
  contactId: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  lastMessage: Message;
  unreadCount: number;
  totalMessages: number;
}>> {
  const { search, type, status } = options;

  // Build each UNION branch with its WHERE conditions. Skip a branch entirely
  // when the type filter makes it irrelevant (emit a no-row placeholder).
  const smsBranch = type === 'email'
    ? sql`SELECT NULL::varchar AS contact_id, NULL::timestamptz AS last_ts WHERE FALSE`
    : sql`SELECT contact_id, MAX(created_at) AS last_ts FROM messages WHERE contractor_id = ${contractorId} AND contact_id IS NOT NULL ${status ? sql`AND status = ${status}` : sql``} ${search ? sql`AND lower(content) LIKE ${`%${search.toLowerCase()}%`}` : sql``} GROUP BY contact_id`;

  const emailBranch = type === 'text'
    ? sql`SELECT NULL::varchar AS contact_id, NULL::timestamptz AS last_ts WHERE FALSE`
    : sql`SELECT contact_id, MAX(created_at) AS last_ts FROM activities WHERE contractor_id = ${contractorId} AND type = 'email' AND contact_id IS NOT NULL ${search ? sql`AND lower(content) LIKE ${`%${search.toLowerCase()}%`}` : sql``} GROUP BY contact_id`;

  // Single DB round-trip: find the top N contacts by most recent activity.
  type TopConvRow = { contact_id: string; last_ts: string };
  const topConvResult = await db.execute<TopConvRow>(sql`
    SELECT contact_id, MAX(last_ts) AS last_ts
    FROM (${smsBranch} UNION ALL ${emailBranch}) combined
    WHERE contact_id IS NOT NULL
    GROUP BY contact_id
    ORDER BY last_ts DESC
    LIMIT ${CONVERSATIONS_PAGE_LIMIT}
  `);

  const topContactIds = topConvResult.rows.map((r) => r.contact_id);
  if (topContactIds.length === 0) return [];

  // Batch-fetch recent messages for the top contacts. Rows are already sorted
  // DESC so the first row per contactId is the most recent message.
  // Bounded by inArray(≤50 contactIds) × CONVERSATION_MESSAGE_LIMIT.
  const [smsRows, emailActivityRows, contactRows] = await Promise.all([
    type === 'email' ? Promise.resolve([]) :
      db.select({
        id: messages.id, type: messages.type, status: messages.status,
        direction: messages.direction, content: messages.content,
        toNumber: messages.toNumber, fromNumber: messages.fromNumber,
        contactId: messages.contactId, estimateId: messages.estimateId,
        userId: messages.userId, externalMessageId: messages.externalMessageId,
        contractorId: messages.contractorId, createdAt: messages.createdAt,
        userName: users.name,
      })
      .from(messages)
      .leftJoin(users, eq(messages.userId, users.id))
      .where(and(eq(messages.contractorId, contractorId), inArray(messages.contactId, topContactIds)))
      .orderBy(desc(messages.createdAt))
      .limit(CONVERSATION_MESSAGE_LIMIT),

    type === 'text' ? Promise.resolve([]) :
      db.select({
        id: activities.id, content: activities.content,
        contactId: activities.contactId, estimateId: activities.estimateId,
        userId: activities.userId, contractorId: activities.contractorId,
        createdAt: activities.createdAt, metadata: activities.metadata,
        userName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(and(
        eq(activities.contractorId, contractorId),
        eq(activities.type, 'email'),
        inArray(activities.contactId, topContactIds),
      ))
      .orderBy(desc(activities.createdAt))
      .limit(CONVERSATION_MESSAGE_LIMIT),

    db.select({ id: contacts.id, name: contacts.name, phones: contacts.phones, emails: contacts.emails })
      .from(contacts)
      .where(and(inArray(contacts.id, topContactIds), eq(contacts.contractorId, contractorId))),
  ]);

  // O(n) pass: pick the first (most recent) message per contactId.
  const lastSmsPerContact = new Map<string, Message>();
  for (const row of smsRows) {
    if (row.contactId && !lastSmsPerContact.has(row.contactId)) {
      lastSmsPerContact.set(row.contactId, row as Message);
    }
  }

  const lastEmailPerContact = new Map<string, Message>();
  for (const row of emailActivityRows) {
    if (row.contactId && !lastEmailPerContact.has(row.contactId)) {
      lastEmailPerContact.set(row.contactId, emailActivityToMessage(row as Parameters<typeof emailActivityToMessage>[0]));
    }
  }

  const contactLookup = new Map(contactRows.map((c) => [c.id, c]));

  // Build result in the sort order determined by the UNION query (most recent first).
  const conversations: Array<{
    contactId: string; contactName: string; contactPhone?: string;
    contactEmail?: string; lastMessage: Message; unreadCount: number; totalMessages: number;
  }> = [];

  for (const { contact_id } of topConvResult.rows) {
    const contact = contactLookup.get(contact_id);
    const lastSms = lastSmsPerContact.get(contact_id);
    const lastEmail = lastEmailPerContact.get(contact_id);

    const candidates = [lastSms, lastEmail].filter((m): m is Message => m !== undefined);
    if (candidates.length === 0) continue;

    const lastMessage = candidates.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    conversations.push({
      contactId: contact_id,
      contactName: contact?.name ?? 'Unknown',
      contactPhone: contact?.phones?.[0] ?? undefined,
      contactEmail: contact?.emails?.[0] ?? undefined,
      lastMessage,
      unreadCount: 0,
      totalMessages: (lastSms ? 1 : 0) + (lastEmail ? 1 : 0),
    });
  }

  return conversations;
}

async function getConversationMessages(contractorId: string, contactId: string): Promise<Message[]> {
  console.log(`[getConversationMessages] Called with contactId: ${contactId}`);

  const contact = await db.select({ phones: contacts.phones, emails: contacts.emails })
    .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.contractorId, contractorId))).limit(1);

  const contactPhones = contact[0]?.phones || [];
  const contactEmails = contact[0]?.emails || [];
  console.log(`[getConversationMessages] Contact phones: ${JSON.stringify(contactPhones)}, emails: ${JSON.stringify(contactEmails)}`);

  const [smsMessages, emailActivities] = await Promise.all([
    db.select({
      id: messages.id, type: messages.type, status: messages.status, direction: messages.direction,
      content: messages.content, toNumber: messages.toNumber, fromNumber: messages.fromNumber,
      contactId: messages.contactId, estimateId: messages.estimateId, userId: messages.userId,
      externalMessageId: messages.externalMessageId, contractorId: messages.contractorId,
      createdAt: messages.createdAt, userName: users.name,
    }).from(messages).leftJoin(users, eq(messages.userId, users.id))
      .where(and(eq(messages.contractorId, contractorId), eq(messages.contactId, contactId)))
      .orderBy(desc(messages.createdAt))
      .limit(CONVERSATION_MESSAGE_LIMIT),
    db.select({
      id: activities.id, content: activities.content, contactId: activities.contactId,
      estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
      createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
    }).from(activities).leftJoin(users, eq(activities.userId, users.id))
      .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email'), eq(activities.contactId, contactId)))
      .orderBy(desc(activities.createdAt))
      .limit(CONVERSATION_MESSAGE_LIMIT),
  ]);

  console.log(`[getConversationMessages] Found ${smsMessages.length} SMS messages`);

  const emailMessages = emailActivities.map(emailActivityToMessage);

  const allMessages = [...smsMessages, ...emailMessages as Message[]];
  allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return allMessages;
}

async function getConversationMessageCount(contractorId: string, contactId: string): Promise<number> {
  const [smsResult, emailResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(messages)
      .where(and(eq(messages.contractorId, contractorId), eq(messages.contactId, contactId))),
    db.select({ count: sql<number>`count(*)::int` }).from(activities)
      .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email'), eq(activities.contactId, contactId))),
  ]);
  return (smsResult[0]?.count || 0) + (emailResult[0]?.count || 0);
}

async function getCalls(contractorId: string): Promise<Call[]> {
  return await db.select().from(calls)
    .where(eq(calls.contractorId, contractorId))
    .orderBy(desc(calls.createdAt))
    .limit(CALLS_LIMIT);
}

async function getCall(id: string, contractorId: string): Promise<Call | undefined> {
  const result = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.contractorId, contractorId))).limit(1);
  return result[0];
}

async function getCallByExternalId(externalCallId: string, contractorId: string): Promise<Call | undefined> {
  const result = await db.select().from(calls).where(and(
    eq(calls.externalCallId, externalCallId),
    eq(calls.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function createCall(call: Omit<InsertCall, 'contractorId'>, contractorId: string): Promise<Call> {
  const result = await db.insert(calls).values({ ...call, contractorId }).returning();
  return result[0];
}

async function updateCall(id: string, call: UpdateCall, contractorId: string): Promise<Call | undefined> {
  const result = await db.update(calls)
    .set({ ...call, updatedAt: new Date() })
    .where(and(eq(calls.id, id), eq(calls.contractorId, contractorId)))
    .returning();
  return result[0];
}

export const messagingMethods = {
  getMessages,
  getMessage,
  createMessage,
  getAllMessages,
  getConversations,
  getConversationMessages,
  getConversationMessageCount,
  getCalls,
  getCall,
  getCallByExternalId,
  createCall,
  updateCall,
};
