import {
  type Activity, type InsertActivity,
  activities, users,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, isNotNull } from "drizzle-orm";
import type { UpdateActivity } from "../storage-types";

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

export const activityMethods = {
  getActivities,
  getActivity,
  createActivity,
  updateActivity,
  deleteActivity,
};
