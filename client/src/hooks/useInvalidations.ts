import { queryClient } from "@/lib/queryClient";

// Centralized query invalidation helpers.
//
// Problem this solves: Every mutation's onSuccess callback across Leads.tsx,
// Jobs.tsx, Estimates.tsx, and Customers.tsx was manually listing the same 3-5
// query keys to invalidate. When a new related query was added, it had to be
// added to every onSuccess call individually.
//
// Usage:
//   import { invalidateContacts } from "@/hooks/useInvalidations";
//   // Inside useMutation onSuccess:
//   invalidateContacts(contactId);
//
// When to update this file:
//   Add a new query key here if it should always be invalidated together with
//   the existing keys for that entity type. Do NOT add one-off keys here —
//   those belong in the specific mutation's onSuccess handler.

/** Invalidate all contact-related queries. Pass contactId for per-contact cache. */
export function invalidateContacts(contactId?: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
  queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
  if (contactId) {
    queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}`] });
  }
}

/** Invalidate all job-related queries, plus related contact and estimate queries. */
export function invalidateJobs() {
  queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
  queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
}

/** Invalidate all estimate-related queries. */
export function invalidateEstimates() {
  queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
  queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
  queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
}

/** Invalidate activity feed queries (used when notes/activities are created). */
export function invalidateActivities() {
  queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
}

/** Convenience: invalidate contacts + activities together (common after status changes). */
export function invalidateContactsAndActivities(contactId?: string) {
  invalidateContacts(contactId);
  invalidateActivities();
}
