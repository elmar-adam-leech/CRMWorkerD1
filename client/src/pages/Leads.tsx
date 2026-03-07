import { useState, useEffect, useMemo, useCallback } from "react";
import { LeadCard } from "@/components/LeadCard";
import { CardSkeleton } from "@/components/CardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { LocalSchedulingModal } from "@/components/LocalSchedulingModal";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Filter, UserPlus, AlertCircle, Archive, ArchiveRestore } from "lucide-react";
import { LeadKanbanBoard } from "@/components/LeadKanbanBoard";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useContactMutations } from "@/hooks/useContactMutations";
import type { Contact, PaginatedContacts } from "@shared/schema";
import { useTerminologyContext } from "@/contexts/TerminologyContext";
import { useUsers } from "@/hooks/useUsers";
import { cn, formatStatusLabel } from "@/lib/utils";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";
import { invalidateContacts } from "@/hooks/useInvalidations";
import { useBulkActions } from "@/hooks/useBulkActions";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
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

type ActiveModal =
  | { type: "details"; contact: Contact }
  | { type: "edit"; contact: Contact }
  | { type: "editStatus"; contact: Contact }
  | { type: "followUp"; contact: Contact }
  | { type: "delete"; contactId: string; contactName: string }
  | null;

export default function Leads({ externalSearch = "" }: { externalSearch?: string }) {
  const [searchQuery, setSearchQuery] = useState(externalSearch);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const isMobile = useIsMobile();
  const { viewMode: savedViewMode, setViewMode, filterStatus, setFilterStatus, advancedFilters, setAdvancedFilters } =
    usePagePreferences({ pageKey: "leads" });
  const viewMode = isMobile ? "cards" : savedViewMode;

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

  const { isSelectionMode, selectedIds, toggleItem } = useBulkSelection();

  const [addContactModal, setAddContactModal] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const terminology = useTerminologyContext();
  const { data: usersData } = useUsers();

  const leadStatusOptions = useMemo(
    () => LEAD_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) })),
    []
  );
  const leadUserOptions = useMemo(
    () => usersData?.map((u) => ({ value: u.id, label: u.name })) ?? [],
    [usersData]
  );

  useGlobalShortcuts((type) => {
    if (type === "lead") setAddContactModal(true);
  });

  useWebSocketInvalidation([
    { types: ["new_activity", "activity_update"], queryKeys: ["/api/activities"] },
    { types: ["new_message", "message_update", "message_updated"], queryKeys: ["/api/conversations"] },
    // Invalidating /api/contacts (broad) ensures any open LeadDetailsModal also
    // gets fresh data — not just the paginated list. contact_updated is triggered
    // when another user (or device) modifies the same contact in real-time.
    { types: ["contact_created", "contact_updated", "contact_deleted"], queryKeys: ["/api/contacts/paginated", "/api/contacts/status-counts", "/api/contacts/follow-ups", "/api/contacts"] },
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
      archived: showArchived,
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
      url.searchParams.set("archived", showArchived ? "true" : "false");
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

  const { deleteContact, updateContactStatus, archiveLead, restoreLead, updateFollowUpDate } = useContactMutations();

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
    if (contact) setActiveModal({ type: "edit", contact });
  }, [leads]);

  const handleDelete = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (!contact) return;
    setActiveModal({ type: "delete", contactId, contactName: contact.name });
  }, [leads]);

  const handleViewDetails = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (contact) setActiveModal({ type: "details", contact });
  }, [leads]);

  const handleEditStatus = useCallback((contactId: string) => {
    const contact = leads.find((l: Contact) => l.id === contactId);
    if (contact) setActiveModal({ type: "editStatus", contact });
  }, [leads]);

  const handleSetFollowUp = useCallback((contact: Contact) => setActiveModal({ type: "followUp", contact }), []);

  const handleFollowUpSubmit = useCallback((date: Date | undefined) => {
    if (activeModal?.type !== "followUp") return;
    updateFollowUpDate.mutate(
      { contactId: activeModal.contact.id, followUpDate: date || null },
      { onSuccess: () => setActiveModal(null) }
    );
  }, [activeModal, updateFollowUpDate]);

  const handleStatusChange = useCallback((contactId: string, newStatus: string) => {
    updateContactStatus.mutate({ contactId, status: newStatus });
  }, [updateContactStatus]);

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
    getExportRow: (entity) => {
      const contact = entity as Contact;
      return [
        contact.name,
        contact.emails && contact.emails.length > 0 ? contact.emails[0] : "",
        contact.phones && contact.phones.length > 0 ? contact.phones[0] : "",
        contact.address ?? undefined,
        contact.source ?? undefined,
        contact.status ?? undefined,
      ];
    },
    entities: leads,
  });

  return (
    <PageLayout className={cn(isSelectionMode && "pb-20")}>
      <PageHeader
        title={showArchived ? `Archived ${terminology?.leadsLabel || "Leads"}` : (terminology?.leadsLabel || "Leads")}
        description={showArchived ? "Archived leads are preserved but hidden from the main view" : "Manage and track potential customers and sales opportunities"}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={showArchived ? "default" : "outline"}
              onClick={() => setShowArchived((v) => !v)}
              data-testid="button-toggle-archived"
            >
              {showArchived ? <ArchiveRestore className="h-4 w-4 mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">{showArchived ? "Show Active" : "Archived"}</span>
            </Button>
            {!showArchived && (
              <Button onClick={() => setAddContactModal(true)} data-testid="button-add-lead">
                <Plus className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Add {terminology?.leadLabel || "Lead"}</span>
                <span className="sm:hidden">Add</span>
              </Button>
            )}
          </div>
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
              statusOptions={leadStatusOptions}
              userOptions={leadUserOptions}
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
              onArchive={showArchived ? undefined : archiveLead.mutate}
              onRestore={showArchived ? restoreLead.mutate : undefined}
              onEditStatus={handleEditStatus}
              onViewDetails={handleViewDetails}
              onSetFollowUp={handleSetFollowUp}
              selectable={!showArchived}
              isSelected={selectedIds.has(lead.id)}
              onToggleSelect={() => toggleItem(lead.id, "leads")}
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
        onSuccess={() => invalidateContacts()}
        leads={leads}
        onViewDuplicate={handleViewDetails}
      />

      <EditLeadModal
        isOpen={activeModal?.type === "edit"}
        contact={activeModal?.type === "edit" ? activeModal.contact : undefined}
        onClose={() => setActiveModal(null)}
        onSuccess={() => invalidateContacts()}
      />

      <LeadDetailsModal
        isOpen={activeModal?.type === "details"}
        contact={activeModal?.type === "details" ? activeModal.contact : undefined}
        onClose={() => setActiveModal(null)}
      />

      <EditStatusModal
        isOpen={activeModal?.type === "editStatus"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        contactName={activeModal?.type === "editStatus" ? activeModal.contact.name : undefined}
        currentStatus={activeModal?.type === "editStatus" ? activeModal.contact.status ?? undefined : undefined}
        statuses={LEAD_STATUSES}
        onStatusChange={(status) => {
          if (activeModal?.type === "editStatus") {
            updateContactStatus.mutate(
              { contactId: activeModal.contact.id, status },
              { onSuccess: () => { invalidateContacts(activeModal.contact.id); setActiveModal(null); } }
            );
          }
        }}
        isPending={updateContactStatus.isPending}
      />

      <FollowUpDateModal
        isOpen={activeModal?.type === "followUp"}
        onClose={() => setActiveModal(null)}
        onSave={handleFollowUpSubmit}
        entityName={activeModal?.type === "followUp" ? activeModal.contact.name : undefined}
        defaultDate={activeModal?.type === "followUp" && activeModal.contact.followUpDate ? new Date(activeModal.contact.followUpDate) : undefined}
        isSaving={updateFollowUpDate.isPending}
      />

      <DeleteConfirmDialog
        isOpen={activeModal?.type === "delete"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        title="Delete Lead"
        description={`Are you sure you want to delete "${activeModal?.type === "delete" ? activeModal.contactName : ""}"? This action cannot be undone.`}
        onConfirm={() => {
          if (activeModal?.type === "delete") {
            deleteContact.mutate(activeModal.contactId, {
              onSuccess: () => setActiveModal(null),
            });
          }
        }}
        confirmTestId="button-confirm-delete-lead"
      />

      <BulkActionToolbar
        onDelete={handleBulkDelete}
        onStatusChange={handleBulkStatusChange}
        onExport={handleBulkExport}
        statusOptions={leadStatusOptions}
      />
    </PageLayout>
  );
}
