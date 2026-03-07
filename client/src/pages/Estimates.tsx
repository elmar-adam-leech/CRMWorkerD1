import { useState, useEffect, useMemo, useCallback } from "react";
import { EstimateCard } from "@/components/EstimateCard";
import { CardSkeleton } from "@/components/CardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, FileText, Download, Filter } from "lucide-react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatStatusLabel, cn } from "@/lib/utils";
import { useBulkActions } from "@/hooks/useBulkActions";
import type { PaginatedEstimates, EstimateSummary, Contact } from "@shared/schema";
import { useTerminologyContext } from "@/contexts/TerminologyContext";
import { useUsers } from "@/hooks/useUsers";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFetchContact } from "@/hooks/useFetchContact";
import { useHousecallProIntegration } from "@/hooks/useHousecallProIntegration";
import { useHcpImport } from "@/hooks/useHcpImport";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { StatusFilterBar } from "@/components/StatusFilterBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { FilterPanel } from "@/components/FilterPanel";
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
import { useEstimateMutations } from "@/hooks/useEstimateMutations";

const ESTIMATE_FILTER_STATUSES = ["sent", "pending", "approved", "rejected"] as const;

const ESTIMATE_BULK_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

type ActiveEstimateModal =
  | { type: "add" }
  | { type: "edit"; estimate: EstimateSummary }
  | { type: "details"; estimate: EstimateListItem }
  | { type: "followUp"; estimate: EstimateCardItem }
  | { type: "delete"; estimateId: string; estimateTitle: string }
  | null;

export default function Estimates({ externalSearch = "" }: { externalSearch?: string }) {
  const { fetchContact } = useFetchContact();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const { filterStatus, setFilterStatus, advancedFilters, setAdvancedFilters } =
    usePagePreferences({ pageKey: "estimates" });

  const { isSelectionMode, selectedIds, toggleItem } = useBulkSelection();

  const {
    emailModal,
    textingModal,
    handleSendEmail,
    handleSendText,
    handleContact,
    closeEmailModal,
    closeTextingModal,
  } = useCommunicationActions();

  const [activeModal, setActiveModal] = useState<ActiveEstimateModal>(null);

  const { updateEstimate, updateFollowUpDate, deleteEstimate } = useEstimateMutations({
    onEditSuccess: () => setActiveModal(null),
    onFollowUpSuccess: () => setActiveModal(null),
    onDeleteSuccess: () => setActiveModal(null),
  });

  const terminology = useTerminologyContext();
  const { data: usersData } = useUsers();

  const estimateStatusOptions = useMemo(
    () => ESTIMATE_FILTER_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) })),
    []
  );
  const estimateUserOptions = useMemo(
    () => usersData?.map((u) => ({ value: u.id, label: u.name })) ?? [],
    [usersData]
  );

  const { data: detailsContact } = useQuery<Contact>({
    queryKey: ["/api/contacts", activeModal?.type === "details" ? activeModal.estimate.contactId : undefined],
    enabled: activeModal?.type === "details" && !!activeModal.estimate.contactId,
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
      if (advancedFilters.dateFrom) params.append("dateFrom", advancedFilters.dateFrom.toISOString());
      if (advancedFilters.dateTo) params.append("dateTo", advancedFilters.dateTo.toISOString());
      return (await apiRequest("GET", `/api/estimates/paginated?${params}`)).json() as Promise<PaginatedEstimates>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  const estimates = estimatesData?.pages.flatMap((page) => page.data) || [];
  const totalEstimates = estimatesData?.pages[0]?.pagination.total || 0;

  // Status counts come bundled with the paginated response — no separate round trip needed.
  // Falls back to zeros during initial load.
  const statusCounts = estimatesData?.pages[0]?.statusCounts ?? {
    all: 0, sent: 0, pending: 0, approved: 0, rejected: 0,
  };

  const { isHousecallProConfigured, syncStartDate } = useHousecallProIntegration();

  const { toast } = useToast();

  useGlobalShortcuts((type) => {
    if (type === "estimate") setActiveModal({ type: "add" });
  });

  useAddModalFromUrl(() => setActiveModal({ type: "add" }));

  const { importDateOpen, setImportDateOpen, selectedImportDate, setSelectedImportDate, handleConfirmImport } =
    useHcpImport({
      entityType: "estimates",
      syncStartDate,
      queryKeysToInvalidate: ["/api/estimates/paginated", "/api/estimates/status-counts"],
    });

  useWebSocketInvalidation([
    {
      types: ["new_estimate", "estimate_created", "estimate_updated", "estimate_deleted"],
      queryKeys: ["/api/estimates/paginated", "/api/estimates/status-counts", "/api/estimates", "/api/estimates/follow-ups"],
    },
  ]);

  const allEstimates: EstimateListItem[] = useMemo(() =>
    (estimates || []).map((e) => ({
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
    })),
    [estimates]
  );

  const handleAddEstimate = useCallback(() => setActiveModal({ type: "add" }), []);

  const handleImportFromHousecallPro = useCallback(() => setImportDateOpen(true), []);

  const handleSend = useCallback((_estimateId: string) => {
    toast({ title: "Sending estimates is not yet available" });
  }, [toast]);

  const handleViewDetails = useCallback((estimateId: string) => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (estimate) setActiveModal({ type: "details", estimate });
  }, [allEstimates]);

  const handleContactById = useCallback(async (estimateId: string, method: "phone" | "email") => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (!estimate) return;

    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;

    apiRequest("POST", "/api/activities", {
      type: method === "phone" ? "call" : "email",
      content: `${method === "phone" ? "Called" : "Emailed"} ${contact.name} regarding ${estimate.title}`,
      estimateId: estimateId,
    }).catch((err: unknown) => {
      console.error("[Estimates] Failed to log activity:", err);
    });

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
  }, [allEstimates, fetchContact, handleContact, toast]);

  const handleSendTextByEntity = useCallback(async (estimate: EstimateCardItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendText({ id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones }, "estimate");
  }, [fetchContact, handleSendText]);

  const handleSendEmailByEntity = useCallback(async (estimate: EstimateCardItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendEmail(
      { id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones },
      "estimate"
    );
  }, [fetchContact, handleSendEmail]);

  const handleConvertToJob = (_estimateId: string) => {
    toast({ title: "Convert to job is not yet available" });
  };

  const handleEditEstimate = useCallback((estimateId: string) => {
    const estimate = (estimates || []).find((e) => e.id === estimateId);
    if (estimate) setActiveModal({ type: "edit", estimate });
  }, [estimates]);

  const handleSetFollowUp = (estimate: EstimateCardItem) => {
    setActiveModal({ type: "followUp", estimate });
  };

  const handleDelete = useCallback((estimateId: string) => {
    const estimate = (estimates || []).find((e) => e.id === estimateId);
    if (!estimate) return;
    setActiveModal({ type: "delete", estimateId, estimateTitle: estimate.title });
  }, [estimates]);

  const handleEditSave = (values: EditEstimateFormValues) => {
    if (activeModal?.type !== "edit") return;
    updateEstimate.mutate({ estimateId: activeModal.estimate.id, data: values });
  };

  const handleFollowUpSave = (date: Date | null | undefined) => {
    if (activeModal?.type !== "followUp") return;
    updateFollowUpDate.mutate({
      estimateId: activeModal.estimate.id,
      followUpDate: date ?? null,
    });
  };

  const { handleBulkDelete, handleBulkStatusChange, handleBulkExport } = useBulkActions({
    entityType: "estimate",
    deleteEndpoint: (id) => `/api/estimates/${id}`,
    statusEndpoint: (id) => `/api/estimates/${id}/status`,
    invalidateKeys: [
      ["/api/estimates/paginated"],
      ["/api/estimates/status-counts"],
      ["/api/estimates"],
    ],
    exportFilename: `estimates-export-${new Date().toISOString().split("T")[0]}.csv`,
    exportHeaders: ["Title", "Customer", "Status", "Value", "Created Date", "Expiry Date"],
    getExportRow: (est) => {
      const e = est as EstimateListItem;
      return [e.title, e.contactName ?? undefined, e.status, e.value ?? undefined, e.createdDate ?? undefined, e.expiryDate ?? undefined];
    },
    entities: allEstimates,
  });

  return (
    <PageLayout className={cn(isSelectionMode && "pb-20")}>
      <PageHeader
        title={terminology?.estimatesLabel || "Estimates"}
        description="Create and manage estimates for potential jobs"
        actions={
          <div className="flex items-center gap-2">
            {isHousecallProConfigured && (
              <Button variant="outline" onClick={handleImportFromHousecallPro} data-testid="button-import-hcp-estimates">
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Import from Housecall Pro</span>
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
        <StatusFilterBar
          statuses={ESTIMATE_FILTER_STATUSES}
          activeStatus={filterStatus}
          counts={statusCounts}
          onStatusChange={setFilterStatus}
        />

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={estimateStatusOptions}
          userOptions={estimateUserOptions}
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
            isSelected={selectedIds.has(estimate.id)}
            onToggleSelect={() => toggleItem(estimate.id, "estimates")}
          />
        ))}
      </div>

      {estimatesLoading && allEstimates.length === 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <CardSkeleton key={index} lines={4} showMultilineBlock showBadges />
          ))}
        </div>
      )}

      {isFetchingNextPage && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <CardSkeleton key={`loading-${index}`} lines={4} showMultilineBlock showBadges />
          ))}
        </div>
      )}

      {/* SCALE NOTE: Each page appends card DOM nodes. At >200 items the rendered
           DOM grows large and scrolling can slow down. If this becomes a problem,
           replace the append-based pagination with react-virtual (or @tanstack/virtual)
           for windowed rendering — only the visible cards would be in the DOM. */}
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
              "Convert approved estimates directly into jobs automatically",
            ]}
            ctaLabel="Create Your First Estimate"
            onCtaClick={handleAddEstimate}
            ctaTestId="button-add-first-estimate"
          />
        ))}

      <EditEstimateModal
        isOpen={activeModal?.type === "edit"}
        estimate={activeModal?.type === "edit" ? activeModal.estimate : undefined}
        onClose={() => setActiveModal(null)}
        onSave={handleEditSave}
        isSaving={updateEstimate.isPending}
      />

      <CreateEstimateModal
        isOpen={activeModal?.type === "add"}
        onClose={() => setActiveModal(null)}
      />

      <EstimateDetailsModal
        isOpen={activeModal?.type === "details"}
        onClose={() => setActiveModal(null)}
        estimate={activeModal?.type === "details" ? activeModal.estimate : undefined}
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
        isOpen={activeModal?.type === "followUp"}
        onClose={() => setActiveModal(null)}
        onSave={handleFollowUpSave}
        entityName={activeModal?.type === "followUp" ? activeModal.estimate.title : undefined}
        isSaving={updateFollowUpDate.isPending}
      />

      <BulkActionToolbar
        onDelete={handleBulkDelete}
        onStatusChange={handleBulkStatusChange}
        onExport={handleBulkExport}
        statusOptions={ESTIMATE_BULK_STATUSES}
      />

      <DeleteConfirmDialog
        isOpen={activeModal?.type === "delete"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        title="Delete Estimate"
        description={`Are you sure you want to delete "${activeModal?.type === "delete" ? activeModal.estimateTitle : "this estimate"}"? This action cannot be undone.`}
        onConfirm={() => {
          if (activeModal?.type === "delete") {
            deleteEstimate.mutate(activeModal.estimateId);
          }
        }}
        confirmTestId="button-confirm-delete-estimate"
      />
    </PageLayout>
  );
}
