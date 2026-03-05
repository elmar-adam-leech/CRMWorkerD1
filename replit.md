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
- **Lead Trend Chart**: `GET /api/contacts/lead-trend` returns a SQL `GROUP BY DATE` aggregate (≤30 rows). The `LeadsTrendChart` component uses this instead of fetching all lead contacts.
- **HCP jobs sync**: `getJobsByExternalIds` pre-fetches all jobs in a batch via `inArray` before the inner loop — eliminates 1 DB query per job.
- **HCP estimates sync**: `getEstimatesByHousecallProIds` pre-fetches all estimates in a batch — same pattern.
- **Gmail sync dedup**: Batch `inArray` query collects all already-synced email IDs upfront; per-email check is O(1) Set lookup.
- **`getContacts` hard cap**: `.limit(2000)` prevents accidental full-table dumps; use `/api/contacts/paginated` for UI.

### DB Indexes (current full set)
The following indexes exist beyond Drizzle's default primary keys:
- `contacts`: contractor_id, contractor+status, contractor+type, contractor+date, contractor+scheduled, external_lookup (contractor+source+external_id), **housecall_pro_customer_id (partial)**, follow_up_date, tags, created_at, status, type, contacted_at, is_scheduled
- `jobs`: contractor_id, contractor+status, contractor+date, contact_id, status, created_at, scheduled_date, **external_id (partial)**
- `estimates`: contractor_id, contractor+status, contractor+date, contact_id, status, created_at, follow_up_date, **external_id+contractor_id (partial)**
- `activities`: contractor_id, contractor+type, contractor+type+contact, contractor+date, contact_id, estimate_id, job_id, external_lookup (source+external_id), user_id, type, created_at
- `messages`: contractor_id, contractor+contact, contractor+contact+created, contractor+phone, contact_id, estimate_id, external_message_id, from_number, to_number, direction, created_at
- `leads`: contractor_id, contractor+status, contact_id, status, assigned_to_user_id
- `user_invitations`: contractor_id
- `business_targets`: contractor_id

### Code Organization
- `server/routes/public.ts` — unauthenticated routes only: `/sw-unregister`, `/api/public/*` (Places proxy, booking, availability, public lead intake), `/api/version`.
- `server/routes/dashboard.ts` — authenticated routes split from public.ts: `/api/places/autocomplete`, `/api/places/details`, `/api/dashboard/metrics`.
- `server/sync/housecall-pro.ts` — `mapHcpEstimateStatus(hcpEstimate)` is the single source of truth for HCP→CRM status mapping (no duplicated chains).

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