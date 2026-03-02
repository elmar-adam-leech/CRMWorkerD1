import { useState, useRef, useEffect } from "react";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { useLocation } from "wouter";
import { LeadCard } from "@/components/LeadCard";
import { LeadCardSkeleton } from "@/components/LeadCardSkeleton";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { LocalSchedulingModal } from "@/components/LocalSchedulingModal";
import { ActivityList } from "@/components/ActivityList";
import { LeadSubmissionHistory } from "@/components/LeadSubmissionHistory";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { CalendarIcon, Plus, Search, Filter, Download, Upload, UserPlus, Users, AlertCircle, Loader2, LayoutGrid, List } from "lucide-react";
import { GoogleSheetsImportTab } from "@/components/GoogleSheetsImportTab";
import { LeadKanbanBoard } from "@/components/LeadKanbanBoard";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertContactSchema } from "@shared/schema";
import { z } from "zod";
import type { Contact } from "@shared/schema";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useCommunicationActions } from "@/hooks/useCommunicationActions";
import { useGlobalShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { FilterPanel, type FilterState } from "@/components/FilterPanel";
import { EmptyState } from "@/components/EmptyState";
import { TagManager } from "@/components/TagManager";

const contactFormSchema = insertContactSchema
  .omit({ contractorId: true, emails: true, phones: true, type: true })
  .extend({
    email: z.string().optional(),
    phone: z.string().optional(),
  });

const CONTACT_FORM_DEFAULTS: z.infer<typeof contactFormSchema> = {
  name: "",
  email: "",
  phone: "",
  address: "",
  source: "",
  notes: "",
  tags: [],
  followUpDate: undefined,
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
  pageUrl: "",
};

export default function Leads({ externalSearch = "" }: { externalSearch?: string }) {
  const [location] = useLocation();
  const [searchQuery, setSearchQuery] = useState(externalSearch);

  // Sync global search bar into local search state
  useEffect(() => {
    setSearchQuery(externalSearch);
  }, [externalSearch]);
  const [filterStatus, setFilterStatus] = useState<"all" | "new" | "contacted" | "scheduled" | "disqualified">("all");
  const [advancedFilters, setAdvancedFilters] = useState<FilterState>({});
  const [viewMode, setViewMode] = useState<"cards" | "kanban">(() => {
    const saved = localStorage.getItem("leads-view-mode");
    return (saved as "cards" | "kanban") || "cards";
  });
  
  // Communication actions hook
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

  // Bulk selection hook for toolbar visibility
  const { isSelectionMode } = useBulkSelection();

  // Add Contact modal state
  const [addContactModal, setAddContactModal] = useState(false);
  const [activeTab, setActiveTab] = useState("manual");

  // Contact details modal state
  const [contactDetailsModal, setContactDetailsModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  // Edit contact modal state
  const [editContactModal, setEditContactModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  // Edit status modal state
  const [editStatusModal, setEditStatusModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  // Follow-up date modal state
  const [followUpModal, setFollowUpModal] = useState<{
    isOpen: boolean;
    contact?: Contact;
  }>({ isOpen: false });

  // CSV Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocketContext();

  // Fetch terminology settings
  const { data: terminology } = useQuery<{
    leadLabel: string;
    leadsLabel: string;
    estimateLabel: string;
    estimatesLabel: string;
    jobLabel: string;
    jobsLabel: string;
    messageLabel: string;
    messagesLabel: string;
    templateLabel: string;
    templatesLabel: string;
  }>({
    queryKey: ['/api/terminology'],
  });

  // Fetch current user to check Gmail connection status
  const { data: currentUser } = useQuery<{ user: { gmailConnected: boolean } }>({
    queryKey: ['/api/auth/me'],
  });

  // Fetch users for assigned filter
  const { data: usersData } = useQuery<Array<{ id: string; fullName: string }>>({
    queryKey: ['/api/users'],
  });

  // Enable global keyboard shortcuts
  useGlobalShortcuts((type) => {
    if (type === "lead") {
      setAddContactModal(true);
    }
  });

  // Subscribe to WebSocket for real-time updates (page-level subscription persists during modal transitions)
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === 'new_activity' || message.type === 'activity_update') {
        queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
      }
      if (message.type === 'new_message' || message.type === 'message_update' || message.type === 'message_updated') {
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      }
      if (message.type === 'contact_created' || message.type === 'contact_updated' || message.type === 'contact_deleted') {
        queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
        queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
      }
    });
    return () => unsubscribe();
  }, [subscribe, queryClient]);

  // Check URL parameters to auto-open modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shouldAdd = urlParams.get('add');
    if (shouldAdd === 'true') {
      setAddContactModal(true);
      // Clean URL after opening modal
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location]);

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem("leads-view-mode", viewMode);
  }, [viewMode]);

  // Form for manual contact creation
  const form = useForm<z.infer<typeof contactFormSchema>>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: CONTACT_FORM_DEFAULTS,
  });

  // Form for contact editing
  const editForm = useForm<z.infer<typeof contactFormSchema>>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: CONTACT_FORM_DEFAULTS,
  });

  // Fetch contacts (filtered by type=lead) from API with pagination
  const {
    data: leadsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: leadsLoading,
    error: leadsError,
  } = useInfiniteQuery({
    queryKey: ['/api/contacts/paginated', { 
      type: 'lead',
      status: filterStatus, 
      search: searchQuery,
      assignedTo: advancedFilters.assignedTo,
      dateFrom: advancedFilters.dateFrom?.toISOString(),
      dateTo: advancedFilters.dateTo?.toISOString()
    }],
    queryFn: ({ pageParam }) => {
      const url = new URL('/api/contacts/paginated', window.location.origin);
      url.searchParams.set('type', 'lead');
      if (pageParam) url.searchParams.set('cursor', pageParam);
      if (filterStatus !== 'all') url.searchParams.set('status', filterStatus);
      if (searchQuery) url.searchParams.set('search', searchQuery);
      if (advancedFilters.assignedTo) url.searchParams.set('assignedTo', advancedFilters.assignedTo);
      if (advancedFilters.dateFrom) url.searchParams.set('dateFrom', advancedFilters.dateFrom.toISOString());
      if (advancedFilters.dateTo) url.searchParams.set('dateTo', advancedFilters.dateTo.toISOString());
      url.searchParams.set('limit', '50');
      
      return fetch(url.toString(), {
        credentials: 'include'
      }).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch contacts: ${res.status}`);
        return res.json();
      });
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
    initialPageParam: undefined as string | undefined,
  });

  // Flatten the paginated data
  const leads = leadsData?.pages.flatMap(page => page.data) || [];
  const totalLeads = leadsData?.pages[0]?.pagination.total || 0;

  // Manual contact creation mutation (creates lead-type contacts)
  const createContactMutation = useMutation({
    mutationFn: async (contactData: z.infer<typeof contactFormSchema>) => {
      // Transform single email/phone to arrays and add type: 'lead'
      const { email, phone, ...rest } = contactData;
      const payload = {
        ...rest,
        type: 'lead' as const,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
      };

      // Uses raw fetch (not apiRequest) to parse JSON from error responses —
      // apiRequest reads text() before throwing, losing the structured duplicate-
      // detection fields (.isDuplicate, .duplicateContactId, .duplicateContactName).
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error: any = new Error(data.message || 'Failed to create contact');
        error.isDuplicate = data.isDuplicate;
        error.duplicateContactId = data.duplicateContactId;
        error.duplicateContactName = data.duplicateContactName;
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Lead Created",
        description: "Lead has been successfully created.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      form.reset();
      setAddContactModal(false);
    },
    onError: (error: any) => {
      if (error.isDuplicate && error.duplicateContactId) {
        toast({
          title: "Duplicate Phone Number",
          description: `A lead with this phone number already exists: ${error.duplicateContactName || 'Unknown'}. Click to view.`,
          variant: "destructive",
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAddContactModal(false);
                const contact = leads.find(l => l.id === error.duplicateContactId);
                if (contact) {
                  setContactDetailsModal({ isOpen: true, contact });
                }
              }}
            >
              View Lead
            </Button>
          ),
        });
      } else {
        toast({
          title: "Failed to Create Lead",
          description: error.message || "Something went wrong.",
          variant: "destructive",
        });
      }
    },
  });

  // Update contact mutation
  const updateContactMutation = useMutation({
    mutationFn: async (data: { contactId: string; contactData: z.infer<typeof contactFormSchema> }) => {
      // Transform single email/phone to arrays
      const { email, phone, ...rest } = data.contactData;
      const payload = {
        ...rest,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
      };
      
      const response = await apiRequest('PUT', `/api/contacts/${data.contactId}`, payload);
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Lead Updated",
        description: "Lead information has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      setEditContactModal({ isOpen: false });
      editForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  // Update contact status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (data: { contactId: string; status: string }) => {
      const response = await apiRequest('PATCH', `/api/contacts/${data.contactId}/status`, { status: data.status });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Lead status has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
      setEditStatusModal({ isOpen: false });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Status",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  // Delete contact mutation
  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiRequest('DELETE', `/api/contacts/${contactId}`);
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Lead Deleted",
        description: "Lead has been successfully deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  // Update follow-up date mutation
  const updateFollowUpDateMutation = useMutation({
    mutationFn: async (data: { contactId: string; followUpDate: Date | null }) => {
      const response = await apiRequest('PATCH', `/api/contacts/${data.contactId}/follow-up`, { 
        followUpDate: data.followUpDate ? data.followUpDate.toISOString() : null 
      });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Follow-Up Date Set",
        description: "Follow-up date has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Follow-Up Date",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  // CSV Upload mutation
  const csvUploadMutation = useMutation({
    mutationFn: async (csvData: string) => {
      const response = await fetch('/api/leads/csv-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for authentication
        body: JSON.stringify({ csvData })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Upload failed');
      }
      
      return await response.json();
    },
    onSuccess: (data: { message?: string; errors?: unknown[] }) => {
      toast({
        title: "CSV Import Successful",
        description: data.message || "CSV data imported successfully",
      });
      
      if (data.errors && data.errors.length > 0) {
        toast({
          title: "Some rows had errors",
          description: `${data.errors.length} rows failed validation and were skipped.`,
          variant: "destructive",
        });
      }
      
      // Refresh the leads list
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      setAddContactModal(false);
      
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: (error: Error) => {
      toast({
        title: "CSV Import Failed",
        description: error.message || "Failed to import CSV data",
        variant: "destructive",
      });
    },
  });

  // Fetch status counts from backend (filtered by type=lead)
  const { data: statusCountsData, isLoading: statusCountsLoading } = useQuery<{
    all: number;
    new: number;
    contacted: number;
    scheduled: number;
    disqualified: number;
  }>({
    queryKey: ['/api/contacts/status-counts', { type: 'lead', search: searchQuery }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('type', 'lead');
      if (searchQuery) params.append('search', searchQuery);
      
      const response = await fetch(`/api/contacts/status-counts?${params}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch contact status counts');
      return response.json();
    },
  });

  // Use status counts from backend, don't show counts during loading
  const statusCounts = statusCountsData || {
    all: statusCountsLoading ? undefined : 0,
    new: statusCountsLoading ? undefined : 0,
    contacted: statusCountsLoading ? undefined : 0,
    scheduled: statusCountsLoading ? undefined : 0,
    disqualified: statusCountsLoading ? undefined : 0,
  };
  
  
  // Infinite scroll handler
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight * 1.2 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const handleAddLead = () => {
    setAddContactModal(true);
    setActiveTab("manual");
  };

  const handleManualSubmit = (values: z.infer<typeof contactFormSchema>) => {
    createContactMutation.mutate(values);
  };

  const handleEditSubmit = (values: z.infer<typeof contactFormSchema>) => {
    if (!editContactModal.contact) return;
    
    updateContactMutation.mutate({
      contactId: editContactModal.contact.id,
      contactData: values,
    });
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/leads/csv-template', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads_template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Could not download CSV template",
        variant: "destructive",
      });
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvData = e.target?.result as string;
      csvUploadMutation.mutate(csvData);
    };
    reader.readAsText(file);
  };

  // Wrapper functions to adapt leadId-based calls to entity-based calls
  const handleContactById = (leadId: string, method: "phone" | "email") => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    handleContact(lead, method);
  };

  const handleScheduleById = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    handleSchedule(lead);
  };

  const handleSendTextByEntity = (lead: Contact) => {
    handleSendText(lead as any, 'lead');
  };

  const handleSendEmailByEntity = (lead: Contact) => {
    handleSendEmail(lead as any, 'lead');
  };

  const handleEdit = (contactId: string) => {
    const contact = leads.find(l => l.id === contactId);
    if (!contact) return;
    
    // Populate the edit form with contact data
    editForm.reset({
      name: contact.name || "",
      email: (contact.emails && contact.emails.length > 0) ? contact.emails[0] : "",
      phone: (contact.phones && contact.phones.length > 0) ? contact.phones[0] : "",
      address: contact.address || "",
      source: contact.source || "",
      notes: contact.notes || "",
      followUpDate: contact.followUpDate ? new Date(contact.followUpDate) : undefined,
      pageUrl: contact.pageUrl || "",
      utmSource: contact.utmSource || "",
      utmMedium: contact.utmMedium || "",
      utmCampaign: contact.utmCampaign || "",
      utmTerm: contact.utmTerm || "",
      utmContent: contact.utmContent || "",
    });
    
    setEditContactModal({ isOpen: true, contact });
  };

  const handleDelete = (contactId: string) => {
    const contact = leads.find(l => l.id === contactId);
    if (!contact) return;
    
    const contactName = 'name' in contact ? contact.name : contact.customerName;
    if (confirm(`Are you sure you want to delete ${contactName}? This action cannot be undone.`)) {
      deleteContactMutation.mutate(contactId);
    }
  };

  const handleViewDetails = (contactId: string) => {
    const contact = leads.find(l => l.id === contactId);
    if (!contact) return;
    
    setContactDetailsModal({ isOpen: true, contact });
  };

  const handleEditStatus = (contactId: string) => {
    const contact = leads.find(l => l.id === contactId);
    if (!contact) return;
    
    setEditStatusModal({ isOpen: true, contact });
  };

  const handleSetFollowUp = (contact: Contact) => {
    setFollowUpModal({ isOpen: true, contact });
  };

  const handleFollowUpSubmit = (date: Date | undefined) => {
    if (!followUpModal.contact) return;
    
    updateFollowUpDateMutation.mutate({
      contactId: followUpModal.contact.id,
      followUpDate: date || null
    }, {
      onSuccess: () => {
        setFollowUpModal({ isOpen: false });
      }
    });
  };

  const handleStatusChange = (contactId: string, newStatus: string) => {
    updateStatusMutation.mutate({
      contactId,
      status: newStatus
    });
  };

  const handleUpdateLead = async (contactId: string, updates: Partial<Contact>) => {
    try {
      await apiRequest('PATCH', `/api/contacts/${contactId}`, updates);
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contactId}`] });
      toast({
        title: "Lead Updated",
        description: "Lead has been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error updating lead",
        description: error instanceof Error ? error.message : "Failed to update lead",
        variant: "destructive",
      });
    }
  };


  return (
    <PageLayout className={cn(isSelectionMode && "pb-20")}>
      <PageHeader 
        title={terminology?.leadsLabel || "Leads"} 
        description="Manage and track potential customers and sales opportunities"
        icon={<Users className="h-6 w-6" />}
        actions={
          <Button onClick={handleAddLead} data-testid="button-add-lead">
            <Plus className="h-4 w-4 mr-2" />
            Add {terminology?.leadLabel || "Lead"}
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${(terminology?.leadsLabel || "leads").toLowerCase()} by name, email, phone, or source...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              data-testid="input-lead-search"
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
            {(["all", "new", "contacted", "scheduled", "disqualified"] as const).map((status) => (
              <Badge
                key={status}
                variant={filterStatus === status ? "default" : "outline"}
                className="cursor-pointer hover-elevate"
                onClick={() => setFilterStatus(status)}
                data-testid={`filter-${status}`}
              >
                {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)} {statusCounts[status] !== undefined ? `(${statusCounts[status]})` : ''}
              </Badge>
            ))}
          </div>
        </div>

        <FilterPanel
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          statusOptions={[
            { value: "new", label: "New" },
            { value: "contacted", label: "Contacted" },
            { value: "scheduled", label: "Scheduled" },
            { value: "disqualified", label: "Disqualified" }
          ]}
          userOptions={usersData?.map(u => ({ value: u.id, label: u.fullName })) || []}
          dateLabel="Created Date"
        />
      </div>


      {/* Pagination Info */}
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
          {/* Initial loading state */}
          {leadsLoading && Array.from({ length: 6 }, (_, i) => (
            <LeadCardSkeleton key={`skeleton-${i}`} />
          ))}
          
          {/* Actual leads */}
          {!leadsLoading && leads.map((lead) => (
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
        />
      )}

      {/* Load More Button */}
      {hasNextPage && !leadsLoading && (
        <div className="flex justify-center mt-8">
          <Button 
            onClick={() => fetchNextPage()} 
            disabled={isFetchingNextPage}
            variant="outline"
            data-testid="button-load-more-leads"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              `Load More ${terminology?.leadsLabel || "Leads"}`
            )}
          </Button>
        </div>
      )}
      
      {/* Error state */}
      {leadsError && !leadsLoading && (
        <EmptyState
          icon={AlertCircle}
          title="Failed to load leads"
          description="There was a problem loading your leads. Please try refreshing the page."
        />
      )}

      {/* Empty state */}
      {leads.length === 0 && !leadsLoading && !leadsError && (
        searchQuery || filterStatus !== 'all' ? (
          <EmptyState
            icon={Filter}
            title="No leads match your filters"
            description="Try adjusting your search criteria or filters to find more leads."
            tips={[
              "Clear some filters to broaden your search",
              "Check your search term for typos",
              "Try searching by customer name, email, or phone number"
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
              "Connect Zapier to automatically create leads from form submissions"
            ]}
            ctaLabel="Add Your First Lead"
            onCtaClick={handleAddLead}
            ctaTestId="button-add-first-lead"
          />
        )
      )}


      {/* Texting Modal */}
      <TextingModal
        isOpen={textingModal.isOpen}
        onClose={closeTextingModal}
        recipientName={textingModal.lead?.name || ''}
        recipientPhone={(textingModal.lead?.phones && textingModal.lead.phones.length > 0) ? textingModal.lead.phones[0] : ''}
        companyName="Elmar HVAC" // TODO: Get from tenant context when auth is implemented
        leadId={textingModal.lead?.id}
      />

      {/* Email Composer Modal */}
      <EmailComposerModal
        isOpen={emailModal.isOpen}
        onClose={closeEmailModal}
        recipientName={emailModal.lead?.name || ''}
        recipientEmail={(emailModal.lead?.emails && emailModal.lead.emails.length > 0) ? emailModal.lead.emails[0] : ''}
        companyName="Elmar HVAC" // TODO: Get from tenant context when auth is implemented
        leadId={emailModal.lead?.id}
      />

      {/* Local Scheduling Modal */}
      <LocalSchedulingModal
        isOpen={schedulingModal.isOpen}
        onClose={closeSchedulingModal}
        lead={schedulingModal.lead || null}
        onScheduled={(scheduledLead) => {
          closeSchedulingModal();
          // The leads list will be automatically refreshed by the modal's success handler
        }}
      />

      {/* Add Lead Modal */}
      <Dialog open={addContactModal} onOpenChange={setAddContactModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4" data-testid="dialog-add-lead">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add Lead
            </DialogTitle>
            <DialogDescription>
              Enter the lead's contact information and details to add them to your CRM system.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="manual" data-testid="tab-manual">Manual Entry</TabsTrigger>
              <TabsTrigger value="csv" data-testid="tab-csv">CSV Import</TabsTrigger>
              <TabsTrigger value="google-sheets" data-testid="tab-google-sheets">Google Sheets</TabsTrigger>
            </TabsList>
            
            <TabsContent value="manual" className="space-y-4 mt-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleManualSubmit)} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter lead name" {...field} data-testid="input-lead-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="Enter email address" {...field} data-testid="input-lead-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter phone number" {...field} data-testid="input-lead-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="source"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Source</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Website, Referral" {...field} data-testid="input-lead-source" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <AddressAutocomplete
                            endpoint="/api/places"
                            value={field.value || ''}
                            onChange={field.onChange}
                            onAddressSelect={(formatted) => field.onChange(formatted)}
                            placeholder="Enter full address"
                            data-testid="input-lead-address"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="followUpDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Follow-up Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-follow-up-date"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {field.value ? format(field.value, "PPP") : "Pick a date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => date < new Date("1900-01-01")}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Tracking Information Section */}
                  <div className="border-t pt-4 mt-6">
                    <h3 className="text-sm font-medium mb-4">Tracking Information (Optional)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="pageUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Page URL</FormLabel>
                            <FormControl>
                              <Input placeholder="https://yoursite.com/landing-page" {...field} data-testid="input-lead-page-url" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="utmSource"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UTM Source</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., google, facebook" {...field} data-testid="input-lead-utm-source" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="utmMedium"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UTM Medium</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., cpc, email, social" {...field} data-testid="input-lead-utm-medium" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="utmCampaign"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UTM Campaign</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., summer_sale_2024" {...field} data-testid="input-lead-utm-campaign" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="utmTerm"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UTM Term</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., hvac repair" {...field} data-testid="input-lead-utm-term" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name="utmContent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UTM Content</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., banner_ad_1" {...field} data-testid="input-lead-utm-content" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Enter any additional notes..." 
                            className="min-h-[80px]" 
                            {...field} 
                            data-testid="textarea-lead-notes"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="tags"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags</FormLabel>
                        <FormControl>
                          <TagManager
                            tags={field.value || []}
                            onChange={field.onChange}
                            placeholder="Add tag..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="flex justify-end gap-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setAddContactModal(false)}
                      data-testid="button-cancel-lead"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={createContactMutation.isPending}
                      data-testid="button-create-lead"
                    >
                      {createContactMutation.isPending ? "Creating..." : "Create Lead"}
                    </Button>
                  </div>
                </form>
              </Form>
            </TabsContent>
            
            <TabsContent value="csv" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <p className="mb-4">Upload a CSV file to import multiple leads at once. First download the template to see the required format.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        onClick={handleDownloadTemplate}
                        disabled={csvUploadMutation.isPending}
                        data-testid="button-download-template"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download Template
                      </Button>
                      <Button 
                        onClick={handleUploadClick}
                        disabled={csvUploadMutation.isPending}
                        data-testid="button-upload-csv"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {csvUploadMutation.isPending ? "Uploading..." : "Upload CSV"}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    <div className="font-medium mb-2">Required columns:</div>
                    <ul className="space-y-1">
                      <li>• <span className="font-medium">name</span> (required)</li>
                      <li>• email, phone, address (optional)</li>
                      <li>• source, notes (optional)</li>
                      <li>• followUpDate (optional, YYYY-MM-DD)</li>
                    </ul>
                  </div>
                </div>
                
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  data-testid="input-csv-file"
                />
                
                <div className="flex justify-end">
                  <Button 
                    variant="outline" 
                    onClick={() => setAddContactModal(false)}
                    data-testid="button-cancel-csv"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="google-sheets" className="mt-4">
              <GoogleSheetsImportTab
                onImportSuccess={() => {
                  setAddContactModal(false);
                  queryClient.invalidateQueries({ queryKey: ["/api/contacts/paginated"] });
                }}
                onCancel={() => setAddContactModal(false)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Contact Details Modal with Activities */}
      <Dialog open={contactDetailsModal.isOpen} onOpenChange={(open) => setContactDetailsModal({ isOpen: open })}>
        <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-2 sm:mx-4">
          <DialogHeader>
            <DialogTitle>
              {contactDetailsModal.contact?.name} - Lead Details
            </DialogTitle>
            <DialogDescription>
              View detailed information and activity history for this lead.
            </DialogDescription>
          </DialogHeader>
          
          {contactDetailsModal.contact && (
            <div className="flex flex-col gap-6">
              {/* Contact Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <strong>Name:</strong> {contactDetailsModal.contact.name}
                  </div>
                  {contactDetailsModal.contact.emails && contactDetailsModal.contact.emails.length > 0 && (
                    <div>
                      <strong>Email:</strong> {contactDetailsModal.contact.emails[0]}
                    </div>
                  )}
                  {contactDetailsModal.contact.phones && contactDetailsModal.contact.phones.length > 0 && (
                    <div>
                      <strong>Phone:</strong> {contactDetailsModal.contact.phones[0]}
                    </div>
                  )}
                  {contactDetailsModal.contact.address && (
                    <div>
                      <strong>Address:</strong> {contactDetailsModal.contact.address}
                    </div>
                  )}
                  {contactDetailsModal.contact.source && (
                    <div>
                      <strong>Source:</strong> {contactDetailsModal.contact.source}
                    </div>
                  )}
                  {contactDetailsModal.contact.notes && (
                    <div>
                      <strong>Notes:</strong> 
                      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                        {contactDetailsModal.contact.notes}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Lead Submission History */}
              <Card>
                <CardHeader>
                  <CardTitle>Submission History</CardTitle>
                </CardHeader>
                <CardContent>
                  <LeadSubmissionHistory contactId={contactDetailsModal.contact.id} />
                </CardContent>
              </Card>

              {/* Activity History */}
              <ActivityList
                leadId={contactDetailsModal.contact.id}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Contact Modal */}
      <Dialog open={editContactModal.isOpen} onOpenChange={(open) => setEditContactModal({ isOpen: open })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
          <DialogHeader>
            <DialogTitle>Edit Lead - {editContactModal.contact?.name}</DialogTitle>
            <DialogDescription>
              Update the lead's contact information and details.
            </DialogDescription>
          </DialogHeader>
          
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEditSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter lead name" {...field} data-testid="input-edit-lead-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Enter email address" {...field} data-testid="input-edit-lead-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter phone number" {...field} data-testid="input-edit-lead-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={editForm.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source</FormLabel>
                      <FormControl>
                        <Input placeholder="How did they find you?" {...field} data-testid="input-edit-lead-source" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={editForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <AddressAutocomplete
                        endpoint="/api/places"
                        value={field.value || ''}
                        onChange={field.onChange}
                        onAddressSelect={(formatted) => field.onChange(formatted)}
                        placeholder="Enter full address"
                        data-testid="input-edit-lead-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Tracking Information Section */}
              <div className="border-t pt-4 mt-6">
                <h3 className="text-sm font-medium mb-4">Tracking Information (Optional)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="pageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Page URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://yoursite.com/landing-page" {...field} data-testid="input-edit-lead-page-url" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={editForm.control}
                    name="utmSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UTM Source</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., google, facebook" {...field} data-testid="input-edit-lead-utm-source" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={editForm.control}
                    name="utmMedium"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UTM Medium</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., cpc, email, social" {...field} data-testid="input-edit-lead-utm-medium" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={editForm.control}
                    name="utmCampaign"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UTM Campaign</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., summer_sale_2024" {...field} data-testid="input-edit-lead-utm-campaign" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={editForm.control}
                    name="utmTerm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UTM Term</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., hvac repair" {...field} data-testid="input-edit-lead-utm-term" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={editForm.control}
                    name="utmContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>UTM Content</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., banner_ad_1" {...field} data-testid="input-edit-lead-utm-content" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={editForm.control}
                name="followUpDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Follow-up Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="button-edit-lead-followup-date"
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date < new Date(new Date().setHours(0, 0, 0, 0))
                          }
                          initialFocus
                          data-testid="calendar-edit-lead-followup"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any notes about this lead..."
                        className="min-h-[100px]"
                        {...field}
                        data-testid="textarea-edit-lead-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={editForm.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <TagManager
                        tags={field.value || []}
                        onChange={field.onChange}
                        placeholder="Add tag..."
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end space-x-2 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setEditContactModal({ isOpen: false })}
                  data-testid="button-cancel-edit-lead"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={updateContactMutation.isPending}
                  data-testid="button-save-edit-lead"
                >
                  {updateContactMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Status Modal */}
      <Dialog open={editStatusModal.isOpen} onOpenChange={(open) => setEditStatusModal(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Lead Status</DialogTitle>
            <DialogDescription>
              Change the status of {editStatusModal.contact?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['new', 'contacted', 'scheduled', 'disqualified'] as const).map((status) => (
                <Button
                  key={status}
                  variant={editStatusModal.contact?.status === status ? "default" : "outline"}
                  onClick={() => {
                    if (editStatusModal.contact) {
                      updateStatusMutation.mutate({
                        contactId: editStatusModal.contact.id,
                        status: status
                      });
                    }
                  }}
                  disabled={updateStatusMutation.isPending}
                  data-testid={`button-status-${status}`}
                  className="justify-start"
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Follow-Up Date Modal */}
      <FollowUpDateModal
        isOpen={followUpModal.isOpen}
        onClose={() => setFollowUpModal({ isOpen: false })}
        onSave={handleFollowUpSubmit}
        entityName={followUpModal.contact?.name}
        defaultDate={followUpModal.contact?.followUpDate ? new Date(followUpModal.contact.followUpDate) : undefined}
        isSaving={updateFollowUpDateMutation.isPending}
      />

      {/* Bulk Action Toolbar */}
      <BulkActionToolbar
        onDelete={async (ids) => {
          // Delete all selected contacts
          await Promise.all(ids.map(id => apiRequest("DELETE", `/api/contacts/${id}`)));
          queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
          queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
          toast({ title: `Deleted ${ids.length} lead(s)` });
        }}
        onStatusChange={async (ids, status) => {
          // Update status for all selected contacts
          await Promise.all(ids.map(id => 
            apiRequest("PATCH", `/api/contacts/${id}/status`, { status })
          ));
          queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
          queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
          queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
          toast({ title: `Updated ${ids.length} lead(s) to ${status}` });
        }}
        onExport={async (ids) => {
          // Export selected contacts
          const selectedContacts = leads.filter(contact => ids.includes(contact.id));
          const csvContent = [
            ['Name', 'Email', 'Phone', 'Address', 'Source', 'Status', 'Priority'].join(','),
            ...selectedContacts.map(contact => [
              contact.name || '',
              (contact.emails && contact.emails.length > 0) ? contact.emails[0] : '',
              (contact.phones && contact.phones.length > 0) ? contact.phones[0] : '',
              contact.address || '',
              contact.source || '',
              contact.status || '',
              contact.priority || ''
            ].join(','))
          ].join('\n');
          
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `leads-export-${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: `Exported ${ids.length} lead(s)` });
        }}
        statusOptions={[
          { value: 'new', label: 'New' },
          { value: 'contacted', label: 'Contacted' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'disqualified', label: 'Disqualified' }
        ]}
      />
    </PageLayout>
  );
}