import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { jobStatusEnum, jobPriorityEnum } from "./enums";
import { contractors } from "./settings";
import { contacts } from "./contacts";
import { estimates } from "./estimates";

// Jobs table
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  type: text("type").notNull(),
  status: jobStatusEnum("status").notNull().default("scheduled"),
  priority: jobPriorityEnum("priority").notNull().default("medium"),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  estimatedHours: integer("estimated_hours"),
  scheduledDate: timestamp("scheduled_date"),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  estimateId: varchar("estimate_id").references(() => estimates.id), // Link to estimate if job was created from one
  notes: text("notes"), // Free-form notes from webhooks or manual entry
  externalId: varchar("external_id"), // External system job ID (e.g., Housecall Pro)
  externalSource: varchar("external_source"), // Source system (e.g., 'housecall-pro')
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("jobs_contractor_id_idx").on(table.contractorId),
  contactIdIdx: index("jobs_contact_id_idx").on(table.contactId),
  statusIdx: index("jobs_status_idx").on(table.status),
  createdAtIdx: index("jobs_created_at_idx").on(table.createdAt),
  scheduledDateIdx: index("jobs_scheduled_date_idx").on(table.scheduledDate),
  // Composite index for contractor + status queries
  contractorStatusIdx: index("jobs_contractor_status_idx").on(table.contractorId, table.status),
  // Composite index for contractor + date range queries
  contractorDateIdx: index("jobs_contractor_date_idx").on(table.contractorId, table.createdAt),
  // Partial index for external ID lookups (HCP sync path)
  externalIdIdx: index("jobs_external_id_idx").on(table.externalId).where(sql`external_id IS NOT NULL`),
  // Index for getJobByEstimateId() and joins from estimates → jobs
  estimateIdIdx: index("jobs_estimate_id_idx").on(table.estimateId),
  // Composite index supporting paginated title search queries:
  // WHERE contractor_id = ? AND title ILIKE ? ORDER BY created_at DESC
  contractorTitleIdx: index("jobs_contractor_title_idx").on(table.contractorId, table.title),
  // Trigram GIN index for ILIKE '%substring%' title search (requires pg_trgm).
  titleTrgmIdx: index("jobs_title_trgm_idx").using("gin", sql`title gin_trgm_ops`),
}));

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  value: z.union([z.string(), z.number()]).transform(val => String(val)),
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// Lightweight DTO for job lists and pagination
export const jobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["low", "medium", "high"]),
  value: z.string(),
  scheduledDate: z.date().nullable(),
  contactName: z.string(),
  contactId: z.string(),
  estimatedHours: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;

// Status counts shape used in paginated responses and the standalone endpoint
export const jobStatusCountsSchema = z.object({
  all: z.number(),
  scheduled: z.number(),
  in_progress: z.number(),
  completed: z.number(),
  cancelled: z.number(),
});
export type JobStatusCounts = z.infer<typeof jobStatusCountsSchema>;

// Query parameter validation schema for jobs pagination
export const jobsPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "all"]).optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// Paginated response schema for jobs (statusCounts bundled to save a round trip)
export const paginatedJobsSchema = z.object({
  data: z.array(jobSummarySchema),
  pagination: z.object({
    total: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  statusCounts: jobStatusCountsSchema,
});
export type PaginatedJobs = z.infer<typeof paginatedJobsSchema>;
