# Multi-Tenant CRM System

## Overview
This project is a multi-tenant Customer Relationship Management (CRM) system designed for service-based businesses, particularly HVAC contractors. Its primary purpose is to streamline customer management, job tracking, estimates, lead nurturing, and communication. The system ensures data isolation between tenants, provides robust role-based access control, and allows users to belong to multiple companies with seamless switching. The overarching ambition is to offer a comprehensive, efficient solution for managing business operations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend utilizes React with TypeScript and Vite, employing Wouter for routing and TanStack Query for state management. The UI is built with a custom component library based on Radix UI primitives and Tailwind CSS, inspired by Pipedrive's design with shadcn/ui. It features a mobile-first responsive design, card-based layouts, and light/dark mode theming. A global command palette (`Cmd+K`) and context-aware keyboard shortcuts enhance productivity. All communication actions (call, email, text, schedule) are standardized using centralized components and hooks for consistency.

### Technical Implementations
The backend is built with Node.js and Express.js, offering a RESTful API with consistent error handling. PostgreSQL with Drizzle ORM provides type-safe database operations and multi-tenancy. Data validation is enforced using Zod schemas. Authentication uses JWT tokens with HTTP-only cookies and bcrypt for password hashing. Role-based access control and strict tenant data segregation are implemented. The system supports multi-contractor users, allowing users to belong to multiple companies via a `user_contractors` junction table, enabling seamless switching and per-contractor roles. Real-time updates are handled via WebSockets. Performance is optimized using strategic database indexing, application caching, and query optimization.

### Feature Specifications
- **Multi-Tenancy**: Complete data isolation and secure access control per tenant.
- **Leads, Estimates & Jobs**: Full CRUD operations with a dual-entity architecture (contacts vs. leads) and real-time updates.
- **Communication & Messaging**: SMS integration via Dialpad API, unified conversation threads, real-time updates, and automatic activity capture.
- **Gmail Integration**: Per-user OAuth for email, encrypted token storage, automatic inbox syncing, and email activity capture.
- **Unified Scheduling System**: Integrates with Housecall Pro, provides a unified calendar view, enforces appointment slots, and uses an auto-assignment algorithm for salespeople.
- **Workflow Automation Builder**: Visual, drag-and-drop builder using React Flow with custom node types (triggers, actions, AI actions, conditionals, delays). Features tag-based filtering, dynamic variables, pre-configured templates, execution logs, and manual testing.

### System Design Choices
- **Frontend**: React, TypeScript, Vite, Wouter, TanStack Query, Radix UI, Tailwind CSS.
- **Backend**: Node.js, Express.js, PostgreSQL, Drizzle ORM, Zod.
- **Real-time**: WebSocket-based architecture.
- **Security**: HTTP-only cookies, role-based access control, AES-256-GCM encryption.

### Code Organization
- `server/workflow-engine.ts` — slim orchestrator (~300 lines). All action handlers live in `server/workflow-actions/` (one file per action type: send-email, send-sms, create-notification, update-entity, assign-user, ai-generate, ai-analyze, condition, delay).
- `server/sync-scheduler.ts` — slim scheduler (~210 lines). HCP sync logic lives in `server/sync/housecall-pro.ts`; Gmail sync in `server/sync/gmail.ts`.
- `server/storage/workflows.ts` — includes `getActiveApprovedWorkflows(contractorId)` which filters `is_active=true AND approval_status='approved'` in SQL (used by workflow trigger engine).

### Performance Notes
- **Workflow trigger**: `triggerWorkflowsForEvent()` calls `getActiveApprovedWorkflows` (SQL-filtered) instead of `getWorkflows` (all) + JS filter.
- **Dashboard metrics**: `getMetricsAggregates` in `server/services/business-metrics.ts` uses SQL `COUNT` aggregates — never fetches rows.
- **HCP manual sync**: Uses `getJobsCount` (SQL COUNT) before/after to count new jobs — not full table loads.
- **Follow-ups**: Dedicated `/api/contacts/follow-ups` and `/api/estimates/follow-ups` endpoints with `WHERE follow_up_date IS NOT NULL` in SQL.

### Code Health Improvements (most recent pass)
- **Database indexes**: Added missing indexes for `dialpad_departments.contractorId`, `workflow_steps.parentStepId`, `password_reset_tokens.userId`.
- **Sync scheduler constants**: Magic numbers replaced with `SCHEDULER_POLL_INTERVAL_MS` / `SYNC_RETRY_DELAY_MS`; file-level comment added explaining the in-memory lock limitation.
- **Dialpad retry**: `fetchWithRetry` utility added to `dialpad-provider.ts` — retries on 429/5xx up to 3x with exponential backoff.
- **Zod validation**: `/api/messages/send-email`, `/api/calls/initiate`, `/api/business-targets`, `/api/terminology` all use Zod `.safeParse()` instead of raw `req.body`.
- **Frontend memoization**: `filteredConversations` (Messages.tsx), `allJobs` (Jobs.tsx), and event callbacks memoized; `ConversationItem` extracted as `React.memo`.
- **WorkflowBuilder**: Removed wrapper functions `mapActionTypeToNodeType`/`mapNodeTypeToActionType` — now calls `ACTION_TO_NODE`/`NODE_TO_ACTION` maps directly; removed `setTimeout` anti-pattern.
- **Settings.tsx**: Eliminated three `useEffect` state-sync anti-patterns; local state is now "pending edits only" with `effectiveX = localEdit ?? queryData ?? fallback` pattern.
- **Unified hook**: `useConversationThread` replaces duplicate `useEmailThread` / `useSmsThread`; old files are thin re-exports for backward compatibility.
- **useFetchContact**: Refactored to use `queryClient.fetchQuery` instead of raw `fetch`.
- **JSDoc**: File-level comments added to `workflow-engine.ts`, `provider-service.ts`, `auth-service.ts`, `WebSocketContext.tsx`, `queryClient.ts`, `useWebSocketInvalidation.ts`, `WorkflowCanvas.tsx`.
- **Lead Trend Chart**: `GET /api/contacts/lead-trend` returns a SQL `GROUP BY DATE` aggregate (≤30 rows). The `LeadsTrendChart` component uses this instead of fetching all lead contacts.
- **HCP jobs sync**: `getJobsByExternalIds` pre-fetches all jobs in a batch via `inArray` before the inner loop — eliminates 1 DB query per job.
- **HCP estimates sync**: `getEstimatesByHousecallProIds` pre-fetches all estimates in a batch — same pattern.
- **Gmail sync dedup**: Batch `inArray` query collects all already-synced email IDs upfront; per-email check is O(1) Set lookup.
- **`getContacts` hard cap**: `.limit(2000)` prevents accidental full-table dumps; use `/api/contacts/paginated` for UI.
- **Scheduling availability**: `getUnifiedAvailability` fires all per-salesperson HCP API calls via `Promise.all` — eliminates N sequential external HTTP round-trips (was ~8 s for 5 salespeople, now ~2 s).
- **Safety caps added**: `getCalls` → 500, `getScheduledContacts` → 500, `getUnscheduledContacts` → 500, `getUnreadNotifications` → 100.
- **Message cleanup parallelized**: Nightly cleanup uses `Promise.allSettled` across all contractors; one failure is logged, not propagated.
- **`/api/auth/me`**: `getUser` and `getEnabledIntegrations` now run via `Promise.all` — saves one DB round-trip on every page load.
- **Sync-status hook**: `staleTime` raised from 0 to 5,000 ms — prevents spurious re-fetches on every React render.
- **GIN indexes on `contacts.emails[]` and `contacts.phones[]`**: `findMatchingContact` uses `unnest()` + `ANY()` scans on every webhook, import, and lead creation — GIN indexes make these array lookups efficient at scale.
- **Index on `jobs.estimate_id`**: `getJobByEstimateId` no longer does a full jobs table scan.
- **Index on `password_reset_tokens.user_id`**: Covers the password reset lookup flow.
- **`upsertEmployees` N+1 eliminated**: Single `inArray` batch fetch replaces per-employee `SELECT` inside the sync loop; updates are parallelized with `Promise.all`.
- **`getEmployees` hard cap**: `.limit(500)` added to match the pattern on other list endpoints.
- **`useTerminology()` / `useUsers()` shared hooks**: Centralized in `client/src/hooks/`; Leads, Jobs, and Estimates pages all use them — combined with the global `staleTime: 5 min`, these queries are fetched once and shared across all three pages.
- **`parseWebhookDate` utility**: `server/utils/parse-webhook-date.ts` — single canonical handler for HCP webhook date fields (null/"none"/Unix-seconds/Unix-ms/ISO string). Replaces two copy-pasted inline `parseDate` functions in `webhooks/estimates.ts` and `webhooks/jobs.ts`.
- **`getContractorsByIds` batch fetch**: `GET /api/user/contractors` now fetches all contractors in a single `inArray` query instead of N individual `getContractor` calls.
- **`integrations/index.ts` converted to asyncHandler**: All 8 routes now use the standard error-handling wrapper; `GET /api/integrations` and `GET /api/integrations/:name/status` parallelize their independent storage fetches with `Promise.all`.
- **`POST /api/messages/send-email` parallelized**: User and contractor fetches now run via `Promise.all` instead of sequentially.
- **Dialpad storage limits**: `getDialpadPhoneNumbers` → 200, `getDialpadUsers` → 500, `getDialpadDepartments` → 200, `getDueSyncSchedules` → 100.
- **Inline algorithm docs added**: Union-Find in `deduplicateContacts`, fuzzy phone SQL in `getContactByPhone` / `findMatchingContact`, HCP estimate status mapping rationale in `mapHcpEstimateStatus`, sliding-window slot search in `getUnifiedAvailability`.

### Code Health Improvements (second pass)
- **HCP jobs sync OOM fix**: Jobs sync loop now processes each page immediately (mirrors estimates pattern) — eliminates unbounded in-memory array accumulation. `totalJobsFetched` counter added.
- **Gmail batch activity creation**: `bulkCreateActivities()` added to `server/storage/activities.ts`; Gmail sync now collects all activity payloads then does a single bulk INSERT instead of N sequential INSERTs. Added to `IStorage` interface.
- **New DB indexes**: `user_invitations.invited_by`, `contractor_integrations.enabled_by`, composite `(contractor_id, contact_id, created_at)` on activities, composite `(contractor_id, title)` on jobs and estimates.
- **React.memo**: `LeadCard`, `JobCard`, `EstimateCard` all wrapped with `React.memo` — parent state changes (filter input, modal open) no longer re-render all 50 card items.
- **Shared hooks everywhere**: `AppSidebar.tsx`, `DashboardLayout.tsx`, `workflow/NodeEditDialog.tsx` now use `useTerminology()` instead of raw `useQuery`. `NodeEditDialog` uses `useUsers()`. `useTemplates.ts` hook created — used in `TextingModal` and `EmailComposerModal` instead of raw `fetch()` in `queryFn`.
- **WorkflowBuilder no raw fetch()**: All three `queryFn` functions in `WorkflowBuilder.tsx` replaced with standard `useQuery` using the default global fetcher (handles credentials automatically).
- **`createActivityAndBroadcast` utility**: `server/utils/activity.ts` — single function replaces the `storage.createActivity()` + `broadcastToContractor()` pair. Used in `contacts.ts` (status_change, follow_up) and `estimates.ts` (follow_up). JSDoc explains when to use vs. call each separately.
- **Global ZodError middleware**: `server/index.ts` now catches `instanceof ZodError` → 400 before the generic 500 handler. Redundant manual ZodError catches removed from `server/routes/auth.ts` and `server/routes/jobs.ts`.
- **EditLeadDialog extracted**: `client/src/components/EditLeadDialog.tsx` contains the ~130-line edit dialog from `Follow-ups.tsx`. `Follow-ups.tsx` dropped from 687 → 463 lines. File-level JSDoc added explaining the leads+estimates merge strategy.
- **Scale notes added**: `deduplicateContacts` (contacts.ts), `getConversations` (messaging.ts), and `LoadMoreButton` (Leads/Jobs/Estimates pages) all have `// SCALE NOTE` comments describing the limits and migration paths.

### DB Indexes (current full set)
The following indexes exist beyond Drizzle's default primary keys:
- `contacts`: contractor_id, contractor+status, contractor+type, contractor+date, contractor+scheduled, external_lookup (contractor+source+external_id), **housecall_pro_customer_id (partial)**, follow_up_date, tags, created_at, status, type, contacted_at, is_scheduled, **emails GIN**, **phones GIN**
- `jobs`: contractor_id, contractor+status, contractor+date, contact_id, status, created_at, scheduled_date, **external_id (partial)**, **estimate_id (partial, non-null)**, **contractor+title**
- `estimates`: contractor_id, contractor+status, contractor+date, contact_id, status, created_at, follow_up_date, **external_id+contractor_id (partial)**, **contractor+title**
- `activities`: contractor_id, contractor+type, contractor+type+contact, contractor+date, contact_id, estimate_id, job_id, external_lookup (source+external_id), user_id, type, created_at, **contractor+contact+created_at**
- `messages`: contractor_id, contractor+contact, contractor+contact+created, contractor+phone, contact_id, estimate_id, external_message_id, from_number, to_number, direction, created_at
- `leads`: contractor_id, contractor+status, contact_id, status, assigned_to_user_id
- `user_invitations`: contractor_id, **invited_by**
- `contractor_integrations`: contractor+name (unique), **enabled_by**
- `business_targets`: contractor_id
- `password_reset_tokens`: **user_id**

### Code Organization
- `server/routes/public.ts` — unauthenticated routes only: `/sw-unregister`, `/api/public/*` (Places proxy, booking, availability, public lead intake), `/api/version`.
- `server/routes/dashboard.ts` — authenticated routes split from public.ts: `/api/places/autocomplete`, `/api/places/details`, `/api/dashboard/metrics`.
- `server/sync/housecall-pro.ts` — `mapHcpEstimateStatus(hcpEstimate)` is the single source of truth for HCP→CRM status mapping (no duplicated chains).
- `server/types/scheduling.ts` — all shared scheduling interfaces (`TimeSlot`, `BusyWindow`, `AvailableSlot`, `AddressComponents`, `BookingRequest`, `BookingResult`, `SalespersonInfo`) and the `parseAddressString()` utility. `housecall-scheduling-service.ts` re-exports them for backwards compatibility.

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
- **Google Cloud Platform**: For Gmail OAuth, Google Maps Places API autocomplete, and API access.
- **Housecall Pro**: For calendar management, scheduling, and real-time event webhooks.