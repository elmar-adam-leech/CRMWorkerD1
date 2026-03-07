import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { activityTypeEnum } from "./enums";
import { contractors } from "./settings";
import { users } from "./users";
import { contacts } from "./contacts";
import { estimates } from "./estimates";
import { jobs } from "./jobs";

// Activities table for tracking timestamped notes and interactions
export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: activityTypeEnum("type").notNull().default("note"),
  title: text("title"),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string for additional data (e.g., email subject, to/from for emails)
  // Link to different entity types
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }), // Unified contact reference
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  // Who created this activity
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  // External system tracking (e.g., synced from Dialpad, Gmail)
  externalId: varchar("external_id"), // External system ID (e.g., Gmail message ID)
  externalSource: varchar("external_source"), // External system name (e.g., 'dialpad', 'gmail')
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("activities_contractor_id_idx").on(table.contractorId),
  typeIdx: index("activities_type_idx").on(table.type),
  contactIdIdx: index("activities_contact_id_idx").on(table.contactId),
  estimateIdIdx: index("activities_estimate_id_idx").on(table.estimateId),
  jobIdIdx: index("activities_job_id_idx").on(table.jobId),
  userIdIdx: index("activities_user_id_idx").on(table.userId),
  createdAtIdx: index("activities_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  contractorTypeIdx: index("activities_contractor_type_idx").on(table.contractorId, table.type),
  contractorContactIdx: index("activities_contractor_contact_idx").on(table.contractorId, table.contactId),
  contractorDateIdx: index("activities_contractor_date_idx").on(table.contractorId, table.createdAt),
  // Index for external system lookups
  externalLookupIdx: index("activities_external_lookup_idx").on(table.externalSource, table.externalId),
  // Composite index for conversation-style email queries (type filter + contact lookup)
  contractorTypeContactIdx: index("activities_contractor_type_contact_idx").on(table.contractorId, table.type, table.contactId),
  // Composite index for the most common getActivities() access pattern:
  // contractorId + contactId filtered, then ordered by createdAt.
  // Without this, Postgres intersects the separate contractorId and contactId indexes,
  // which is slower than a single covering index scan.
  contractorContactDateIdx: index("activities_contractor_contact_date_idx").on(table.contractorId, table.contactId, table.createdAt),
}));

export const insertActivitySchema = createInsertSchema(activities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;
