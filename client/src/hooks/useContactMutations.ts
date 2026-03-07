import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared contact mutation hook — provides pre-wired delete and status-update
 * mutations that are duplicated across Leads, Follow-ups, and other pages.
 *
 * Both mutations share the same cache-invalidation strategy:
 *   - /api/contacts/paginated  — updates the paginated lead list
 *   - /api/contacts/status-counts — updates the status bar counters
 *   - /api/contacts            — updates any full-list consumers
 *   - /api/contacts/follow-ups — clears follow-up widgets when a lead is deleted/moved
 *
 * Usage:
 *   const { deleteContact, updateContactStatus } = useContactMutations();
 *   deleteContact.mutate(contactId);
 *   updateContactStatus.mutate({ contactId, status: 'contacted' });
 */
export function useContactMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidateContactQueries = (contactId?: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/contacts/follow-ups"] });
    if (contactId) {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId] });
    }
  };

  const deleteContact = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("DELETE", `/api/contacts/${contactId}`);
    },
    onSuccess: () => {
      toast({ title: "Lead Deleted", description: "Lead has been successfully deleted." });
      invalidateContactQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const updateContactStatus = useMutation({
    mutationFn: async (data: { contactId: string; status: string }) => {
      return apiRequest("PATCH", `/api/contacts/${data.contactId}/status`, { status: data.status });
    },
    onSuccess: (_result, data) => {
      toast({ title: "Status Updated", description: "Lead status has been successfully updated." });
      invalidateContactQueries(data.contactId);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Status",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  return { deleteContact, updateContactStatus };
}
