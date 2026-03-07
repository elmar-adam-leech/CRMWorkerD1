import { useMemo, useCallback } from "react";
import { useEntityModals } from "@/hooks/useEntityModals";
import { useLocation } from "wouter";
import { JobCard } from "@/components/JobCard";
import { CardSkeleton } from "@/components/CardSkeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Briefcase, CalendarIcon } from "lucide-react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatStatusLabel } from "@/lib/utils";
import { useBulkActions } from "@/hooks/useBulkActions";
import type { PaginatedJobs } from "@shared/schema";
import { useTerminology } from "@/hooks/useTerminology";
import { useUsers } from "@/hooks/useUsers";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useHousecallProIntegration } from "@/hooks/useHousecallProIntegration";
import { useHcpImport } from "@/hooks/useHcpImport";
import { useWebSocketInvalidation } from "@/hooks/useWebSocketInvalidation";
import { usePagePreferences } from "@/hooks/use-page-preferences";
import { useAddModalFromUrl } from "@/hooks/use-add-modal-from-url";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { JobDetailsModal, type JobListItem } from "@/components/JobDetailsModal";
import { HCPImportModal } from "@/components/HCPImportModal";
import { CreateJobModal } from "@/components/CreateJobModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { StatusFilterBar } from "@/components/StatusFilterBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";

const JOB_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];
type FilterStatus = "all" | JobStatus;

export default function Jobs({ externalSearch = "" }: { externalSearch?: string }) {
  useLocation();
  const { isHousecallProConfigured, syncStartDate } = useHousecallProIntegration();

  const {
    filterStatus,
    setFilterStatus,
    advancedFilters,
    setAdvancedFilters,
  } = usePagePreferences({ pageKey: "jobs" });

  const searchQuery = externalSearch;
  const {
    addModal: addModalOpen,
    openAdd: setAddModalOpen,
    closeAdd: closeAddModal,
    detailsModal: jobDetailsItem,
    openDetails: openJobDetails,
    closeDetails: closeJobDetails,
    deleteModal: deleteJobItem,
    openDelete: openDeleteJob,
    closeDelete: closeDeleteJob,
  } = useEntityModals<JobListItem>();

  const { toast } = useToast();

  const { importDateOpen, setImportDateOpen, selectedImportDate, setSelectedImportDate, handleConfirmImport } =
    useHcpImport({
      entityType: "jobs",
      syncStartDate,
      queryKeysToInvalidate: ["/api/jobs/paginated", "/api/jobs/status-counts"],
    });

  useWebSocketInvalidation([
    { types: ["new_job", "job_created", "job_updated", "job_deleted"], queryKeys: ["/api/jobs/paginated", "/api/jobs/status-counts"] },
  ]);

  useAddModalFromUrl(() => setAddModalOpen());

  const { data: terminology } = useTerminology();
  const { data: usersData } = useUsers();

  // Paginated jobs list
  const {
    data: jobsData,
    isLoading: jobsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "/api/jobs/paginated",
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
      const res = await apiRequest("GET", `/api/jobs/paginated?${params}`);
      return res.json() as Promise<PaginatedJobs>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  // Per-status counts (search-aware)
  const { data: statusCountsData } = useQuery<Record<FilterStatus, number>>({
    queryKey: ["/api/jobs/status-counts", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      const res = await apiRequest("GET", `/api/jobs/status-counts?${params}`);
      return res.json();
    },
  });

  const statusCounts: Record<string, number> = statusCountsData ?? {
    all: 0, scheduled: 0, in_progress: 0, completed: 0, cancelled: 0,
  };

  // Update job status
  const updateJobStatusMutation = useMutation({
    mutationFn: (data: { jobId: string; status: string }) =>
      apiRequest("PATCH", `/api/jobs/${data.jobId}/status`, { status: data.status }),
    onSuccess: () => {
      toast({ title: "Status Updated", description: "Job status has been successfully updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
    },
    onError: (error: Error) => {
      toast({ title: "Update Failed", description: error.message || "Failed to update job status", variant: "destructive" });
    },
  });

  // Delete a single job
  const deleteJobMutation = useMutation({
    mutationFn: (jobId: string) => apiRequest("DELETE", `/api/jobs/${jobId}`),
    onSuccess: () => {
      toast({ title: "Job Deleted", description: "Job has been successfully deleted." });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      closeDeleteJob();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Delete Job", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  // Global keyboard shortcuts
  useGlobalShortcuts((type) => {
    if (type === "job") setAddModalOpen();
  });

  // Flatten paginated pages into a typed list. Memoized — only recomputes when
  // jobsData changes, not on every filter/modal state update.
  const allJobs: JobListItem[] = useMemo(() =>
    jobsData?.pages.flatMap((page) =>
      (page.data || []).map((job) => ({
        id: job.id,
        title: job.title,
        contactId: job.contactId,
        contactName: job.contactName,
        status: job.status,
        value: typeof job.value === "string" ? parseFloat(job.value) : job.value,
        scheduledDate: job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : "No date",
        type: job.type,
        priority: job.priority,
        estimatedHours: job.estimatedHours ?? null,
      }))
    ) ?? [], [jobsData]);

  const totalJobs = jobsData?.pages[0]?.pagination.total ?? 0;

  // ----- Event handlers -----

  const handleStatusChange = useCallback((jobId: string, newStatus: string) => {
    updateJobStatusMutation.mutate({ jobId, status: newStatus });
  }, [updateJobStatusMutation]);

  const handleViewDetails = useCallback((jobId: string) => {
    const job = allJobs.find((j) => j.id === jobId);
    if (job) openJobDetails(job);
  }, [allJobs, openJobDetails]);

  const handleDeleteJob = useCallback((jobId: string, _jobTitle: string) => {
    const job = allJobs.find((j) => j.id === jobId);
    if (job) openDeleteJob(job);
  }, [allJobs, openDeleteJob]);

  const handleImportFromHousecallPro = () => {
    closeAddModal();
    setImportDateOpen(true);
  };

  // ----- Bulk action handlers -----

  const { handleBulkDelete, handleBulkStatusChange, handleBulkExport } = useBulkActions({
    entityType: "job",
    deleteEndpoint: (id) => `/api/jobs/${id}`,
    statusEndpoint: (id) => `/api/jobs/${id}/status`,
    invalidateKeys: [
      ["/api/jobs/paginated"],
      ["/api/jobs/status-counts"],
      ["/api/jobs"],
    ],
    exportFilename: `jobs-export-${new Date().toISOString().split("T")[0]}.csv`,
    exportHeaders: ["Title", "Customer", "Status", "Value", "Scheduled Date", "Type", "Priority", "Estimated Hours"],
    getExportRow: (job) => {
      const j = job as JobListItem;
      return [j.title, j.contactName, j.status, j.value, j.scheduledDate, j.type, j.priority, j.estimatedHours ?? ""];
    },
    entities: allJobs,
  });

  // ----- Render -----

  const jobLabel = terminology?.jobLabel || "Job";
  const jobsLabel = terminology?.jobsLabel || "Jobs";
  const isFiltered = !!(searchQuery || filterStatus !== "all");

  return (
    <PageLayout>
      <PageHeader
        title={jobsLabel}
        description="Track and manage all your service jobs and installations"
        actions={
          <div className="flex items-center gap-2">
            {isHousecallProConfigured && (
              <Button variant="outline" onClick={handleImportFromHousecallPro} data-testid="button-import-hcp">
                <CalendarIcon className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Import from Housecall Pro</span>
              </Button>
            )}
            <Button onClick={() => setAddModalOpen()} data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Add {jobLabel}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-4">
        <StatusFilterBar
          statuses={JOB_STATUSES}
          activeStatus={filterStatus}
          counts={statusCounts}
          onStatusChange={setFilterStatus}
        />

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={JOB_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) }))}
          userOptions={usersData?.map((u) => ({ value: u.id, label: u.fullName })) ?? []}
          dateLabel="Scheduled Date"
        />
      </div>

      {/* Result count */}
      {allJobs.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {allJobs.length} of {totalJobs} {jobsLabel.toLowerCase()}
        </div>
      )}

      {/* Jobs list */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
        {jobsLoading
          ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={`skeleton-${i}`} />)
          : allJobs.map((job) => (
              <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onViewDetails={handleViewDetails} onDelete={handleDeleteJob} selectable />
            ))}
      </div>

      {/* SCALE NOTE: Each page appends card DOM nodes. At >200 items the rendered
           DOM grows large and scrolling can slow down. If this becomes a problem,
           replace the append-based pagination with react-virtual (or @tanstack/virtual)
           for windowed rendering — only the visible cards would be in the DOM. */}
      <LoadMoreButton
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
        label="Load More Jobs"
        testId="button-load-more-jobs"
      />

      {/* Empty states */}
      {allJobs.length === 0 && !jobsLoading && (
        isFiltered ? (
          <EmptyState
            icon={Search}
            title="No jobs match your filters"
            description="Try adjusting your search criteria or filters to find more jobs."
            tips={[
              "Clear some filters to broaden your search",
              "Check your status and date range settings",
              "Try searching by job title or customer name",
            ]}
          />
        ) : (
          <EmptyState
            icon={Briefcase}
            title="No jobs yet"
            description="Create your first job to start tracking work and revenue."
            tips={[
              "Convert approved estimates into jobs automatically",
              "Create jobs manually for walk-in customers",
              "Jobs synced from Housecall Pro will appear here automatically",
            ]}
            ctaLabel="Create Your First Job"
            onCtaClick={() => setAddModalOpen()}
            ctaTestId="button-add-first-job"
          />
        )
      )}

      {/* Modals */}
      <JobDetailsModal isOpen={jobDetailsItem !== null} job={jobDetailsItem ?? undefined} onClose={closeJobDetails} />

      <CreateJobModal isOpen={addModalOpen} onClose={closeAddModal} />

      <HCPImportModal
        isOpen={importDateOpen}
        onClose={() => setImportDateOpen(false)}
        onConfirm={handleConfirmImport}
        selectedDate={selectedImportDate}
        onDateChange={setSelectedImportDate}
        entityLabel="jobs"
      />

      <BulkActionToolbar
        onDelete={handleBulkDelete}
        onStatusChange={handleBulkStatusChange}
        onExport={handleBulkExport}
        statusOptions={JOB_STATUSES.map((s) => ({ value: s, label: formatStatusLabel(s) }))}
      />

      <DeleteConfirmDialog
        isOpen={deleteJobItem !== null}
        onOpenChange={(open) => !open && closeDeleteJob()}
        title="Delete Job"
        description={`Are you sure you want to delete "${deleteJobItem?.title}"? This action cannot be undone.`}
        onConfirm={() => deleteJobItem && deleteJobMutation.mutate(deleteJobItem.id)}
        confirmTestId="button-confirm-delete-job"
      />
    </PageLayout>
  );
}
