import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { estimateStatusEnum } from "./enums";
import { contractors } from "./settings";
import { contacts } from "./contacts";

// Estimates table
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: estimateStatusEnum("status").notNull().default("draft"),
  validUntil: timestamp("valid_until"),
  followUpDate: timestamp("follow_up_date"),
  contactId: varchar("contact_id").notNull().references(() => contacts.id), // Reference to contact (no duplicate phone/email data)
  // Housecall Pro integration fields
  housecallProEstimateId: varchar("housecall_pro_estimate_id"), // Housecall Pro estimate ID
  housecallProCustomerId: varchar("housecall_pro_customer_id"), // Housecall Pro customer ID
  scheduledStart: timestamp("scheduled_start"), // Scheduled start time from Housecall Pro
  scheduledEnd: timestamp("scheduled_end"), // Scheduled end time from Housecall Pro
  scheduledEmployeeId: varchar("scheduled_employee_id"), // Housecall Pro employee ID
  syncedAt: timestamp("synced_at"), // Last sync time with Housecall Pro
  // External system tracking fields (consistent with jobs table)
  externalId: varchar("external_id"), // External system ID (e.g., Housecall Pro estimate ID)
  externalSource: varchar("external_source"), // External system name (e.g., 'housecall-pro')
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("estimates_contractor_id_idx").on(table.contractorId),
  contactIdIdx: index("estimates_contact_id_idx").on(table.contactId),
  statusIdx: index("estimates_status_idx").on(table.status),
  createdAtIdx: index("estimates_created_at_idx").on(table.createdAt),
  // Composite index for contractor + status queries
  contractorStatusIdx: index("estimates_contractor_status_idx").on(table.contractorId, table.status),
  // Composite index for contractor + date range queries
  contractorDateIdx: index("estimates_contractor_date_idx").on(table.contractorId, table.createdAt),
  // Index for follow-up date queries (Follow-ups page)
  followUpDateIdx: index("estimates_follow_up_date_idx").on(table.followUpDate),
  // Partial index for external ID + contractor lookups (HCP sync path)
  externalIdContractorIdx: index("estimates_external_id_contractor_idx").on(table.externalId, table.contractorId).where(sql`external_id IS NOT NULL`),
  // Partial index for Housecall Pro estimate ID lookups (HCP sync path).
  // housecall_pro_estimate_id is distinct from external_id — the HCP estimate-specific
  // sync path queries this column directly when matching incoming HCP webhooks.
  housecallProEstimateIdIdx: index("estimates_housecall_pro_estimate_id_idx").on(table.housecallProEstimateId).where(sql`housecall_pro_estimate_id IS NOT NULL`),
  // Composite index supporting paginated title search queries:
  // WHERE contractor_id = ? AND title ILIKE ? ORDER BY created_at DESC
  contractorTitleIdx: index("estimates_contractor_title_idx").on(table.contractorId, table.title),
  // Trigram GIN index for ILIKE '%substring%' title search (requires pg_trgm).
  titleTrgmIdx: index("estimates_title_trgm_idx").using("gin", sql`title gin_trgm_ops`),
}));

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  amount: z.union([z.string(), z.number()]).transform(val => String(val)),
});
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Lightweight DTO for estimate lists and pagination
export const estimateSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.string(),
  status: z.enum(["draft", "sent", "pending", "approved", "rejected"]),
  validUntil: z.date().nullable(),
  contactName: z.string(),
  contactId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type EstimateSummary = z.infer<typeof estimateSummarySchema>;

// Paginated response schema for estimates
export const paginatedEstimatesSchema = z.object({
  data: z.array(estimateSummarySchema),
  pagination: z.object({
    total: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});
export type PaginatedEstimates = z.infer<typeof paginatedEstimatesSchema>;
