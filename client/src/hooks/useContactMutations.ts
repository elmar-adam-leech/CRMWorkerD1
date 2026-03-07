import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared contact mutation hook — provides pre-wired mutations for all common
 * contact operations. Every mutation shares the same cache-invalidation strategy:
 *   - /api/contacts/paginated  — updates the paginated lead list
 *   - /api/contacts/status-counts — updates the status bar counters
 *   - /api/contacts            — updates any full-list consumers
 *   - /api/contacts/follow-ups — keeps follow-up widgets in sync
 *
 * Usage:
 *   const { deleteContact, updateContactStatus, archiveLead, restoreLead, updateFollowUpDate } = useContactMutations();
 *   deleteContact.mutate(contactId);
 *   updateContactStatus.mutate({ contactId, status: 'contacted' });
 *   archiveLead.mutate(leadId);
 *   restoreLead.mutate(leadId);
 *   updateFollowUpDate.mutate({ contactId, followUpDate: new Date() });
 *
 * Per-call callbacks: All mutations accept an optional second argument with
 * per-call onSuccess/onError callbacks (standard TanStack Query pattern):
 *   deleteContact.mutate(id, { onSuccess: () => closeDialog() });
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

  const archiveLead = useMutation({
    mutationFn: async (leadId: string) => {
      return apiRequest("PATCH", `/api/leads/${leadId}/archive`);
    },
    onSuccess: () => {
      toast({ title: "Lead Archived", description: "Lead has been archived and is hidden from the main view." });
      invalidateContactQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Archive Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const restoreLead = useMutation({
    mutationFn: async (leadId: string) => {
      return apiRequest("PATCH", `/api/leads/${leadId}/restore`);
    },
    onSuccess: () => {
      toast({ title: "Lead Restored", description: "Lead has been restored and is visible again." });
      invalidateContactQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Restore Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const updateFollowUpDate = useMutation({
    mutationFn: async (data: { contactId: string; followUpDate: Date | null }) => {
      return apiRequest("PATCH", `/api/contacts/${data.contactId}/follow-up`, {
        followUpDate: data.followUpDate ? data.followUpDate.toISOString() : null,
      });
    },
    onSuccess: () => {
      toast({ title: "Follow-Up Date Set", description: "Follow-up date has been successfully updated." });
      invalidateContactQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Follow-Up Date",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  return { deleteContact, updateContactStatus, archiveLead, restoreLead, updateFollowUpDate };
}
