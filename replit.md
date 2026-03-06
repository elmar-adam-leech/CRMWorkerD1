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
- **Real-time**: WebSocket-based architecture.
- **Security**: HTTP-only cookies, role-based access control, AES-256-GCM encryption.

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