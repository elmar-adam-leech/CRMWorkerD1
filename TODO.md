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

---

## Security

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P0 | JWT is returned in the JSON response body from `/api/auth/login` and `/api/auth/register` in addition to the httpOnly cookie. This exposes the token to JS, partially defeating the httpOnly cookie security. Remove from body for web clients (or gate behind `?mode=api` query param). | `server/routes/auth.ts` |
| ⬜ Open | P1 | Dialpad SMS webhook uses a simple API key comparison (`contractor[0].webhookApiKey !== apiKey`) rather than HMAC SHA256. A leaked key allows message injection into any tenant. Standardize with the Housecall Pro HMAC approach. | `server/routes/webhooks/dialpad-sms.ts` |
| ⬜ Open | P1 | `/api/public/book/:slug/contact/:contactId` allows unauthenticated enumeration of contact names by UUID. Either remove or require a short-lived signed token in the URL. | `server/routes/public.ts` |
| ⬜ Open | P2 | No explicit CORS configuration — relies on Helmet defaults. The booking widget is embedded on external customer sites, so CORS policy should be explicit and audited. | `server/index.ts` |
| ✅ Fixed | P2 | Public booking availability rate limit was 30/min for an unauthenticated endpoint doing heavy scheduling math + external API calls. Reduced to 10/min. | `server/middleware/rate-limiter.ts` |
| ✅ Fixed | P2 | CSP was fully disabled (`contentSecurityPolicy: false`). Replaced with a permissive-but-defined baseline CSP that allows `'unsafe-inline'` (required by Vite SPA) but blocks frames and objects. Tighten by replacing `'unsafe-inline'` with nonces when a nonce pipeline is ready. | `server/index.ts` |

---

## Performance & Scalability (What breaks at 10x load)

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Documented | P1 | **WebSocket single-process**: `broadcastToContractor` only reaches clients on the current Node.js process. Horizontal scaling requires Redis pub/sub fan-out. See comment block near `broadcastToContractor`. | `server/websocket.ts` |
| ✅ Documented | P1 | **In-memory rate limiter**: Rate limit counts are not shared across processes. At horizontal scale, effective limit = maxRequests × process count. Requires Redis-backed store to fix. See comment block at top of file. | `server/middleware/rate-limiter.ts` |
| ✅ Guarded | P1 | **Contact deduplication OOM**: The Union-Find algorithm builds the entire contact graph in Node.js heap. Added a 50k-contact ceiling guard that throws before loading any rows. Long-term fix: migrate to SQL-side MERGE. | `server/storage/contacts.ts` |
| ⬜ Open | P1 | **Fuzzy phone matching full table scans**: `getContactByPhone` and `findMatchingContact` use `REGEXP_REPLACE` inside an `unnest()` EXISTS subquery. No functional index exists on the array elements. At 10x data, this is O(n) per webhook call. Fix: store a `normalizedPhone` column and index it. | `server/storage/contacts.ts` |
| ⬜ Open | P2 | **Read-before-write on job/estimate creation**: `createJob` and `createEstimate` do a SELECT to verify contact existence, then INSERT — 2 round-trips per creation. Replace with a DB-level FK constraint check or Drizzle `onConflict` to do it in 1 query. | `server/storage/jobs-estimates.ts` |
| ⬜ Open | P2 | **`useTerminology()` fetched in 5+ simultaneous components**: `DashboardLayout`, `AppSidebar`, `CommandPalette`, and every page component all fire separate queries. Lift to a React Context so the data is fetched once per session. | `client/src/hooks/useTerminology.ts` |
| ⬜ Open | P2 | **Over-broad cache invalidation**: Mutations in Leads/Estimates/Jobs invalidate `/api/contacts/paginated`, `/api/contacts/status-counts`, and `/api/contacts` all at once. Narrow to only the key that actually changed. | `client/src/pages/Leads.tsx`, `client/src/pages/Estimates.tsx`, `client/src/pages/Jobs.tsx` |
| ⬜ Open | P2 | **HCP sync 5-minute max runtime**: Large tenants may never finish a full sync within 5 minutes, leaving data perpetually stale if incremental sync doesn't catch up. Consider scaling `maxRunTime` based on tenant contact count. | `server/sync/housecall-pro.ts` |
| ⬜ Open | P2 | **In-memory sync lock**: `activeSyncs` Set prevents concurrent syncs per-process but not across horizontally-scaled instances. Two servers could start the same tenant's sync simultaneously. Migrate to a distributed lock (Redis SETNX). | `server/sync-scheduler.ts` |
| ⬜ Open | P2 | **`setTimeout`-based workflow delays**: Pending delays are lost on server restart. At 10x load, thousands of active timers impact the event loop. Migrate to a persistent task queue (e.g., BullMQ). | `server/workflow-actions/delay.ts` |
| ⬜ Open | P3 | **`ActivityList.tsx` split fetching**: Two separate requests per render (activities + conversations). Merge into a single `/api/activities/combined` endpoint or use `Promise.all` on the backend. | `client/src/components/ActivityList.tsx`, `server/routes/activities.ts` |
| ⬜ Open | P3 | **`getContacts()` non-paginated call**: A safety cap of 2,000 rows is in place, but callers should be migrated to `getContactsPaginated()` for cursor-based pagination. See `TODO` comment in file. | `server/storage/contacts.ts` |

---

## TypeScript Hygiene

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Added | P1 | `req.user!` used 300+ times across route files. Added `getAuthUser(req, res)` helper in `server/utils/auth-helpers.ts` to eliminate non-null assertions. Migrate route files incrementally. | All `server/routes/*.ts` |
| ✅ Fixed | P2 | `(hcpUser as any)` in HCP scheduling service — replaced with typed `HCPEmployee` interface. | `server/housecall-scheduling-service.ts` |
| ✅ Fixed | P2 | `as any` on Google Places API responses in dashboard routes — replaced with typed response interfaces. | `server/routes/dashboard.ts` |
| ✅ Fixed | P2 | `status as any` in workflow engine — replaced with explicit union type strings for each entity type. | `server/workflow-engine.ts` |
| ✅ Fixed | P2 | `options.status as any` in contacts storage — replaced with `typeof contactStatusEnum.enumValues[number]` cast. | `server/storage/contacts.ts` |
| ✅ Fixed | P2 | `options.status as any` in jobs/estimates storage — replaced with typed enum casts. | `server/storage/jobs-estimates.ts` |
| ✅ Fixed | P2 | `approvalStatus as any` in workflows storage — replaced with `typeof workflowApprovalStatusEnum.enumValues[number]` cast. | `server/storage/workflows.ts` |
| ✅ Fixed | P2 | `(contractor as any)?.timezone` in HCP scheduling route — `timezone` is already on the `Contractor` type; removed unnecessary cast. | `server/routes/integrations/hcp-scheduling.ts` |
| ✅ Fixed | P2 | `const templateAny = template as any` in Templates.tsx — `status` is already on the `Template` type; removed unnecessary cast. | `client/src/pages/Templates.tsx` |
| ⬜ Open | P3 | `updateData: any` in `housecall-scheduling-service.ts` `syncHousecallUsers` — type the update shape using the `userContractors` Drizzle table schema. | `server/housecall-scheduling-service.ts` |

---

## UI / Database Sync Gaps

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `EditLeadDialog.tsx` — status update mutation was missing `invalidateQueries` for `/api/contacts/status-counts`. Status badge counts on the Leads page would not update after editing a lead's status. | `client/src/components/EditLeadDialog.tsx` |
| ✅ Fixed | P1 | `HousecallProSchedulingModal.tsx` — was invalidating `/api/leads`, `/api/leads/unscheduled`, `/api/leads/scheduled` which don't exist. The Leads page uses `/api/contacts/paginated`. Fixed to use the correct keys. | `client/src/components/HousecallProSchedulingModal.tsx` |
| ✅ Fixed | P1 | `ConversationModal.tsx` `sendEmailMutation` — only invalidated the per-contact thread key. The main Messages page conversation list was not refreshed. Added root `/api/conversations` invalidation. | `client/src/components/ConversationModal.tsx` |
| ✅ Fixed | P2 | `JobCard.tsx` and `EstimateCard.tsx` — used string-interpolated queryKeys (`/api/contacts/${id}`) instead of array-style. Hierarchical cache invalidation (`queryKey: ['/api/contacts']`) would not bust these entries. Fixed to array style. | `client/src/components/JobCard.tsx`, `EstimateCard.tsx` |
| ⬜ Open | P2 | Bulk status update and bulk delete mutations invalidate the local cache, but don't emit a WebSocket broadcast event. Other open user sessions won't see changes until manual refresh. | `server/routes/contacts.ts`, `client/src/hooks/useBulkActions.ts` |
| ⬜ Open | P2 | HCP webhook updates to jobs/estimates should emit a WS broadcast so the UI auto-refreshes. Verify all entity-mutation webhook handlers call `broadcastToContractor`. | `server/routes/webhooks/housecall-pro.ts` |
| ⬜ Open | P2 | `Follow-ups.tsx` `updateLeadFollowUpMutation` — does not invalidate `/api/contacts/status-counts`. If a follow-up date change also changes lead status, the count badges won't update. | `client/src/pages/Follow-ups.tsx` |
| ⬜ Open | P3 | Audit all mutation types against the WS event list to find any that skip broadcasting. Document the full event type catalogue in a comment near `broadcastToContractor`. | `server/websocket.ts` |

---

## Code Modularity

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P2 | `Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` all set up the same modal state boilerplate (edit, delete, details, follow-up). Extract a `useEntityPageModals<T>()` hook. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` |
| ⬜ Open | P2 | `TextingModal` and `EmailComposerModal` are manually instantiated with near-identical props in 4 page files. Wrap into a `<CommunicationModals />` compound component. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx`, `Messages.tsx` |
| ⬜ Open | P2 | `useInfiniteQuery` boilerplate (URLSearchParams construction, `getNextPageParam`, filter state sync) is copy-pasted across Leads, Jobs, Estimates. Extract a `usePaginatedResource` hook. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` |
| ⬜ Open | P2 | Server routes repeat manual pagination parsing (`cursor`, `limit`, `search` from `req.query`) in every handler. Extract a `parsePagination(req)` utility. | All `server/routes/*.ts` |
| ⬜ Open | P2 | Post-save side effects (broadcastToContractor + workflowEngine.trigger + createActivityAndBroadcast) are copy-pasted across entity routes. Extract a `handleEntityMutation()` helper. | `server/routes/contacts.ts`, `jobs.ts`, `estimates.ts` |
| ⬜ Open | P2 | Zod DTO schemas (e.g., `insertEstimateSchema.omit({...}).extend({...})`) are re-derived inline in every route. Move them to `shared/schema.ts` as named exports. | `server/routes/*.ts`, `shared/schema.ts` |
| ⬜ Open | P3 | `EstimateCard.tsx` and `JobCard.tsx` share nearly identical layouts and contact-fetch logic. Consider a shared `EntityCard` base component. | `client/src/components/EstimateCard.tsx`, `JobCard.tsx` |
| ⬜ Open | P3 | Status constant arrays (LEAD_STATUSES, JOB_STATUSES, etc.) are defined locally in each page. Move to a shared constants file or derive from schema enum values. | `client/src/pages/Leads.tsx`, `Jobs.tsx`, `Estimates.tsx` |

---

## Silent Error Paths

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `catch (e) {}` in booking widget — was completely silent. Now logs a warning. | `client/public/booking-widget.js` |
| ✅ Fixed | P2 | `server/routes/integrations/index.ts` — sync-cancel failure on integration disable was logged without context. Now logs contractorId and error message for diagnosability. | `server/routes/integrations/index.ts` |
| ✅ Fixed | P2 | `server/ai-service.ts` — JSON parse failure in `analyzeData` logged no detail. Now logs `analysisType` and first 500 chars of raw AI output for reproduction. | `server/ai-service.ts` |
| ✅ Fixed | P2 | `server/providers/dialpad-provider.ts` — Dialpad user ID lookup failure logged no user/contractor context. Now logs `contractorId`, `userId`, and error message. | `server/providers/dialpad-provider.ts` |
| ⬜ Open | P1 | Workflow engine step execution catch blocks only log — should also update the workflow run record's status to `failed` so failures are visible in the execution log UI. | `server/workflow-engine.ts` |
| ⬜ Open | P2 | `dialpad-enhanced-service.ts` — dozens of catch blocks return `undefined` silently. Callers cannot distinguish "API returned nothing" from "API call failed". Add typed result types. | `server/dialpad-enhanced-service.ts` |
| ⬜ Open | P2 | HCP sync error during estimate creation (`server/routes/estimates.ts` ~line 160) is caught and logged but not surfaced to the caller. Consider adding a `syncWarning` field to the response. | `server/routes/estimates.ts` |

---

## Duplicate Data Fetching

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P2 | `useTerminology()` fetched in 5+ simultaneous components. Lift to a React Context so the data is fetched once per session. (Also listed under Performance.) | `client/src/hooks/useTerminology.ts` |
| ⬜ Open | P2 | `useFollowUps` shared hook missing — `Follow-ups.tsx` and `FollowUpsWidget.tsx` each define their own `useQuery` for the same keys. Extract a shared hook so queryKey stays consistent. | `client/src/pages/Follow-ups.tsx`, `client/src/components/FollowUpsWidget.tsx` |
| ⬜ Open | P3 | `HousecallProSchedulingModal.tsx` invalidated wrong keys (`/api/leads/…`) after scheduling — see UI sync fixes. Separately, `useCurrentUser` and `useUsers` are also called in many sibling components; consider a shared UserContext. | `client/src/hooks/useCurrentUser.ts` |

---

## Documentation / Readability

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Added | P2 | Multi-tenancy isolation strategy documented with rules at top of schema file. | `shared/schema.ts` |
| ✅ Added | P2 | WebSocket single-process scaling limitation documented with migration path. | `server/websocket.ts` |
| ✅ Added | P2 | Rate limiter in-memory scaling limitation documented with migration path. | `server/middleware/rate-limiter.ts` |
| ✅ Added | P2 | `HCPEmployee` interface added with JSDoc explaining why the fields are optionally typed. | `server/housecall-scheduling-service.ts` |
| ✅ Added | P2 | `getAuthUser()` helper added with JSDoc explaining the pattern. | `server/utils/auth-helpers.ts` |
| ✅ Added | P2 | Contact deduplication OOM guard added with comment explaining the SQL migration path. | `server/storage/contacts.ts` |
| ⬜ Open | P3 | Workflow engine trigger evaluation and step-group ordering logic lacks section comments. A new developer cannot follow the execution flow without reading every line. | `server/workflow-engine.ts` |
| ⬜ Open | P3 | Salesperson auto-assignment scoring algorithm in the scheduling service has no inline explanation. | `server/housecall-scheduling-service.ts` |
