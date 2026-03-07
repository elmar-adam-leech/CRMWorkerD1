import {
  type Estimate, type InsertEstimate,
  estimates, contacts, activities, leads, jobs,
  estimateStatusEnum,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, gt, ilike, sql, count } from "drizzle-orm";
import type { UpdateEstimate } from "../storage-types";
import { deleteContactFull } from "./jobs";

type PaginatedEstimates = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

async function getEstimates(contractorId: string): Promise<Estimate[]> {
  return await db.select({
    id: estimates.id,
    title: estimates.title,
    description: estimates.description,
    amount: estimates.amount,
    status: estimates.status,
    validUntil: estimates.validUntil,
    followUpDate: estimates.followUpDate,
    contactId: estimates.contactId,
    contractorId: estimates.contractorId,
    scheduledStart: estimates.scheduledStart,
    scheduledEnd: estimates.scheduledEnd,
    scheduledEmployeeId: estimates.scheduledEmployeeId,
    housecallProCustomerId: estimates.housecallProCustomerId,
    housecallProEstimateId: estimates.housecallProEstimateId,
    externalId: estimates.externalId,
    externalSource: estimates.externalSource,
    syncedAt: estimates.syncedAt,
    createdAt: estimates.createdAt,
    updatedAt: estimates.updatedAt,
    contact: {
      id: contacts.id,
      name: contacts.name,
      emails: contacts.emails,
      phones: contacts.phones,
      address: contacts.address,
    }
  })
  .from(estimates)
  .leftJoin(contacts, eq(estimates.contactId, contacts.id))
  .where(eq(estimates.contractorId, contractorId))
  .orderBy(desc(estimates.createdAt))
  .limit(500) as unknown as Estimate[];
}

async function getEstimatesPaginated(contractorId: string, options: {
  cursor?: string;
  limit?: number;
  status?: string;
  search?: string;
} = {}): Promise<PaginatedEstimates> {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [eq(estimates.contractorId, contractorId)];

  if (options.cursor) {
    conditions.push(gt(estimates.createdAt, new Date(options.cursor)));
  }
  if (options.status) {
    conditions.push(eq(estimates.status, options.status as typeof estimateStatusEnum.enumValues[number]));
  }
  if (options.search) {
    conditions.push(or(
      ilike(estimates.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }

  const [estimatesData, total] = await Promise.all([
    db.select({
      id: estimates.id,
      title: estimates.title,
      amount: estimates.amount,
      status: estimates.status,
      validUntil: estimates.validUntil,
      contactId: estimates.contactId,
      contactName: sql<string>`COALESCE(${contacts.name}, 'Unknown Contact')`,
      createdAt: estimates.createdAt,
      updatedAt: estimates.updatedAt,
    })
    .from(estimates)
    .leftJoin(contacts, eq(estimates.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(estimates.createdAt))
    .limit(limit + 1),
    getEstimatesCount(contractorId, { status: options.status, search: options.search }),
  ]);

  const hasMore = estimatesData.length > limit;
  if (estimatesData.length > limit) estimatesData.pop();

  const nextCursor = hasMore && estimatesData.length > 0
    ? estimatesData[estimatesData.length - 1].createdAt.toISOString()
    : null;

  return { data: estimatesData, pagination: { total, hasMore, nextCursor } };
}

async function getEstimatesCount(contractorId: string, options: {
  status?: string;
  search?: string;
} = {}): Promise<number> {
  const conditions = [eq(estimates.contractorId, contractorId)];
  if (options.status) conditions.push(eq(estimates.status, options.status as typeof estimateStatusEnum.enumValues[number]));
  if (options.search) {
    conditions.push(or(
      ilike(estimates.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }
  const result = await db.select({ count: count() })
    .from(estimates)
    .leftJoin(contacts, eq(estimates.contactId, contacts.id))
    .where(and(...conditions));
  return result[0].count;
}

async function getEstimatesStatusCounts(contractorId: string, options: {
  search?: string;
} = {}): Promise<{ all: number; sent: number; pending: number; approved: number; rejected: number }> {
  const baseConditions = [eq(estimates.contractorId, contractorId)];
  if (options.search) {
    baseConditions.push(or(
      ilike(estimates.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }
  const result = await db.select({
    all: count(),
    sent: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'sent' THEN 1 END)`,
    pending: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'pending' THEN 1 END)`,
    approved: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'approved' THEN 1 END)`,
    rejected: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'rejected' THEN 1 END)`,
  })
  .from(estimates)
  .leftJoin(contacts, eq(estimates.contactId, contacts.id))
  .where(and(...baseConditions));

  const counts = result[0];
  return {
    all: Number(counts.all),
    sent: Number(counts.sent),
    pending: Number(counts.pending),
    approved: Number(counts.approved),
    rejected: Number(counts.rejected),
  };
}

async function getEstimate(id: string, contractorId: string): Promise<Estimate | undefined> {
  const result = await db.select().from(estimates)
    .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
    .limit(1);
  return result[0];
}

async function createEstimate(estimate: Omit<InsertEstimate, 'contractorId'>, contractorId: string): Promise<Estimate> {
  if (estimate.contactId) {
    const contact = await db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.id, estimate.contactId),
      eq(contacts.contractorId, contractorId)
    )).limit(1);
    if (!contact[0]) throw new Error('Contact not found or does not belong to this contractor');
  }
  const result = await db.insert(estimates).values({ ...estimate, contractorId }).returning();
  return result[0];
}

async function updateEstimate(id: string, estimate: UpdateEstimate, contractorId: string): Promise<Estimate | undefined> {
  const result = await db.update(estimates)
    .set({ ...estimate, updatedAt: new Date() })
    .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteEstimate(id: string, contractorId: string): Promise<boolean> {
  const estimate = await db.select({ contactId: estimates.contactId })
    .from(estimates)
    .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
    .limit(1);

  if (estimate.length === 0) return false;
  const contactId = estimate[0].contactId;

  await db.delete(activities).where(and(
    eq(activities.estimateId, id),
    eq(activities.contractorId, contractorId)
  ));
  const result = await db.delete(estimates)
    .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
    .returning();
  if (result.length === 0) return false;

  if (contactId) {
    const [remainingLeads, remainingEstimates, remainingJobs] = await Promise.all([
      db.select({ id: leads.id }).from(leads).where(and(eq(leads.contactId, contactId), eq(leads.contractorId, contractorId))).limit(1),
      db.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.contactId, contactId), eq(estimates.contractorId, contractorId))).limit(1),
      db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.contactId, contactId), eq(jobs.contractorId, contractorId))).limit(1),
    ]);
    if (remainingLeads.length === 0 && remainingEstimates.length === 0 && remainingJobs.length === 0) {
      await deleteContactFull(contactId, contractorId);
    }
  }

  return true;
}

async function getEstimatesWithFollowUp(contractorId: string, limit = 200): Promise<Estimate[]> {
  return db.select()
    .from(estimates)
    .where(and(
      eq(estimates.contractorId, contractorId),
      sql`${estimates.followUpDate} IS NOT NULL`
    ))
    .orderBy(estimates.followUpDate)
    .limit(limit) as unknown as Estimate[];
}

export const estimateMethods = {
  getEstimates,
  getEstimatesPaginated,
  getEstimatesCount,
  getEstimatesStatusCounts,
  getEstimate,
  createEstimate,
  updateEstimate,
  deleteEstimate,
  getEstimatesWithFollowUp,
};
