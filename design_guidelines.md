# Multi-Tenant CRM Design Guidelines

## Design Approach
**Reference-Based Approach**: Drawing inspiration from **Pipedrive** - the leading CRM platform known for its clean, professional interface and excellent usability. This utility-focused application prioritizes efficiency, data clarity, and workflow optimization over visual flourishes.

## Core Design Principles
- **Data-First Interface**: Information hierarchy guides every design decision
- **Professional Efficiency**: Clean, scannable layouts that reduce cognitive load
- **Multi-Tenant Consistency**: Unified experience across tenant boundaries
- **Role-Based Clarity**: Clear visual distinction between user permissions

## Color Palette
**Primary Colors:**
- Brand Primary: 220 85% 55% (Professional blue)
- Success: 142 76% 36% (Green for completed jobs)
- Warning: 38 92% 50% (Orange for pending items)
- Error: 0 84% 60% (Red for urgent/overdue)

**Neutral Foundation:**
- Background: 210 20% 98% (Light mode) / 220 13% 9% (Dark mode)
- Surface: 0 0% 100% (Light) / 220 13% 14% (Dark)
- Text Primary: 220 13% 18% (Light) / 210 20% 98% (Dark)
- Text Secondary: 220 9% 46% (Light) / 220 9% 64% (Dark)
- Border: 220 13% 91% (Light) / 220 13% 18% (Dark)

## Typography
- **Primary Font**: Inter (Google Fonts)
- **Headers**: 600 weight, tight letter-spacing
- **Body Text**: 400 weight, relaxed line-height (1.6)
- **Data Labels**: 500 weight, compact spacing
- **Scale**: 12px, 14px, 16px, 18px, 24px, 32px

## Layout System
**Tailwind Spacing Units**: Primarily 2, 4, 6, 8, 12, 16
- Component padding: p-4, p-6
- Section spacing: mb-8, mt-12
- Grid gaps: gap-4, gap-6
- Container max-width: max-w-7xl

## Component Library

### Navigation
- **Sidebar Navigation**: Fixed left sidebar with collapsible sections
- **Breadcrumbs**: Show hierarchical location within tenant context
- **Tenant Switcher**: Dropdown in top navigation for multi-tenant access

### Data Display
- **Customer Cards**: Clean cards with contact info, job count, and status indicators
- **Job Table**: Sortable columns with status badges and priority indicators
- **Status Badges**: Rounded badges with semantic colors (draft: gray, pending: orange, approved: blue, completed: green)

### Forms
- **Input Fields**: Subtle borders with focus states in brand primary
- **Role Selectors**: Clear radio buttons or dropdown with permission descriptions
- **Tenant Onboarding**: Progressive forms with clear step indicators

### Dashboard Elements
- **Metric Cards**: Key statistics with trend indicators
- **Quick Actions**: Prominent CTA buttons for common workflows
- **Recent Activity**: Timeline-style list of latest customer interactions

## Key Screens Structure

### Dashboard
- Header with tenant name and user role indicator
- Key metrics in card layout (4 columns on desktop, 2 on tablet, 1 on mobile)
- Recent jobs table with inline actions
- Quick customer search and "Add Customer" CTA

### Customer Management
- Search and filter bar at top
- Customer cards in grid layout with consistent information hierarchy
- Quick actions overlay on card hover

### Job Tracking
- Kanban board view by status with drag-and-drop capability
- Table view with sortable columns and bulk actions
- Job detail modal with Housecall Pro sync status

## Interaction Patterns
- **Loading States**: Skeleton screens for data-heavy sections
- **Empty States**: Helpful illustrations with clear next steps
- **Error Handling**: Inline validation with contextual messaging
- **Responsive Design**: Mobile-first with tablet and desktop optimizations

## Integration Visual Cues
- **Housecall Pro Sync**: Subtle sync status indicators on relevant data
- **API Status**: Connection health indicators in settings area
- **Real-time Updates**: Gentle notifications for data changes

This design system balances professional utility with modern aesthetics, ensuring the CRM feels both powerful and approachable for users managing customer relationships and job workflows.