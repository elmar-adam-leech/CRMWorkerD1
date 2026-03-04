# Multi-Tenant CRM System

## Overview
This project is a multi-tenant Customer Relationship Management (CRM) system designed for service-based businesses, particularly HVAC contractors. Its primary purpose is to streamline customer management, job tracking, estimates, lead nurturing, and communication. The system ensures data isolation between tenants, provides robust role-based access control, and allows users to belong to multiple companies with seamless switching. The overarching ambition is to offer a comprehensive, efficient solution for managing business operations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend utilizes React with TypeScript and Vite, employing Wouter for routing and TanStack Query for state management. The UI is built with a custom component library based on Radix UI primitives and Tailwind CSS, inspired by Pipedrive's design with shadcn/ui. It features a mobile-first responsive design, card-based layouts, and light/dark mode theming. A global command palette (`Cmd+K`) and context-aware keyboard shortcuts enhance productivity. All communication actions (call, email, text, schedule) are standardized using centralized components and hooks for consistency.

### Technical Implementations
The backend is built with Node.js and Express.js, offering a RESTful API with consistent error handling. PostgreSQL with Drizzle ORM provides type-safe database operations and multi-tenancy. Data validation is enforced using Zod schemas. Authentication uses JWT tokens with HTTP-only cookies and bcrypt for password hashing. Role-based access control and strict tenant data segregation are implemented. The system supports multi-contractor users, allowing users to belong to multiple companies via a `user_contractors` junction table, enabling seamless switching and per-contractor roles.

### Feature Specifications
- **Multi-Tenancy**: Complete data isolation and secure access control per tenant.
- **Leads, Estimates & Jobs**: Full CRUD operations, with a dual-entity architecture separating contacts (deduplicated identity) from leads (submission tracking). Supports multiple contacts per entity and features real-time updates via WebSockets for all entity operations.
- **Communication & Messaging**: SMS integration via Dialpad API, unified conversation threads (merging SMS and emails) across related entities, real-time updates via WebSockets, and automatic activity capture. Includes automatic data cleanup for orphaned activities and messages.
- **Gmail Integration**: Per-user OAuth for email, encrypted token storage, automatic inbox syncing, and email activity capture.
- **Unified Scheduling System**: Integrates with Housecall Pro, provides a unified calendar view across salespeople, enforces 1-hour appointment slots with 30-minute buffers, and uses an auto-assignment algorithm for salespeople. Includes API endpoints for availability, booking, and user syncing.
- **Workflow Automation Builder**: Visual, drag-and-drop builder using React Flow with custom node types (triggers, actions, AI actions, conditionals, delays). Features tag-based workflow filtering, a comprehensive dynamic variable system with nested data support, and pre-configured templates. Includes execution logs and a manual testing mode.

### Performance Optimizations
The system employs strategic database indexing (54 indexes), application caching using `memoizee` for frequently accessed data (user contractor relationships, settings), and query optimization (React Query configuration, pagination).

### System Design Choices
- **Frontend**: React, TypeScript, Vite, Wouter, TanStack Query, Radix UI, Tailwind CSS.
- **Backend**: Node.js, Express.js, PostgreSQL, Drizzle ORM, Zod.
- **Real-time**: WebSocket-based architecture.
- **Security**: HTTP-only cookies, role-based access control, AES-256-GCM encryption.

### Route Architecture

179 total routes split across a modular file structure. Core CRM routes live at the top level; third-party integration and inbound webhook routes are grouped into dedicated subdirectories:

```
server/routes/
  auth.ts              — login, register, OAuth, JWT
  users.ts             — user management, contractor switching
  contacts.ts          — contacts CRUD
  jobs-estimates.ts    — jobs and estimates CRUD
  employees.ts         — employee roles
  messaging.ts         — SMS, email, calls, conversations, templates
  workflows.ts         — workflow builder CRUD and execution
  ai.ts                — AI endpoints
  settings.ts          — contractor settings
  public.ts            — public/unauthenticated endpoints
  integrations/        — third-party integration management
    index.ts           — enable/disable/credentials/status/webhook-config (8 routes)
    dialpad.ts         — Dialpad phone numbers, sync, webhook config (13 routes)
    housecall-pro.ts   — HCP status, employees, scheduling, sync (16 routes)
    google-sheets.ts   — Google Sheets import pipeline (6 routes)
  webhooks/            — inbound webhooks from external systems
    index.ts           — delegates to sub-registrars
    housecall-pro.ts   — inbound HCP events (HMAC-verified)
    leads.ts           — inbound lead webhook (API-key auth)
    estimates.ts       — inbound estimate webhook (API-key auth)
    jobs.ts            — inbound job webhook (API-key auth)
    dialpad-sms.ts     — Dialpad SMS webhook (tenant API-key auth)

server/sync-status-store.ts  — shared in-memory Map for sync progress tracking
```

### Storage Architecture

`server/storage.ts` is a thin orchestrator (~423 lines) exporting a single `storage` object that satisfies the `IStorage` interface. All method implementations live in domain-specific files under `server/storage/`:

```
server/storage-types.ts   — 23 Update* type aliases shared across domain files
server/storage/
  users.ts          — User, UserContractor, Contractor methods (userMethods)
  contacts.ts       — Contact, Lead, Deduplication, Dashboard methods (contactMethods)
  jobs-estimates.ts — Job, Estimate methods (jobEstimateMethods)
  messaging.ts      — Message, Template, Call, Activity methods (messagingMethods)
  integrations.ts   — Credentials, Providers, HCP, Employees, Business Targets (integrationMethods)
  dialpad.ts        — Dialpad phones, Permissions, Caching, Sync, Terminology, Notifications (dialpadMethods)
  workflows.ts      — Workflow, WorkflowStep, WorkflowExecution, enriched fetching (workflowMethods)
```

All external `import { storage } from "./storage"` imports are unchanged. The `IStorage` interface (in `storage.ts`) serves as the compile-time contract ensuring all methods are implemented.

### Settings Component Architecture

`client/src/pages/Settings.tsx` (218 lines) is a thin orchestrator: it owns all shared queries and side-effect state (businessTargets, terminologySettings, bookingSlugInput), then renders one of 6 tab components that each own their own mutations and local state.

```
client/src/components/settings/
  IntegrationsTab.tsx        — Integration list, credentials, enable/disable, HCP webhook dialog, provider selection, Dialpad sync. Owns its own mutations. Uses useCurrentUser() and useSyncStatus() hooks directly.
  AccountTab.tsx             — Profile info, Gmail card, public booking slug (URL + embed), team user management (add/list), navigation terminology editor. Owns addUser, saveBookingSlug, saveTerminology mutations.
  SecurityTab.tsx            — Placeholder for future security settings.
  TargetsTab.tsx             — Business performance targets (speed-to-lead, follow-up rate, set rate, close rate). Owns saveTargets mutation.
  WebhooksTab.tsx            — Inbound webhook URLs (leads/estimates), API key viewer, full documentation panel. Local-only state (selectedWebhook, showApiKey).
  SalespeopleTab.tsx         — Thin wrapper around SalespeopleManagement component.
  SalespeopleManagement.tsx  — Salespeople/scheduling tab (own queries, mutations, local state).
  GmailConnectionCard.tsx    — Gmail OAuth connect/disconnect/sync card (own mutations, URL-param handling).
```

## External Dependencies

### Core Framework Dependencies
- **React Ecosystem**: React, TypeScript, React Hook Form
- **State Management**: TanStack Query
- **Routing**: Wouter

### UI and Styling
- **UI Primitives**: Radix UI
- **CSS Framework**: Tailwind CSS
- **Iconography**: Lucide Icons
- **Fonts**: Google Fonts (Inter)

### Backend Services
- **Database**: Neon (serverless PostgreSQL)
- **ORM**: Drizzle Kit
- **Telephony**: Dialpad API

### Development Tools
- **Build Tools**: Vite, ESBuild
- **Type Safety**: TypeScript

### Integrations
- **Zapier**: For SMS message ingestion.
- **Google Cloud Platform**: For Gmail OAuth, Google Maps Places API autocomplete (address input in scheduling modal), and API access.
- **Housecall Pro**: For calendar management, scheduling, and real-time event webhooks. Webhook endpoint at `/api/webhooks/:contractorId/housecall-pro` handles `estimate.*`, `job.*`, and `customer.*` events with HMAC-SHA256 signature verification, per-tenant webhook secrets (stored via CredentialService under `housecallpro/webhook_secret`), event logging to `webhookEvents` table, and automatic workflow trigger dispatch via `workflowEngine.triggerWorkflowsForEvent()`.

### Environment Variables Required
- `GOOGLE_MAPS_API_KEY` (secret): Google Maps API key with Places API + Maps JavaScript API enabled. Must have your domain added to "Allowed HTTP referrers" in Google Cloud Console (API Keys → Restrictions).
- `DATABASE_URL`, `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `NODE_ENV`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `APP_URL`, `XAI_API_KEY`

### Workflow Builder Architecture

`client/src/pages/WorkflowBuilder.tsx` (~472 lines) keeps: state, 4 query hooks, 4 `useEffect` hooks, 3 mutations + `saveWorkflowSteps`, event handlers (node click, drag, delete, reset, template), and the thin layout render.

```
client/src/lib/workflow-utils.ts        — extractTriggerConfig(), NODE_ACTION_MAP, NODE_TO_ACTION, ACTION_TO_NODE (pure, no React dependency)
client/src/components/workflow/
  WorkflowHeader.tsx                    — ~165 lines: back button, workflow name input, templates trigger, test button, delete+confirm dialog, unsaved badge, save button, creator+approval+active toggle row. Props: workflowId, workflowName, workflow, creator, isDirty, isSaving, isDeleting + callbacks.
  WorkflowStatusAlert.tsx               — ~40 lines: pending/rejected alert with "View Approvals" link. Renders null when approved. Props: { workflow }.
```

### Workflow Node Form Architecture

`client/src/components/workflow/NodeEditDialog.tsx` (183 lines) is a thin dispatcher: it owns formData state + 4 TanStack Query calls, then renders the correct form component via a switch on node type.

```
client/src/components/workflow/node-forms/
  shared-fields.tsx          — VariableInputField, VariableTextareaField, AfterSendingSection, StatusOptions, insertVariableAtCursor utility
  TriggerNodeForm.tsx        — Entity event / time-based / manual trigger config with tag filter
  SendEmailNodeForm.tsx      — To/Subject/Body variable fields + admin fromEmail override + AfterSending
  SendSmsNodeForm.tsx        — To/Message variable fields + admin fromNumber override + AfterSending
  NotificationNodeForm.tsx   — Title/Message variable fields
  UpdateEntityNodeForm.tsx   — Entity type + field + value with live preview (needs setFormData for atomic multi-field update)
  AssignUserNodeForm.tsx     — Team member select (admin) or text input (non-admin)
  AiNodeForm.tsx             — Covers both aiGenerate (prompt textarea) and aiAnalyze (analysisType select)
  ConditionalNodeForm.tsx    — 3-column condition builder (field/operator/value) with preview + help text
  DelayNodeForm.tsx          — Duration value + unit (s/m/h/d) with multi-format parser
  WaitUntilNodeForm.tsx      — datetime-local input
```

Each form receives `(formData, handleChange)` props. Forms needing variable insertion (`SendEmail`, `SendSMS`, `Notification`, `AiGenerate`) create their own refs internally and call `insertVariableAtCursor` from `shared-fields.tsx`. `UpdateEntityNodeForm` additionally receives `setFormData` for atomic multi-field updates.

### Shared Component Library
Reusable components extracted to avoid duplication across Jobs, Estimates, and Leads pages:
- `DeleteConfirmDialog` — standardised AlertDialog for destructive confirmations
- `EditStatusModal` — Dialog with status-picker button grid; used by Leads page
- `StatusFilterBar` — Quick-filter badge row with counts; used by Jobs, Estimates, Leads
- `LoadMoreButton` — Cursor-pagination load trigger; used by Jobs, Estimates, Leads
- `ViewToggle` — Card/Kanban view switch; used by Jobs and Leads
- `FollowUpCard` (`client/src/components/FollowUpCard.tsx`) — Per-item card for the Follow-ups page. Shows contact name, follow-up date, overdue badge, and 4 action buttons (call, text, schedule, edit). Props: `{ item, onSetFollowUp, onCallContact, onTextContact, onSchedule, onEdit }`. Extracted from `Follow-ups.tsx` to reduce that file by ~150 lines.

### Card Utilities (`client/src/lib/card-utils.ts`)
- `getPriorityColor(priority: string): string` — Returns the Tailwind `border-l-4 border-l-*` class for a given priority level (high/medium/low). Previously duplicated verbatim in both `JobCard.tsx` and `EstimateCard.tsx`.
- `updateContactTags(contactId, newTags): Promise<void>` — PATCHes `/api/contacts/:id` with new tags, then invalidates `["/api/contacts/:id"]` and `["/api/contacts/paginated"]` query keys. Previously duplicated verbatim in both `JobCard.tsx` and `EstimateCard.tsx`.

### Shared UI Primitives (`client/src/components/ui/`)
- `DatePicker` (`date-picker.tsx`) — `<DatePicker value onChange placeholder? disabled? className? data-testid? />`. Wraps `Popover + Button(CalendarIcon) + Calendar`. Replaces the identical 8-line pattern previously hand-written in `CreateJobForm`, `CreateEstimateForm`, and `FilterPanel`.
- `ContactCombobox` (`contact-combobox.tsx`) — `<ContactCombobox value onChange error? />`. Self-contained component that owns the contacts query (`/api/contacts/paginated?limit=100`), filtering logic, inline customer creation dialog (name/email/phone), and the full Popover+Command UI. Replaces ~70 lines duplicated verbatim in `CreateJobForm` and `CreateEstimateForm`.

### Server Utilities (`server/utils/`)
- `asyncHandler` (`async-handler.ts`) — HOF wrapping `async (req, res, next)` route handlers: catches any thrown error and forwards it to `next(error)`. Eliminates per-handler `try { ... } catch { res.status(500) }` boilerplate. Applied to all simple-500-catch handlers in `contacts.ts`, `jobs-estimates.ts`, `messaging.ts`, and `users.ts`. A global 4-argument error handler in `server/routes.ts` receives these forwarded errors and returns a structured `{ message }` JSON response with the correct HTTP status.
- `parseBody` (`validate-body.ts`) — `parseBody<T>(schema: z.ZodType<T, any, any>, req, res): T | null`. Validates `req.body` via `schema.safeParse`. Returns parsed data on success or sends `res.status(400).json({ message, errors })` and returns `null` on failure. Applied to all Zod parse sites in `contacts.ts`, `jobs-estimates.ts`, and `messaging.ts`. Usage: `const data = parseBody(mySchema, req, res); if (!data) return;`.

### Page Preferences Hook
`usePagePreferences({ pageKey })` persists `viewMode`, `filterStatus`, `advancedFilters` to localStorage per page. Currently wired into Jobs and Leads.

### Known Pending Issues
- `GET /api/contacts/[object%20Object]` 404 — object being stringified as contact ID (source not yet traced)
- Several TypeScript errors in example/demo components (`examples/`) are pre-existing and don't affect production