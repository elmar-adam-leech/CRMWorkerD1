import {
  type Job, type InsertJob,
  jobs, contacts, leads, estimates, messages, calls,
  jobStatusEnum,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, lte, ilike, sql, count } from "drizzle-orm";
import type { UpdateJob } from "../storage-types";

type PaginatedJobs = {
  data: Record<string, unknown>[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

const GET_JOBS_LIMIT = 500;

async function getJobs(contractorId: string): Promise<Job[]> {
  return await db.select().from(jobs).where(eq(jobs.contractorId, contractorId)).orderBy(desc(jobs.createdAt)).limit(GET_JOBS_LIMIT);
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
    conditions.push(eq(jobs.status, options.status as typeof jobStatusEnum.enumValues[number]));
  }
  if (options.search) {
    conditions.push(or(
      ilike(jobs.title, `%${options.search}%`),
      ilike(contacts.name, `%${options.search}%`)
    )!);
  }

  const [jobsData, total] = await Promise.all([
    db.select({
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
    .limit(limit + 1),
    getJobsCount(contractorId, { status: options.status, search: options.search }),
  ]);

  const hasMore = jobsData.length > limit;
  if (hasMore) jobsData.pop();

  const nextCursor = hasMore && jobsData.length > 0
    ? jobsData[jobsData.length - 1].createdAt.toISOString()
    : null;

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
    conditions.push(eq(jobs.status, options.status as typeof jobStatusEnum.enumValues[number]));
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
  const job = await db.select({ contactId: jobs.contactId })
    .from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
    .limit(1);

  if (job.length === 0) return false;
  const contactId = job[0].contactId;

  const result = await db.delete(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
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

/**
 * Hard-deletes a contact and all associated records. Only called when a contact
 * has no remaining leads, estimates, or jobs — i.e. the last linked entity was deleted.
 * Exported so `estimates.ts` can reuse the same cleanup logic.
 */
export async function deleteContactFull(id: string, contractorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(messages).where(and(eq(messages.contactId, id), eq(messages.contractorId, contractorId)));
    await tx.delete(calls).where(and(eq(calls.contactId, id), eq(calls.contractorId, contractorId)));
    await tx.delete(estimates).where(and(eq(estimates.contactId, id), eq(estimates.contractorId, contractorId)));
    await tx.delete(jobs).where(and(eq(jobs.contactId, id), eq(jobs.contractorId, contractorId)));
    await tx.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.contractorId, contractorId)));
  });
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

export const jobMethods = {
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
};
