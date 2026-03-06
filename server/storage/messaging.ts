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
const MESSAGES_BULK_LIMIT = 2000;        // bulk messaging inbox queries

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
  const smsConditions = [eq(messages.contractorId, contractorId)];
  if (options.type !== 'email') {
    if (options.type) smsConditions.push(eq(messages.type, options.type));
    if (options.status) smsConditions.push(eq(messages.status, options.status));
    if (options.search) smsConditions.push(like(sql`lower(${messages.content})`, `%${options.search.toLowerCase()}%`));
  }

  const emailConditions = [eq(activities.contractorId, contractorId), eq(activities.type, 'email')];
  if (options.type !== 'text' && options.search) {
    emailConditions.push(like(sql`lower(${activities.content})`, `%${options.search.toLowerCase()}%`));
  }

  const [smsMessages, emailActivities] = await Promise.all([
    options.type === 'email' ? Promise.resolve([]) : db.select().from(messages).where(and(...smsConditions)).orderBy(desc(messages.createdAt)).limit(CONVERSATION_MESSAGE_LIMIT),
    options.type === 'text' ? Promise.resolve([]) : db.select({
      id: activities.id,
      content: activities.content,
      contactId: activities.contactId,
      estimateId: activities.estimateId,
      userId: activities.userId,
      contractorId: activities.contractorId,
      createdAt: activities.createdAt,
      metadata: activities.metadata,
      userName: users.name,
    }).from(activities).leftJoin(users, eq(activities.userId, users.id)).where(and(...emailConditions)).orderBy(desc(activities.createdAt)).limit(CONVERSATION_MESSAGE_LIMIT)
  ]);

  const emailMessages = emailActivities.map(emailActivityToMessage);

  const filteredMessages = [...smsMessages, ...emailMessages as Message[]];
  filteredMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  let allMessages: Message[];
  if (options.search || options.type || options.status) {
    const conversationKeys = new Set<string>();
    filteredMessages.forEach(msg => { if (msg.contactId) conversationKeys.add(msg.contactId); });

    if (conversationKeys.size === 0) return [];

    const contactIds = Array.from(conversationKeys);

    // Batch fetch — 2 queries total regardless of how many contactIds
    const [batchSms, batchEmails] = await Promise.all([
      db.select().from(messages)
        .where(and(eq(messages.contractorId, contractorId), inArray(messages.contactId, contactIds)))
        .orderBy(desc(messages.createdAt))
        .limit(CONVERSATION_MESSAGE_LIMIT),
      db.select({
        id: activities.id, content: activities.content, contactId: activities.contactId,
        estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
        createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
      }).from(activities).leftJoin(users, eq(activities.userId, users.id))
        .where(and(
          eq(activities.contractorId, contractorId),
          eq(activities.type, 'email'),
          inArray(activities.contactId, contactIds)
        ))
        .orderBy(desc(activities.createdAt))
        .limit(CONVERSATION_MESSAGE_LIMIT)
    ]);

    const batchEmailMessages = batchEmails.map(emailActivityToMessage);
    allMessages = [...batchSms, ...batchEmailMessages as Message[]];
  } else {
    const [allSms, allEmailActivities] = await Promise.all([
      db.select().from(messages).where(eq(messages.contractorId, contractorId)).orderBy(desc(messages.createdAt)).limit(MESSAGES_BULK_LIMIT),
      db.select({
        id: activities.id, content: activities.content, contactId: activities.contactId,
        estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
        createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
      }).from(activities).leftJoin(users, eq(activities.userId, users.id))
        .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email')))
        .orderBy(desc(activities.createdAt))
        .limit(MESSAGES_BULK_LIMIT)
    ]);

    const allEmailMessages = allEmailActivities.map(emailActivityToMessage);

    allMessages = [...allSms, ...allEmailMessages as Message[]];
  }

  const conversationMap = new Map<string, { contactId: string; messages: Message[] }>();
  for (const message of allMessages) {
    if (!message.contactId) continue;
    if (!conversationMap.has(message.contactId)) {
      conversationMap.set(message.contactId, { contactId: message.contactId, messages: [] });
    }
    conversationMap.get(message.contactId)!.messages.push(message);
  }

  const conversationContactIds = Array.from(conversationMap.keys());
  const contactRows = conversationContactIds.length > 0
    ? await db.select({ id: contacts.id, name: contacts.name, phones: contacts.phones, emails: contacts.emails })
        .from(contacts)
        .where(and(inArray(contacts.id, conversationContactIds), eq(contacts.contractorId, contractorId)))
    : [];
  const contactLookup = new Map(contactRows.map(c => [c.id, c]));

  const conversations = [];
  for (const [contactId, conversation] of Array.from(conversationMap.entries())) {
    const contact = contactLookup.get(contactId);
    const contactName = contact?.name ?? 'Unknown';
    const contactPhone = contact?.phones?.[0] ?? undefined;
    const contactEmail = contact?.emails?.[0] ?? undefined;

    const sorted = conversation.messages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    conversations.push({
      contactId, contactName, contactPhone, contactEmail,
      lastMessage: sorted[0],
      unreadCount: 0,
      totalMessages: conversation.messages.length
    });
  }

  conversations.sort((a, b) =>
    new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
  );

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
