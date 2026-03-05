import {
  type Job, type InsertJob,
  type Estimate, type InsertEstimate,
  jobs, estimates, contacts, activities,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, gt, lte, ilike, sql, count } from "drizzle-orm";
import type { UpdateJob, UpdateEstimate } from "../storage-types";

type PaginatedJobs = {
  data: any[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

type PaginatedEstimates = {
  data: any[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

async function getJobs(contractorId: string): Promise<Job[]> {
  return await db.select().from(jobs).where(eq(jobs.contractorId, contractorId)).orderBy(desc(jobs.createdAt)).limit(500);
}

async function getJobsPaginated(contractorId: string, options: {
  cursor?: string;
  limit?: number;
  status?: string;
  search?: string;
} = {}): Promise<PaginatedJobs> {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [eq(jobs.contractorId, contractorId)];

  if (options.cursor) {
    conditions.push(lte(jobs.createdAt, new Date(options.cursor)));
  }
  if (options.status && options.status !== 'all') {
    conditions.push(eq(jobs.status, options.status as any));
  }
  if (options.search) {
    conditions.push(or(
      ilike(jobs.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }

  const jobsData = await db.select({
    id: jobs.id,
    title: jobs.title,
    type: jobs.type,
    status: jobs.status,
    priority: jobs.priority,
    value: jobs.value,
    scheduledDate: jobs.scheduledDate,
    contactId: jobs.contactId,
    contactName: contacts.name,
    estimatedHours: jobs.estimatedHours,
    createdAt: jobs.createdAt,
    updatedAt: jobs.updatedAt,
  })
  .from(jobs)
  .leftJoin(contacts, eq(jobs.contactId, contacts.id))
  .where(and(...conditions))
  .orderBy(desc(jobs.createdAt))
  .limit(limit + 1);

  const hasMore = jobsData.length > limit;
  if (hasMore) jobsData.pop();

  const nextCursor = hasMore && jobsData.length > 0
    ? jobsData[jobsData.length - 1].createdAt.toISOString()
    : null;

  const total = await getJobsCount(contractorId, { status: options.status, search: options.search });

  return {
    data: jobsData.map(job => ({ ...job, contactName: job.contactName || 'Unknown Contact' })),
    pagination: { total, hasMore, nextCursor },
  };
}

async function getJobsCount(contractorId: string, options: {
  status?: string;
  search?: string;
} = {}): Promise<number> {
  const conditions = [eq(jobs.contractorId, contractorId)];
  if (options.status && options.status !== 'all') {
    conditions.push(eq(jobs.status, options.status as any));
  }
  if (options.search) {
    conditions.push(or(
      ilike(jobs.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }
  const result = await db.select({ count: sql`count(*)` })
    .from(jobs)
    .leftJoin(contacts, eq(jobs.contactId, contacts.id))
    .where(and(...conditions));
  return Number(result[0]?.count || 0);
}

async function getJobsStatusCounts(contractorId: string, options: {
  search?: string;
} = {}): Promise<{ all: number; scheduled: number; in_progress: number; completed: number; cancelled: number }> {
  const baseConditions = [eq(jobs.contractorId, contractorId)];
  if (options.search) {
    baseConditions.push(or(
      ilike(jobs.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }
  const result = await db.select({
    all: count(),
    scheduled: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'scheduled' THEN 1 END)`,
    in_progress: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'in_progress' THEN 1 END)`,
    completed: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'completed' THEN 1 END)`,
    cancelled: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'cancelled' THEN 1 END)`,
  })
  .from(jobs)
  .leftJoin(contacts, eq(jobs.contactId, contacts.id))
  .where(and(...baseConditions));

  const counts = result[0];
  return {
    all: Number(counts.all),
    scheduled: Number(counts.scheduled),
    in_progress: Number(counts.in_progress),
    completed: Number(counts.completed),
    cancelled: Number(counts.cancelled),
  };
}

async function getJob(id: string, contractorId: string): Promise<Job | undefined> {
  const result = await db.select().from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
    .limit(1);
  return result[0];
}

async function createJob(job: Omit<InsertJob, 'contractorId'>, contractorId: string): Promise<Job> {
  if (job.contactId) {
    const contact = await db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.id, job.contactId),
      eq(contacts.contractorId, contractorId)
    )).limit(1);
    if (!contact[0]) throw new Error('Contact not found or does not belong to this contractor');
  }
  const result = await db.insert(jobs).values({ ...job, contractorId }).returning();
  return result[0];
}

async function updateJob(id: string, job: UpdateJob, contractorId: string): Promise<Job | undefined> {
  const result = await db.update(jobs)
    .set({ ...job, updatedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteJob(id: string, contractorId: string): Promise<boolean> {
  const result = await db.delete(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
    .returning();
  return result.length > 0;
}

async function getJobByEstimateId(estimateId: string, contractorId: string): Promise<Job | undefined> {
  const result = await db.select().from(jobs)
    .where(and(eq(jobs.estimateId, estimateId), eq(jobs.contractorId, contractorId)))
    .limit(1);
  return result[0];
}

async function getJobByHousecallProJobId(externalId: string, contractorId: string): Promise<Job | undefined> {
  const result = await db.select().from(jobs)
    .where(and(eq(jobs.externalId, externalId), eq(jobs.contractorId, contractorId)))
    .limit(1);
  return result[0];
}

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
    conditions.push(eq(estimates.status, options.status as any));
  }
  if (options.search) {
    conditions.push(or(
      ilike(estimates.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }

  const estimatesData = await db.select({
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
  .limit(limit + 1);

  const hasMore = estimatesData.length > limit;
  if (hasMore) estimatesData.pop();

  const nextCursor = hasMore && estimatesData.length > 0
    ? estimatesData[estimatesData.length - 1].createdAt.toISOString()
    : null;

  const total = await getEstimatesCount(contractorId, { status: options.status, search: options.search });

  return { data: estimatesData, pagination: { total, hasMore, nextCursor } };
}

async function getEstimatesCount(contractorId: string, options: {
  status?: string;
  search?: string;
} = {}): Promise<number> {
  const conditions = [eq(estimates.contractorId, contractorId)];
  if (options.status) conditions.push(eq(estimates.status, options.status as any));
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
  await db.delete(activities).where(and(
    eq(activities.estimateId, id),
    eq(activities.contractorId, contractorId)
  ));
  const result = await db.delete(estimates)
    .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
    .returning();
  return result.length > 0;
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

export const jobEstimateMethods = {
  getJobs,
  getJobsPaginated,
  getJobsCount,
  getJobsStatusCounts,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  getJobByEstimateId,
  getJobByHousecallProJobId,
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
