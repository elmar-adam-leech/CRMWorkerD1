import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, decimal, pgEnum, boolean, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["super_admin", "admin", "manager", "user"]);
export const contactTypeEnum = pgEnum("contact_type", ["lead", "customer", "inactive"]);
export const contactStatusEnum = pgEnum("contact_status", ["new", "contacted", "scheduled", "active", "disqualified", "inactive"]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "qualified", "converted", "disqualified"]);
export const jobStatusEnum = pgEnum("job_status", ["scheduled", "in_progress", "completed", "cancelled"]);
export const jobPriorityEnum = pgEnum("job_priority", ["low", "medium", "high"]);
export const estimateStatusEnum = pgEnum("estimate_status", ["draft", "sent", "pending", "approved", "rejected"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "email"]);
export const messageStatusEnum = pgEnum("message_status", ["sent", "delivered", "failed"]);
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const templateTypeEnum = pgEnum("template_type", ["text", "email"]);
export const templateStatusEnum = pgEnum("template_status", ["draft", "pending_approval", "approved", "rejected"]);
export const providerTypeEnum = pgEnum("provider_type", ["email", "sms", "calling"]);
export const emailProviderEnum = pgEnum("email_provider", ["gmail", "sendgrid", "outlook", "mailgun"]);
export const smsProviderEnum = pgEnum("sms_provider", ["dialpad", "twilio", "messagebird", "nexmo"]);
export const callingProviderEnum = pgEnum("calling_provider", ["dialpad", "twilio", "ringcentral", "zoom"]);
export const activityTypeEnum = pgEnum("activity_type", ["note", "call", "email", "sms", "meeting", "follow_up", "status_change"]);
export const dialpadOwnerTypeEnum = pgEnum("dialpad_owner_type", ["user", "department", "company"]);
export const dialpadSyncStatusEnum = pgEnum("dialpad_sync_status", ["pending", "in_progress", "completed", "failed"]);
export const notificationTypeEnum = pgEnum("notification_type", ["lead_assigned", "estimate_approved", "estimate_rejected", "job_completed", "new_message", "follow_up_due", "system"]);
export const workflowTriggerTypeEnum = pgEnum("workflow_trigger_type", ["entity_created", "entity_updated", "status_changed", "field_changed", "time_based", "manual"]);
export const workflowActionTypeEnum = pgEnum("workflow_action_type", ["send_email", "send_sms", "create_notification", "update_entity", "assign_user", "ai_generate_content", "ai_analyze", "conditional_branch", "delay", "wait_until"]);
export const workflowExecutionStatusEnum = pgEnum("workflow_execution_status", ["pending", "running", "completed", "failed", "cancelled"]);
export const workflowApprovalStatusEnum = pgEnum("workflow_approval_status", ["approved", "pending_approval", "rejected"]);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(), // Removed unique constraint to allow same email across companies
  role: userRoleEnum("role").notNull().default("user"), // Legacy field, role now in user_contractors
  contractorId: varchar("contractor_id").references(() => contractors.id), // Current/active contractor for this session
  dialpadDefaultNumber: text("dialpad_default_number"), // Legacy field, now in user_contractors
  gmailConnected: boolean("gmail_connected").default(false).notNull(), // Whether user has connected their Gmail account
  gmailRefreshToken: text("gmail_refresh_token"), // Encrypted Gmail OAuth refresh token for this user
  gmailEmail: text("gmail_email"), // The Gmail address this user connected
  gmailLastSyncAt: timestamp("gmail_last_sync_at"), // Last time we synced emails from Gmail
  gmailSyncHistoryId: text("gmail_sync_history_id"), // Gmail API history ID for incremental sync
  canManageIntegrations: boolean("can_manage_integrations").default(false).notNull(), // Legacy field, now in user_contractors
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User-Contractor junction table (many-to-many relationship)
// Allows users to belong to multiple contractors with different roles per contractor
export const userContractors = pgTable("user_contractors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").notNull().default("user"), // Role specific to this contractor
  dialpadDefaultNumber: text("dialpad_default_number"), // Per-contractor default Dialpad number
  canManageIntegrations: boolean("can_manage_integrations").default(false).notNull(),
  // Salesperson scheduling fields
  isSalesperson: boolean("is_salesperson").default(false).notNull(), // Whether this user is a salesperson for scheduling
  housecallProUserId: text("housecall_pro_user_id"), // HCP user ID for calendar sync
  lastAssignmentAt: timestamp("last_assignment_at"), // Last time this salesperson was assigned a booking
  calendarColor: text("calendar_color"), // Color for display in combined calendar view
  // Working hours settings (synced from HCP or customized)
  workingDays: integer("working_days").array().default(sql`'{1,2,3,4,5}'`), // Days of week (0=Sun, 1=Mon, ..., 6=Sat)
  workingHoursStart: text("working_hours_start").default("09:00"), // Start time HH:MM format
  workingHoursEnd: text("working_hours_end").default("17:00"), // End time HH:MM format
  hasCustomSchedule: boolean("has_custom_schedule").default(false).notNull(), // If true, HCP sync won't overwrite
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure a user can only be linked to a contractor once
  userContractorUnique: unique().on(table.userId, table.contractorId),
  // Indexes for common queries
  userIdIdx: index("user_contractors_user_id_idx").on(table.userId),
  contractorIdIdx: index("user_contractors_contractor_id_idx").on(table.contractorId),
  salespersonIdx: index("user_contractors_salesperson_idx").on(table.contractorId, table.isSalesperson),
}));

// Scheduled bookings table for tracking appointments
export const scheduledBookings = pgTable("scheduled_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  assignedSalespersonId: varchar("assigned_salesperson_id").notNull().references(() => users.id),
  contactId: varchar("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  housecallProEventId: text("housecall_pro_event_id"), // HCP calendar event ID
  title: text("title").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  status: text("status").notNull().default("confirmed"), // confirmed, cancelled, completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorIdx: index("scheduled_bookings_contractor_idx").on(table.contractorId),
  salespersonIdx: index("scheduled_bookings_salesperson_idx").on(table.assignedSalespersonId),
  startTimeIdx: index("scheduled_bookings_start_time_idx").on(table.startTime),
}));

// User invitations table
export const userInvitations = pgTable("user_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  inviteCode: text("invite_code").notNull().unique(),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  invitedBy: varchar("invited_by").notNull().references(() => users.id),
  acceptedAt: timestamp("accepted_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contractors table
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

// Contacts table (unified leads and customers)
// Stores deduplicated contact records - one record per unique person/company
export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  emails: text("emails").array().default(sql`'{}'`), // Support multiple email addresses
  phones: text("phones").array().default(sql`'{}'`), // Support multiple phone numbers
  address: text("address"),
  type: contactTypeEnum("type").notNull().default("lead"), // lead, customer, or inactive
  status: contactStatusEnum("status").notNull().default("new"), // Unified status for all contact types
  source: text("source"), // Where the contact came from (web form, referral, etc.)
  notes: text("notes"),
  tags: text("tags").array().default(sql`'{}'`), // Tags for segmentation and workflow targeting
  followUpDate: timestamp("follow_up_date"),
  // UTM and tracking fields
  utmSource: text("utm_source"), // UTM source (e.g., "google", "facebook")
  utmMedium: text("utm_medium"), // UTM medium (e.g., "cpc", "email", "social")
  utmCampaign: text("utm_campaign"), // UTM campaign name
  utmTerm: text("utm_term"), // UTM term (keywords)
  utmContent: text("utm_content"), // UTM content (ad content)
  pageUrl: text("page_url"), // Page URL where contact was captured
  // Housecall Pro integration fields
  housecallProCustomerId: varchar("housecall_pro_customer_id"), // Housecall Pro customer ID
  housecallProEstimateId: varchar("housecall_pro_estimate_id"), // Housecall Pro estimate ID if scheduled
  scheduledAt: timestamp("scheduled_at"), // When the estimate was scheduled
  scheduledEmployeeId: varchar("scheduled_employee_id"), // Housecall Pro employee ID
  isScheduled: boolean("is_scheduled").notNull().default(false), // Quick lookup for scheduled status
  contactedAt: timestamp("contacted_at"), // When the contact was first contacted (call, text, or email)
  contactedByUserId: varchar("contacted_by_user_id").references(() => users.id), // User who first contacted
  scheduledByUserId: varchar("scheduled_by_user_id").references(() => users.id), // User who scheduled the appointment
  // External system tracking fields
  externalId: varchar("external_id"), // External system ID (e.g., Housecall Pro customer ID)
  externalSource: varchar("external_source"), // External system name (e.g., 'housecall-pro')
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("contacts_contractor_id_idx").on(table.contractorId),
  typeIdx: index("contacts_type_idx").on(table.type),
  statusIdx: index("contacts_status_idx").on(table.status),
  isScheduledIdx: index("contacts_is_scheduled_idx").on(table.isScheduled),
  createdAtIdx: index("contacts_created_at_idx").on(table.createdAt),
  contactedAtIdx: index("contacts_contacted_at_idx").on(table.contactedAt),
  // Composite index for contractor + type queries
  contractorTypeIdx: index("contacts_contractor_type_idx").on(table.contractorId, table.type),
  // Composite index for contractor + status queries
  contractorStatusIdx: index("contacts_contractor_status_idx").on(table.contractorId, table.status),
  // Composite index for contractor + scheduled status queries
  contractorScheduledIdx: index("contacts_contractor_scheduled_idx").on(table.contractorId, table.isScheduled),
  // Composite index for contractor + date range queries
  contractorDateIdx: index("contacts_contractor_date_idx").on(table.contractorId, table.createdAt),
  // Composite index for external system lookups
  externalLookupIdx: index("contacts_external_lookup_idx").on(table.contractorId, table.externalSource, table.externalId),
  // Index for tag-based filtering in workflows
  tagsIdx: index("contacts_tags_idx").on(table.tags),
}));

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
}));

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
}));

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
}));

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
}));

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

// Webhook events table for logging all webhook events received
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
}));

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
});

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
});

// Contractor credentials table for secure per-contractor API key storage
export const contractorCredentials = pgTable("contractor_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("tenant_id").notNull().references(() => contractors.id),
  service: varchar("service").notNull(), // 'gmail', 'dialpad', etc.
  credentialKey: varchar("credential_key").notNull(), // 'api_key', 'client_id', etc.
  encryptedValue: text("encrypted_value").notNull(), // Encrypted credential value
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Ensure one credential type per service per tenant
}, (table) => ({
  contractorServiceKeyUnique: unique().on(table.contractorId, table.service, table.credentialKey),
}));

// Contractor provider preferences - which provider each contractor uses for each service type
export const contractorProviders = pgTable("contractor_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("tenant_id").notNull().references(() => contractors.id),
  providerType: providerTypeEnum("provider_type").notNull(), // 'email', 'sms', 'calling'
  emailProvider: emailProviderEnum("email_provider"), // Only set if providerType is 'email'
  smsProvider: smsProviderEnum("sms_provider"), // Only set if providerType is 'sms'
  callingProvider: callingProviderEnum("calling_provider"), // Only set if providerType is 'calling'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Ensure one provider per service type per contractor
}, (table) => ({
  contractorProviderTypeUnique: unique().on(table.contractorId, table.providerType),
}));

// Contractor integration enablement - explicit control over which integrations are enabled
export const contractorIntegrations = pgTable("contractor_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("tenant_id").notNull().references(() => contractors.id),
  integrationName: varchar("integration_name").notNull(), // 'dialpad', 'gmail', 'housecall-pro', etc.
  isEnabled: boolean("is_enabled").notNull().default(false), // Explicit enablement flag
  enabledAt: timestamp("enabled_at"), // When integration was enabled
  disabledAt: timestamp("disabled_at"), // When integration was disabled
  enabledBy: varchar("enabled_by").references(() => users.id), // User who enabled it
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Ensure one record per integration per contractor
}, (table) => ({
  contractorIntegrationUnique: unique().on(table.contractorId, table.integrationName),
}));

// Employee roles enum for internal role labeling
export const employeeRoleEnum = pgEnum("employee_role", [
  "sales",
  "technician", 
  "estimator",
  "dispatcher",
  "manager",
  "admin"
]);

// Employees table for storing and labeling team members from external sources
export const employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  externalSource: varchar("external_source"), // 'housecall-pro', null for manually added
  externalId: varchar("external_id"), // External system's employee ID
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  isActive: boolean("is_active").notNull().default(true),
  externalRole: text("external_role"), // Original role from external system
  roles: text("roles").array().notNull().default(sql`'{}'`), // Internal role labels
  department: text("department"), // Department assignment for phone number mapping
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorExternalUnique: unique().on(table.contractorId, table.externalSource, table.externalId),
}));

// Dialpad phone numbers table for storing available phone numbers and their capabilities
export const dialpadPhoneNumbers = pgTable("dialpad_phone_numbers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  phoneNumber: text("phone_number").notNull(), // The actual phone number
  dialpadId: text("dialpad_id"), // Dialpad's internal ID for this number
  displayName: text("display_name"), // Human-readable name for this number
  department: text("department"), // Which department this number belongs to
  canSendSms: boolean("can_send_sms").notNull().default(false), // SMS capability
  canReceiveSms: boolean("can_receive_sms").notNull().default(false), // SMS capability
  canMakeCalls: boolean("can_make_calls").notNull().default(false), // Calling capability
  canReceiveCalls: boolean("can_receive_calls").notNull().default(false), // Calling capability
  isActive: boolean("is_active").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"), // When capabilities were last checked
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorPhoneUnique: unique().on(table.contractorId, table.phoneNumber),
}));

// User phone number permissions - which users can send from which phone numbers
export const userPhoneNumberPermissions = pgTable("user_phone_number_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  phoneNumberId: varchar("phone_number_id").notNull().references(() => dialpadPhoneNumbers.id),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  canSendSms: boolean("can_send_sms").notNull().default(false),
  canMakeCalls: boolean("can_make_calls").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  assignedBy: varchar("assigned_by").references(() => users.id), // Who granted this permission
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userPhoneUnique: unique().on(table.userId, table.phoneNumberId),
}));

// Dialpad users cache - stores Dialpad user data for each contractor
export const dialpadUsers = pgTable("dialpad_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  dialpadUserId: text("dialpad_user_id").notNull(), // Dialpad's user ID (from API)
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  fullName: text("full_name"),
  isActive: boolean("is_active").notNull().default(true),
  department: text("department"), // User's primary department
  phoneNumbers: text("phone_numbers").array().default(sql`'{}'`), // User's assigned phone numbers
  lastSyncAt: timestamp("last_sync_at"), // When this user data was last synced
  syncChecksum: text("sync_checksum"), // For detecting changes
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorDialpadUserUnique: unique().on(table.contractorId, table.dialpadUserId),
}));

// Dialpad departments cache - stores Dialpad department data for each contractor  
export const dialpadDepartments = pgTable("dialpad_departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  dialpadDepartmentId: text("dialpad_department_id").notNull(), // Dialpad's department ID (from API)
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  phoneNumbers: text("phone_numbers").array().default(sql`'{}'`), // Department's assigned phone numbers
  userCount: integer("user_count").default(0), // Number of users in this department
  lastSyncAt: timestamp("last_sync_at"), // When this department data was last synced
  syncChecksum: text("sync_checksum"), // For detecting changes
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorDialpadDeptUnique: unique().on(table.contractorId, table.dialpadDepartmentId),
}));

// Dialpad sync jobs - tracks sync operations and status
export const dialpadSyncJobs = pgTable("dialpad_sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  syncType: text("sync_type").notNull(), // 'full', 'incremental', 'users', 'departments', 'numbers'
  status: dialpadSyncStatusEnum("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  recordsProcessed: integer("records_processed").default(0),
  recordsSuccess: integer("records_success").default(0),
  recordsError: integer("records_error").default(0),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at"), // When last successful sync happened
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  contractorIdIdx: index("dialpad_sync_jobs_contractor_id_idx").on(table.contractorId),
  statusIdx: index("dialpad_sync_jobs_status_idx").on(table.status),
  createdAtIdx: index("dialpad_sync_jobs_created_at_idx").on(table.createdAt),
  // Composite index for finding pending jobs by contractor
  contractorStatusIdx: index("dialpad_sync_jobs_contractor_status_idx").on(table.contractorId, table.status),
}));

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
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertContractorSchema = createInsertSchema(contractors).omit({
  id: true,
  createdAt: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  value: z.union([z.string(), z.number()]).transform(val => String(val)),
});

// Lightweight DTO for contact lists and pagination
export const contactSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  type: z.enum(["lead", "customer", "inactive"]),
  status: z.enum(["new", "contacted", "scheduled", "active", "disqualified", "inactive"]),
  source: z.string().nullable(),
  isScheduled: z.boolean(),
  contactedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  hasJobs: z.boolean().optional(),
});

// Paginated response schema for contacts
export const paginatedContactsSchema = z.object({
  data: z.array(contactSummarySchema),
  pagination: z.object({
    total: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  amount: z.union([z.string(), z.number()]).transform(val => String(val)),
});

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

// Paginated response schema for estimates
export const paginatedEstimatesSchema = z.object({
  data: z.array(estimateSummarySchema),
  pagination: z.object({
    total: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});

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

// Query parameter validation schema for jobs pagination
export const jobsPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "all"]).optional(),
  search: z.string().optional(),
});

// Paginated response schema for jobs
export const paginatedJobsSchema = z.object({
  data: z.array(jobSummarySchema),
  pagination: z.object({
    total: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWebhookEventSchema = createInsertSchema(webhookEvents).omit({
  id: true,
  createdAt: true,
});

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  status: true,
  approvedBy: true,
  approvedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCallSchema = createInsertSchema(calls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorCredentialSchema = createInsertSchema(contractorCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorProviderSchema = createInsertSchema(contractorProviders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertContractorIntegrationSchema = createInsertSchema(contractorIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateEmployeeRolesSchema = z.object({
  roles: z.array(z.enum(["sales", "technician", "estimator", "dispatcher", "manager", "admin"])).max(5)
});

export const insertActivitySchema = createInsertSchema(activities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBusinessTargetsSchema = createInsertSchema(businessTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDialpadPhoneNumberSchema = createInsertSchema(dialpadPhoneNumbers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserPhoneNumberPermissionSchema = createInsertSchema(userPhoneNumberPermissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDialpadUserSchema = createInsertSchema(dialpadUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDialpadDepartmentSchema = createInsertSchema(dialpadDepartments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDialpadSyncJobSchema = createInsertSchema(dialpadSyncJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const insertUserContractorSchema = createInsertSchema(userContractors).omit({ id: true, createdAt: true });
export type InsertUserContractor = z.infer<typeof insertUserContractorSchema>;
export type UserContractor = typeof userContractors.$inferSelect;

export const insertScheduledBookingSchema = createInsertSchema(scheduledBookings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScheduledBooking = z.infer<typeof insertScheduledBookingSchema>;
export type ScheduledBooking = typeof scheduledBookings.$inferSelect;

export type InsertContractor = z.infer<typeof insertContractorSchema>;
export type Contractor = typeof contractors.$inferSelect;

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect & { hasJobs?: boolean };
export type ContactSummary = z.infer<typeof contactSummarySchema>;
export type PaginatedContacts = z.infer<typeof paginatedContactsSchema>;

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type PaginatedJobs = z.infer<typeof paginatedJobsSchema>;

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;
export type EstimateSummary = z.infer<typeof estimateSummarySchema>;
export type PaginatedEstimates = z.infer<typeof paginatedEstimatesSchema>;

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type Template = typeof templates.$inferSelect;

export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

export type InsertContractorCredential = z.infer<typeof insertContractorCredentialSchema>;
export type ContractorCredential = typeof contractorCredentials.$inferSelect;

export type InsertContractorProvider = z.infer<typeof insertContractorProviderSchema>;
export type ContractorProvider = typeof contractorProviders.$inferSelect;

export type InsertContractorIntegration = z.infer<typeof insertContractorIntegrationSchema>;
export type ContractorIntegration = typeof contractorIntegrations.$inferSelect;

export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activities.$inferSelect;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;
export type UpdateEmployeeRoles = z.infer<typeof updateEmployeeRolesSchema>;

export type InsertBusinessTargets = z.infer<typeof insertBusinessTargetsSchema>;
export type BusinessTargets = typeof businessTargets.$inferSelect;

export type InsertDialpadPhoneNumber = z.infer<typeof insertDialpadPhoneNumberSchema>;
export type DialpadPhoneNumber = typeof dialpadPhoneNumbers.$inferSelect;

export type InsertUserPhoneNumberPermission = z.infer<typeof insertUserPhoneNumberPermissionSchema>;
export type UserPhoneNumberPermission = typeof userPhoneNumberPermissions.$inferSelect;

export type InsertDialpadUser = z.infer<typeof insertDialpadUserSchema>;
export type DialpadUser = typeof dialpadUsers.$inferSelect;

export type InsertDialpadDepartment = z.infer<typeof insertDialpadDepartmentSchema>;
export type DialpadDepartment = typeof dialpadDepartments.$inferSelect;

export type InsertDialpadSyncJob = z.infer<typeof insertDialpadSyncJobSchema>;
export type DialpadSyncJob = typeof dialpadSyncJobs.$inferSelect;

export const insertUserInvitationSchema = createInsertSchema(userInvitations).omit({
  id: true,
  createdAt: true,
});
export type InsertUserInvitation = z.infer<typeof insertUserInvitationSchema>;
export type UserInvitation = typeof userInvitations.$inferSelect;

// Sync schedules table for background job scheduling
export const syncFrequencyEnum = pgEnum("sync_frequency", ["daily", "weekly", "hourly", "every-5-minutes"]);

export const syncSchedules = pgTable("sync_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id),
  integrationName: varchar("integration_name").notNull(), // e.g., 'gmail', 'housecall-pro'
  frequency: syncFrequencyEnum("frequency").notNull().default("daily"),
  lastSyncAt: timestamp("last_sync_at"),
  nextSyncAt: timestamp("next_sync_at").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure only one schedule per contractor per integration
  contractorIntegrationUnique: unique("sync_schedules_contractor_integration_unique").on(table.contractorId, table.integrationName),
  // Index for finding schedules that need to run
  nextSyncAtIdx: index("sync_schedules_next_sync_at_idx").on(table.nextSyncAt, table.isEnabled),
}));

export const insertSyncScheduleSchema = createInsertSchema(syncSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSyncSchedule = z.infer<typeof insertSyncScheduleSchema>;
export type SyncSchedule = typeof syncSchedules.$inferSelect;

// Password reset tokens table
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  createdAt: true,
});
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Terminology settings table for customizable navigation labels
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

// Notifications table for user notifications
export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"), // Optional URL to navigate to
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Index for fetching user's notifications
  userIdIdx: index("notifications_user_id_idx").on(table.userId),
  contractorIdIdx: index("notifications_contractor_id_idx").on(table.contractorId),
  // Composite index for unread notifications query
  userUnreadIdx: index("notifications_user_unread_idx").on(table.userId, table.read),
  createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
}));

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// Workflows table for automation workflows
export const workflows = pgTable("workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(false),
  triggerType: workflowTriggerTypeEnum("trigger_type").notNull(),
  triggerConfig: text("trigger_config").notNull(), // JSON config for trigger (entity type, field, conditions, etc.)
  approvalStatus: workflowApprovalStatusEnum("approval_status").notNull().default("pending_approval"),
  approvedBy: varchar("approved_by").references(() => users.id), // Admin who approved/rejected the workflow
  approvedAt: timestamp("approved_at"), // When workflow was approved/rejected
  rejectionReason: text("rejection_reason"), // Optional reason for rejection
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  contractorIdIdx: index("workflows_contractor_id_idx").on(table.contractorId),
  isActiveIdx: index("workflows_is_active_idx").on(table.isActive),
  triggerTypeIdx: index("workflows_trigger_type_idx").on(table.triggerType),
  approvalStatusIdx: index("workflows_approval_status_idx").on(table.approvalStatus),
  contractorActiveIdx: index("workflows_contractor_active_idx").on(table.contractorId, table.isActive),
  contractorApprovalIdx: index("workflows_contractor_approval_idx").on(table.contractorId, table.approvalStatus),
}));

export const insertWorkflowSchema = createInsertSchema(workflows).omit({
  id: true,
  contractorId: true,
  approvalStatus: true,
  approvedBy: true,
  approvedAt: true,
  rejectionReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflow = z.infer<typeof insertWorkflowSchema>;
export type Workflow = typeof workflows.$inferSelect;

// Workflow steps table for individual actions in a workflow
export const workflowSteps = pgTable("workflow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  actionType: workflowActionTypeEnum("action_type").notNull(),
  actionConfig: text("action_config").notNull(), // JSON config for action (email template, field updates, AI prompts, etc.)
  parentStepId: varchar("parent_step_id"), // For conditional branches - self-reference
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  workflowIdIdx: index("workflow_steps_workflow_id_idx").on(table.workflowId),
  workflowOrderIdx: index("workflow_steps_workflow_order_idx").on(table.workflowId, table.stepOrder),
}));

export const insertWorkflowStepSchema = createInsertSchema(workflowSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkflowStep = z.infer<typeof insertWorkflowStepSchema>;
export type WorkflowStep = typeof workflowSteps.$inferSelect;

// Workflow executions table for tracking workflow runs
export const workflowExecutions = pgTable("workflow_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  contractorId: varchar("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  status: workflowExecutionStatusEnum("status").notNull().default("pending"),
  triggerData: text("trigger_data"), // JSON data about what triggered the workflow (entity ID, field values, etc.)
  executionLog: text("execution_log"), // JSON log of each step execution with results/errors
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  workflowIdIdx: index("workflow_executions_workflow_id_idx").on(table.workflowId),
  contractorIdIdx: index("workflow_executions_contractor_id_idx").on(table.contractorId),
  statusIdx: index("workflow_executions_status_idx").on(table.status),
  createdAtIdx: index("workflow_executions_created_at_idx").on(table.createdAt),
  workflowStatusIdx: index("workflow_executions_workflow_status_idx").on(table.workflowId, table.status),
}));

export const insertWorkflowExecutionSchema = createInsertSchema(workflowExecutions).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkflowExecution = z.infer<typeof insertWorkflowExecutionSchema>;
export type WorkflowExecution = typeof workflowExecutions.$inferSelect;

// OAuth states table for persisting OAuth state tokens (CSRF protection)
// Used for Gmail OAuth flow to survive server restarts and support multi-instance deployments
export const oauthStates = pgTable("oauth_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  state: text("state").notNull().unique(), // The random state token
  userId: varchar("user_id").notNull(), // User initiating the OAuth flow
  redirectHost: text("redirect_host").notNull(), // Domain for OAuth callback
  expiresAt: timestamp("expires_at").notNull(), // State expiration time (10 minutes from creation)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  stateIdx: index("oauth_states_state_idx").on(table.state),
  expiresAtIdx: index("oauth_states_expires_at_idx").on(table.expiresAt),
}));

export const insertOAuthStateSchema = createInsertSchema(oauthStates).omit({
  id: true,
  createdAt: true,
});
export type InsertOAuthState = z.infer<typeof insertOAuthStateSchema>;
export type OAuthState = typeof oauthStates.$inferSelect;
