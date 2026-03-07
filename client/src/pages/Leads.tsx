import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { LeadCard } from "@/components/LeadCard";
import { CardSkeleton } from "@/components/CardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { LocalSchedulingModal } from "@/components/LocalSchedulingModal";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Filter, UserPlus, Users, AlertCircle } from "lucide-react";
import { LeadKanbanBoard } from "@/components/LeadKanbanBoard";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, PaginatedContacts } from "@shared/schema";
import { useTerminology } from "@/hooks/useTerminology";
import { useUsers } from "@/hooks/useUsers";
import { cn, formatStatusLabel } from "@/lib/utils";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";
import { useBulkActions } from "@/hooks/useBulkActions";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { StatusFilterBar } from "@/components/StatusFilterBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { ViewToggle } from "@/components/ViewToggle";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { FilterPanel } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { CreateLeadModal } from "@/components/CreateLeadModal";
import { EditLeadModal } from "@/components/EditLeadModal";
import { LeadDetailsModal } from "@/components/LeadDetailsModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { EditStatusModal } from "@/components/EditStatusModal";
import { usePagePreferences } from "@/hooks/use-page-preferences";
import { useAddModalFromUrl } from "@/hooks/use-add-modal-from-url";

const LEAD_STATUSES = ["new", "contacted", "scheduled", "disqualified"] as const;

export default function Leads({ externalSearch = "" }: { externalSearch?: string }) {
  useLocation();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const { viewMode, setViewMode, filterStatus, setFilterStatus, advancedFilters, setAdvancedFilters } =
    usePagePreferences({ pageKey: "leads" });

  const {
    emailModal,
    textingModal,
    schedulingModal,
    handleSendEmail,
    handleSendText,
    handleSchedule,
    handleContact,
    closeEmailModal,
    closeTextingModal,
    closeSchedulingModal,
  } = useCommunicationActions();

  const { isSelectionMode } = useBulkSelection();

  const [addContactModal, setAddContactModal] = useState(false);

  const [contactDetailsModal, setContactDetailsModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  const [editContactModal, setEditContactModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  const [editStatusModal, setEditStatusModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  const [followUpModal, setFollowUpModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    isOpen: boolean;
    contactId?: string;
    contactName?: string;
  }>({ isOpen: false });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: terminology } = useTerminology();
  const { data: usersData } = useUsers();

  useGlobalShortcuts((type) => {
    if (type === "lead") setAddContactModal(true);
  });

  useWebSocketInvalidation([
    { types: ["new_activity", "activity_update"], queryKeys: ["/api/activities"] },
    { types: ["new_message", "message_update", "message_updated"], queryKeys: ["/api/conversations"] },
    { types: ["contact_created", "contact_updated", "contact_deleted"], queryKeys: ["/api/contacts/paginated", "/api/contacts/status-counts"] },
  ]);

  useAddModalFromUrl(() => setAddContactModal(true));

  const {
    data: leadsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: leadsLoading,
    error: leadsError,
  } = useInfiniteQuery({
    queryKey: ["/api/contacts/paginated", {
      type: "lead",
      // includeAll is true in kanban mode so all status columns are populated;
      // it is kept in the key so kanban and card views use separate cache entries
      includeAll: viewMode === "kanban",
      status: viewMode === "kanban" ? "all" : filterStatus,
      search: searchQuery,
      assignedTo: advancedFilters.assignedTo,
      dateFrom: advancedFilters.dateFrom?.toISOString(),
      dateTo: advancedFilters.dateTo?.toISOString(),
    }],
    queryFn: async ({ pageParam }) => {
      const url = new URL("/api/contacts/paginated", window.location.origin);
      url.searchParams.set("type", "lead");
      if (pageParam) url.searchParams.set("cursor", pageParam as string);
      if (viewMode === "kanban") {
        url.searchParams.set("includeAll", "true");
      } else if (filterStatus !== "all") {
        url.searchParams.set("status", filterStatus);
      }
      if (searchQuery) url.searchParams.set("search", searchQuery);
      if (advancedFilters.assignedTo) url.searchParams.set("assignedTo", advancedFilters.assignedTo);
      if (advancedFilters.dateFrom) url.searchParams.set("dateFrom", advancedFilters.dateFrom.toISOString());
      if (advancedFilters.dateTo) url.searchParams.set("dateTo", advancedFilters.dateTo.toISOString());
      url.searchParams.set("limit", "50");
      return (await apiRequest("GET", url.toString())).json();
    },
    getNextPageParam: (lastPage: PaginatedContacts) => lastPage.pagination.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  const leads = useMemo(
    () => (leadsData?.pages.flatMap((page: PaginatedContacts) => page.data) || []) as Contact[],
    [leadsData]
  );
  const totalLeads = leadsData?.pages[0]?.pagination.total || 0;

  const updateStatusMutation = useMutation({
    mutationFn: async (data: { contactId: string; status: string }) => {
      return apiRequest("PATCH", `/api/contacts/${data.contactId}/status`, { status: data.status });
    },
    onSuccess: () => {
      toast({ title: "Status Updated", description: "Lead status has been successfully updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
      setEditStatusModal({ isOpen: false });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Update Status", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest("DELETE", `/api/contacts/${contactId}`);
    },
    onSuccess: () => {
      toast({ title: "Lead Deleted", description: "Lead has been successfully deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setDeleteConfirmDialog({ isOpen: false });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Delete Lead", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  const updateFollowUpDateMutation = useMutation({
    mutationFn: async (data: { contactId: string; followUpDate: Date | null }) => {
      return apiRequest("PATCH", `/api/contacts/${data.contactId}/follow-up`, {
        followUpDate: data.followUpDate ? data.followUpDate.toISOString() : null,
      });
    },
    onSuccess: () => {
      toast({ title: "Follow-Up Date Set", description: "Follow-up date has been successfully updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Update Follow-Up Date", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  const { data: statusCountsData, isLoading: statusCountsLoading } = useQuery<{
    all: number;
    new: number;
    contacted: number;
    scheduled: number;
    disqualified: number;
  }>({
    queryKey: ["/api/contacts/status-counts", { type: "lead", search: searchQuery }],
    queryFn: async () => {
      const params = new URLSearchParams({ type: "lead" });
      if (searchQuery) params.append("search", searchQuery);
      return (await apiRequest("GET", `/api/contacts/status-counts?${params}`)).json();
    },
  });

  const statusCounts = statusCountsData || {
    all: statusCountsLoading ? undefined : 0,
    new: statusCountsLoading ? undefined : 0,
    contacted: statusCountsLoading ? undefined : 0,
    scheduled: statusCountsLoading ? undefined : 0,
    disqualified: statusCountsLoading ? undefined : 0,
  };

  const handleContactById = useCallback((leadId: string, method: "phone" | "email") => {
    const lead = leads.find((l: Contact) => l.id === leadId);
    if (lead) handleContact(lead, method);
  }, [leads, handleContact]);

  const handleScheduleById = useCallback((leadId: string) => {
    const lead = leads.find((l: Contact) => l.id === leadId);
    if (lead) handleSchedule(lead);
  }, [leads, handleSchedule]);

  const handleSendTextByEntity = useCallback((lead: Contact) => handleSendText(lead, "lead"), [handleSendText]);
  const handleSendEmailByEntity = useCallback((lead: Contact) => handleSendEmail(lead, "lead"), [handleSendEmail]);

  const handleEdit = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (contact) setEditContactModal({ isOpen: true, contact });
  }, [leads]);

  const handleDelete = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (!contact) return;
    setDeleteConfirmDialog({ isOpen: true, contactId, contactName: contact.name });
  }, [leads]);

  const handleViewDetails = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (contact) setContactDetailsModal({ isOpen: true, contact });
  }, [leads]);

  const handleEditStatus = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (contact) setEditStatusModal({ isOpen: true, contact });
  }, [leads]);

  const handleSetFollowUp = useCallback((contact: Contact) => setFollowUpModal({ isOpen: true, contact }), []);

  const handleFollowUpSubmit = useCallback((date: Date | undefined) => {
    if (!followUpModal.contact) return;
    updateFollowUpDateMutation.mutate(
      { contactId: followUpModal.contact.id, followUpDate: date || null },
      { onSuccess: () => setFollowUpModal({ isOpen: false }) }
    );
  }, [followUpModal.contact, updateFollowUpDateMutation]);

  const handleStatusChange = useCallback((contactId: string, newStatus: string) => {
    updateStatusMutation.mutate({ contactId, status: newStatus });
  }, [updateStatusMutation]);

  const handleUpdateLead = async (contactId: string, updates: Partial<Contact>) => {
    try {
      await apiRequest("PATCH", `/api/contacts/${contactId}`, updates);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}`] });
      toast({ title: "Lead Updated", description: "Lead has been updated successfully." });
    } catch (error) {
      toast({
        title: "Error updating lead",
        description: error instanceof Error ? error.message : "Failed to update lead",
        variant: "destructive",
      });
    }
  };

  const { handleBulkDelete, handleBulkStatusChange, handleBulkExport } = useBulkActions({
    entityType: "contact",
    deleteEndpoint: (id) => `/api/contacts/${id}`,
    statusEndpoint: (id) => `/api/contacts/${id}/status`,
    invalidateKeys: [
      ["/api/contacts"],
      ["/api/contacts/paginated"],
      ["/api/contacts/status-counts"],
    ],
    exportFilename: `leads-export-${new Date().toISOString().split("T")[0]}.csv`,
    exportHeaders: ["Name", "Email", "Phone", "Address", "Source", "Status"],
    getExportRow: (contact: Contact) => [
      contact.name,
      contact.emails && contact.emails.length > 0 ? contact.emails[0] : "",
      contact.phones && contact.phones.length > 0 ? contact.phones[0] : "",
      contact.address ?? undefined,
      contact.source ?? undefined,
      contact.status ?? undefined,
    ],
    entities: leads,
  });

  return (
    <PageLayout className={cn(isSelectionMode && "pb-20")}>
      <PageHeader
        title={terminology?.leadsLabel || "Leads"}
        description="Manage and track potential customers and sales opportunities"
        actions={
          <Button onClick={() => setAddContactModal(true)} data-testid="button-add-lead">
            <Plus className="h-4 w-4 mr-2" />
            Add {terminology?.leadLabel || "Lead"}
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

        {viewMode === "cards" && (
          <>
            <StatusFilterBar
              statuses={LEAD_STATUSES}
              activeStatus={filterStatus}
              counts={statusCounts}
              onStatusChange={setFilterStatus}
            />

            <FilterPanel
              filters={advancedFilters}
              onFiltersChange={setAdvancedFilters}
              statusOptions={LEAD_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) }))}
              userOptions={usersData?.map((u) => ({ value: u.id, label: u.fullName })) || []}
              dateLabel="Created Date"
            />
          </>
        )}
      </div>

      {leads.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {leads.length} of {totalLeads} {terminology?.leadsLabel?.toLowerCase() || "leads"}
        </div>
      )}

      {viewMode === "cards" ? (
        <div
          className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3"
          data-testid="leads-grid"
        >
          {leadsLoading && Array.from({ length: 6 }, (_, i) => (
            <CardSkeleton key={`skeleton-${i}`} />
          ))}

          {!leadsLoading && leads.map((lead: Contact) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onContact={handleContactById}
              onSchedule={handleScheduleById}
              onSendText={handleSendTextByEntity}
              onSendEmail={handleSendEmailByEntity}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onEditStatus={handleEditStatus}
              onViewDetails={handleViewDetails}
              onSetFollowUp={handleSetFollowUp}
              onUpdateLead={handleUpdateLead}
              selectable={true}
            />
          ))}
        </div>
      ) : (
        <LeadKanbanBoard
          leads={leads}
          onStatusChange={handleStatusChange}
          onViewDetails={handleViewDetails}
          onEdit={handleEdit}
          onContact={handleContactById}
          onSchedule={handleScheduleById}
          onSendText={handleSendTextByEntity}
          onSendEmail={handleSendEmailByEntity}
          onEditStatus={handleEditStatus}
          onSetFollowUp={handleSetFollowUp}
          onDelete={handleDelete}
          onUpdateLead={handleUpdateLead}
        />
      )}

      {/* SCALE NOTE: Each page appends card DOM nodes. At >200 items the rendered
           DOM grows large and scrolling can slow down. If this becomes a problem,
           replace the append-based pagination with react-virtual (or @tanstack/virtual)
           for windowed rendering — only the visible cards would be in the DOM. */}
      {!leadsLoading && (
        <LoadMoreButton
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => fetchNextPage()}
          label={`Load More ${terminology?.leadsLabel || "Leads"}`}
          testId="button-load-more-leads"
        />
      )}

      {leadsError && !leadsLoading && (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load leads"
          description="There was a problem loading your leads. Please try refreshing the page."
        />
      )}

      {leads.length === 0 && !leadsLoading && !leadsError && (
        filterStatus !== "all" || searchQuery ? (
          <EmptyState
            icon={Filter}
            title="No leads match your filters"
            description="Try adjusting your search criteria or filters to find more leads."
            tips={[
              "Clear some filters to broaden your search",
              "Check your search term for typos",
              "Try searching by customer name, email, or phone number",
            ]}
          />
        ) : (
          <EmptyState
            icon={UserPlus}
            title="No leads yet"
            description="Start building your pipeline by adding your first lead."
            tips={[
              "Manually add leads from phone calls or website inquiries",
              "Import leads from a CSV file using the import button",
              "Connect Zapier to automatically create leads from form submissions",
            ]}
            ctaLabel="Add Your First Lead"
            onCtaClick={() => setAddContactModal(true)}
            ctaTestId="button-add-first-lead"
          />
        )
      )}

      <TextingModal
        isOpen={textingModal.isOpen}
        onClose={closeTextingModal}
        recipientName={textingModal.lead?.name || ""}
        recipientPhone={textingModal.lead?.phones?.[0] || ""}
        leadId={textingModal.lead?.id}
      />

      <EmailComposerModal
        isOpen={emailModal.isOpen}
        onClose={closeEmailModal}
        recipientName={emailModal.lead?.name || ""}
        recipientEmail={emailModal.lead?.emails?.[0] || ""}
        leadId={emailModal.lead?.id}
      />

      <LocalSchedulingModal
        isOpen={schedulingModal.isOpen}
        onClose={closeSchedulingModal}
        lead={schedulingModal.lead || null}
        onScheduled={() => closeSchedulingModal()}
      />

      <CreateLeadModal
        isOpen={addContactModal}
        onClose={() => setAddContactModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
          queryClient.invalidateQueries({ queryKey: ["/api/contacts/status-counts"] });
        }}
        leads={leads}
        onViewDuplicate={handleViewDetails}
      />

      <EditLeadModal
        isOpen={editContactModal.isOpen}
        contact={editContactModal.contact}
        onClose={() => setEditContactModal({ isOpen: false })}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
        }}
      />

      <LeadDetailsModal
        isOpen={contactDetailsModal.isOpen}
        contact={contactDetailsModal.contact}
        onClose={() => setContactDetailsModal({ isOpen: false })}
      />

      <EditStatusModal
        isOpen={editStatusModal.isOpen}
        onOpenChange={(open) => setEditStatusModal((prev) => ({ ...prev, isOpen: open }))}
        contactName={editStatusModal.contact?.name}
        currentStatus={editStatusModal.contact?.status ?? undefined}
        statuses={LEAD_STATUSES}
        onStatusChange={(status) => {
          if (editStatusModal.contact) {
            updateStatusMutation.mutate({ contactId: editStatusModal.contact.id, status });
          }
        }}
        isPending={updateStatusMutation.isPending}
      />

      <FollowUpDateModal
        isOpen={followUpModal.isOpen}
        onClose={() => setFollowUpModal({ isOpen: false })}
        onSave={handleFollowUpSubmit}
        entityName={followUpModal.contact?.name}
        defaultDate={followUpModal.contact?.followUpDate ? new Date(followUpModal.contact.followUpDate) : undefined}
        isSaving={updateFollowUpDateMutation.isPending}
      />

      <DeleteConfirmDialog
        isOpen={deleteConfirmDialog.isOpen}
        onOpenChange={(open) => setDeleteConfirmDialog((prev) => ({ ...prev, isOpen: open }))}
        title="Delete Lead"
        description={`Are you sure you want to delete "${deleteConfirmDialog.contactName}"? This action cannot be undone.`}
        onConfirm={() => {
          if (deleteConfirmDialog.contactId) {
            deleteContactMutation.mutate(deleteConfirmDialog.contactId);
          }
        }}
        confirmTestId="button-confirm-delete-lead"
      />

      <BulkActionToolbar
        onDelete={handleBulkDelete}
        onStatusChange={handleBulkStatusChange}
        onExport={handleBulkExport}
        statusOptions={LEAD_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) }))}
      />
    </PageLayout>
  );
}
