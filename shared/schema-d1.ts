import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, blob } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Helper function to generate UUIDs in SQLite
const generateId = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))`;

// Users table
export const users = sqliteTable("users", {
  id: text("id").primaryKey().default(generateId),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("user"), // 'admin', 'manager', 'user'
  tenantId: text("tenant_id").references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Tenants table
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey().default(generateId),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Customers table
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey().default(generateId),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  status: text("status").notNull().default("lead"), // 'active', 'lead', 'inactive'
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Jobs table
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey().default(generateId),
  title: text("title").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("scheduled"), // 'scheduled', 'in_progress', 'completed', 'cancelled'
  priority: text("priority").notNull().default("medium"), // 'low', 'medium', 'high'
  value: real("value").notNull(), // Using real for decimal values
  estimatedHours: integer("estimated_hours"),
  scheduledDate: text("scheduled_date"), // ISO string format
  customerId: text("customer_id").notNull().references(() => customers.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Leads table
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey().default(generateId),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  source: text("source"),
  notes: text("notes"),
  followUpDate: text("follow_up_date"), // ISO string format
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Estimates table
export const estimates = sqliteTable("estimates", {
  id: text("id").primaryKey().default(generateId),
  title: text("title").notNull(),
  description: text("description"),
  amount: real("amount").notNull(), // Using real for decimal values
  status: text("status").notNull().default("draft"), // 'draft', 'sent', 'approved', 'rejected'
  validUntil: text("valid_until"), // ISO string format
  customerId: text("customer_id").notNull().references(() => customers.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Messages table for texting functionality
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey().default(generateId),
  type: text("type").notNull().default("text"), // 'text', 'email'
  status: text("status").notNull().default("sent"), // 'sent', 'delivered', 'failed'
  content: text("content").notNull(),
  toNumber: text("to_number").notNull(),
  fromNumber: text("from_number"),
  leadId: text("lead_id").references(() => leads.id),
  estimateId: text("estimate_id").references(() => estimates.id),
  customerId: text("customer_id").references(() => customers.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Templates table for text and email templates
export const templates = sqliteTable("templates", {
  id: text("id").primaryKey().default(generateId),
  title: text("title").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull(), // 'text', 'email'
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Calls table for tracking calls with tenant isolation
export const calls = sqliteTable("calls", {
  id: text("id").primaryKey().default(generateId),
  externalCallId: text("external_call_id").notNull(), // Provider call ID
  toNumber: text("to_number").notNull(),
  fromNumber: text("from_number"),
  status: text("status").notNull().default("initiated"),
  customerId: text("customer_id").references(() => customers.id),
  leadId: text("lead_id").references(() => leads.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  callUrl: text("call_url"),
  metadata: text("metadata"), // JSON string for additional call data
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Tenant credentials table for secure per-tenant API key storage
export const tenantCredentials = sqliteTable("tenant_credentials", {
  id: text("id").primaryKey().default(generateId),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  service: text("service").notNull(), // 'gmail', 'dialpad', etc.
  credentialKey: text("credential_key").notNull(), // 'api_key', 'client_id', etc.
  encryptedValue: text("encrypted_value").notNull(), // Encrypted credential value
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Tenant provider preferences - which provider each tenant uses for each service type
export const tenantProviders = sqliteTable("tenant_providers", {
  id: text("id").primaryKey().default(generateId),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  providerType: text("provider_type").notNull(), // 'email', 'sms', 'calling'
  emailProvider: text("email_provider"), // 'gmail', 'sendgrid', 'outlook', 'mailgun'
  smsProvider: text("sms_provider"), // 'dialpad', 'twilio', 'messagebird', 'nexmo'
  callingProvider: text("calling_provider"), // 'dialpad', 'twilio', 'ringcentral', 'zoom'
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertTenantSchema = createInsertSchema(tenants).omit({
  id: true,
  createdAt: true,
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTenantCredentialSchema = createInsertSchema(tenantCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTenantProviderSchema = createInsertSchema(tenantProviders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

export type InsertTenantCredential = z.infer<typeof insertTenantCredentialSchema>;
export type TenantCredential = typeof tenantCredentials.$inferSelect;

export type InsertTenantProvider = z.infer<typeof insertTenantProviderSchema>;
export type TenantProvider = typeof tenantProviders.$inferSelect;