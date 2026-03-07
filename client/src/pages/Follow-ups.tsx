/**
 * Follow-ups page.
 *
 * Data merge strategy: Fetches leads (/api/contacts/follow-ups) and estimates
 * (/api/estimates/follow-ups) separately, then merges them into a single
 * FollowUpItem[] array sorted by followUpDate ascending. This happens client-side
 * via useMemo so that re-sorts are free and both queries remain independently
 * cacheable. The EditLeadDialog component owns the lead-edit form and mutation.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useContactMutations } from "@/hooks/useContactMutations";
import { format } from "date-fns";
import { Calendar, Clock, Filter } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EditLeadDialog } from "@/components/EditLeadDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextingModal } from "@/components/TextingModal";
import { EmailComposerModal } from "@/components/EmailComposerModal";
import { HousecallProSchedulingModal } from "@/components/HousecallProSchedulingModal";
import { FollowUpDateModal } from "@/components/FollowUpDateModal";
import { FollowUpCard, FollowUpItem, getFollowUpStatus } from "@/components/FollowUpCard";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import type { Contact, Estimate } from "@shared/schema";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { dialPhone } from "@/lib/dialPhone";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function FollowUps() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: currentUserData } = useCurrentUser();
  const contractorName = currentUserData?.user?.contractorName || '';

  const [filterView, setFilterView] = useState<string>("all");
  const [textingModal, setTextingModal] = useState<{
    isOpen: boolean;
    item?: FollowUpItem;
  }>({ isOpen: false });

  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    item?: FollowUpItem;
  }>({ isOpen: false });
  
  const [schedulingModal, setSchedulingModal] = useState<{
    isOpen: boolean;
    item?: FollowUpItem;
  }>({ isOpen: false });

  const [editLeadModal, setEditLeadModal] = useState<{
    isOpen: boolean;
    lead?: Contact;
  }>({ isOpen: false });

  const [followUpModal, setFollowUpModal] = useState<{
    isOpen: boolean;
    item?: FollowUpItem;
  }>({ isOpen: false });

  const { data: leads = [], isLoading: leadsLoading } = useQuery<Contact[]>({
    queryKey: ['/api/contacts/follow-ups'],
  });

  const { data: estimates = [], isLoading: estimatesLoading } = useQuery<Estimate[]>({
    queryKey: ['/api/estimates/follow-ups'],
  });

  const isLoading = leadsLoading || estimatesLoading;

  // Merge leads and estimates into a unified follow-up list (memoized)
  const followUpItems = useMemo(() => {
    const items: FollowUpItem[] = [];

    // Add leads with follow-up dates
    leads
      .filter(lead => lead.followUpDate)
      .forEach(lead => {
        const followUpDateStr = typeof lead.followUpDate === 'string' ? lead.followUpDate : lead.followUpDate!.toISOString();
        const followUpDateObj = new Date(followUpDateStr);
        // Contact has emails[] and phones[] arrays, use first element
        const leadEmail = (lead.emails && lead.emails.length > 0) ? lead.emails[0] : undefined;
        const leadPhone = (lead.phones && lead.phones.length > 0) ? lead.phones[0] : undefined;
        
        items.push({
          id: lead.id,
          type: 'lead',
          name: lead.name,
          email: leadEmail,
          phone: leadPhone,
          address: lead.address || undefined,
          value: undefined,
          notes: lead.notes || undefined,
          source: lead.source || undefined,
          followUpDate: followUpDateStr,
          followUpReason: `Follow up on ${format(followUpDateObj, 'MMM d, yyyy')}`,
        });
      });

    // Add estimates that need follow-up
    estimates.forEach(estimate => {
      let followUpDate: string | null = null;
      let followUpReason: string = '';

      // Include estimates with valid_until dates (need follow-up before expiry)
      if (estimate.validUntil && estimate.status !== 'approved' && estimate.status !== 'rejected') {
        followUpDate = typeof estimate.validUntil === 'string' ? estimate.validUntil : estimate.validUntil.toISOString();
        followUpReason = `Estimate expires ${format(new Date(estimate.validUntil), 'MMM d')}`;
      }
      // Include estimates with scheduled start dates (upcoming work)
      else if (estimate.scheduledStart) {
        followUpDate = typeof estimate.scheduledStart === 'string' ? estimate.scheduledStart : estimate.scheduledStart.toISOString();
        followUpReason = `Work scheduled ${format(new Date(estimate.scheduledStart), 'MMM d')}`;
      }

      if (followUpDate) {
        items.push({
          id: estimate.id,
          type: 'estimate',
          name: estimate.title,
          email: undefined,
          phone: undefined,
          address: undefined,
          value: parseFloat(estimate.amount),
          notes: estimate.description || undefined,
          followUpDate,
          followUpReason,
          title: estimate.title,
          amount: estimate.amount,
          status: estimate.status,
        });
      }
    });

    // Sort by follow-up date (earliest first for past due, latest first for future)
    return items
      .sort((a, b) => {
        const dateA = new Date(a.followUpDate).getTime();
        const dateB = new Date(b.followUpDate).getTime();
        return dateA - dateB;
      })
      .filter(item => {
        const status = getFollowUpStatus(item.followUpDate);
        
        switch (filterView) {
          case "overdue":
            return status.label === "Overdue";
          case "today":
            return status.label === "Today";
          case "thisweek":
            return status.label === "This Week";
          case "upcoming":
            return status.label === "Upcoming";
          case "all":
          default:
            return true;
        }
      });
  }, [leads, estimates, filterView]);

  const handleContact = (item: FollowUpItem, method: 'phone' | 'email') => {
    console.log(`Contacting ${item.type} ${item.name} via ${method}`);
    
    if (method === 'phone') {
      if (item.phone) {
        dialPhone({ contactId: item.id, phone: item.phone, name: item.name });
      } else {
        toast({
          title: "No phone number",
          description: `${item.name} doesn't have a phone number on file.`,
          variant: "destructive",
        });
      }
    } else if (method === 'email') {
      if (item.email) {
        setEmailModal({ isOpen: true, item });
      } else {
        toast({
          title: "No email address",
          description: `${item.name} doesn't have an email address on file.`,
          variant: "destructive",
        });
      }
    }
  };

  const handleSendText = (item: FollowUpItem) => {
    if (!item.phone) {
      toast({
        title: "No phone number",
        description: `${item.name} doesn't have a phone number on file.`,
        variant: "destructive",
      });
      return;
    }
    setTextingModal({ 
      isOpen: true, 
      item: item
    });
  };

  const handleSchedule = (item: FollowUpItem) => {
    setSchedulingModal({ 
      isOpen: true, 
      item: item
    });
  };

  // Update lead follow-up date mutation
  const updateLeadFollowUpMutation = useMutation({
    mutationFn: async (data: { leadId: string; followUpDate: Date | null }) => {
      const response = await apiRequest('PATCH', `/api/contacts/${data.leadId}/follow-up`, { 
        followUpDate: data.followUpDate ? data.followUpDate.toISOString() : null 
      });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Follow-Up Date Updated",
        description: "Follow-up date has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/follow-ups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Follow-Up Date",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  // Update estimate follow-up date mutation
  const updateEstimateFollowUpMutation = useMutation({
    mutationFn: async ({ estimateId, followUpDate }: { estimateId: string; followUpDate: Date | null }) => {
      return apiRequest('PATCH', `/api/estimates/${estimateId}/follow-up`, {
        followUpDate: followUpDate ? followUpDate.toISOString() : null
      });
    },
    onSuccess: () => {
      toast({
        title: "Follow-up date updated",
        description: "The follow-up date has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates/follow-ups'] });
    },
    onError: (error) => {
      toast({
        title: "Error updating follow-up date",
        description: error instanceof Error ? error.message : "Failed to update follow-up date. Please try again.",
        variant: "destructive",
      });
    },
  });

  const { deleteContact: deleteLeadMutation } = useContactMutations();

  const handleEdit = (item: FollowUpItem) => {
    if (item.type === 'lead') {
      const lead = leads.find(l => l.id === item.id);
      if (lead) {
        setEditLeadModal({ isOpen: true, lead });
      }
    } else {
      // Navigate to the Estimates page using SPA routing (no hard browser reload)
      setLocation('/estimates');
    }
  };

  const handleSetFollowUp = (item: FollowUpItem) => {
    setFollowUpModal({ isOpen: true, item });
  };

  const handleFollowUpSubmit = (date: Date | undefined) => {
    if (!followUpModal.item) return;
    
    if (followUpModal.item.type === 'lead') {
      updateLeadFollowUpMutation.mutate({
        leadId: followUpModal.item.id,
        followUpDate: date || null
      }, {
        onSuccess: () => {
          setFollowUpModal({ isOpen: false });
        }
      });
    } else {
      updateEstimateFollowUpMutation.mutate({
        estimateId: followUpModal.item.id,
        followUpDate: date || null,
      }, {
        onSuccess: () => {
          setFollowUpModal({ isOpen: false });
        }
      });
    }
  };

  const handleDelete = (item: FollowUpItem) => {
    if (item.type === 'lead') {
      if (confirm(`Are you sure you want to delete ${item.name}?`)) {
        deleteLeadMutation.mutate(item.id);
      }
    } else {
      toast({
        title: "Cannot delete estimate",
        description: "Please delete estimates from the Estimates page.",
        variant: "destructive",
      });
    }
  };

  return (
    <PageLayout>
      <PageHeader
        title="Follow-ups"
        description="Leads and estimates that need follow-up, sorted by date"
        actions={
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Select value={filterView} onValueChange={setFilterView} data-testid="select-filter-view">
            <SelectTrigger className="w-full sm:w-[180px]">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <SelectValue placeholder="Filter view" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Follow-ups</SelectItem>
              <SelectItem value="overdue">Past Due</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="thisweek">This Week</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" data-testid="badge-total-followups">
            {followUpItems.length} follow-ups
          </Badge>
          </div>
        }
      />

      {isLoading ? (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-muted rounded w-1/3"></div>
              </CardHeader>
              <CardContent>
                <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-4 bg-muted rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : 
        followUpItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No follow-ups scheduled</h3>
            <p className="text-muted-foreground">
              You're all caught up! No leads or estimates need follow-up right now.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {followUpItems.map((item) => (
            <FollowUpCard
              key={`${item.type}-${item.id}`}
              item={item}
              onSetFollowUp={handleSetFollowUp}
              onContact={handleContact}
              onTextContact={handleSendText}
              onSchedule={handleSchedule}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Texting Modal */}
      {textingModal.item && (
        <TextingModal
          isOpen={textingModal.isOpen}
          onClose={() => setTextingModal({ isOpen: false })}
          recipientName={textingModal.item.name}
          recipientPhone={textingModal.item.phone || ""}
          recipientEmail={textingModal.item.email}
          leadId={textingModal.item.type === 'lead' ? textingModal.item.id : undefined}
          estimateId={textingModal.item.type === 'estimate' ? textingModal.item.id : undefined}
        />
      )}

      {/* Email Composer Modal */}
      {emailModal.item && (
        <EmailComposerModal
          isOpen={emailModal.isOpen}
          onClose={() => setEmailModal({ isOpen: false })}
          recipientName={emailModal.item.name}
          recipientEmail={emailModal.item.email || ''}
          companyName={contractorName}
          contactId={emailModal.item.type === 'lead' ? emailModal.item.id : undefined}
          estimateId={emailModal.item.type === 'estimate' ? emailModal.item.id : undefined}
        />
      )}

      {/* Housecall Pro Scheduling Modal */}
      {schedulingModal.item && (
        <HousecallProSchedulingModal
          isOpen={schedulingModal.isOpen}
          onClose={() => setSchedulingModal({ isOpen: false })}
          lead={schedulingModal.item ? {
            id: schedulingModal.item.id,
            name: schedulingModal.item.name,
            email: schedulingModal.item.email || null,
            phone: schedulingModal.item.phone || null,
            address: schedulingModal.item.address || null,
            value: schedulingModal.item.value ? schedulingModal.item.value.toString() : null,
            isScheduled: false,
            housecallProEstimateId: schedulingModal.item.type === 'estimate' ? schedulingModal.item.id : null,
          } : null}
          onScheduled={(_scheduledLead) => {
            setSchedulingModal({ isOpen: false });
            // The leads/estimates list will be automatically refreshed by the modal's success handler
          }}
        />
      )}

      {/* Edit Lead Modal — logic extracted to EditLeadDialog for maintainability */}
      <EditLeadDialog
        lead={editLeadModal.lead}
        open={editLeadModal.isOpen}
        onClose={() => setEditLeadModal({ isOpen: false })}
      />

      {/* Set Follow-Up Date Modal */}
      <FollowUpDateModal
        isOpen={followUpModal.isOpen}
        onClose={() => setFollowUpModal({ isOpen: false })}
        onSave={handleFollowUpSubmit}
        entityName={followUpModal.item?.name}
        defaultDate={followUpModal.item?.followUpDate ? new Date(followUpModal.item.followUpDate) : undefined}
        isSaving={updateLeadFollowUpMutation.isPending || updateEstimateFollowUpMutation.isPending}
        size="compact"
      />

    </PageLayout>
  );
}