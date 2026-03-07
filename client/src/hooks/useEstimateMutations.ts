import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { invalidateEstimates } from "@/hooks/useInvalidations";
import type { EditEstimateFormValues } from "@/components/EditEstimateModal";

/**
 * Shared estimate mutation hook — provides pre-wired mutations for all common
 * estimate operations. Every mutation uses `invalidateEstimates` from useInvalidations:
 *   - /api/estimates/paginated   — updates the paginated estimate list
 *   - /api/estimates/status-counts — updates the status bar counters
 *   - /api/estimates             — updates any full-list consumers
 *   - /api/estimates/follow-ups  — keeps follow-up widgets in sync
 *
 * Usage:
 *   const {
 *     updateEstimate,
 *     updateFollowUpDate,
 *     deleteEstimate,
 *   } = useEstimateMutations({
 *     onEditSuccess: () => setActiveModal(null),
 *     onFollowUpSuccess: () => setActiveModal(null),
 *     onDeleteSuccess: () => setActiveModal(null),
 *   });
 *
 * Per-call callbacks: All mutations also accept an optional second argument with
 * per-call onSuccess/onError callbacks (standard TanStack Query pattern).
 */
export function useEstimateMutations({
  onEditSuccess,
  onFollowUpSuccess,
  onDeleteSuccess,
}: {
  onEditSuccess?: () => void;
  onFollowUpSuccess?: () => void;
  onDeleteSuccess?: () => void;
} = {}) {
  const { toast } = useToast();

  const updateEstimate = useMutation({
    mutationFn: async ({ estimateId, data }: { estimateId: string; data: EditEstimateFormValues }) => {
      return apiRequest("PUT", `/api/estimates/${estimateId}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Estimate updated",
        description: "The estimate has been successfully updated.",
      });
      invalidateEstimates();
      onEditSuccess?.();
    },
    onError: (error) => {
      toast({
        title: "Error updating estimate",
        description: error instanceof Error ? error.message : "Failed to update estimate. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateFollowUpDate = useMutation({
    mutationFn: async ({ estimateId, followUpDate }: { estimateId: string; followUpDate: Date | null }) => {
      return apiRequest("PATCH", `/api/estimates/${estimateId}/follow-up`, {
        followUpDate: followUpDate ? followUpDate.toISOString() : null,
      });
    },
    onSuccess: () => {
      toast({
        title: "Follow-up date set",
        description: "The follow-up date has been successfully updated.",
      });
      invalidateEstimates();
      onFollowUpSuccess?.();
    },
    onError: (error) => {
      toast({
        title: "Error setting follow-up date",
        description: error instanceof Error ? error.message : "Failed to set follow-up date. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteEstimate = useMutation({
    mutationFn: async (estimateId: string) => {
      return apiRequest("DELETE", `/api/estimates/${estimateId}`);
    },
    onSuccess: () => {
      toast({
        title: "Estimate Deleted",
        description: "Estimate has been successfully deleted.",
      });
      invalidateEstimates();
      onDeleteSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Estimate",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  return { updateEstimate, updateFollowUpDate, deleteEstimate };
}
