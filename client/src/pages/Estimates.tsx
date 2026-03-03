import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { EstimateCard } from "@/components/EstimateCard";
import { EstimateCardSkeleton } from "@/components/EstimateCardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Filter, Calendar, FileText } from "lucide-react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PaginatedEstimates, TerminologySettings, Contact, EstimateSummary } from "@shared/schema";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFetchContact } from "@/hooks/useFetchContact";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { CreateEstimateForm } from "@/components/CreateEstimateForm";
import { EditEstimateModal, type EditEstimateFormValues } from "@/components/EditEstimateModal";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { EstimateDetailsModal, type EstimateListItem } from "@/components/EstimateDetailsModal";
import { HCPImportModal } from "@/components/HCPImportModal";

export default function Estimates({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const { subscribe } = useWebSocketContext();
  const { fetchContact } = useFetchContact();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  // Sync global search bar into local search state
  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "pending" | "approved" | "rejected">("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({});

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

  const [addModal, setAddModal] = useState<{
    isOpen: boolean;
  }>({ isOpen: false });

  const [detailsModal, setDetailsModal] = useState<{
    isOpen: boolean;
    estimate?: EstimateListItem;
  }>({ isOpen: false });

  const [importDateModal, setImportDateModal] = useState<{
    isOpen: boolean;
  }>({ isOpen: false });

  const [selectedImportDate, setSelectedImportDate] = useState<Date | undefined>(undefined);

  const [followUpModal, setFollowUpModal] = useState<{
    isOpen: boolean;
    estimate?: EstimateListItem;
  }>({ isOpen: false });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    estimateId?: string;
    estimateTitle?: string;
  }>({ isOpen: false });

  // Fetch terminology settings
  const { data: terminology } = useQuery<TerminologySettings>({
    queryKey: ["/api/terminology"],
  });

  // Fetch users for assigned filter
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ["/api/users"],
  });

  // Fetch contact data for details modal
  const { data: detailsContact } = useQuery<Contact>({
    queryKey: ["/api/contacts", detailsModal.estimate?.contactId],
    enabled: detailsModal.isOpen && !!detailsModal.estimate?.contactId,
  });

  // Fetch estimates with pagination
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

      const response = await fetch(`/api/estimates/paginated?${params}`);
      if (!response.ok) throw new Error("Failed to fetch estimates");
      return response.json() as Promise<PaginatedEstimates>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  // Flatten paginated data into single array
  const estimates = estimatesData?.pages.flatMap((page) => page.data) || [];
  const totalEstimates = estimatesData?.pages[0]?.pagination.total || 0;

  // Get user role to guard admin-only queries
  const { data: currentUser } = useQuery<{ user: { role: string; canManageIntegrations?: boolean } }>({
    queryKey: ["/api/auth/me"],
  });
  const canManageIntegrations =
    currentUser?.user?.role === "admin" ||
    currentUser?.user?.role === "super_admin" ||
    currentUser?.user?.role === "manager" ||
    currentUser?.user?.canManageIntegrations === true;

  // Check if Housecall Pro integration is configured (admin/manager only)
  const { data: integrations = [] } = useQuery<any[]>({
    queryKey: ["/api/integrations"],
    enabled: canManageIntegrations,
  });

  const housecallProIntegration = integrations.find((i) => i.name === "housecall-pro");
  const isHousecallProConfigured = housecallProIntegration?.hasCredentials && housecallProIntegration?.isEnabled;

  // Fetch current sync start date from settings
  const { data: syncStartDateData } = useQuery<{ syncStartDate: string | null }>({
    queryKey: ["/api/housecall-pro/sync-start-date"],
    enabled: isHousecallProConfigured,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Enable global keyboard shortcuts
  useGlobalShortcuts((type) => {
    if (type === "estimate") {
      setAddModal({ isOpen: true });
    }
  });

  // Check URL parameters to auto-open modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("add") === "true") {
      setAddModal({ isOpen: true });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  // Subscribe to WebSocket updates for estimates
  useEffect(() => {
    const unsubscribe = subscribe((message: { type: string }) => {
      if (
        message.type === "new_estimate" ||
        message.type === "estimate_created" ||
        message.type === "estimate_updated" ||
        message.type === "estimate_deleted"
      ) {
        queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
        queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      }
    });
    return unsubscribe;
  }, [subscribe, queryClient]);

  // Set default import date when sync start date is fetched
  useEffect(() => {
    if (syncStartDateData?.syncStartDate) {
      setSelectedImportDate(new Date(syncStartDateData.syncStartDate));
    }
  }, [syncStartDateData]);

  // Transform paginated estimates data (EstimateSummary) into display-friendly EstimateListItem
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

  // Fetch status counts from backend
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
      const response = await fetch(`/api/estimates/status-counts?${params}`);
      if (!response.ok) throw new Error("Failed to fetch status counts");
      return response.json();
    },
  });

  // Use status counts from backend, fallback to 0 if not loaded yet
  const statusCounts = statusCountsData || {
    all: 0,
    sent: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  };

  const handleAddEstimate = () => {
    setAddModal({ isOpen: true });
  };

  // Handle actual import with selected date
  const handleConfirmImport = async () => {
    setImportDateModal({ isOpen: false });

    toast({
      title: "Import Started",
      description: "Importing estimates from Housecall Pro...",
    });

    const originalSyncDate = syncStartDateData?.syncStartDate;
    const selectedDateISO = selectedImportDate?.toISOString();
    const dateChanged = selectedDateISO && selectedDateISO !== originalSyncDate;

    try {
      if (dateChanged) {
        await apiRequest("POST", "/api/housecall-pro/sync-start-date", {
          syncStartDate: selectedDateISO,
        });
      }

      const response = await apiRequest("POST", "/api/housecall-pro/sync");
      const data = await response.json();

      queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
      toast({
        title: "Import Successful",
        description: `Successfully imported estimates from Housecall Pro.${data.newEstimates ? ` Added ${data.newEstimates} new estimates.` : ""}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import estimates from Housecall Pro",
        variant: "destructive",
      });
    } finally {
      if (dateChanged) {
        await apiRequest("POST", "/api/housecall-pro/sync-start-date", {
          syncStartDate: originalSyncDate,
        }).catch(() => {
          // Best-effort restore; don't surface a secondary error
        });
      }
    }
  };

  const handleSend = (_estimateId: string) => {
    toast({ title: "Sending estimates is not yet available" });
  };

  const handleViewDetails = (estimateId: string) => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (estimate) {
      setDetailsModal({ isOpen: true, estimate });
    }
  };

  // Wrapper functions to adapt estimateId-based calls to entity-based calls
  const handleContactById = async (estimateId: string, method: "phone" | "email") => {
    const estimate = (allEstimates || []).find((e) => e.id === estimateId);
    if (!estimate) return;

    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;

    // Log activity (best-effort)
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

  const handleSendTextByEntity = async (estimate: EstimateListItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendText({ id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones }, "estimate");
  };

  const handleSendEmailByEntity = async (estimate: EstimateListItem) => {
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

  // Update estimate mutation
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

  // Follow-up date mutation
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

  const handleSetFollowUp = (estimate: EstimateListItem) => {
    setFollowUpModal({ isOpen: true, estimate });
  };

  // Delete estimate mutation
  const deleteEstimateMutation = useMutation({
    mutationFn: async (estimateId: string) => {
      return apiRequest("DELETE", `/api/estimates/${estimateId}`);
    },
    onSuccess: () => {
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

  return (
    <PageLayout>
      <PageHeader
        title={terminology?.estimatesLabel || "Estimates"}
        description="Create and manage estimates for potential jobs"
        icon={<Calendar className="h-6 w-6" />}
        actions={
          <Button onClick={handleAddEstimate} data-testid="button-add-estimate">
            <Plus className="h-4 w-4 mr-2" />
            Add {terminology?.estimateLabel || "Estimate"}
          </Button>
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground hidden sm:inline">Quick Filter:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "sent", "pending", "approved", "rejected"] as const).map((status) => (
                <Badge
                  key={status}
                  variant={filterStatus === status ? "default" : "outline"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setFilterStatus(status)}
                  data-testid={`filter-${status}`}
                >
                  {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={[
            { value: "sent", label: "Sent" },
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
          userOptions={usersData?.map((u) => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Created Date"
        />
      </div>

      {/* Pagination Info */}
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

      {/* Initial loading state with skeletons */}
      {estimatesLoading && allEstimates.length === 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <EstimateCardSkeleton key={index} />
          ))}
        </div>
      )}

      {/* Loading more skeletons during pagination */}
      {isFetchingNextPage && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <EstimateCardSkeleton key={`loading-${index}`} />
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasNextPage && !isFetchingNextPage && (
        <div className="text-center py-8">
          <Button onClick={() => fetchNextPage()} variant="outline" data-testid="button-load-more-estimates">
            Load More Estimates
          </Button>
        </div>
      )}

      {/* Empty state */}
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

      {/* Edit Estimate Modal */}
      <EditEstimateModal
        isOpen={editModal.isOpen}
        estimate={editModal.estimate}
        onClose={() => setEditModal({ isOpen: false })}
        onSave={(values) => {
          if (!editModal.estimate) return;
          updateEstimateMutation.mutate({ estimateId: editModal.estimate.id, data: values });
        }}
        isSaving={updateEstimateMutation.isPending}
      />

      {/* Add Estimate Modal */}
      <Dialog open={addModal.isOpen} onOpenChange={(open) => setAddModal({ isOpen: open })}>
        <DialogContent className="sm:max-w-[600px]" data-testid="modal-add-estimate">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Estimate
            </DialogTitle>
            <DialogDescription>Create a new estimate for a lead or customer.</DialogDescription>
          </DialogHeader>

          <CreateEstimateForm
            onSuccess={() => setAddModal({ isOpen: false })}
            onCancel={() => setAddModal({ isOpen: false })}
          />
        </DialogContent>
      </Dialog>

      {/* Estimate Details Modal */}
      <EstimateDetailsModal
        isOpen={detailsModal.isOpen}
        onClose={() => setDetailsModal({ isOpen: false })}
        estimate={detailsModal.estimate}
        detailsContact={detailsContact}
        onContact={handleContact}
        onSendText={handleSendText}
        onSendEmail={handleSendEmail}
      />

      {/* Texting Modal */}
      <TextingModal
        isOpen={textingModal.isOpen}
        onClose={closeTextingModal}
        recipientName={textingModal.estimate?.name || ""}
        recipientPhone={textingModal.estimate?.phones?.[0] || textingModal.estimate?.phone || ""}
        recipientEmail={textingModal.estimate?.emails?.[0] || textingModal.estimate?.email || ""}
        companyName="Our Company"
        estimateId={textingModal.estimate?.id}
      />

      {/* Email Composer Modal */}
      <EmailComposerModal
        isOpen={emailModal.isOpen}
        onClose={closeEmailModal}
        recipientName={emailModal.estimate?.name || ""}
        recipientEmail={emailModal.estimate?.emails?.[0] || emailModal.estimate?.email || ""}
        companyName=""
        estimateId={emailModal.estimate?.id}
      />

      {/* Import Date Selection Modal */}
      <HCPImportModal
        isOpen={importDateModal.isOpen}
        onClose={() => setImportDateModal({ isOpen: false })}
        onConfirm={handleConfirmImport}
        selectedDate={selectedImportDate}
        onDateChange={setSelectedImportDate}
        entityLabel="estimates"
      />

      {/* Follow-Up Date Modal */}
      <FollowUpDateModal
        isOpen={followUpModal.isOpen}
        onClose={() => setFollowUpModal({ isOpen: false })}
        onSave={(date) => {
          if (!followUpModal.estimate) return;
          updateFollowUpDateMutation.mutate({
            estimateId: followUpModal.estimate.id,
            followUpDate: date ?? null,
          });
        }}
        entityName={followUpModal.estimate?.title}
        isSaving={updateFollowUpDateMutation.isPending}
      />

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        onDelete={async (ids) => {
          await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/estimates/${id}`)));
          queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
          queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
          toast({ title: `Deleted ${ids.length} estimate(s)` });
        }}
        onStatusChange={async (ids, status) => {
          await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/estimates/${id}/status`, { status })));
          queryClient.invalidateQueries({ queryKey: ["/api/estimates/paginated"] });
          queryClient.invalidateQueries({ queryKey: ["/api/estimates/status-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
          toast({ title: `Updated ${ids.length} estimate(s) to ${status}` });
        }}
        onExport={async (ids) => {
          const selectedEstimates = (allEstimates || []).filter((est) => ids.includes(est.id));
          const csvContent = [
            ["Title", "Customer", "Email", "Phone", "Status", "Value", "Created Date", "Expiry Date"].join(","),
            ...(selectedEstimates || []).map((est) =>
              [
                est.title || "",
                est.contactName || "",
                "",
                "",
                est.status || "",
                est.value || "",
                est.createdDate || "",
                est.expiryDate || "",
              ].join(",")
            ),
          ].join("\n");

          const blob = new Blob([csvContent], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `estimates-export-${new Date().toISOString().split("T")[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: `Exported ${ids.length} estimate(s)` });
        }}
        statusOptions={[
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirm.isOpen}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, isOpen: open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Estimate</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              {deleteConfirm.estimateTitle ? `"${deleteConfirm.estimateTitle}"` : "this estimate"}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-estimate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirm.estimateId) {
                  deleteEstimateMutation.mutate(deleteConfirm.estimateId);
                }
                setDeleteConfirm({ isOpen: false });
              }}
              data-testid="button-confirm-delete-estimate"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
