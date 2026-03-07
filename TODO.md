# Project TODO List

This file is a living document. Add items as you find them, check them off when complete, and remove stale entries.

Priority levels: **P0** = Critical bug / security, **P1** = High, **P2** = Medium, **P3** = Low / nice-to-have

---

## Bugs & Errors

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P0 | `wss://localhost:undefined` unhandled rejection on every page load — Vite HMR WebSocket building invalid URL because `window.location.port` is empty on Replit | `server/vite.ts` |
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

---

## Performance & Scalability (What breaks at 10x load)

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Documented | P1 | **WebSocket single-process**: `broadcastToContractor` only reaches clients on the current Node.js process. Horizontal scaling requires Redis pub/sub fan-out. See comment block near `broadcastToContractor`. | `server/websocket.ts` |
| ✅ Documented | P1 | **In-memory rate limiter**: Rate limit counts are not shared across processes. At horizontal scale, effective limit = maxRequests × process count. Requires Redis-backed store to fix. See comment block at top of file. | `server/middleware/rate-limiter.ts` |
| ✅ Guarded | P1 | **Contact deduplication OOM**: The Union-Find algorithm builds the entire contact graph in Node.js heap. Added a 50k-contact ceiling guard that throws before loading any rows. Long-term fix: migrate to SQL-side MERGE. | `server/storage/contacts.ts` |
| ⬜ Open | P2 | **Read-before-write on job/estimate creation**: `createJob` and `createEstimate` do a SELECT to verify contact existence, then INSERT — 2 round-trips per creation. Replace with a DB-level FK constraint check or Drizzle `onConflict` to do it in 1 query. | `server/storage/jobs-estimates.ts` |
| ⬜ Open | P2 | **`useTerminology()` fetched in 5+ simultaneous components**: `DashboardLayout`, `AppSidebar`, `CommandPalette`, and every page component all fire separate queries. Lift to a React Context so the data is fetched once per session. | `client/src/hooks/useTerminology.ts` |
| ⬜ Open | P2 | **Over-broad cache invalidation**: Mutations in Leads/Estimates/Jobs invalidate `/api/contacts/paginated`, `/api/contacts/status-counts`, and `/api/contacts` all at once. Narrow to only the key that actually changed. | `client/src/pages/Leads.tsx`, `client/src/pages/Estimates.tsx`, `client/src/pages/Jobs.tsx` |
| ⬜ Open | P3 | **`ActivityList.tsx` split fetching**: Two separate requests per render (activities + conversations). Merge into a single `/api/activities/combined` endpoint or use `Promise.all` on the backend. | `client/src/components/ActivityList.tsx`, `server/routes/activities.ts` |
| ⬜ Open | P3 | **`getContacts()` non-paginated call**: A safety cap of 2,000 rows is in place, but callers should be migrated to `getContactsPaginated()` for cursor-based pagination. See `TODO` comment in file. | `server/storage/contacts.ts` |

---

## TypeScript Hygiene

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Added | P1 | `req.user!` used 300+ times across route files. Added `getAuthUser(req, res)` helper in `server/utils/auth-helpers.ts` to eliminate non-null assertions. Migrate route files incrementally. | All `server/routes/*.ts` |
| ✅ Fixed | P2 | `(hcpUser as any)` in HCP scheduling service — replaced with typed `HCPEmployee` interface. | `server/housecall-scheduling-service.ts` |
| ✅ Fixed | P2 | `as any` on Google Places API responses in dashboard routes — replaced with typed response interfaces. | `server/routes/dashboard.ts` |
| ⬜ Open | P2 | `status as any` in workflow engine (lines 348, 352, 356) — define a union type for entity statuses derived from the Drizzle schema enums. | `server/workflow-engine.ts` |
| ⬜ Open | P2 | `options.status as any` in contacts storage (lines 105, 175) — the status type is derivable from `contactStatusEnum` in the schema. | `server/storage/contacts.ts` |
| ⬜ Open | P3 | `updateData: any` in `housecall-scheduling-service.ts` `syncHousecallUsers` — type the update shape using the `userContractors` Drizzle table schema. | `server/housecall-scheduling-service.ts` |

---

## UI / Database Sync Gaps

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P2 | Bulk status update and bulk delete mutations invalidate the local cache, but don't emit a WebSocket broadcast event. Other open user sessions won't see changes until manual refresh. | `server/routes/contacts.ts`, `client/src/hooks/useBulkActions.ts` |
| ⬜ Open | P2 | HCP webhook updates to jobs/estimates should emit a WS broadcast so the UI auto-refreshes. Verify all entity-mutation webhook handlers call `broadcastToContractor`. | `server/routes/webhooks/housecall-pro.ts` |
| ⬜ Open | P3 | Audit all mutation types against the WS event list to find any that skip broadcasting. Document the full event type catalogue in a comment near `broadcastToContractor`. | `server/websocket.ts` |

---

## Code Modularity

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ⬜ Open | P2 | `Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` all set up the same modal state boilerplate (edit, delete, details, follow-up). Extract a `useEntityPageModals<T>()` hook. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx` |
| ⬜ Open | P2 | `TextingModal` and `EmailComposerModal` are manually instantiated with near-identical props in 4 page files. Wrap into a `<CommunicationModals />` compound component. | `client/src/pages/Leads.tsx`, `Estimates.tsx`, `Jobs.tsx`, `Messages.tsx` |
| ⬜ Open | P3 | `EstimateCard.tsx` and `JobCard.tsx` share nearly identical layouts and contact-fetch logic. Consider a shared `EntityCard` base component. | `client/src/components/EstimateCard.tsx`, `JobCard.tsx` |

---

## Silent Error Paths

| Status | Priority | Description | File(s) |
|--------|----------|-------------|---------|
| ✅ Fixed | P1 | `catch (e) {}` in booking widget — was completely silent. Now logs a warning. | `client/public/booking-widget.js` |
| ⬜ Open | P1 | Workflow engine step execution catch blocks only log — should also update the workflow run record's status to `failed` so failures are visible in the execution log UI. | `server/workflow-engine.ts` |
| ⬜ Open | P2 | `dialpad-enhanced-service.ts` — dozens of catch blocks return `undefined` silently. Callers cannot distinguish "API returned nothing" from "API call failed". Add typed result types. | `server/dialpad-enhanced-service.ts` |
| ⬜ Open | P2 | HCP sync error during estimate creation (`server/routes/estimates.ts` ~line 160) is caught and logged but not surfaced to the caller. Consider adding a `syncWarning` field to the response. | `server/routes/estimates.ts` |

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
