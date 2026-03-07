# Project TODO List

This file is a living document. Add items as you find them, check them off when complete, and remove stale entries.

Priority levels: **P0** = Critical bug / security, **P1** = High, **P2** = Medium, **P3** = Low / nice-to-have

---

## Bugs & Errors

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P0 | `wss://localhost:undefined` unhandled rejection on every page load — Vite HMR WebSocket building invalid URL because `window.location.port` is empty on Replit | `server/vite.ts` |
| ✅ Fixed | P0 | Vite HMR WebSocket handshake fails on Replit (reverse proxy strips `Sec-WebSocket-Protocol: vite-hmr`), causing Vite to poll endlessly and call `location.reload()` every few seconds. Fixed by setting `hmr: false`. | `server/vite.ts` |
| ✅ Fixed | P1 | Empty `catch (e) {}` in booking widget — silently swallows script origin detection errors | `client/public/booking-widget.js` |
| ✅ Fixed | P1 | **Debug `console.log` left in production storage code**: Removed 3 `console.log` calls from `getConversationMessages` that fired on every conversation open and could expose contact phone/email data in logs. | `server/storage/messaging.ts` |

---

## Security

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P0 | JWT is returned in the JSON response body from `/api/auth/login` and `/api/auth/register` in addition to the httpOnly cookie. Removed `token` field from both responses. | `server/routes/auth.ts` |
| ✅ Fixed | P0 | No token revocation on logout — a captured token stayed valid up to 7 days after logout. Added `revoked_tokens` table + `jti` claim in JWT. | `server/auth-service.ts`, `server/routes/auth.ts`, `server/index.ts` |
| ✅ Fixed | P1 | No "sign out all devices" protection — stolen phone could not be invalidated remotely. Added `tokenVersion` column on `users` + `POST /api/auth/logout-all`. | `server/auth-service.ts`, `server/routes/auth.ts`, `client/src/components/settings/SecurityTab.tsx` |
| ✅ Fixed | P1 | **51 `req.user!` non-null assertions** eliminated across 8 route files. All handlers already typed with `AuthenticatedRequest`/`AuthedRequest` (or asyncHandler default) — assertions dropped. | `server/routes/contact-actions.ts`, `server/routes/integrations/hcp-scheduling.ts`, `server/routes/ai.ts`, `server/routes/integrations/housecall-pro.ts`, `server/routes/integrations/google-sheets.ts`, `server/routes/oauth.ts`, `server/routes/auth.ts`, `server/routes/employees.ts` |
| ⬜ Open | P1 | **Dialpad SMS webhook uses plain API key comparison** instead of HMAC SHA256. A leaked key allows message injection into any tenant. Standardize with the Housecall Pro HMAC approach. | `server/routes/webhooks/dialpad-sms.ts` |
| ⬜ Open | P1 | **`/api/public/book/:slug/contact/:contactId` allows unauthenticated contact name enumeration** by UUID. Either remove or require a short-lived signed token in the URL. | `server/routes/public.ts` |
| ⬜ Open | P2 | **No explicit CORS configuration** — relies on Helmet defaults. The booking widget is embedded on external customer sites, so the CORS policy should be explicit and audited. | `server/index.ts` |
| ✅ Fixed | P2 | Public booking availability rate limit was 30/min for an unauthenticated endpoint doing heavy scheduling math. Reduced to 10/min. | `server/middleware/rate-limiter.ts` |
| ✅ Fixed | P2 | CSP was fully disabled. Replaced with a permissive-but-defined baseline CSP. | `server/index.ts` |

---

## Performance & Scalability (What breaks at 10x load)

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Documented | P1 | **WebSocket single-process**: `broadcastToContractor` only reaches clients on the current Node.js process. Horizontal scaling requires Redis pub/sub fan-out. | `server/websocket.ts` |
| ✅ Documented | P1 | **In-memory rate limiter**: Rate limit counts not shared across processes. Requires Redis-backed store. | `server/middleware/rate-limiter.ts` |
| ✅ Guarded | P1 | **Contact deduplication OOM**: Union-Find algorithm builds entire contact graph in Node.js heap. 50k-contact ceiling guard added. Long-term fix: SQL-side MERGE. | `server/storage/contacts.ts` |
| ✅ Fixed | P1 | **`getContactByPhone` full-table scan**: Now uses the indexed `normalizedPhone` column. | `server/storage/contacts.ts` |
| ✅ Fixed | P1 | **`findMatchingContact` still uses `REGEXP_REPLACE`**: Replaced full-table scan with `inArray(contacts.normalizedPhone, normalizedPhones)` using the existing indexed column. Same approach as `getContactByPhone`. | `server/storage/contacts.ts` |
| ✅ Fixed | P2 | **Notification polling redundant with WebSocket**: Removed `refetchInterval: 60_000`. Added `useWebSocketInvalidation` for `notification_updated` events so the badge updates immediately via WS. | `client/src/components/NotificationDropdown.tsx` |
| ✅ Fixed | P2 | **`getConversationMessages` sequential queries**: Function already uses `Promise.all` at the SMS+email and call layers. No change needed. | `server/storage/messaging.ts` |
| ⬜ Open | P2 | **`hcp-sync.ts` estimate sync is sequential**: `allHousecallProEstimates.map(async ...)` loop is not wrapped in `Promise.all`, so estimates sync one at a time. Wrap in `Promise.allSettled` with a concurrency limiter (e.g. `p-limit(5)`). | `server/routes/integrations/hcp-sync.ts` |
| ⬜ Open | P2 | **Read-before-write on job/estimate creation**: `createJob` and `createEstimate` do a SELECT to verify contact existence, then INSERT — 2 round-trips per creation. Replace with a DB-level FK constraint check or Drizzle `onConflict`. | `server/storage/jobs-estimates.ts` |
| ⬜ Open | P2 | **`useTerminology()` fetched in 7+ simultaneous components**: `DashboardLayout`, `AppSidebar`, `NodeEditDialog`, `CommandPalette`, `Leads`, `Jobs`, `Estimates`. Lift to a React Context so the data is fetched once per session. | `client/src/hooks/useTerminology.ts` |
| ⬜ Open | P2 | **Over-broad cache invalidation**: Mutations in Leads/Estimates/Jobs invalidate `/api/contacts/paginated`, `/api/contacts/status-counts`, and `/api/contacts` all at once. Narrow to only the keys that actually changed. | `client/src/pages/Leads.tsx`, `client/src/pages/Estimates.tsx`, `client/src/pages/Jobs.tsx` |
| ⬜ Open | P2 | **HCP sync 5-minute max runtime**: Large tenants may never finish a full sync within 5 minutes. Consider scaling `maxRunTime` based on tenant contact count. | `server/sync/housecall-pro.ts` |
| ⬜ Open | P2 | **In-memory sync lock**: `activeSyncs` Set prevents concurrent syncs per-process but not across horizontally-scaled instances. Migrate to a distributed lock (Redis SETNX). | `server/sync-scheduler.ts` |
| ⬜ Open | P2 | **`setTimeout`-based workflow delays**: Pending delays are lost on server restart. At 10x load, thousands of active timers impact the event loop. Migrate to a persistent task queue (e.g., BullMQ). | `server/workflow-actions/delay.ts` |
| ⬜ Open | P3 | **Settings page fires 5+ separate API queries on mount**: `/api/integrations`, `/api/housecall-pro/webhook-config`, `/api/business-targets`, `/api/booking-slug`, `/api/webhook-config`. A combined `/api/settings/config` endpoint or a single hook using `Promise.all` would cut load-time round-trips. | `client/src/pages/Settings.tsx` |
| ⬜ Open | P3 | **`ActivityList.tsx` split fetching**: Two separate requests per render (activities + conversations). Merge into a single endpoint or use `Promise.all` on the backend. | `client/src/components/ActivityList.tsx`, `server/routes/activities.ts` |
| ⬜ Open | P3 | **`getContacts()` non-paginated call**: A 2,000-row safety cap is in place, but callers should be migrated to `getContactsPaginated()` for cursor-based pagination. | `server/storage/contacts.ts` |

---

## TypeScript Hygiene

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `req.user!` eliminated across all route files. Added `getAuthUser(req, res)` helper for handlers without explicit typed request; all remaining assertions dropped (handlers already typed with `AuthenticatedRequest`/`AuthedRequest`). | All `server/routes/*.ts` |
| ✅ Fixed | P2 | `(hcpUser as any)` in HCP scheduling service — replaced with typed `HCPEmployee` interface. | `server/housecall-scheduling-service.ts` |
| ✅ Fixed | P2 | `as any` on Google Places API responses in dashboard routes — replaced with typed interfaces. | `server/routes/dashboard.ts` |
| ✅ Fixed | P2 | `status as any` in workflow engine — replaced with explicit union type strings. | `server/workflow-engine.ts` |
| ✅ Fixed | P2 | `options.status as any` in contacts storage — replaced with enum cast. | `server/storage/contacts.ts` |
| ✅ Fixed | P2 | `options.status as any` in jobs/estimates storage — replaced with typed enum casts. | `server/storage/jobs-estimates.ts` |
| ✅ Fixed | P2 | `approvalStatus as any` in workflows storage — replaced with typed enum cast. | `server/storage/workflows.ts` |
| ✅ Fixed | P2 | `(contractor as any)?.timezone` in HCP scheduling route — `timezone` is already on `Contractor` type. | `server/routes/integrations/hcp-scheduling.ts` |
| ✅ Fixed | P2 | `const templateAny = template as any` in Templates.tsx — `status` is already on the `Template` type. | `client/src/pages/Templates.tsx` |
| ✅ Fixed | P2 | **`INTEGRATION_NAMES.includes(integrationName as any)`**: Added `isIntegrationName(v: string): v is IntegrationName` type guard to `provider-service.ts`. Replaced all 7 `as any` casts (6 in `index.ts`, 1 in `provider-service.ts`). | `server/routes/integrations/index.ts`, `server/providers/provider-service.ts` |
| ⬜ Open | P3 | **`insertData: any` and `updateData: any`** in `server/storage/integrations.ts`. Type with the Drizzle inferred insert type for the `integrations` table. | `server/storage/integrations.ts` |
| ⬜ Open | P3 | **`error: any` in catch clauses** in `server/providers/sendgrid-provider.ts` (lines 52, 74). Modern TypeScript infers `unknown` in catch; using `: any` widens the type unnecessarily. | `server/providers/sendgrid-provider.ts` |
| ⬜ Open | P3 | **`updateData: any`** in `housecall-scheduling-service.ts` `syncHousecallUsers` — type the update shape using the `userContractors` Drizzle table schema. | `server/housecall-scheduling-service.ts` |

---

## UI / Database Sync Gaps

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `EditLeadDialog.tsx` — status update mutation was missing `invalidateQueries` for `/api/contacts/status-counts`. | `client/src/components/EditLeadDialog.tsx` |
| ✅ Fixed | P1 | `HousecallProSchedulingModal.tsx` — was invalidating non-existent query keys. Fixed to use correct keys. | `client/src/components/HousecallProSchedulingModal.tsx` |
| ✅ Fixed | P1 | `ConversationModal.tsx` `sendEmailMutation` — only invalidated the per-contact thread key. Added root `/api/conversations` invalidation. | `client/src/components/ConversationModal.tsx` |
| ✅ Fixed | P2 | `JobCard.tsx` and `EstimateCard.tsx` — string-interpolated queryKeys fixed to array style for correct hierarchical invalidation. | `client/src/components/JobCard.tsx`, `EstimateCard.tsx` |
| ✅ Fixed | P2 | **Bulk mutations missing WebSocket broadcast**: Confirmed `useBulkActions` sends individual PATCH/DELETE requests, and each contacts route handler already calls `broadcastToContractor`. No silent bulk endpoint exists. | `server/routes/contacts.ts`, `client/src/hooks/useBulkActions.ts` |
| ✅ Fixed | P2 | **HCP main webhook missing broadcasts**: Added `broadcastToContractor` calls after each entity mutation: `estimate_updated`, `job_updated`, `job_created`, `contact_created`, `contact_updated`. | `server/routes/webhooks/housecall-pro.ts` |
| ✅ Fixed | P2 | **`Follow-ups.tsx` missing status-count invalidation**: Added `invalidateQueries` for `/api/contacts/status-counts` to `updateLeadFollowUpMutation.onSuccess`. | `client/src/pages/Follow-ups.tsx` |
| ⬜ Open | P3 | **Audit WS event catalogue**: Audit all mutation types against the WS event list to find any that skip broadcasting. Document the full event type catalogue in a comment near `broadcastToContractor`. | `server/websocket.ts` |

---

## Code Modularity

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P2 | **Migrate integration routes off raw `console.log`**: 83 raw `console.log`/`console.warn` calls in `google-sheets.ts`, `dialpad.ts`, `hcp-sync.ts`, and `server/storage/messaging.ts` bypass the structured logger. These cannot be filtered or correlated by tenant in a log aggregator. Migrate to `log.info`/`log.warn`/`log.error` from `server/utils/logger.ts`. | `server/routes/integrations/google-sheets.ts`, `server/routes/integrations/dialpad.ts`, `server/routes/integrations/hcp-sync.ts`, `server/storage/messaging.ts` |
| ⬜ Open | P2 | **`Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` share identical modal state boilerplate** (edit, delete, details, follow-up). Extract a `useEntityPageModals<T>()` hook. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` |
| ⬜ Open | P2 | **`TextingModal` and `EmailComposerModal` manually instantiated with near-identical props** in 4 page files. Wrap into a `<CommunicationModals />` compound component. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx`, `Messages.tsx` |
| ⬜ Open | P2 | **`useInfiniteQuery` pagination boilerplate copy-pasted** across Leads, Jobs, Estimates (URLSearchParams construction, `getNextPageParam`, filter state sync). Extract a `usePaginatedResource` hook. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` |
| ⬜ Open | P2 | **Server routes repeat manual pagination parsing** (`cursor`, `limit`, `search` from `req.query`) in every handler. Extract a `parsePagination(req)` utility. | All `server/routes/*.ts` |
| ⬜ Open | P2 | **Post-save side effects copy-pasted across entity routes** (broadcastToContractor + workflowEngine.trigger + createActivityAndBroadcast). Extract a `handleEntityMutation()` helper. | `server/routes/contacts.ts`, `jobs.ts`, `estimates.ts` |
| ⬜ Open | P2 | **Zod DTO schemas re-derived inline in every route** (e.g. `insertEstimateSchema.omit({...}).extend({...})`). Move to `shared/schema.ts` as named exports. | `server/routes/*.ts`, `shared/schema.ts` |
| ⬜ Open | P2 | **`useFetchContact` vs `useContact` fragmentation**: `Estimates.tsx` uses the old imperative `useFetchContact` hook while `EstimateCard`, `JobCard`, and `contact-combobox` use the newer declarative `useContact`. Both target `/api/contacts/:id` but with different cache key structures, meaning the same contact can be cached twice. Consolidate or document the intentional split. | `client/src/hooks/useFetchContact.ts`, `client/src/hooks/useContact.ts`, `client/src/pages/Estimates.tsx` |
| ⬜ Open | P3 | **`EstimateCard.tsx` and `JobCard.tsx` share nearly identical layouts**. Consider a shared `EntityCard` base component. | `client/src/components/EstimateCard.tsx`, `JobCard.tsx` |
| ⬜ Open | P3 | **Status constant arrays defined locally in each page** (LEAD_STATUSES, JOB_STATUSES, etc.). Move to a shared constants file or derive from schema enum values. | `client/src/pages/Leads.tsx`, `Jobs.tsx`, `Estimates.tsx` |

---

## Silent Error Paths

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `catch (e) {}` in booking widget — was completely silent. Now logs a warning. | `client/public/booking-widget.js` |
| ✅ Fixed | P2 | `server/routes/integrations/index.ts` — sync-cancel failure on integration disable was logged without context. | `server/routes/integrations/index.ts` |
| ✅ Fixed | P2 | `server/ai-service.ts` — JSON parse failure in `analyzeData` logged no detail. | `server/ai-service.ts` |
| ✅ Fixed | P2 | `server/providers/dialpad-provider.ts` — Dialpad user ID lookup failure logged no user/contractor context. | `server/providers/dialpad-provider.ts` |
| ✅ Fixed | P2 | **Workflow engine step failures**: Outer catch block and step-aggregation path both call `updateExecutionStatus(..., 'failed', ...)` (lines 194 and 226). Run records are correctly marked failed. | `server/workflow-engine.ts` |
| ⬜ Open | P2 | **`dialpad-enhanced-service.ts`**: Dozens of catch blocks return `undefined` silently. Callers cannot distinguish "API returned nothing" from "API call failed". Add typed result types. | `server/dialpad-enhanced-service.ts` |
| ⬜ Open | P2 | **HCP sync error during estimate creation** is caught and logged but not surfaced to the caller. Consider adding a `syncWarning` field to the response. | `server/routes/estimates.ts` |

---

## Duplicate Data Fetching

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P2 | **`useTerminology()` fetched in 7+ simultaneous components**. Lifted to `TerminologyProvider` React Context — single fetch per session shared by all consumers via `useTerminologyContext()`. | `client/src/contexts/TerminologyContext.tsx` |
| ⬜ Open | P2 | **`useFollowUps` shared hook missing** — `Follow-ups.tsx` and `FollowUpsWidget.tsx` each define their own `useQuery` for the same keys. Extract a shared hook so queryKey stays consistent. | `client/src/pages/Follow-ups.tsx`, `client/src/components/FollowUpsWidget.tsx` |
| ⬜ Open | P2 | **`useFetchContact` vs `useContact` cache duplication** — see Code Modularity section. | `client/src/hooks/useFetchContact.ts`, `client/src/hooks/useContact.ts` |
| ⬜ Open | P3 | **`useCurrentUser` and `useUsers` called in many sibling components**. Consider a shared UserContext for the current user. | `client/src/hooks/useCurrentUser.ts` |

---

## Documentation / Readability

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Added | P2 | Multi-tenancy isolation strategy documented at top of schema file. | `shared/schema.ts` |
| ✅ Added | P2 | WebSocket single-process scaling limitation documented with migration path. | `server/websocket.ts` |
| ✅ Added | P2 | Rate limiter in-memory scaling limitation documented with migration path. | `server/middleware/rate-limiter.ts` |
| ✅ Added | P2 | `HCPEmployee` interface added with JSDoc. | `server/housecall-scheduling-service.ts` |
| ✅ Added | P2 | `getAuthUser()` helper added with JSDoc. | `server/utils/auth-helpers.ts` |
| ✅ Added | P2 | Contact deduplication OOM guard added with comment. | `server/storage/contacts.ts` |
| ⬜ Open | P3 | **Workflow engine execution flow lacks section comments**. A new developer cannot follow trigger evaluation and step-group ordering without reading every line. | `server/workflow-engine.ts` |
| ⬜ Open | P3 | **Salesperson auto-assignment scoring algorithm** in the scheduling service has no inline explanation. | `server/housecall-scheduling-service.ts` |

## New Findings (2026-03-07 Audit)

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P2 | **6 missing WS broadcasts**: `hcp-sync.ts` (estimate_updated, contact_created, estimate_created), `google-sheets.ts` (contact_created), `public.ts` (contact_updated ×2, contact_created) | `server/routes/integrations/hcp-sync.ts`, `google-sheets.ts`, `public.ts` |
| ✅ Fixed | P2 | **WorkflowExecutions.tsx polled at 5s** via `refetchInterval`. Replaced with WebSocket invalidation on `workflow_started`/`workflow_completed`/`workflow_failed` events. | `client/src/pages/WorkflowExecutions.tsx` |
| ✅ Fixed | P2 | **Cache invalidation gaps**: `CreateJobForm.tsx` now invalidates `/api/contacts/paginated` + `/api/contacts/status-counts` on success; `LogCallDialog.tsx` now invalidates `/api/contacts/paginated` + per-contact key. | `client/src/components/CreateJobForm.tsx`, `LogCallDialog.tsx` |
| ✅ Fixed | P2 | **`users.ts` create route** accepted raw `req.body` without Zod validation. Added `createUserBodySchema` with min/max length and email format checks. | `server/routes/users.ts` |
| ✅ Fixed | P2 | **console.log migration**: Migrated all calls in `webhooks/leads.ts`, `webhooks/jobs.ts`, `integrations/dialpad.ts`, `integrations/hcp-sync.ts`, `integrations/google-sheets.ts`, `routes/public.ts` to structured logger. | listed files |
| ✅ Fixed | P2 | **`as any` casts** removed from `dialpad-enhanced-service.ts` (added missing fields to `DialpadUser`), `contact-actions.ts` (typed `validContacts` as `Omit<InsertContact,'contractorId'>[]`), `activities.ts` (literal union type), `templates.ts` (rewrite to avoid chain cast), `public.ts` (typed Places API responses), `housecall-scheduling-service.ts` (inline interface for estimate data). | listed files |
| ⬜ Open | P3 | **`/api/jobs` and `/api/estimates` unbounded endpoints** have no pagination — will degrade under large datasets. Add `limit`/`offset` or cursor pagination. | `server/routes/jobs.ts`, `server/routes/estimates.ts` |
| ⬜ Open | P3 | **`weekly-reporter.ts` in-memory report array** is lost on restart. Reports should be persisted to DB or object storage. | `server/weekly-reporter.ts` |
| ⬜ Open | P2 | **`housecall-scheduling-service.ts` (32 calls) and `dialpad-provider.ts` (14 calls)** still use `console.log`/`warn`/`error`. Migrate to structured logger. | `server/housecall-scheduling-service.ts`, `server/dialpad-provider.ts` |
