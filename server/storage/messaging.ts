import {
  type Message, type InsertMessage,
  type Template, type InsertTemplate,
  type Call, type InsertCall,
  type Activity, type InsertActivity,
  messages, templates, calls, activities, contacts, users,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, asc, isNotNull, like, sql } from "drizzle-orm";
import type { UpdateTemplate, UpdateCall, UpdateActivity } from "../storage-types";

async function getMessages(contractorId: string, contactId?: string, estimateId?: string): Promise<Message[]> {
  const conditions = [eq(messages.contractorId, contractorId)];
  if (contactId) conditions.push(eq(messages.contactId, contactId));
  if (estimateId) conditions.push(eq(messages.estimateId, estimateId));
  return await db.select().from(messages).where(and(...conditions));
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
    options.type === 'email' ? Promise.resolve([]) : db.select().from(messages).where(and(...smsConditions)).orderBy(desc(messages.createdAt)),
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
    }).from(activities).leftJoin(users, eq(activities.userId, users.id)).where(and(...emailConditions)).orderBy(desc(activities.createdAt))
  ]);

  const emailMessages = emailActivities.map(activity => {
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
    };
  });

  const filteredMessages = [...smsMessages, ...emailMessages as Message[]];
  filteredMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  let allMessages: Message[];
  if (options.search || options.type || options.status) {
    const conversationKeys = new Set<string>();
    filteredMessages.forEach(msg => { if (msg.contactId) conversationKeys.add(msg.contactId); });

    if (conversationKeys.size === 0) return [];

    const contactIds = Array.from(conversationKeys);
    const allConversationMessages = await Promise.all(contactIds.map(async (contactId) => {
      const [contactSms, contactEmails] = await Promise.all([
        db.select().from(messages).where(and(eq(messages.contractorId, contractorId), eq(messages.contactId, contactId))).orderBy(desc(messages.createdAt)),
        db.select({
          id: activities.id, content: activities.content, contactId: activities.contactId,
          estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
          createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
        }).from(activities).leftJoin(users, eq(activities.userId, users.id))
          .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email'), eq(activities.contactId, contactId)))
          .orderBy(desc(activities.createdAt))
      ]);

      const contactEmailMessages = contactEmails.map(activity => {
        const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
        return {
          id: activity.id, type: 'email' as const, status: 'sent' as const,
          direction: metadata.direction || 'outbound', content: activity.content || '',
          toNumber: metadata.to?.[0] || '', fromNumber: metadata.from || '',
          contactId: activity.contactId, estimateId: activity.estimateId, userId: activity.userId,
          externalMessageId: metadata.messageId || null, contractorId: activity.contractorId,
          createdAt: activity.createdAt, userName: activity.userName,
        };
      });

      return [...contactSms, ...contactEmailMessages as Message[]];
    }));

    allMessages = allConversationMessages.flat();
  } else {
    const [allSms, allEmailActivities] = await Promise.all([
      db.select().from(messages).where(eq(messages.contractorId, contractorId)).orderBy(desc(messages.createdAt)),
      db.select({
        id: activities.id, content: activities.content, contactId: activities.contactId,
        estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
        createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
      }).from(activities).leftJoin(users, eq(activities.userId, users.id))
        .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email')))
        .orderBy(desc(activities.createdAt))
    ]);

    const allEmailMessages = allEmailActivities.map(activity => {
      const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
      return {
        id: activity.id, type: 'email' as const, status: 'sent' as const,
        direction: metadata.direction || 'outbound', content: activity.content || '',
        toNumber: metadata.to?.[0] || '', fromNumber: metadata.from || '',
        contactId: activity.contactId, estimateId: activity.estimateId, userId: activity.userId,
        externalMessageId: metadata.messageId || null, contractorId: activity.contractorId,
        createdAt: activity.createdAt, userName: activity.userName,
      };
    });

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

  const conversations = [];
  for (const [contactId, conversation] of Array.from(conversationMap.entries())) {
    let contactName = 'Unknown';
    let contactPhone: string | undefined;
    let contactEmail: string | undefined;

    const contact = await db.select({ name: contacts.name, phones: contacts.phones, emails: contacts.emails })
      .from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.contractorId, contractorId))).limit(1);
    if (contact[0]) {
      contactName = contact[0].name;
      contactPhone = contact[0].phones?.[0] || undefined;
      contactEmail = contact[0].emails?.[0] || undefined;
    }

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

  const smsMessages = await db.select({
    id: messages.id, type: messages.type, status: messages.status, direction: messages.direction,
    content: messages.content, toNumber: messages.toNumber, fromNumber: messages.fromNumber,
    contactId: messages.contactId, estimateId: messages.estimateId, userId: messages.userId,
    externalMessageId: messages.externalMessageId, contractorId: messages.contractorId,
    createdAt: messages.createdAt, userName: users.name,
  }).from(messages).leftJoin(users, eq(messages.userId, users.id))
    .where(and(eq(messages.contractorId, contractorId), eq(messages.contactId, contactId)));

  console.log(`[getConversationMessages] Found ${smsMessages.length} SMS messages`);

  const emailActivities = await db.select({
    id: activities.id, content: activities.content, contactId: activities.contactId,
    estimateId: activities.estimateId, userId: activities.userId, contractorId: activities.contractorId,
    createdAt: activities.createdAt, metadata: activities.metadata, userName: users.name,
  }).from(activities).leftJoin(users, eq(activities.userId, users.id))
    .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email'), eq(activities.contactId, contactId)));

  const emailMessages = emailActivities.map(activity => {
    const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
    return {
      id: activity.id, type: 'email' as const, status: 'sent' as const,
      direction: metadata.direction || 'outbound', content: activity.content || '',
      toNumber: metadata.to?.[0] || '', fromNumber: metadata.from || '',
      contactId: activity.contactId, estimateId: activity.estimateId, userId: activity.userId,
      externalMessageId: metadata.messageId || null, contractorId: activity.contractorId,
      createdAt: activity.createdAt, userName: activity.userName,
    };
  });

  const allMessages = [...smsMessages, ...emailMessages as Message[]];
  allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return allMessages;
}

async function getConversationMessageCount(contractorId: string, contactId: string): Promise<number> {
  const smsResult = await db.select({ count: sql<number>`count(*)::int` }).from(messages)
    .where(and(eq(messages.contractorId, contractorId), eq(messages.contactId, contactId)));
  const emailResult = await db.select({ count: sql<number>`count(*)::int` }).from(activities)
    .where(and(eq(activities.contractorId, contractorId), eq(activities.type, 'email'), eq(activities.contactId, contactId)));
  return (smsResult[0]?.count || 0) + (emailResult[0]?.count || 0);
}

async function getTemplates(contractorId: string, type?: 'text' | 'email'): Promise<Template[]> {
  const conditions = [eq(templates.contractorId, contractorId)];
  if (type) conditions.push(eq(templates.type, type));
  return await db.select().from(templates).where(and(...conditions));
}

async function getTemplate(id: string, contractorId: string): Promise<Template | undefined> {
  const result = await db.select().from(templates).where(and(eq(templates.id, id), eq(templates.contractorId, contractorId))).limit(1);
  return result[0];
}

async function createTemplate(template: Omit<InsertTemplate, 'contractorId'>, contractorId: string): Promise<Template> {
  const result = await db.insert(templates).values({ ...template, contractorId }).returning();
  return result[0];
}

async function updateTemplate(id: string, template: UpdateTemplate, contractorId: string): Promise<Template | undefined> {
  const result = await db.update(templates)
    .set({ ...template, updatedAt: new Date() })
    .where(and(eq(templates.id, id), eq(templates.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteTemplate(id: string, contractorId: string): Promise<boolean> {
  const result = await db.delete(templates).where(and(eq(templates.id, id), eq(templates.contractorId, contractorId)));
  return (result.rowCount ?? 0) > 0;
}

async function getCalls(contractorId: string): Promise<Call[]> {
  return await db.select().from(calls).where(eq(calls.contractorId, contractorId));
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

async function getActivities(contractorId: string, options: {
  contactId?: string;
  estimateId?: string;
  jobId?: string;
  type?: 'note' | 'call' | 'email' | 'sms' | 'meeting' | 'follow_up' | 'status_change';
  limit?: number;
  offset?: number;
} = {}): Promise<Activity[]> {
  const conditions = [
    eq(activities.contractorId, contractorId),
    or(isNotNull(activities.contactId), isNotNull(activities.estimateId), isNotNull(activities.jobId))!
  ];

  if (options.contactId) conditions.push(eq(activities.contactId, options.contactId));
  if (options.estimateId) conditions.push(eq(activities.estimateId, options.estimateId));
  if (options.jobId) conditions.push(eq(activities.jobId, options.jobId));
  if (options.type) conditions.push(eq(activities.type, options.type));

  const result = await db.select({
    id: activities.id, type: activities.type, title: activities.title, content: activities.content,
    contactId: activities.contactId, estimateId: activities.estimateId, jobId: activities.jobId,
    userId: activities.userId, contractorId: activities.contractorId,
    createdAt: activities.createdAt, updatedAt: activities.updatedAt, userName: users.name,
  }).from(activities).leftJoin(users, eq(activities.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(activities.createdAt))
    .limit(options.limit || 50)
    .offset(options.offset || 0);

  return result as unknown as Activity[];
}

async function getActivity(id: string, contractorId: string): Promise<Activity | undefined> {
  const result = await db.select().from(activities).where(and(
    eq(activities.id, id),
    eq(activities.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function createActivity(activity: Omit<InsertActivity, 'contractorId'>, contractorId: string): Promise<Activity> {
  const result = await db.insert(activities).values({ ...activity, contractorId }).returning();
  return result[0];
}

async function updateActivity(id: string, activity: UpdateActivity, contractorId: string): Promise<Activity | undefined> {
  const result = await db.update(activities)
    .set({ ...activity, updatedAt: new Date() })
    .where(and(eq(activities.id, id), eq(activities.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteActivity(id: string, contractorId: string): Promise<boolean> {
  const result = await db.delete(activities).where(and(eq(activities.id, id), eq(activities.contractorId, contractorId))).returning();
  return result.length > 0;
}

export const messagingMethods = {
  getMessages,
  getMessage,
  createMessage,
  getAllMessages,
  getConversations,
  getConversationMessages,
  getConversationMessageCount,
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getCalls,
  getCall,
  getCallByExternalId,
  createCall,
  updateCall,
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
};
