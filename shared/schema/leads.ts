import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { leadStatusEnum } from "./enums";
import { contractors } from "./settings";
import { users } from "./users";
import { contacts } from "./contacts";
import { estimates } from "./estimates";
import { jobs } from "./jobs";

// Leads table - tracks individual lead submissions
// Each submission creates a new lead record, even if from the same contact
// This allows tracking multiple inquiries from the same person over time
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }), // Link to deduplicated contact
  status: leadStatusEnum("status").notNull().default("new"), // Lead-specific status
  source: text("source"), // Where this specific lead submission came from
  message: text("message"), // Message or notes from this submission
  housecallProLeadId: varchar("housecall_pro_lead_id"), // HCP lead ID for syncing
  // UTM tracking for this specific submission
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  pageUrl: text("page_url"), // Page where this lead was submitted
  rawPayload: text("raw_payload"), // Store the raw webhook payload for debugging
  archived: boolean("archived").notNull().default(false), // Archived leads are hidden from main view but not deleted
  followUpDate: timestamp("follow_up_date"), // Follow-up date for this specific lead
  convertedAt: timestamp("converted_at"), // When this lead was converted to customer/estimate/job
  convertedToEstimateId: varchar("converted_to_estimate_id").references(() => estimates.id), // If converted to estimate
  convertedToJobId: varchar("converted_to_job_id").references(() => jobs.id), // If converted to job
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id), // User assigned to follow up
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  contractorIdIdx: index("leads_contractor_id_idx").on(table.contractorId),
  contactIdIdx: index("leads_contact_id_idx").on(table.contactId),
  statusIdx: index("leads_status_idx").on(table.status),
  createdAtIdx: index("leads_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  contractorStatusIdx: index("leads_contractor_status_idx").on(table.contractorId, table.status),
  contractorDateIdx: index("leads_contractor_date_idx").on(table.contractorId, table.createdAt),
  contactCreatedIdx: index("leads_contact_created_idx").on(table.contactId, table.createdAt),
  assignedToUserIdIdx: index("leads_assigned_to_user_id_idx").on(table.assignedToUserId),
  // Indexes for conversion tracking queries (e.g., finding which estimate/job a lead became)
  convertedToEstimateIdIdx: index("leads_converted_to_estimate_id_idx").on(table.convertedToEstimateId),
  convertedToJobIdIdx: index("leads_converted_to_job_id_idx").on(table.convertedToJobId),
}));

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
