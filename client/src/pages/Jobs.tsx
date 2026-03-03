import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { JobCard } from "@/components/JobCard";
import { JobCardSkeleton } from "@/components/JobCardSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Briefcase, CalendarIcon } from "lucide-react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatStatusLabel } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import type { PaginatedJobs, TerminologySettings } from "@shared/schema";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useHousecallProIntegration } from "@/hooks/useHousecallProIntegration";
import { usePagePreferences } from "@/hooks/use-page-preferences";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { JobDetailsModal, type JobListItem } from "@/components/JobDetailsModal";
import { HCPImportModal } from "@/components/HCPImportModal";
import { CreateJobModal } from "@/components/CreateJobModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { StatusFilterBar } from "@/components/StatusFilterBar";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { ViewToggle } from "@/components/ViewToggle";

const JOB_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];
type FilterStatus = "all" | JobStatus;

export default function Jobs({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const { subscribe } = useWebSocketContext();
  const { isHousecallProConfigured, syncStartDate } = useHousecallProIntegration();

  const {
    viewMode,
    setViewMode,
    filterStatus,
    setFilterStatus,
    advancedFilters,
    setAdvancedFilters,
  } = usePagePreferences({ pageKey: "jobs" });

  const [searchQuery, setSearchQuery] = useState(externalSearch);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [jobDetailsModal, setJobDetailsModal] = useState<{ isOpen: boolean; job?: JobListItem }>({ isOpen: false });
  const [importDateModalOpen, setImportDateModalOpen] = useState(false);
  const [selectedImportDate, setSelectedImportDate] = useState<Date | undefined>(undefined);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; jobId?: string; jobTitle?: string }>({ isOpen: false });

  const { toast } = useToast();

  // Sync global search bar into local state
  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  // Initialise import date from the stored sync start date
  useEffect(() => {
    if (syncStartDate) {
      setSelectedImportDate(new Date(syncStartDate));
    }
  }, [syncStartDate]);

  // Check URL parameters to auto-open add modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("add") === "true") {
      setAddModalOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  // Fetch terminology settings
  const { data: terminology } = useQuery<TerminologySettings>({
    queryKey: ["/api/terminology"],
  });

  // Fetch users for the advanced filter panel
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ["/api/users"],
  });

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
      setDeleteConfirm({ isOpen: false });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to Delete Job", description: error.message || "Something went wrong.", variant: "destructive" });
    },
  });

  const handleDeleteJob = (jobId: string, jobTitle: string) => {
    setDeleteConfirm({ isOpen: true, jobId, jobTitle });
  };

  // Global keyboard shortcuts
  useGlobalShortcuts((type) => {
    if (type === "job") setAddModalOpen(true);
  });

  // WebSocket: invalidate on any job change
  useEffect(() => {
    const unsubscribe = subscribe((message: { type: string }) => {
      if (["new_job", "job_created", "job_updated", "job_deleted"].includes(message.type)) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // Flatten paginated pages into a typed list
  const allJobs: JobListItem[] = jobsData?.pages.flatMap((page) =>
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
  ) ?? [];

  const totalJobs = jobsData?.pages[0]?.pagination.total ?? 0;

  const jobsByStatus = useMemo(
    () => ({
      scheduled: allJobs.filter((j) => j.status === "scheduled"),
      in_progress: allJobs.filter((j) => j.status === "in_progress"),
      completed: allJobs.filter((j) => j.status === "completed"),
      cancelled: allJobs.filter((j) => j.status === "cancelled"),
    }),
    [allJobs]
  );

  // ----- Event handlers -----

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobStatusMutation.mutate({ jobId, status: newStatus });
  };

  const handleViewDetails = (jobId: string) => {
    const job = allJobs.find((j) => j.id === jobId);
    if (job) setJobDetailsModal({ isOpen: true, job });
  };

  const handleImportFromHousecallPro = () => {
    setAddModalOpen(false);
    setImportDateModalOpen(true);
  };

  const handleConfirmImport = async () => {
    setImportDateModalOpen(false);
    toast({ title: "Import Started", description: "Importing jobs from Housecall Pro..." });

    const selectedDateISO = selectedImportDate?.toISOString();
    const dateChanged = selectedDateISO && selectedDateISO !== syncStartDate;

    try {
      if (dateChanged) {
        await apiRequest("POST", "/api/housecall-pro/sync-start-date", { syncStartDate: selectedDateISO });
      }
      const response = await apiRequest("POST", "/api/housecall-pro/sync?type=jobs");
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      toast({
        title: "Import Successful",
        description: `Successfully imported jobs from Housecall Pro.${data.newJobs ? ` Added ${data.newJobs} new jobs.` : ""}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import jobs from Housecall Pro",
        variant: "destructive",
      });
      if (dateChanged) {
        await apiRequest("POST", "/api/housecall-pro/sync-start-date", { syncStartDate: syncStartDate }).catch(() => {});
      }
    }
  };

  // ----- Bulk action handlers -----

  const handleBulkDelete = async (ids: string[]) => {
    try {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/jobs/${id}`)));
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: `Deleted ${ids.length} job(s)` });
    } catch (error: unknown) {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete one or more jobs.",
        variant: "destructive",
      });
    }
  };

  const handleBulkStatusChange = async (ids: string[], status: string) => {
    try {
      await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/jobs/${id}/status`, { status })));
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: `Updated ${ids.length} job(s) to ${status}` });
    } catch (error: unknown) {
      toast({
        title: "Status Update Failed",
        description: error instanceof Error ? error.message : "Failed to update one or more jobs.",
        variant: "destructive",
      });
    }
  };

  const handleBulkExport = async (ids: string[]) => {
    const selectedJobs = allJobs.filter((job) => ids.includes(job.id));
    downloadCsv(
      `jobs-export-${new Date().toISOString().split("T")[0]}.csv`,
      ["Title", "Customer", "Status", "Value", "Scheduled Date", "Type", "Priority", "Estimated Hours"],
      selectedJobs.map((job) => [
        job.title, job.contactName, job.status, job.value,
        job.scheduledDate, job.type, job.priority, job.estimatedHours ?? "",
      ])
    );
    toast({ title: `Exported ${ids.length} job(s)` });
  };

  // ----- Render -----

  const jobLabel = terminology?.jobLabel || "Job";
  const jobsLabel = terminology?.jobsLabel || "Jobs";
  const isFiltered = !!(searchQuery || filterStatus !== "all");

  return (
    <PageLayout>
      <PageHeader
        title={jobsLabel}
        description="Track and manage all your service jobs and installations"
        icon={<Briefcase className="h-6 w-6" />}
        actions={
          <div className="flex items-center gap-2">
            {isHousecallProConfigured && (
              <Button variant="outline" onClick={handleImportFromHousecallPro} data-testid="button-import-hcp">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Import from Housecall Pro
              </Button>
            )}
            <Button onClick={() => setAddModalOpen(true)} data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Add {jobLabel}
            </Button>
          </div>
        }
      />

      {/* Search, view toggle, filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${jobsLabel.toLowerCase()} by title, customer, or type...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="input-job-search"
            />
          </div>
          <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

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

      {/* Card / Kanban views */}
      {viewMode === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {jobsLoading
            ? Array.from({ length: 6 }).map((_, i) => <JobCardSkeleton key={`skeleton-${i}`} />)
            : allJobs.map((job) => (
                <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onViewDetails={handleViewDetails} onDelete={handleDeleteJob} selectable />
              ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {JOB_STATUSES.map((status) => (
            <div key={status} className="space-y-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                <span className="text-sm text-muted-foreground">
                  ({jobsLoading ? 0 : jobsByStatus[status].length})
                </span>
              </div>
              <div className="space-y-3">
                {jobsLoading
                  ? Array.from({ length: 2 }).map((_, i) => <JobCardSkeleton key={`kanban-skeleton-${status}-${i}`} />)
                  : jobsByStatus[status].map((job) => (
                      <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onViewDetails={handleViewDetails} onDelete={handleDeleteJob} selectable />
                    ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
            onCtaClick={() => setAddModalOpen(true)}
            ctaTestId="button-add-first-job"
          />
        )
      )}

      {/* Modals */}
      <JobDetailsModal isOpen={jobDetailsModal.isOpen} job={jobDetailsModal.job} onClose={() => setJobDetailsModal({ isOpen: false })} />

      <CreateJobModal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} />

      <HCPImportModal
        isOpen={importDateModalOpen}
        onClose={() => setImportDateModalOpen(false)}
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
        isOpen={deleteConfirm.isOpen}
        onOpenChange={(open) => !open && setDeleteConfirm({ isOpen: false })}
        title="Delete Job"
        description={`Are you sure you want to delete "${deleteConfirm.jobTitle}"? This action cannot be undone.`}
        onConfirm={() => deleteConfirm.jobId && deleteJobMutation.mutate(deleteConfirm.jobId)}
        confirmTestId="button-confirm-delete-job"
      />
    </PageLayout>
  );
}
