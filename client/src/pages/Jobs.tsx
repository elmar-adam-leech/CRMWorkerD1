import { useState, useEffect } from "react";
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
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Search, Filter, LayoutGrid, List, Briefcase, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Job, JobSummary, PaginatedJobs, Contact } from "@shared/schema";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { CreateJobForm } from "@/components/CreateJobForm";

function JobDetailsModal({ isOpen, job, onClose }: { 
  isOpen: boolean; 
  job?: {
    id: string;
    title: string;
    contactId: string;
    status: string;
    value: number;
    scheduledDate: string;
    type: string;
    priority: string;
    estimatedHours: number;
    externalSource?: string;
    estimateId?: string;
  }; 
  onClose: () => void;
}) {
  // Fetch contact data when modal is open and job exists
  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: [`/api/contacts/${job?.contactId}`],
    enabled: isOpen && !!job?.contactId,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <DialogHeader>
          <DialogTitle>
            {job?.title} - Job Details
          </DialogTitle>
          <DialogDescription>
            View detailed information about this job.
          </DialogDescription>
        </DialogHeader>
        
        {job && (
          <div className="space-y-6">
            {contactLoading ? (
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse" />
                <div className="h-4 bg-muted rounded animate-pulse w-2/3" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <strong>Customer:</strong> {contact?.name || 'Unknown Contact'}
                </div>
                <div>
                  <strong>Type:</strong> {job.type}
                </div>
                <div>
                  <strong>Status:</strong> <StatusBadge status={job.status} />
                </div>
                <div>
                  <strong>Priority:</strong> 
                  <Badge variant={
                    job.priority === "high" ? "destructive" : 
                    job.priority === "medium" ? "default" : "secondary"
                  }>
                    {job.priority}
                  </Badge>
                </div>
                <div>
                  <strong>Value:</strong> {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: "USD",
                  }).format(job.value)}
                </div>
                <div>
                  <strong>Scheduled Date:</strong> {job.scheduledDate}
                </div>
                <div>
                  <strong>Estimated Hours:</strong> {job.estimatedHours}h
                </div>
                {job.externalSource && (
                  <div>
                    <strong>Source:</strong> 
                    <Badge variant="secondary" className="ml-2">
                      {job.externalSource === 'housecall-pro' ? 'Housecall Pro' : job.externalSource}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {job.externalSource === 'housecall-pro' && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded border-l-4 border-l-blue-500">
                <strong>Tracking Only:</strong> This job was automatically synced from Housecall Pro for lead value tracking. 
                Status updates and job management should be done in Housecall Pro.
              </div>
            )}

            {job.estimateId && (
              <div className="text-sm text-muted-foreground bg-green-50 p-3 rounded border-l-4 border-l-green-500">
                <strong>Generated from Estimate:</strong> This job was created from an approved estimate. 
                You can track the original estimate ID: {job.estimateId}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Jobs() {
  const [location] = useLocation();
  const { subscribe } = useWebSocketContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "scheduled" | "in_progress" | "completed" | "cancelled">("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({});
  const [viewMode, setViewMode] = useState<"cards" | "kanban">("cards");
  
  const [addModal, setAddModal] = useState<{
    isOpen: boolean;
  }>({ isOpen: false });

  // Job details modal state
  const [jobDetailsModal, setJobDetailsModal] = useState<{
    isOpen: boolean;
    job?: {
      id: string;
      title: string;
      contactId: string;
      status: string;
      value: number;
      scheduledDate: string;
      type: string;
      priority: string;
      estimatedHours: number;
      externalSource?: string;
      estimateId?: string;
    };
  }>({ isOpen: false });

  const [importDateModal, setImportDateModal] = useState<{
    isOpen: boolean;
  }>({ isOpen: false });

  const [selectedImportDate, setSelectedImportDate] = useState<Date | undefined>(undefined);

  // Fetch terminology settings
  const { data: terminology } = useQuery<any>({
    queryKey: ['/api/terminology'],
  });

  // Fetch users for assigned filter
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ['/api/users'],
  });

  // Fetch jobs with infinite pagination
  const {
    data: jobsData,
    isLoading: jobsLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['/api/jobs/paginated', { 
      status: filterStatus, 
      search: searchQuery,
      assignedTo: advancedFilters.assignedTo,
      dateFrom: advancedFilters.dateFrom?.toISOString(),
      dateTo: advancedFilters.dateTo?.toISOString()
    }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.append('cursor', pageParam);
      params.append('limit', '50');
      if (filterStatus !== 'all') params.append('status', filterStatus);
      if (searchQuery) params.append('search', searchQuery);
      if (advancedFilters.assignedTo) params.append('assignedTo', advancedFilters.assignedTo);
      if (advancedFilters.dateFrom) params.append('dateFrom', advancedFilters.dateFrom.toISOString());
      if (advancedFilters.dateTo) params.append('dateTo', advancedFilters.dateTo.toISOString());
      
      const response = await fetch(`/api/jobs/paginated?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch jobs');
      return response.json() as Promise<PaginatedJobs>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  // Check if Housecall Pro integration is configured
  const { data: integrations = [] } = useQuery<any>({
    queryKey: ['/api/integrations'],
  });

  const housecallProIntegration = Array.isArray(integrations) 
    ? integrations.find((i: any) => i.name === 'housecall-pro')
    : (integrations?.integrations && Array.isArray(integrations.integrations)) 
      ? integrations.integrations.find((i: any) => i.name === 'housecall-pro')
      : null;
  
  const isHousecallProConfigured = housecallProIntegration?.hasCredentials && housecallProIntegration?.isEnabled;

  // Fetch current sync start date from settings
  const { data: syncStartDateData } = useQuery<{ syncStartDate: string | null }>({
    queryKey: ['/api/housecall-pro/sync-start-date'],
    enabled: isHousecallProConfigured,
  });
  
  const { toast } = useToast();

  // Update job status mutation
  const updateJobStatusMutation = useMutation({
    mutationFn: async (data: { jobId: string; status: string }) => {
      const response = await apiRequest('PATCH', `/api/jobs/${data.jobId}/status`, { status: data.status });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Job status has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs/status-counts'] });
    },
    onError: (error: any) => {
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
      setAddModal({ isOpen: true });
    }
  });

  // Check URL parameters to auto-open modal
  useEffect(() => {
    console.log('🔍 Jobs page useEffect triggered, location:', location);
    console.log('🔍 Current URL:', window.location.href);
    const urlParams = new URLSearchParams(window.location.search);
    const shouldAdd = urlParams.get('add');
    console.log('🔍 URL params shouldAdd:', shouldAdd);
    if (shouldAdd === 'true') {
      console.log('✅ Opening add modal for jobs');
      setAddModal({ isOpen: true });
      // Clean URL after opening modal
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location]);

  // Set default import date when sync start date is fetched
  useEffect(() => {
    if (syncStartDateData?.syncStartDate) {
      setSelectedImportDate(new Date(syncStartDateData.syncStartDate));
    }
  }, [syncStartDateData]);

  // Invalidate queries when filters change to ensure fresh data
  useEffect(() => {
    queryClient.invalidateQueries({ 
      queryKey: ['/api/jobs/paginated'] 
    });
  }, [filterStatus, searchQuery]);

  // Subscribe to WebSocket updates for jobs
  useEffect(() => {
    const unsubscribe = subscribe((message: any) => {
      console.log('[Jobs] WebSocket message received:', message);
      
      // When jobs are created, updated, or deleted, invalidate queries to refresh
      if (message.type === 'new_job' || message.type === 'job_created' || message.type === 'job_updated' || message.type === 'job_deleted') {
        console.log('[Jobs] Invalidating job queries for real-time update');
        queryClient.invalidateQueries({ queryKey: ['/api/jobs/paginated'] });
        queryClient.invalidateQueries({ queryKey: ['/api/jobs/status-counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      }
    });

    return unsubscribe;
  }, [subscribe]);

  // Flatten paginated data into a single array, using JobSummary as-is with minimal transformation
  const allJobs = jobsData?.pages.flatMap(page => (page.data || []).map(job => ({
    id: job.id,
    title: job.title,
    contactId: job.contactId,
    status: job.status,
    value: typeof job.value === 'string' ? parseFloat(job.value) : job.value,
    scheduledDate: job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString() : 'No date',
    type: job.type,
    priority: job.priority,
    estimatedHours: 8, // Default for display
    externalSource: undefined, // Not in JobSummary yet
    estimateId: undefined, // Not in JobSummary yet
  }))) ?? [];

  // Server-side filtering is handled by the pagination query
  // Use allJobs directly since filtering is already applied
  const filteredJobs = allJobs;

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
    queryKey: ['/api/jobs/status-counts', searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/jobs/status-counts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch job status counts');
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

  const jobsByStatus = {
    scheduled: (filteredJobs || []).filter(j => j.status === "scheduled"),
    in_progress: (filteredJobs || []).filter(j => j.status === "in_progress"),
    completed: (filteredJobs || []).filter(j => j.status === "completed"),
    cancelled: (filteredJobs || []).filter(j => j.status === "cancelled"),
  };

  const handleAddJob = () => {
    console.log("Add job clicked");
    setAddModal({ isOpen: true });
  };

  // Handle showing date picker for import
  const handleImportFromHousecallPro = () => {
    setAddModal({ isOpen: false });
    setImportDateModal({ isOpen: true });
  };

  // Handle actual import with selected date
  const handleConfirmImport = async () => {
    try {
      setImportDateModal({ isOpen: false });
      
      toast({
        title: "Import Started",
        description: "Importing jobs from Housecall Pro...",
      });

      // Temporarily update sync start date if different from current
      const originalSyncDate = syncStartDateData?.syncStartDate;
      const selectedDateISO = selectedImportDate?.toISOString();
      
      if (selectedDateISO && selectedDateISO !== originalSyncDate) {
        await apiRequest('POST', '/api/housecall-pro/sync-start-date', {
          syncStartDate: selectedDateISO
        });
      }

      const response = await apiRequest('POST', '/api/housecall-pro/sync');
      
      // Restore original sync date if we changed it
      if (selectedDateISO && selectedDateISO !== originalSyncDate) {
        await apiRequest('POST', '/api/housecall-pro/sync-start-date', {
          syncStartDate: originalSyncDate
        });
      }
      
      if (response.ok) {
        const data = await response.json();
        
        // Refresh jobs data
        queryClient.invalidateQueries({ queryKey: ['/api/jobs/paginated'] });
        
        toast({
          title: "Import Successful", 
          description: `Successfully imported data from Housecall Pro. ${data.newJobs ? `Added ${data.newJobs} new jobs.` : ''}`,
        });
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Import failed');
      }
    } catch (error: any) {
      console.error('Failed to import from Housecall Pro:', error);
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import jobs from Housecall Pro",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = (jobId: string, newStatus: string) => {
    updateJobStatusMutation.mutate({ jobId, status: newStatus });
  };

  const handleViewDetails = (jobId: string) => {
    console.log(`Viewing details for job ${jobId}`);
    const job = allJobs.find(j => j.id === jobId);
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
          <Button onClick={handleAddJob} data-testid="button-add-job">
            <Plus className="h-4 w-4 mr-2" />
            Add {terminology?.jobLabel || "Job"}
          </Button>
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
            { value: "cancelled", label: "Cancelled" }
          ]}
          userOptions={usersData?.map(u => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Scheduled Date"
        />
      </div>

      {/* Pagination Info */}
      {filteredJobs.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {filteredJobs.length} of {totalJobs} {terminology?.jobsLabel?.toLowerCase() || "jobs"}
        </div>
      )}

      {viewMode === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {jobsLoading ? (
            // Show skeletons while loading
            Array.from({ length: 6 }).map((_, i) => (
              <JobCardSkeleton key={`skeleton-${i}`} />
            ))
          ) : (
            filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onStatusChange={handleStatusChange}
                onViewDetails={handleViewDetails}
                selectable={true}
              />
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {jobsLoading ? (
            // Show skeleton columns for kanban view
            (["scheduled", "in_progress", "completed", "cancelled"] as const).map((status) => (
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
          ) : (
            (["scheduled", "in_progress", "completed", "cancelled"] as const).map((status) => (
              <div key={status} className="space-y-4">
                <div className="flex items-center gap-2">
                  <StatusBadge status={status} />
                  <span className="text-sm text-muted-foreground">
                    ({jobsByStatus[status].length})
                  </span>
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
            ))
          )}
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
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900 mr-2"></div>
                Loading...
              </>
            ) : (
              'Load More Jobs'
            )}
          </Button>
        </div>
      )}

      {filteredJobs.length === 0 && !jobsLoading && (
        searchQuery || filterStatus !== "all" ? (
          <EmptyState
            icon={Filter}
            title="No jobs match your filters"
            description="Try adjusting your search criteria or filters to find more jobs."
            tips={[
              "Clear some filters to broaden your search",
              "Check your status and date range settings",
              "Try searching by job title or customer name"
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
              "Jobs synced from Housecall Pro will appear here automatically"
            ]}
            ctaLabel="Create Your First Job"
            onCtaClick={handleAddJob}
            ctaTestId="button-add-first-job"
          />
        )
      )}

      {/* Job Details Modal */}
      <JobDetailsModal 
        isOpen={jobDetailsModal.isOpen}
        job={jobDetailsModal.job}
        onClose={() => setJobDetailsModal({ isOpen: false })}
      />

      {/* Add Job Modal */}
      <Dialog open={addModal.isOpen} onOpenChange={(open) => setAddModal({ isOpen: open })}>
        <DialogContent className="sm:max-w-[600px]" data-testid="modal-add-job">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Job
            </DialogTitle>
            <DialogDescription>
              Create a new job for a customer.
            </DialogDescription>
          </DialogHeader>

          <CreateJobForm
            onSuccess={() => setAddModal({ isOpen: false })}
            onCancel={() => setAddModal({ isOpen: false })}
          />
        </DialogContent>
      </Dialog>

      {/* Import Date Selection Modal */}
      <Dialog open={importDateModal.isOpen} onOpenChange={(open) => setImportDateModal({ isOpen: open })}>
        <DialogContent className="sm:max-w-[400px]" data-testid="modal-import-date">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Select Import Date
            </DialogTitle>
            <DialogDescription>
              Choose the starting date for importing jobs from Housecall Pro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Import jobs modified since:
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedImportDate && "text-muted-foreground"
                    )}
                    data-testid="button-select-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedImportDate ? format(selectedImportDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={selectedImportDate}
                    onSelect={setSelectedImportDate}
                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="text-sm text-muted-foreground">
              Only jobs modified on or after this date will be imported. This will temporarily override your sync settings.
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportDateModal({ isOpen: false })}
                data-testid="button-cancel-import"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                disabled={!selectedImportDate}
                data-testid="button-confirm-import"
              >
                Import Jobs
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        onDelete={async (ids) => {
          // Delete all selected jobs
          await Promise.all(ids.map(id => apiRequest("DELETE", `/api/jobs/${id}`)));
          queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
          toast({ title: `Deleted ${ids.length} job(s)` });
        }}
        onStatusChange={async (ids, status) => {
          // Update status for all selected jobs
          await Promise.all(ids.map(id => 
            apiRequest("PATCH", `/api/jobs/${id}/status`, { status })
          ));
          queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
          toast({ title: `Updated ${ids.length} job(s) to ${status}` });
        }}
        onExport={async (ids) => {
          // Export selected jobs
          const selectedJobs = (allJobs || []).filter(job => ids.includes(job.id));
          const csvContent = [
            ['Title', 'Customer', 'Status', 'Value', 'Scheduled Date', 'Type', 'Priority', 'Estimated Hours'].join(','),
            ...(selectedJobs || []).map(job => [
              job.title || '',
              job.customer?.name || '',
              job.status || '',
              job.value || '',
              job.scheduledDate || '',
              job.type || '',
              job.priority || '',
              job.estimatedHours || ''
            ].join(','))
          ].join('\n');
          
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `jobs-export-${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: `Exported ${ids.length} job(s)` });
        }}
        statusOptions={[
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'in_progress', label: 'In Progress' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' }
        ]}
      />
    </PageLayout>
  );
}