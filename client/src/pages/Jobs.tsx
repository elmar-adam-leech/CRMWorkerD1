import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { JobCard } from "@/components/JobCard";
import { JobCardSkeleton } from "@/components/JobCardSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Plus, Search, Filter, LayoutGrid, List, Briefcase, CalendarIcon } from "lucide-react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PaginatedJobs, TerminologySettings } from "@shared/schema";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { CreateJobForm } from "@/components/CreateJobForm";
import { JobDetailsModal, type JobListItem } from "@/components/JobDetailsModal";
import { HCPImportModal } from "@/components/HCPImportModal";

type HCPIntegration = { name: string; hasCredentials: boolean; isEnabled: boolean };

export default function Jobs({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const { subscribe } = useWebSocketContext();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  // Sync global search bar into local search state
  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);

  const [filterStatus, setFilterStatus] = useState<"all" | "scheduled" | "in_progress" | "completed" | "cancelled">("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({});
  const [viewMode, setViewMode] = useState<"cards" | "kanban">("cards");
  const [addModalOpen, setAddModalOpen] = useState(false);

  const [jobDetailsModal, setJobDetailsModal] = useState<{
    isOpen: boolean;
    job?: JobListItem;
  }>({ isOpen: false });

  const [importDateModalOpen, setImportDateModalOpen] = useState(false);
  const [selectedImportDate, setSelectedImportDate] = useState<Date | undefined>(undefined);

  // Fetch terminology settings
  const { data: terminology } = useQuery<TerminologySettings>({
    queryKey: ["/api/terminology"],
  });

  // Fetch users for assigned filter
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ["/api/users"],
  });

  // Fetch jobs with infinite pagination
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

      const response = await fetch(`/api/jobs/paginated?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json() as Promise<PaginatedJobs>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

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
  const { data: integrations = [] } = useQuery<HCPIntegration[]>({
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

  // Update job status mutation
  const updateJobStatusMutation = useMutation({
    mutationFn: async (data: { jobId: string; status: string }) => {
      return apiRequest("PATCH", `/api/jobs/${data.jobId}/status`, { status: data.status });
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Job status has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update job status",
        variant: "destructive",
      });
    },
  });

  // Enable global keyboard shortcuts
  useGlobalShortcuts((type) => {
    if (type === "job") {
      setAddModalOpen(true);
    }
  });

  // Check URL parameters to auto-open modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("add") === "true") {
      setAddModalOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [location]);

  // Set default import date when sync start date is fetched
  useEffect(() => {
    if (syncStartDateData?.syncStartDate) {
      setSelectedImportDate(new Date(syncStartDateData.syncStartDate));
    }
  }, [syncStartDateData]);

  // Subscribe to WebSocket updates for jobs
  useEffect(() => {
    const unsubscribe = subscribe((message: { type: string }) => {
      if (
        message.type === "new_job" ||
        message.type === "job_created" ||
        message.type === "job_updated" ||
        message.type === "job_deleted"
      ) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
      }
    });
    return unsubscribe;
  }, [subscribe]);

  // Flatten paginated data into a single array
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
      estimatedHours: 8,
      externalSource: undefined,
      estimateId: undefined,
    }))
  ) ?? [];

  // Get total count from pagination data
  const totalJobs = jobsData?.pages[0]?.pagination.total ?? 0;

  // Fetch status counts from backend
  const { data: statusCountsData } = useQuery<{
    all: number;
    scheduled: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  }>({
    queryKey: ["/api/jobs/status-counts", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      const response = await fetch(`/api/jobs/status-counts?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch job status counts");
      return response.json();
    },
  });

  // Use status counts from backend, fallback to 0 if not loaded yet
  const statusCounts = statusCountsData || {
    all: 0,
    scheduled: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  };

  const jobsByStatus = useMemo(
    () => ({
      scheduled: allJobs.filter((j) => j.status === "scheduled"),
      in_progress: allJobs.filter((j) => j.status === "in_progress"),
      completed: allJobs.filter((j) => j.status === "completed"),
      cancelled: allJobs.filter((j) => j.status === "cancelled"),
    }),
    [allJobs]
  );

  const handleAddJob = () => {
    setAddModalOpen(true);
  };

  const handleImportFromHousecallPro = () => {
    setAddModalOpen(false);
    setImportDateModalOpen(true);
  };

  const handleConfirmImport = async () => {
    setImportDateModalOpen(false);

    toast({
      title: "Import Started",
      description: "Importing jobs from Housecall Pro...",
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
      const contentType = response.headers.get("content-type");
      const data = contentType?.includes("application/json") ? await response.json() : {};

      queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
      toast({
        title: "Import Successful",
        description: `Successfully imported data from Housecall Pro.${data.newJobs ? ` Added ${data.newJobs} new jobs.` : ""}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import jobs from Housecall Pro",
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

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobStatusMutation.mutate({ jobId, status: newStatus });
  };

  const handleViewDetails = (jobId: string) => {
    const job = allJobs.find((j) => j.id === jobId);
    if (job) {
      setJobDetailsModal({ isOpen: true, job });
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title={terminology?.jobsLabel || "Jobs"}
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
            <Button onClick={handleAddJob} data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Add {terminology?.jobLabel || "Job"}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${(terminology?.jobsLabel || "jobs").toLowerCase()} by title, customer, or type...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="input-job-search"
            />
          </div>
          <div className="flex items-center border rounded-md self-start sm:self-auto">
            <Button
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("cards")}
              data-testid="view-cards"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "kanban" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("kanban")}
              data-testid="view-kanban"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground hidden sm:inline">Quick Filter:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "scheduled", "in_progress", "completed", "cancelled"] as const).map((status) => (
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

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={[
            { value: "scheduled", label: "Scheduled" },
            { value: "in_progress", label: "In Progress" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
          userOptions={usersData?.map((u) => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Scheduled Date"
        />
      </div>

      {/* Pagination Info */}
      {allJobs.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {allJobs.length} of {totalJobs} {terminology?.jobsLabel?.toLowerCase() || "jobs"}
        </div>
      )}

      {viewMode === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {jobsLoading
            ? Array.from({ length: 6 }).map((_, i) => <JobCardSkeleton key={`skeleton-${i}`} />)
            : allJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStatusChange={handleStatusChange}
                  onViewDetails={handleViewDetails}
                  selectable={true}
                />
              ))}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {jobsLoading
            ? (["scheduled", "in_progress", "completed", "cancelled"] as const).map((status) => (
                <div key={status} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span className="text-sm text-muted-foreground">(0)</span>
                  </div>
                  <div className="space-y-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <JobCardSkeleton key={`kanban-skeleton-${status}-${i}`} />
                    ))}
                  </div>
                </div>
              ))
            : (["scheduled", "in_progress", "completed", "cancelled"] as const).map((status) => (
                <div key={status} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span className="text-sm text-muted-foreground">({jobsByStatus[status].length})</span>
                  </div>
                  <div className="space-y-3">
                    {jobsByStatus[status].map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onStatusChange={handleStatusChange}
                        onViewDetails={handleViewDetails}
                        selectable={true}
                      />
                    ))}
                  </div>
                </div>
              ))}
        </div>
      )}

      {/* Infinite scrolling - Load More button */}
      {hasNextPage && (
        <div className="flex justify-center mt-8">
          <Button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            variant="outline"
            data-testid="button-load-more-jobs"
          >
            {isFetchingNextPage ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                Loading...
              </>
            ) : (
              "Load More Jobs"
            )}
          </Button>
        </div>
      )}

      {allJobs.length === 0 &&
        !jobsLoading &&
        (searchQuery || filterStatus !== "all" ? (
          <EmptyState
            icon={Filter}
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
            onCtaClick={handleAddJob}
            ctaTestId="button-add-first-job"
          />
        ))}

      {/* Job Details Modal */}
      <JobDetailsModal
        isOpen={jobDetailsModal.isOpen}
        job={jobDetailsModal.job}
        onClose={() => setJobDetailsModal({ isOpen: false })}
      />

      {/* Add Job Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-[600px]" data-testid="modal-add-job">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Job
            </DialogTitle>
            <DialogDescription>Create a new job for a customer.</DialogDescription>
          </DialogHeader>

          <CreateJobForm onSuccess={() => setAddModalOpen(false)} onCancel={() => setAddModalOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* HCP Import Date Modal */}
      <HCPImportModal
        isOpen={importDateModalOpen}
        onClose={() => setImportDateModalOpen(false)}
        onConfirm={handleConfirmImport}
        selectedDate={selectedImportDate}
        onDateChange={setSelectedImportDate}
        entityLabel="jobs"
      />

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        onDelete={async (ids) => {
          await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/jobs/${id}`)));
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
          toast({ title: `Deleted ${ids.length} job(s)` });
        }}
        onStatusChange={async (ids, status) => {
          await Promise.all(ids.map((id) => apiRequest("PATCH", `/api/jobs/${id}/status`, { status })));
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/paginated"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/status-counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
          toast({ title: `Updated ${ids.length} job(s) to ${status}` });
        }}
        onExport={async (ids) => {
          const selectedJobs = allJobs.filter((job) => ids.includes(job.id));
          const csvContent = [
            ["Title", "Customer", "Status", "Value", "Scheduled Date", "Type", "Priority", "Estimated Hours"].join(","),
            ...selectedJobs.map((job) =>
              [
                job.title || "",
                job.contactName || "",
                job.status || "",
                job.value || "",
                job.scheduledDate || "",
                job.type || "",
                job.priority || "",
                job.estimatedHours || "",
              ].join(",")
            ),
          ].join("\n");

          const blob = new Blob([csvContent], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `jobs-export-${new Date().toISOString().split("T")[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: `Exported ${ids.length} job(s)` });
        }}
        statusOptions={[
          { value: "scheduled", label: "Scheduled" },
          { value: "in_progress", label: "In Progress" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
    </PageLayout>
  );
}
