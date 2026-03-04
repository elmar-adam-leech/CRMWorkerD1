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

`client/src/pages/Settings.tsx` (~2,146 lines) imports two self-contained sub-components that were extracted to keep the file manageable:

```
client/src/components/settings/
  SalespeopleManagement.tsx  — Salespeople/scheduling tab (own queries, mutations, local state)
  GmailConnectionCard.tsx    — Gmail OAuth connect/disconnect/sync card (own mutations, URL-param handling)
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

### Shared Component Library
Reusable components extracted to avoid duplication across Jobs, Estimates, and Leads pages:
- `DeleteConfirmDialog` — standardised AlertDialog for destructive confirmations
- `EditStatusModal` — Dialog with status-picker button grid; used by Leads page
- `StatusFilterBar` — Quick-filter badge row with counts; used by Jobs, Estimates, Leads
- `LoadMoreButton` — Cursor-pagination load trigger; used by Jobs, Estimates, Leads
- `ViewToggle` — Card/Kanban view switch; used by Jobs and Leads

### Page Preferences Hook
`usePagePreferences({ pageKey })` persists `viewMode`, `filterStatus`, `advancedFilters` to localStorage per page. Currently wired into Jobs and Leads.

### Known Pending Issues
- `GET /api/contacts/[object%20Object]` 404 — object being stringified as contact ID (source not yet traced)
- Several TypeScript errors in example/demo components (`examples/`) are pre-existing and don't affect production