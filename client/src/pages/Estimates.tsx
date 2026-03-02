import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { EstimateCard } from "@/components/EstimateCard";
import { EstimateCardSkeleton } from "@/components/EstimateCardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { ActivityList } from "@/components/ActivityList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Search, Filter, Phone, Mail, MessageSquare, Calendar, User, FileText, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertEstimateSchema } from "@shared/schema";
import { z } from "zod";
import type { Estimate, PaginatedEstimates, TerminologySettings, Contact, EstimateSummary } from "@shared/schema";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { CreateEstimateForm } from "@/components/CreateEstimateForm";

const estimateFormSchema = insertEstimateSchema.pick({
  title: true,
  description: true,
  amount: true,
  status: true,
});

type EstimateListItem = {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  status: EstimateSummary['status'] | 'cancelled';
  value: number;
  createdDate: string;
  expiryDate: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  externalSource?: string;
  externalId?: string;
};

export default function Estimates({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const { subscribe } = useWebSocketContext();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  // Sync global search bar into local search state
  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);
  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "pending" | "approved" | "rejected">("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({});
  
  // Communication actions hook
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

  const [followUpDate, setFollowUpDate] = useState<Date | undefined>(undefined);

  // Fetch terminology settings
  const { data: terminology } = useQuery<TerminologySettings>({
    queryKey: ['/api/terminology'],
  });

  // Fetch users for assigned filter
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ['/api/users'],
  });

  // Fetch contact data for details modal
  const { data: detailsContact } = useQuery<Contact>({
    queryKey: ['/api/contacts', detailsModal.estimate?.contactId],
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
    queryKey: ['/api/estimates/paginated', { 
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
      
      const response = await fetch(`/api/estimates/paginated?${params}`);
      if (!response.ok) throw new Error('Failed to fetch estimates');
      return response.json() as Promise<PaginatedEstimates>;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: null as string | null,
  });

  // Flatten paginated data into single array
  const estimates = estimatesData?.pages.flatMap(page => page.data) || [];
  const totalEstimates = estimatesData?.pages[0]?.pagination.total || 0;

  // Get user role to guard admin-only queries
  const { data: currentUser } = useQuery<{ user: { role: string; canManageIntegrations?: boolean } }>({
    queryKey: ['/api/auth/me'],
  });
  const canManageIntegrations = currentUser?.user?.role === 'admin'
    || currentUser?.user?.role === 'super_admin'
    || currentUser?.user?.role === 'manager'
    || currentUser?.user?.canManageIntegrations === true;

  // Check if Housecall Pro integration is configured (admin/manager only)
  const { data: integrations = [] } = useQuery<any[]>({
    queryKey: ['/api/integrations'],
    enabled: canManageIntegrations,
  });

  const housecallProIntegration = integrations.find(i => i.name === 'housecall-pro');
  
  const isHousecallProConfigured = housecallProIntegration?.hasCredentials && housecallProIntegration?.isEnabled;

  // Fetch current sync start date from settings
  const { data: syncStartDateData } = useQuery<{ syncStartDate: string | null }>({
    queryKey: ['/api/housecall-pro/sync-start-date'],
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
    if (urlParams.get('add') === 'true') {
      setAddModal({ isOpen: true });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location]);

  // Subscribe to WebSocket updates for estimates
  useEffect(() => {
    const unsubscribe = subscribe((message: { type: string }) => {
      if (message.type === 'new_estimate' || message.type === 'estimate_created' || message.type === 'estimate_updated' || message.type === 'estimate_deleted') {
        queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
        queryClient.invalidateQueries({ queryKey: ['/api/estimates/status-counts'] });
        queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
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
  
  // Form for estimate editing
  const editForm = useForm<z.infer<typeof estimateFormSchema>>({
    resolver: zodResolver(estimateFormSchema),
    defaultValues: {
      title: "",
      description: "",
      amount: "0",
      status: "pending",
    },
  });


  // Transform paginated estimates data (EstimateSummary) into display-friendly EstimateListItem
  const allEstimates: EstimateListItem[] = (estimates || []).map(e => ({
    id: e.id,
    title: e.title,
    contactId: e.contactId,
    contactName: e.contactName,
    status: e.status,
    value: parseFloat(e.amount),
    createdDate: new Date(e.createdAt).toLocaleDateString(),
    expiryDate: e.validUntil ? new Date(e.validUntil).toLocaleDateString() : 'No expiry',
    description: '',
    priority: 'medium' as const,
  }));


  // Fetch status counts from backend
  const { data: statusCountsData } = useQuery<{
    all: number;
    sent: number;
    pending: number;
    approved: number;
    rejected: number;
  }>({
    queryKey: ['/api/estimates/status-counts', searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/estimates/status-counts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch status counts');
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

  // Handle showing date picker for import
  const handleImportFromHousecallPro = () => {
    setAddModal({ isOpen: false });
    setImportDateModal({ isOpen: true });
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
        await apiRequest('POST', '/api/housecall-pro/sync-start-date', {
          syncStartDate: selectedDateISO
        });
      }

      const response = await apiRequest('POST', '/api/housecall-pro/sync');
      const data = await response.json();

      queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
      toast({
        title: "Import Successful",
        description: `Successfully imported estimates from Housecall Pro.${data.newEstimates ? ` Added ${data.newEstimates} new estimates.` : ''}`,
      });
    } catch (error: unknown) {
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import estimates from Housecall Pro",
        variant: "destructive",
      });
    } finally {
      // Always restore the original sync date if we changed it
      if (dateChanged) {
        await apiRequest('POST', '/api/housecall-pro/sync-start-date', {
          syncStartDate: originalSyncDate
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
    const estimate = (allEstimates || []).find(e => e.id === estimateId);
    if (estimate) {
      setDetailsModal({ isOpen: true, estimate });
    }
  };

  // Shared helper: fetch a contact by ID with error handling
  const fetchContact = async (contactId: string): Promise<Contact | null> => {
    const response = await fetch(`/api/contacts/${contactId}`, { credentials: 'include' });
    if (!response.ok) {
      toast({
        title: "Error",
        description: "Failed to load contact information",
        variant: "destructive",
      });
      return null;
    }
    return response.json() as Promise<Contact>;
  };

  // Wrapper functions to adapt estimateId-based calls to entity-based calls
  const handleContactById = async (estimateId: string, method: "phone" | "email") => {
    const estimate = (allEstimates || []).find(e => e.id === estimateId);
    if (!estimate) return;

    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    
    // Log activity (best-effort)
    apiRequest('POST', '/api/activities', {
      type: method === 'phone' ? 'call' : 'email',
      content: `${method === 'phone' ? 'Called' : 'Emailed'} ${contact.name} regarding ${estimate.title}`,
      estimateId: estimateId,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
    }).catch(() => {});
    
    const entity = { name: contact.name, emails: contact.emails, phones: contact.phones, id: estimate.id };

    if (method === 'phone') {
      if (contact.phones?.[0]) {
        handleContact(entity, method);
      } else {
        toast({ title: "No phone number", description: `${contact.name} doesn't have a phone number on file.`, variant: "destructive" });
      }
    } else {
      if (contact.emails?.[0]) {
        handleContact(entity, method);
      } else {
        toast({ title: "No email address", description: `${contact.name} doesn't have an email address on file.`, variant: "destructive" });
      }
    }
  };

  const handleSendTextByEntity = async (estimate: EstimateListItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendText({ id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones }, 'estimate');
  };

  const handleSendEmailByEntity = async (estimate: EstimateListItem) => {
    const contact = await fetchContact(estimate.contactId);
    if (!contact) return;
    handleSendEmail({ id: estimate.id, name: contact.name, emails: contact.emails, phones: contact.phones }, 'estimate');
  };

  const handleConvertToJob = (_estimateId: string) => {
    toast({ title: "Convert to job is not yet available" });
  };

  const handleEditEstimate = (estimateId: string) => {
    const estimate = (estimates || []).find(e => e.id === estimateId);
    if (estimate) {
      // Populate the edit form
      editForm.reset({
        title: estimate.title || "",
        description: "",
        amount: estimate.amount?.toString() || "0",
        status: ["sent", "pending", "approved", "rejected"].includes(estimate.status) ? estimate.status as "sent" | "pending" | "approved" | "rejected" : "pending",
      });
      setEditModal({ isOpen: true, estimate });
    }
  };
  
  // Update estimate mutation
  const updateEstimateMutation = useMutation({
    mutationFn: async ({ estimateId, data }: { estimateId: string; data: z.infer<typeof estimateFormSchema> }) => {
      return apiRequest('PUT', `/api/estimates/${estimateId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
      toast({
        title: "Estimate updated",
        description: "The estimate has been successfully updated.",
      });
      setEditModal({ isOpen: false });
      editForm.reset();
    },
    onError: (error) => {
      toast({
        title: "Error updating estimate",
        description: error instanceof Error ? error.message : "Failed to update estimate. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  const handleEditSubmit = (values: z.infer<typeof estimateFormSchema>) => {
    if (!editModal.estimate) return;
    
    updateEstimateMutation.mutate({
      estimateId: editModal.estimate.id,
      data: values,
    });
  };

  // Follow-up date mutation
  const updateFollowUpDateMutation = useMutation({
    mutationFn: async ({ estimateId, followUpDate }: { estimateId: string; followUpDate: Date | null }) => {
      return apiRequest('PATCH', `/api/estimates/${estimateId}/follow-up`, {
        followUpDate: followUpDate ? followUpDate.toISOString() : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      toast({
        title: "Follow-up date set",
        description: "The follow-up date has been successfully updated.",
      });
      setFollowUpModal({ isOpen: false });
      setFollowUpDate(undefined);
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
    setFollowUpDate(undefined);
  };

  const handleFollowUpSubmit = () => {
    if (!followUpModal.estimate) return;
    
    updateFollowUpDateMutation.mutate({
      estimateId: followUpModal.estimate.id,
      followUpDate: followUpDate || null,
    });
  };

  // Delete estimate mutation
  const deleteEstimateMutation = useMutation({
    mutationFn: async (estimateId: string) => {
      const response = await apiRequest('DELETE', `/api/estimates/${estimateId}`);
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Estimate Deleted",
        description: "Estimate has been successfully deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
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
    const estimate = (estimates || []).find(e => e.id === estimateId);
    if (!estimate) return;
    
    if (confirm(`Are you sure you want to delete estimate "${estimate.title}"? This action cannot be undone.`)) {
      deleteEstimateMutation.mutate(estimateId);
    }
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
            { value: "rejected", label: "Rejected" }
          ]}
          userOptions={usersData?.map(u => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Created Date"
        />
      </div>

      {/* Pagination Info */}
      {estimates.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {estimates.length} of {totalEstimates} {terminology?.estimatesLabel?.toLowerCase() || "estimates"}
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
          <Button
            onClick={() => fetchNextPage()}
            variant="outline"
            data-testid="button-load-more-estimates"
          >
            Load More Estimates
          </Button>
        </div>
      )}

      {/* Empty state */}
      {allEstimates.length === 0 && !estimatesLoading && (
        searchQuery || filterStatus !== "all" ? (
          <EmptyState
            icon={Filter}
            title="No estimates match your filters"
            description="Try adjusting your search criteria or filters to find more estimates."
            tips={[
              "Clear some filters to broaden your search",
              "Check your date range settings",
              "Try searching by customer name or estimate title"
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
              "Convert approved estimates directly into jobs"
            ]}
            ctaLabel="Create Your First Estimate"
            onCtaClick={handleAddEstimate}
            ctaTestId="button-add-first-estimate"
          />
        )
      )}
      
      {/* Edit Estimate Modal */}
      <Dialog open={editModal.isOpen} onOpenChange={(open) => setEditModal({ isOpen: open })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
          <DialogHeader>
            <DialogTitle>Edit Estimate - {editModal.estimate?.title}</DialogTitle>
            <DialogDescription>
              Update the estimate details including title, amount, status, and notes.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={editForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter estimate title" {...field} data-testid="input-edit-estimate-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-edit-estimate-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <FormControl>
                        <select {...field} className="w-full px-3 py-2 border border-input rounded-md" data-testid="select-edit-estimate-status">
                          <option value="draft">Draft</option>
                          <option value="sent">Sent</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter estimate description..."
                        className="resize-none"
                        rows={4}
                        {...field}
                        value={field.value || ""}
                        data-testid="textarea-edit-estimate-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditModal({ isOpen: false })}
                  data-testid="button-cancel-edit-estimate"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateEstimateMutation.isPending}
                  data-testid="button-save-edit-estimate"
                >
                  {updateEstimateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Estimate Modal */}
      <Dialog open={addModal.isOpen} onOpenChange={(open) => setAddModal({ isOpen: open })}>
        <DialogContent className="sm:max-w-[600px]" data-testid="modal-add-estimate">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Estimate
            </DialogTitle>
            <DialogDescription>
              Create a new estimate for a lead or customer.
            </DialogDescription>
          </DialogHeader>

          <CreateEstimateForm
            onSuccess={() => setAddModal({ isOpen: false })}
            onCancel={() => setAddModal({ isOpen: false })}
          />
        </DialogContent>
      </Dialog>

      {/* Estimate Details Modal */}
      <Dialog open={detailsModal.isOpen} onOpenChange={(open) => setDetailsModal({ isOpen: open })}>
        <DialogContent className="w-full max-w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto mx-2 sm:mx-4">
          <DialogHeader>
            <DialogTitle>{detailsModal.estimate?.title}</DialogTitle>
            <DialogDescription>
              Estimate details and activity history
            </DialogDescription>
          </DialogHeader>
          
          {detailsModal.estimate && (() => {
            const detailsEst = detailsModal.estimate!;
            return (<div className="grid gap-6 md:grid-cols-2">
              {/* Estimate Information */}
              <div className="space-y-4">
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Customer:</span>
                    <span>{detailsContact?.name || detailsEst.contactName || 'Not provided'}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Email:</span>
                    <span>
                      {detailsContact?.emails && detailsContact.emails.length > 0
                        ? detailsContact.emails.join(', ')
                        : 'Not provided'}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Phone:</span>
                    <span>
                      {detailsContact?.phones && detailsContact.phones.length > 0
                        ? detailsContact.phones.join(', ')
                        : 'Not provided'}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Created:</span>
                    <span>{detailsEst.createdDate}</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Expires:</span>
                    <span>{detailsEst.expiryDate}</span>
                  </div>
                  
                  <div className="pt-4">
                    <span className="font-medium">Description:</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {detailsEst.description || 'No description provided'}
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 pt-4">
                    {detailsContact?.phones && detailsContact.phones.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleContact({ name: detailsContact.name, emails: detailsContact.emails, phones: detailsContact.phones, id: detailsEst.id }, "phone")}
                      >
                        <Phone className="h-4 w-4 mr-1" />
                        Call
                      </Button>
                    )}
                    {detailsContact?.emails && detailsContact.emails.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleContact({ name: detailsContact.name, emails: detailsContact.emails, phones: detailsContact.phones, id: detailsEst.id }, "email")}
                      >
                        <Mail className="h-4 w-4 mr-1" />
                        Email
                      </Button>
                    )}
                    {detailsContact?.phones && detailsContact.phones.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSendText({
                          id: detailsEst.id,
                          name: detailsContact.name,
                          emails: detailsContact.emails,
                          phones: detailsContact.phones,
                        }, 'estimate')}
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Text
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Activities */}
              <ActivityList
                estimateId={detailsEst.id}
                className="md:col-span-1"
              />
            </div>);
          })()}
        </DialogContent>
      </Dialog>

      {/* Texting Modal */}
      <TextingModal
        isOpen={textingModal.isOpen}
        onClose={closeTextingModal}
        recipientName={textingModal.estimate?.name || ''}
        recipientPhone={textingModal.estimate?.phones?.[0] || textingModal.estimate?.phone || ''}
        recipientEmail={textingModal.estimate?.emails?.[0] || textingModal.estimate?.email || ''}
        companyName="Our Company"
        estimateId={textingModal.estimate?.id}
      />

      {/* Email Composer Modal */}
      <EmailComposerModal
        isOpen={emailModal.isOpen}
        onClose={closeEmailModal}
        recipientName={emailModal.estimate?.name || ''}
        recipientEmail={emailModal.estimate?.emails?.[0] || emailModal.estimate?.email || ''}
        companyName=""
        estimateId={emailModal.estimate?.id}
      />

      {/* Import Date Selection Modal */}
      <Dialog open={importDateModal.isOpen} onOpenChange={(open) => setImportDateModal({ isOpen: open })}>
        <DialogContent className="sm:max-w-[400px]" data-testid="modal-import-date">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Select Import Date
            </DialogTitle>
            <DialogDescription>
              Choose the starting date for importing estimates from Housecall Pro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Import estimates modified since:
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
              Only estimates modified on or after this date will be imported. This will temporarily override your sync settings.
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
                Import Estimates
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Follow-Up Date Modal */}
      <Dialog open={followUpModal.isOpen} onOpenChange={(open) => setFollowUpModal(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Follow-Up Date</DialogTitle>
            <DialogDescription>
              Set a reminder to follow up on {followUpModal.estimate?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Follow-Up Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !followUpDate && "text-muted-foreground"
                    )}
                    data-testid="button-follow-up-date-picker"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {followUpDate ? format(followUpDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={followUpDate}
                    onSelect={setFollowUpDate}
                    initialFocus
                    data-testid="calendar-follow-up-date"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex justify-end space-x-2">
              {followUpDate && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFollowUpDate(undefined)}
                  data-testid="button-clear-follow-up"
                >
                  Clear Date
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setFollowUpModal({ isOpen: false })}
                data-testid="button-cancel-follow-up"
              >
                Cancel
              </Button>
              <Button
                onClick={handleFollowUpSubmit}
                disabled={updateFollowUpDateMutation.isPending}
                data-testid="button-save-follow-up"
              >
                {updateFollowUpDateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        onDelete={async (ids) => {
          await Promise.all(ids.map(id => apiRequest("DELETE", `/api/estimates/${id}`)));
          queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
          queryClient.invalidateQueries({ queryKey: ['/api/estimates/status-counts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
          toast({ title: `Deleted ${ids.length} estimate(s)` });
        }}
        onStatusChange={async (ids, status) => {
          await Promise.all(ids.map(id =>
            apiRequest("PATCH", `/api/estimates/${id}/status`, { status })
          ));
          queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
          queryClient.invalidateQueries({ queryKey: ['/api/estimates/status-counts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
          toast({ title: `Updated ${ids.length} estimate(s) to ${status}` });
        }}
        onExport={async (ids) => {
          // Export selected estimates
          const selectedEstimates = (allEstimates || []).filter(est => ids.includes(est.id));
          const csvContent = [
            ['Title', 'Customer', 'Email', 'Phone', 'Status', 'Value', 'Created Date', 'Expiry Date'].join(','),
            ...(selectedEstimates || []).map(est => [
              est.title || '',
              est.contactName || '',
              '',
              '',
              est.status || '',
              est.value || '',
              est.createdDate || '',
              est.expiryDate || ''
            ].join(','))
          ].join('\n');
          
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `estimates-export-${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: `Exported ${ids.length} estimate(s)` });
        }}
        statusOptions={[
          { value: 'draft', label: 'Draft' },
          { value: 'sent', label: 'Sent' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'cancelled', label: 'Cancelled' }
        ]}
      />
    </PageLayout>
  );
}