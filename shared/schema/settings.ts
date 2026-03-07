import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, boolean, integer, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Contractors table — one row per tenant (company). All business-data tables
// reference this table via contractorId for multi-tenant isolation.
export const contractors = pgTable("contractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  bookingSlug: text("booking_slug").unique(), // URL-friendly slug for public booking page (e.g., /book/acme-hvac)
  timezone: text("timezone").default("America/New_York"), // Business timezone for availability calculations
  housecallProSyncStartDate: timestamp("housecall_pro_sync_start_date"), // Admin configurable sync start date
  defaultDialpadNumber: text("default_dialpad_number"), // Organization-wide default Dialpad phone number
  dialpadActivityLastSyncAt: timestamp("dialpad_activity_last_sync_at"), // Last time Dialpad activities were synced
  dialpadActivitySyncEnabled: boolean("dialpad_activity_sync_enabled").default(true).notNull(), // Enable/disable automatic activity sync
  webhookApiKey: varchar("webhook_api_key").default(sql`encode(gen_random_bytes(32), 'hex')`), // API key for webhook authentication
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContractorSchema = createInsertSchema(contractors).omit({
  id: true,
  createdAt: true,
});
export type InsertContractor = z.infer<typeof insertContractorSchema>;
export type Contractor = typeof contractors.$inferSelect;

// Terminology settings table for customizable navigation labels per contractor
export const terminologySettings = pgTable("terminology_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id).unique(),
  // Navigation labels - defaults match current system
  leadLabel: text("lead_label").notNull().default("Lead"),
  leadsLabel: text("leads_label").notNull().default("Leads"),
  estimateLabel: text("estimate_label").notNull().default("Estimate"),
  estimatesLabel: text("estimates_label").notNull().default("Estimates"),
  jobLabel: text("job_label").notNull().default("Job"),
  jobsLabel: text("jobs_label").notNull().default("Jobs"),
  messageLabel: text("message_label").notNull().default("Message"),
  messagesLabel: text("messages_label").notNull().default("Messages"),
  templateLabel: text("template_label").notNull().default("Template"),
  templatesLabel: text("templates_label").notNull().default("Templates"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTerminologySettingsSchema = createInsertSchema(terminologySettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTerminologySettings = z.infer<typeof insertTerminologySettingsSchema>;
export type TerminologySettings = typeof terminologySettings.$inferSelect;

// Business metric targets table for custom performance targets per contractor
export const businessTargets = pgTable("business_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  speedToLeadMinutes: integer("speed_to_lead_minutes").notNull().default(60), // Target response time in minutes
  followUpRatePercent: decimal("follow_up_rate_percent", { precision: 5, scale: 2 }).notNull().default(sql`80.00`), // Target follow-up rate percentage
  setRatePercent: decimal("set_rate_percent", { precision: 5, scale: 2 }).notNull().default(sql`40.00`), // Target set rate percentage (leads to estimates)
  closeRatePercent: decimal("close_rate_percent", { precision: 5, scale: 2 }).notNull().default(sql`25.00`), // Target close rate percentage (estimates to jobs)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorIdIdx: index("business_targets_contractor_id_idx").on(table.contractorId),
}));

export const insertBusinessTargetsSchema = createInsertSchema(businessTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBusinessTargets = z.infer<typeof insertBusinessTargetsSchema>;
export type BusinessTargets = typeof businessTargets.$inferSelect;
