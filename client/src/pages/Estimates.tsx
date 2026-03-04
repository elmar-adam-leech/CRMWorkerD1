import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { EstimateCard } from "@/components/EstimateCard";
import { EstimateCardSkeleton } from "@/components/EstimateCardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Calendar, FileText, Download, Filter } from "lucide-react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatStatusLabel, cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import type { PaginatedEstimates, TerminologySettings, Contact, EstimateSummary } from "@shared/schema";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFetchContact } from "@/hooks/useFetchContact";
import { useHousecallProIntegration } from "@/hooks/useHousecallProIntegration";
import { useHcpImport } from "@/hooks/useHcpImport";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { StatusFilterBar } from "@/components/StatusFilterBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { usePagePreferences } from "@/hooks/use-page-preferences";
import { useAddModalFromUrl } from "@/hooks/use-add-modal-from-url";
import { EmptyState } from "@/components/EmptyState";
import { CreateEstimateModal } from "@/components/CreateEstimateModal";
import { EditEstimateModal, type EditEstimateFormValues } from "@/components/EditEstimateModal";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { EstimateDetailsModal, type EstimateListItem } from "@/components/EstimateDetailsModal";
import { type EstimateCardItem } from "@/components/EstimateCard";
import { HCPImportModal } from "@/components/HCPImportModal";

const ESTIMATE_FILTER_STATUSES = ["sent", "pending", "approved", "rejected"] as const;

const ESTIMATE_BULK_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

export default function Estimates({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const { fetchContact } = useFetchContact();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const { filterStatus, setFilterStatus, advancedFilters, setAdvancedFilters } =
    usePagePreferences({ pageKey: "estimates" });

  const { isSelectionMode } = useBulkSelection();

  const {
    emailModal,
    textingModal,
    handleSendEmail,
    handleSendText,
    handleContact,
    closeEmailModal,
    closeTextingModal,
  } = useCommunicationActions();

  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    estimate?: EstimateSummary;
  }>({ isOpen: false });

  const [addModal, setAddModal] = useState(false);

  const [detailsModal, setDetailsModal] = useState<{
    isOpen: boolean;
    estimate?: EstimateListItem;
  }>({ isOpen: false });

  const [followUpModal, setFollowUpModal] = useState<{
    isOpen: boolean;
    estimate?: EstimateCardItem;
  }>({ isOpen: false });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    estimateId?: string;
    estimateTitle?: string;
  }>({ isOpen: false });

  const { data: terminology } = useQuery<TerminologySettings>({
    queryKey: ["/api/terminology"],
  });

  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ["/api/users"],
  });

  const { data: detailsContact } = useQuery<Contact>({
    queryKey: ["/api/contacts", detailsModal.estimate?.contactId],
    enabled: detailsModal.isOpen && !!detailsModal.estimate?.contactId,
  });

  const {
    data: estimatesData,
    isLoading: estimatesLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "/api/estimates/paginated",
      {
        status: filterStatus,
        search: searchQuery,
        assignedTo: advancedFilters.assignedTo,
        dateFrom: advancedFilters.dateFrom?.toISOString(),
        dateTo: advancedFilters.dateTo?.toISOString(),
      },
    ],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.append("cursor", pageParam);
      params.append("limit", "50");
      if (filterStatus !== "all") params.append("status", filterStatus);
      if (searchQuery) params.append("search", searchQuery);
      if (advancedFilters.assignedTo) params.append("assignedTo", advancedFilters.assignedTo);
      if (advancedFilters.dateFrom) params.append("dateFrom", advancedFilters.dateFrom.toISOString());
      if (advancedFilters.dateTo) params.append("dateTo", advancedFilters.dateTo.toISOString());
      return (await apiRequest("GET", `/api/estimates/paginated?${params}`)).json() as Promise<PaginatedEstimates>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  const estimates = estimatesData?.pages.flatMap((page) => page.data) || [];
  const totalEstimates = estimatesData?.pages[0]?.pagination.total || 0;

  const { isHousecallProConfigured, syncStartDate } = useHousecallProIntegration();

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useGlobalShortcuts((type) => {
    if (type === "estimate") {
      setAddModal(true);
    }
  });

  useAddModalFromUrl(() => setAddModal(true));

  const { importDateOpen, setImportDateOpen, selectedImportDate, setSelectedImportDate, handleConfirmImport } =
    useHcpImport({
      entityType: "estimates",
      syncStartDate,
      queryKeysToInvalidate: ["/api/estimates/paginated", "/api/estimates/status-counts"],
    });

  useWebSocketInvalidation([
    {
      types: ["new_estimate", "estimate_created", "estimate_updated", "estimate_deleted"],
      queryKeys: ["/api/estimates/paginated", "/api/estimates/status-counts", "/api/estimates"],
    },
  ]);

  const allEstimates: EstimateListItem[] = (estimates || []).map((e) => ({
    id: e.id,
    title: e.title,
    contactId: e.contactId,
    contactName: e.contactName,
    status: e.status,
    value: parseFloat(e.amount),
    createdDate: new Date(e.createdAt).toLocaleDateString(),
    expiryDate: e.validUntil ? new Date(e.validUntil).toLocaleDateString() : "No expiry",
    description: "",
    priority: "medium" as const,
  }));

  const { data: statusCountsData } = useQuery<{
    all: number;
    sent: number;
    pending: number;
    approved: number;
    rejected: number;
  }>({
    queryKey: ["/api/estimates/status-counts", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      return (await apiRequest("GET", `/api/estimates/status-counts?${params}`)).json();
    },
  });

  const statusCounts = statusCountsData || { all: 0, sent: 0, pending: 0, approved: 0, rejected: 0 };

  const handleAddEstimate = () => setAddModal(true);

  const handleImportFromHousecallPro = () => setImportDateOpen(true);

  const handleSend = (_estimateId: string) => {
    toast({ title: "Sending estimates is not yet available" });
  };

  const handleViewDetails = (estimateId: string) => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (estimate) {
      setDetailsModal({ isOpen: true, estimate });
    }
  };

  const handleContactById = async (estimateId: string, method: "phone" | "email") => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (!estimate) return;

    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;

    apiRequest("POST", "/api/activities", {
      type: method === "phone" ? "call" : "email",
      content: `${method === "phone" ? "Called" : "Emailed"} ${contact.name} regarding ${estimate.title}`,
      estimateId: estimateId,
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      })
      .catch(() => {});

    const entity = { name: contact.name, emails: contact.emails, phones: contact.phones, id: estimate.id };

    if (method === "phone") {
      if (contact.phones?.[0]) {
        handleContact(entity, method);
      } else {
        toast({
          title: "No phone number",
          description: `${contact.name} doesn't have a phone number on file.`,
          variant: "destructive",
        });
      }
    } else {
      if (contact.emails?.[0]) {
        handleContact(entity, method);
      } else {
        toast({
          title: "No email address",
          description: `${contact.name} doesn't have an email address on file.`,
          variant: "destructive",
        });
      }
    }
  };

  const handleSendTextByEntity = async (estimate: EstimateCardItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendText({ id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones }, "estimate");
  };

  const handleSendEmailByEntity = async (estimate: EstimateCardItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendEmail(
      { id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones },
      "estimate"
    );
  };

  const handleConvertToJob = (_estimateId: string) => {
    toast({ title: "Convert to job is not yet available" });
  };

  const handleEditEstimate = (estimateId: string) => {
    const estimate = (estimates || []).find((e) => e.id === estimateId);
    if (estimate) {
      setEditModal({ isOpen: true, estimate });
    }
  };

  const updateEstimateMutation = useMutation({
    mutationFn: async ({ estimateId, data }: { estimateId: string; data: EditEstimateFormValues }) => {
      return apiRequest("PUT", `/api/estimates/${estimateId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      toast({
        title: "Estimate updated",
        description: "The estimate has been successfully updated.",
      });
      setEditModal({ isOpen: false });
    },
    onError: (error) => {
      toast({
        title: "Error updating estimate",
        description: error instanceof Error ? error.message : "Failed to update estimate. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateFollowUpDateMutation = useMutation({
    mutationFn: async ({ estimateId, followUpDate }: { estimateId: string; followUpDate: Date | null }) => {
      return apiRequest("PATCH", `/api/estimates/${estimateId}/follow-up`, {
        followUpDate: followUpDate ? followUpDate.toISOString() : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({
        title: "Follow-up date set",
        description: "The follow-up date has been successfully updated.",
      });
      setFollowUpModal({ isOpen: false });
    },
    onError: (error) => {
      toast({
        title: "Error setting follow-up date",
        description: error instanceof Error ? error.message : "Failed to set follow-up date. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSetFollowUp = (estimate: EstimateCardItem) => {
    setFollowUpModal({ isOpen: true, estimate });
  };

  const deleteEstimateMutation = useMutation({
    mutationFn: async (estimateId: string) => {
      return apiRequest("DELETE", `/api/estimates/${estimateId}`);
    },
    onSuccess: () => {
      setDeleteConfirm({ isOpen: false });
      toast({
        title: "Estimate Deleted",
        description: "Estimate has been successfully deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Estimate",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (estimateId: string) => {
    const estimate = (estimates || []).find((e) => e.id === estimateId);
    if (!estimate) return;
    setDeleteConfirm({ isOpen: true, estimateId, estimateTitle: estimate.title });
  };

  const handleEditSave = (values: EditEstimateFormValues) => {
    if (!editModal.estimate) return;
    updateEstimateMutation.mutate({ estimateId: editModal.estimate.id, data: values });
  };

  const handleFollowUpSave = (date: Date | null | undefined) => {
    if (!followUpModal.estimate) return;
    updateFollowUpDateMutation.mutate({
      estimateId: followUpModal.estimate.id,
      followUpDate: date ?? null,
    });
  };

  const handleBulkDelete = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/estimates/${id}`)));
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: `Deleted ${ids.length} estimate(s)` });
    } catch (error) {
      toast({
        title: "Bulk delete failed",
        description: error instanceof Error ? error.message : "Some estimates could not be deleted.",
        variant: "destructive",
      });
    }
  };

  const handleBulkStatusChange = async (ids: string[], status: string) => {
    try {
      await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/estimates/${id}/status`, { status })));
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: `Updated ${ids.length} estimate(s) to ${status}` });
    } catch (error) {
      toast({
        title: "Bulk status update failed",
        description: error instanceof Error ? error.message : "Some estimates could not be updated.",
        variant: "destructive",
      });
    }
  };

  const handleBulkExport = async (ids: string[]) => {
    const selectedEstimates = allEstimates.filter((est) => ids.includes(est.id));
    downloadCsv(
      `estimates-export-${new Date().toISOString().split("T")[0]}.csv`,
      ["Title", "Customer", "Status", "Value", "Created Date", "Expiry Date"],
      selectedEstimates.map((est) => [est.title, est.contactName, est.status, est.value, est.createdDate, est.expiryDate])
    );
    toast({ title: `Exported ${ids.length} estimate(s)` });
  };

  return (
    <PageLayout className={cn(isSelectionMode && "pb-20")}>
      <PageHeader
        title={terminology?.estimatesLabel || "Estimates"}
        description="Create and manage estimates for potential jobs"
        icon={<Calendar className="h-6 w-6" />}
        actions={
          <div className="flex items-center gap-2">
            {isHousecallProConfigured && (
              <Button variant="outline" onClick={handleImportFromHousecallPro} data-testid="button-import-hcp-estimates">
                <Download className="h-4 w-4 mr-2" />
                Import from Housecall Pro
              </Button>
            )}
            <Button onClick={handleAddEstimate} data-testid="button-add-estimate">
              <Plus className="h-4 w-4 mr-2" />
              Add {terminology?.estimateLabel || "Estimate"}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${(terminology?.estimatesLabel || "estimates").toLowerCase()} by title, customer, or description...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="input-estimate-search"
            />
          </div>
        </div>

        <StatusFilterBar
          statuses={ESTIMATE_FILTER_STATUSES}
          activeStatus={filterStatus}
          counts={statusCounts}
          onStatusChange={setFilterStatus}
        />

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={ESTIMATE_FILTER_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) }))}
          userOptions={usersData?.map((u) => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Created Date"
        />
      </div>

      {estimates.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {estimates.length} of {totalEstimates}{" "}
          {terminology?.estimatesLabel?.toLowerCase() || "estimates"}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {allEstimates.map((estimate) => (
          <EstimateCard
            key={estimate.id}
            estimate={estimate}
            onSend={handleSend}
            onViewDetails={handleViewDetails}
            onConvertToJob={handleConvertToJob}
            onSetFollowUp={handleSetFollowUp}
            onEdit={handleEditEstimate}
            onContact={handleContactById}
            onSendText={handleSendTextByEntity}
            onSendEmail={handleSendEmailByEntity}
            onDelete={handleDelete}
            selectable={true}
          />
        ))}
      </div>

      {estimatesLoading && allEstimates.length === 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <EstimateCardSkeleton key={index} />
          ))}
        </div>
      )}

      {isFetchingNextPage && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <EstimateCardSkeleton key={`loading-${index}`} />
          ))}
        </div>
      )}

      <LoadMoreButton
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
        label="Load More Estimates"
        testId="button-load-more-estimates"
      />

      {allEstimates.length === 0 && !estimatesLoading &&
        (searchQuery || filterStatus !== "all" ? (
          <EmptyState
            icon={Filter}
            title="No estimates match your filters"
            description="Try adjusting your search criteria or filters to find more estimates."
            tips={[
              "Clear some filters to broaden your search",
              "Check your date range settings",
              "Try searching by customer name or estimate title",
            ]}
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No estimates yet"
            description="Create your first estimate to send pricing proposals to customers."
            tips={[
              "Estimates help you provide formal quotes to potential customers",
              "Track estimate status from sent to approved or rejected",
              "Convert approved estimates directly into jobs",
            ]}
            ctaLabel="Create Your First Estimate"
            onCtaClick={handleAddEstimate}
            ctaTestId="button-add-first-estimate"
          />
        ))}

      <EditEstimateModal
        isOpen={editModal.isOpen}
        estimate={editModal.estimate}
        onClose={() => setEditModal({ isOpen: false })}
        onSave={handleEditSave}
        isSaving={updateEstimateMutation.isPending}
      />

      <CreateEstimateModal isOpen={addModal} onClose={() => setAddModal(false)} />

      <EstimateDetailsModal
        isOpen={detailsModal.isOpen}
        onClose={() => setDetailsModal({ isOpen: false })}
        estimate={detailsModal.estimate}
        detailsContact={detailsContact}
        onContact={handleContact}
        onSendText={handleSendText}
        onSendEmail={handleSendEmail}
      />

      <TextingModal
        isOpen={textingModal.isOpen}
        onClose={closeTextingModal}
        recipientName={textingModal.estimate?.name || ""}
        recipientPhone={textingModal.estimate?.phones?.[0] || textingModal.estimate?.phone || ""}
        recipientEmail={textingModal.estimate?.emails?.[0] || textingModal.estimate?.email || ""}
        estimateId={textingModal.estimate?.id}
      />

      <EmailComposerModal
        isOpen={emailModal.isOpen}
        onClose={closeEmailModal}
        recipientName={emailModal.estimate?.name || ""}
        recipientEmail={emailModal.estimate?.emails?.[0] || emailModal.estimate?.email || ""}
        estimateId={emailModal.estimate?.id}
      />

      <HCPImportModal
        isOpen={importDateOpen}
        onClose={() => setImportDateOpen(false)}
        onConfirm={handleConfirmImport}
        selectedDate={selectedImportDate}
        onDateChange={setSelectedImportDate}
        entityLabel="estimates"
      />

      <FollowUpDateModal
        isOpen={followUpModal.isOpen}
        onClose={() => setFollowUpModal({ isOpen: false })}
        onSave={handleFollowUpSave}
        entityName={followUpModal.estimate?.title}
        isSaving={updateFollowUpDateMutation.isPending}
      />

      <BulkActionToolbar
        onDelete={handleBulkDelete}
        onStatusChange={handleBulkStatusChange}
        onExport={handleBulkExport}
        statusOptions={ESTIMATE_BULK_STATUSES}
      />

      <DeleteConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, isOpen: open }))}
        title="Delete Estimate"
        description={`Are you sure you want to delete "${deleteConfirm.estimateTitle ?? "this estimate"}"? This action cannot be undone.`}
        onConfirm={() => {
          if (deleteConfirm.estimateId) {
            deleteEstimateMutation.mutate(deleteConfirm.estimateId);
          }
        }}
        confirmTestId="button-confirm-delete-estimate"
      />
    </PageLayout>
  );
}
