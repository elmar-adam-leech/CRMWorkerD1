# Multi-Tenant CRM System

## Overview
This project is a multi-tenant Customer Relationship Management (CRM) system designed for service-based businesses, primarily HVAC contractors. It aims to streamline customer management, job tracking, estimates, lead nurturing, and communication. The system ensures data isolation between tenants, provides robust role-based access control, and allows users to belong to multiple companies with seamless switching. The vision is to provide a comprehensive, efficient solution for managing business operations and maximizing market potential.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend uses React with TypeScript, Vite, Wouter for routing, and TanStack Query for state management. It features a custom component library built with Radix UI primitives and Tailwind CSS, inspired by Pipedrive's design with shadcn/ui. The design is mobile-first, responsive, utilizes card-based layouts, and includes light/dark mode theming. Productivity is enhanced via a global command palette (`Cmd+K`) and context-aware keyboard shortcuts. All communication actions (call, email, text, schedule) are standardized through centralized components and hooks.

### Technical Implementations
The backend is built with Node.js and Express.js, providing a RESTful API with consistent error handling. PostgreSQL, managed with Drizzle ORM, ensures type-safe database operations and multi-tenancy. Data validation uses Zod schemas. Authentication is handled with JWT tokens, HTTP-only cookies, and bcrypt for password hashing. The system implements role-based access control and strict tenant data segregation, supporting multi-contractor users with seamless switching and per-contractor roles. Real-time updates are facilitated by WebSockets. Performance is optimized through database indexing, application caching, and query optimization.

### Feature Specifications
- **Multi-Tenancy**: Complete data isolation and secure access control per tenant.
- **Leads, Estimates & Jobs**: Full CRUD operations with a dual-entity architecture (contacts vs. leads) and real-time updates.
- **Communication & Messaging**: SMS integration, unified conversation threads, real-time updates, and automatic activity capture.
- **Gmail Integration**: Per-user OAuth, encrypted token storage, automatic inbox syncing, and email activity capture.
- **Unified Scheduling System**: Integration with external scheduling platforms, unified calendar views, appointment slot enforcement, and an auto-assignment algorithm for salespeople.
- **Workflow Automation Builder**: A visual, drag-and-drop builder using React Flow, supporting custom node types (triggers, actions, AI actions, conditionals, delays), tag-based filtering, dynamic variables, templates, execution logs, and manual testing.

### System Design Choices
- **Frontend**: React, TypeScript, Vite, Wouter, TanStack Query, Radix UI, Tailwind CSS.
- **Backend**: Node.js, Express.js, PostgreSQL, Drizzle ORM, Zod.
- **Real-time**: WebSocket-based architecture with reconnect/stale-data banner in DashboardLayout.
- **Security**: HTTP-only cookies, role-based access control, AES-256-GCM encryption, JWT revocation via `revoked_tokens` table (per-token logout), `tokenVersion` on `users` (sign-out-all-devices protection for stolen phones).
- **PWA**: `client/public/manifest.json` + meta tags in `index.html` — field techs can install to home screen with standalone display.
- **Mobile UX**: Fixed bottom nav bar (`MobileBottomNav.tsx`) on ≤767px screens with Leads/Estimates/Contacts/Messages/More; mobile-first page padding; responsive PageHeader stacking; mobile quick actions on Job and Estimate cards.
- **Call Preference**: Per-user setting (`callPreference` on `userContractors`, values: `'integration'` | `'personal'`, default `'integration'`). Configurable in Settings → Account → "Calling Preference" (only shown when a calling integration is active). When set to `'personal'`, the call button opens the device's native dialer (`tel:` link) instead of the calling integration modal, regardless of integration status.
- **Lead Archive**: Leads can be archived (soft-hidden) instead of deleted. `archived` boolean column on `leads` table (default `false`). Archive/restore via kebab menu on LeadCard. Leads page has an "Archived" toggle in the header to view/restore archived leads. Archived leads are excluded from status counts and default list/kanban views.
- **Contacts Page** (`/contacts`): Grid view of all contacts with lead/estimate/job counts. Click-to-open side sheet shows full contact details, record counts, quick-links to linked records, and a "Delete Contact Permanently" button. Delete removes all associated leads, estimates, jobs, messages, calls, and activities. Search supported.
- **Smart Delete**: Deleting a lead/estimate/job checks if the contact has any remaining records; if not, the contact is also deleted (orphan cleanup). `deleteContact` fully removes messages and calls rows (no null-ref orphans).

## Performance & Reliability Improvements (March 2026)

### Zombie Workflow Execution Recovery
- On every server startup, `workflowEngine.recoverZombieExecutions()` runs once and marks any workflow execution stuck in "running" status (older than 15 min) as "failed" with a clear reason. This prevents the DB table from accumulating zombie rows caused by server restarts during in-memory `setTimeout` delays.
- Added `storage.getStaleRunningExecutions(olderThan: Date)` to query cross-tenant running executions for recovery.

### Workflow Engine Improvements
- **Per-step timeout**: Each workflow step is now wrapped in `Promise.race` with a timeout — 30s for standard steps, 60s for AI steps. A hung API call no longer blocks the entire execution chain.
- **JSON parsing optimization**: `triggerConfig` is now parsed once per workflow *before* the filter loop in `triggerWorkflowsForEvent`, not once per filter iteration (previously O(N×M) parses, now O(N)).
- **Eliminated duplicate path traversal**: `getFieldValue` in `WorkflowEngine` now delegates dot-path traversal to the shared `getNestedValue` utility from `variable-replacer.ts` instead of duplicating the traversal logic inline.

### Cache TTL
- `getWorkflowStepsCached` TTL increased from 60s → 5 minutes. Manual invalidation via `invalidateWorkflowStepsCache(workflowId)` is called on all step-mutation routes, making the longer TTL safe.

### Dialpad Service Retry Logic
- Read-only Dialpad API calls (`getCompanyNumbers`, `getCompanyUsers`, `getDepartments`) now use the shared `withRetry` + `dialpadFetch` pattern that throws on 429/5xx and retries up to 3 times with exponential backoff. Write operations (sendText, sendCall) are intentionally NOT retried to prevent duplicate message sends.
- Replaced inline `formatPhoneNumber` method in `DialpadService` with the shared `normalizePhoneNumber` utility from `server/utils/phone-normalizer.ts`.

### Frontend WebSocket Invalidation Fix
- Fixed event type mismatch: `server/routes/email-sync.ts` was broadcasting `type: 'activity'` but the frontend subscribes to `'new_activity'`. This caused the activity timeline to stay stale after Gmail sync. Corrected to `'new_activity'`.

### HCP Webhook — URL Token Auth
- HCP does not provide a signing secret on most plans, so the previous HMAC-only auth blocked all incoming webhook requests with 401.
- New approach: `GET /api/integrations/housecall-pro/webhook-config` auto-generates a 32-byte hex URL token (`webhook_url_token` credential) on first call and embeds it in the webhook URL as `?token=<secret>`. HCP sends it back with every request.
- The webhook endpoint (`POST /api/webhooks/:contractorId/housecall-pro`) now has a two-tier auth path: if a signing secret is configured → HMAC verification (backward compat); otherwise → URL token comparison via `crypto.timingSafeEqual`. Both are stored per-contractor.
- Settings UI updated: status indicator shows green "Webhook ready" once the URL token exists; "Set Secret" button renamed to "Advanced: Signing Secret" with an updated description making clear it's optional.

### HCP Estimate Follow-Up Fix
- Removed the HCP read-only guard from `PATCH /api/estimates/:id/follow-up`. Follow-up dates are CRM-only metadata with no HCP equivalent. The guard remains on `PUT /api/estimates/:id` to protect actual estimate fields.

## Running TODO List
See `TODO.md` at the repo root for the prioritized list of open improvements, security items, performance work, and technical debt. Update it whenever you find new issues or complete existing ones.

---

## Known Scaling Limitations

These are single-process assumptions that work fine now but require architectural changes before horizontal scaling:

1. **WebSocket broadcasts** (`server/websocket.ts`): `broadcastToContractor` only reaches clients on the current Node.js process. Fix: Redis pub/sub fan-out.
2. **Rate limiter** (`server/middleware/rate-limiter.ts`): In-memory `Map` store — counts are not shared across processes. Fix: Redis-backed store (e.g. `rate-limit-redis`).
3. **Contact deduplication** (`server/services/contact-deduper.ts`): The Union-Find graph is built entirely in Node.js heap. A 50k-contact ceiling guard is in place. Fix: migrate to SQL-side MERGE using a temp table.

---

## Code Quality & Architecture Notes (Technical Health Pass)

### Server Utilities (`server/utils/`)
- **`errors.ts`** — `getErrorMessage(e: unknown): string` helper for typed catch blocks.
- **`logger.ts`** — Thin structured logger (`logger('ModuleName')`). All route files and the workflow engine use this instead of raw `console.*`.
- **`auth-helpers.ts`** — `getAuthUser(req, res)` helper that returns the typed JWT payload or sends a 401 and returns null. Use this instead of `req.user!` in route handlers to eliminate non-null assertions.
- **`workflow/entity-adapter.ts`** — `toWorkflowEvent(entity)` adapter that safely converts typed Drizzle entities to `Record<string, unknown>` for the workflow engine. Eliminates all `as unknown as Record<string, unknown>` casts.

### Schema Module (`shared/schema/`)
- The monolithic `shared/schema.ts` has been split into 12 domain-scoped files under `shared/schema/`.
- `shared/schema/index.ts` re-exports everything — all existing `import ... from "@shared/schema"` imports continue to work unchanged.
- Domain files: `enums`, `settings`, `users`, `contacts`, `estimates`, `jobs`, `leads`, `messages`, `activities`, `integrations`, `notifications`, `workflows`.

### Storage Module (`server/storage/`)
- Full orientation JSDoc at the top of `IStorage` explaining the multi-module composition pattern and the multi-tenancy requirement.
- **Contact deduplication** has been extracted to `server/services/contact-deduper.ts` — a dedicated service with full JSDoc explaining the Union-Find algorithm (O(N·α(N)) complexity). `contactMethods.deduplicateContacts` re-exports from this service. Contacts are processed in paginated batches (`DEDUP_BATCH_SIZE = 2000`) — no unbounded `SELECT *`.

### DB Indexes
- Added composite index on `workflow_executions(workflow_id, created_at)`.
- Added partial index on `estimates(housecall_pro_estimate_id)` for HCP sync lookups.
- Added functional index on `contacts.normalized_phone` for O(1) webhook lookups — eliminates REGEXP_REPLACE full-table scans on every Dialpad call/SMS.
- Both applied directly via SQL and reflected in `shared/schema/contacts.ts`.

### Frontend Shared Hooks (`client/src/hooks/`)
- **`useDialpadPhoneNumbers`** — Single cache-sharing hook for `/api/dialpad/phone-numbers`. Used by `NodeEditDialog`, `EnhancedDialpadConfig`, and `UserManagement` instead of inline `useQuery`.
- **`useTerminology`** — Use for `/api/terminology`; returns `TerminologySettings` type. Settings.tsx uses this hook.
- **`useProviderConfig`** — Use for `/api/providers`; returns `ProviderConfig` (includes `isActive` flag). Settings.tsx uses this hook.
- **`useUsers`** — Use for `/api/users`; returns `UserSummary[]` with `{ id, username, name, email, role, contractorId, dialpadDefaultNumber, canManageIntegrations, createdAt }`. Note: field is `name` (not `fullName`). Settings.tsx and UserManagement.tsx use this hook.
- **`useFetchContact`** — Existing shared hook for single contact fetches.

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

### Integrations
- **Zapier**: For SMS message ingestion.
- **Google Cloud Platform**: For Gmail OAuth, Google Maps Places API autocomplete, and API access.
- **Housecall Pro**: For calendar management, scheduling, and real-time event webhooks.