import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { messageTypeEnum, messageStatusEnum, messageDirectionEnum, templateTypeEnum, templateStatusEnum } from "./enums";
import { contractors } from "./settings";
import { users } from "./users";
import { contacts } from "./contacts";
import { estimates } from "./estimates";

// Messages table for texting functionality
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: messageTypeEnum("type").notNull().default("text"),
  status: messageStatusEnum("status").notNull().default("sent"),
  direction: messageDirectionEnum("direction").notNull().default("outbound"), // Track if message is inbound or outbound
  content: text("content").notNull(),
  toNumber: text("to_number").notNull(),
  fromNumber: text("from_number"),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "cascade" }), // Unified contact reference
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }), // Optional estimate context
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }), // Track which user sent the message (for outbound) or assigned to (for inbound)
  externalMessageId: text("external_message_id"), // Dialpad message ID for tracking
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("messages_contractor_id_idx").on(table.contractorId),
  contactIdIdx: index("messages_contact_id_idx").on(table.contactId),
  toNumberIdx: index("messages_to_number_idx").on(table.toNumber),
  fromNumberIdx: index("messages_from_number_idx").on(table.fromNumber),
  directionIdx: index("messages_direction_idx").on(table.direction),
  createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
  estimateIdIdx: index("messages_estimate_id_idx").on(table.estimateId),
  // Composite index for phone conversation lookups
  contractorPhoneIdx: index("messages_contractor_phone_idx").on(table.contractorId, table.toNumber),
  // Composite index for contractor + contact queries
  contractorContactIdx: index("messages_contractor_contact_idx").on(table.contractorId, table.contactId),
  // Index for webhook/sync lookups by external message ID
  externalMessageIdIdx: index("messages_external_message_id_idx").on(table.externalMessageId),
  // Composite index for conversation timeline queries
  contractorContactCreatedIdx: index("messages_contractor_contact_created_idx").on(table.contractorId, table.contactId, table.createdAt),
}));

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Webhooks table for tracking webhook configurations
export const webhooks = pgTable("webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  service: varchar("service").notNull(), // 'dialpad', 'housecall-pro', etc.
  webhookType: varchar("webhook_type").notNull(), // 'sms', 'call', 'estimate', etc.
  externalWebhookId: varchar("external_webhook_id"), // ID from external service (e.g., Dialpad webhook ID)
  webhookUrl: text("webhook_url").notNull(), // The URL endpoint to receive webhooks
  isActive: boolean("is_active").notNull().default(true),
  lastReceivedAt: timestamp("last_received_at"), // Last time we received a webhook
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("webhooks_contractor_id_idx").on(table.contractorId),
  serviceIdx: index("webhooks_service_idx").on(table.service),
  webhookTypeIdx: index("webhooks_webhook_type_idx").on(table.webhookType),
  isActiveIdx: index("webhooks_is_active_idx").on(table.isActive),
  // Composite index for finding active webhooks by service
  contractorServiceIdx: index("webhooks_contractor_service_idx").on(table.contractorId, table.service),
}));

export const insertWebhookSchema = createInsertSchema(webhooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

// Webhook events table for logging all webhook events received.
//
// Growth concern: this table accumulates every incoming webhook event indefinitely. At
// 10x write volume (high Dialpad/HCP traffic) the GIN indexes on `payload` and the
// multiple B-tree indexes will degrade write throughput significantly. The standard
// approach is a scheduled job that archives or hard-deletes processed rows older than
// N days (e.g. 30 days). The `processedCreatedAtIdx` composite index is designed to
// make that DELETE efficient (index-only scan on processed + createdAt).
// TODO: Implement a scheduled cleanup job to archive/delete processed webhook_events older than N days.
export const webhookEvents = pgTable("webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").references(() => webhooks.id),
  contractorId: varchar("contractor_id").references(() => contractors.id), // Nullable to allow logging before contractor is identified
  service: varchar("service").notNull(), // 'dialpad', 'housecall-pro', etc.
  eventType: varchar("event_type").notNull(), // 'sms.received', 'call.completed', etc.
  payload: text("payload").notNull(), // Full JSON payload from webhook
  processed: boolean("processed").notNull().default(false),
  processedAt: timestamp("processed_at"),
  errorMessage: text("error_message"), // Store any processing errors
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  webhookIdIdx: index("webhook_events_webhook_id_idx").on(table.webhookId),
  contractorIdIdx: index("webhook_events_contractor_id_idx").on(table.contractorId),
  serviceIdx: index("webhook_events_service_idx").on(table.service),
  eventTypeIdx: index("webhook_events_event_type_idx").on(table.eventType),
  processedIdx: index("webhook_events_processed_idx").on(table.processed),
  createdAtIdx: index("webhook_events_created_at_idx").on(table.createdAt),
  // Composite index for finding unprocessed events
  processedCreatedAtIdx: index("webhook_events_processed_created_at_idx").on(table.processed, table.createdAt),
  // Partial index specifically for the background processor's unprocessed event lookup.
  // Because processed=true rows vastly outnumber processed=false rows over time,
  // a partial index skips the large processed section entirely.
  unprocessedIdx: index("webhook_events_unprocessed_idx").on(table.createdAt).where(sql`processed = false`),
}));

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

// Templates table for text and email templates
export const templates = pgTable("templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  type: templateTypeEnum("type").notNull(),
  status: templateStatusEnum("status").notNull().default("pending_approval"),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorIdIdx: index("templates_contractor_id_idx").on(table.contractorId),
  typeIdx: index("templates_type_idx").on(table.type),
}));

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  status: true,
  approvedBy: true,
  approvedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

// Calls table for tracking Dialpad calls with contractor isolation
export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  externalCallId: varchar("external_call_id").notNull(), // Dialpad call ID
  toNumber: varchar("to_number").notNull(),
  fromNumber: varchar("from_number"),
  status: varchar("status").notNull().default("initiated"),
  contactId: varchar("contact_id").references(() => contacts.id), // Unified contact reference
  userId: varchar("user_id").references(() => users.id), // Track which user made the call
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  callUrl: text("call_url"),
  metadata: text("metadata"), // JSON string for additional call data
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("calls_contractor_id_idx").on(table.contractorId),
  contactIdIdx: index("calls_contact_id_idx").on(table.contactId),
  externalCallIdIdx: index("calls_external_call_id_idx").on(table.externalCallId),
  toNumberIdx: index("calls_to_number_idx").on(table.toNumber),
  fromNumberIdx: index("calls_from_number_idx").on(table.fromNumber),
  statusIdx: index("calls_status_idx").on(table.status),
  userIdIdx: index("calls_user_id_idx").on(table.userId),
  createdAtIdx: index("calls_created_at_idx").on(table.createdAt),
  // Composite indexes for common queries
  contractorContactIdx: index("calls_contractor_contact_idx").on(table.contractorId, table.contactId),
}));

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;
