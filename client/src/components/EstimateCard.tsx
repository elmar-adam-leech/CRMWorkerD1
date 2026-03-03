import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./StatusBadge";
import { CustomerBadge } from "./CustomerBadge";
import { Calendar, User, FileText, MoreHorizontal, Send, Edit, Briefcase, ExternalLink, Phone, Mail, MessageSquare, CalendarClock, Trash2, Tag } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CommunicationActionButtons } from "./CommunicationActionButtons";
import { ViewDetailsButton } from "./ViewDetailsButton";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { InlineEdit } from "./InlineEdit";
import { TagsDialog } from "./TagsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getInitials, formatCurrency } from "@/lib/utils";

type EstimateCardProps = {
  estimate: {
    id: string;
    title: string;
    contactId: string;
    status: "draft" | "sent" | "pending" | "approved" | "rejected" | "cancelled";
    value: number;
    createdDate: string;
    expiryDate: string;
    description: string;
    priority: "low" | "medium" | "high";
    externalSource?: string;
    externalId?: string;
  };
  onSend?: (estimateId: string) => void;
  onViewDetails?: (estimateId: string) => void;
  onConvertToJob?: (estimateId: string) => void;
  onEdit?: (estimateId: string) => void;
  onContact?: (estimateId: string, method: "phone" | "email") => void;
  onSendText?: (estimate: any) => void;
  onSendEmail?: (estimate: any) => void;
  onSetFollowUp?: (estimate: any) => void;
  onDelete?: (estimateId: string) => void;
  onUpdateEstimate?: (estimateId: string, updates: Partial<any>) => Promise<void>;
  selectable?: boolean;
};

export function EstimateCard({ estimate, onSend, onViewDetails, onConvertToJob, onEdit, onContact, onSendText, onSendEmail, onSetFollowUp, onDelete, onUpdateEstimate, selectable = false }: EstimateCardProps) {
  const { toggleItem, isSelected } = useBulkSelection();
  const { toast } = useToast();
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  
  // Fetch contact data using contactId
  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: [`/api/contacts/${estimate.contactId}`],
    enabled: !!estimate.contactId,
  });

  // Check if this is a Housecall Pro estimate (read-only for tracking purposes)
  const isHousecallProEstimate = estimate.externalSource === 'housecall-pro';

  // Handle contact tags update
  const handleUpdateContactTags = async (newTags: string[]) => {
    if (!contact) return;
    
    try {
      await apiRequest('PATCH', `/api/contacts/${contact.id}`, { tags: newTags });
      queryClient.invalidateQueries({ queryKey: [`/api/contacts/${contact.id}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      toast({
        title: "Tags updated",
        description: "Contact tags have been updated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error updating tags",
        description: error instanceof Error ? error.message : "Failed to update tags",
        variant: "destructive",
      });
    }
  };

  const handleContact = (method: "phone" | "email") => {
    console.log(`Contacting customer for estimate ${estimate.title} via ${method}`);
    onContact?.(estimate.id, method);
  };
  const handleSend = () => {
    console.log(`Sending estimate ${estimate.title}`);
    onSend?.(estimate.id);
  };

  const handleViewDetails = () => {
    console.log(`Viewing details for estimate ${estimate.title}`);
    onViewDetails?.(estimate.id);
  };

  const handleConvert = () => {
    console.log(`Converting estimate ${estimate.title} to job`);
    onConvertToJob?.(estimate.id);
  };

  const handleEdit = () => {
    console.log(`Editing estimate ${estimate.title}`);
    onEdit?.(estimate.id);
  };

  const handleDelete = () => {
    console.log(`Deleting estimate ${estimate.title}`);
    onDelete?.(estimate.id);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "border-l-4 border-l-destructive";
      case "medium":
        return "border-l-4 border-l-chart-3";
      default:
        return "border-l-4 border-l-chart-2";
    }
  };

  // Determine border color: green if contact has jobs, otherwise priority-based
  const getBorderClass = () => {
    if (contact?.hasJobs) {
      return "border-l-4 border-l-green-600";
    }
    return getPriorityColor(estimate.priority);
  };

  return (
    <div className={`${getBorderClass()} rounded-xl`}>
      <Card 
        className="hover-elevate border-l-0"
        data-testid={`card-estimate-${estimate.id}`}
      >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        {selectable && (
          <Checkbox
            checked={isSelected(estimate.id)}
            onCheckedChange={() => toggleItem(estimate.id, "estimates")}
            data-testid={`checkbox-estimate-${estimate.id}`}
            className="shrink-0 mt-1"
          />
        )}
        <div className="space-y-1 flex-1 min-w-0">
          <CardTitle className="text-base font-medium line-clamp-2">{estimate.title}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={estimate.status} />
            <CustomerBadge hasJobs={contact?.hasJobs} />
            {isHousecallProEstimate && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Housecall Pro
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid={`button-estimate-menu-${estimate.id}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <ViewDetailsButton 
              onViewDetails={handleViewDetails} 
              testId={`menu-view-estimate-${estimate.id}`}
            />
            {!isHousecallProEstimate && (
              <DropdownMenuItem onClick={handleEdit} data-testid={`menu-edit-estimate-${estimate.id}`}>
                <Edit className="h-4 w-4 mr-2" />
                Edit Estimate
              </DropdownMenuItem>
            )}
            {isHousecallProEstimate && (
              <DropdownMenuItem disabled className="text-muted-foreground">
                <Edit className="h-4 w-4 mr-2" />
                Tracking Only - Edit in Housecall Pro
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onSetFollowUp?.(estimate)} data-testid={`menu-set-followup-estimate-${estimate.id}`}>
              <CalendarClock className="h-4 w-4 mr-2" />
              Set Follow Up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTagsDialogOpen(true)} data-testid={`menu-add-tags-${estimate.id}`}>
              <Tag className="h-4 w-4 mr-2" />
              Add Tags
            </DropdownMenuItem>
            {!isHousecallProEstimate && (
              <DropdownMenuItem 
                onClick={handleDelete} 
                className="text-destructive focus:text-destructive"
                data-testid={`menu-delete-estimate-${estimate.id}`}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Estimate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-3">
        {contactLoading ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="h-4 bg-muted rounded animate-pulse" />
            <div className="h-4 bg-muted rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">
                    {contact ? getInitials(contact.name) : '?'}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground">{contact?.name || 'Unknown Contact'}</span>
              </div>
              <div className="flex items-center gap-1 text-sm font-medium">
                {onUpdateEstimate && !isHousecallProEstimate ? (
                  <InlineEdit
                    value={estimate.value}
                    onSave={async (newValue) => {
                      await onUpdateEstimate(estimate.id, { value: Number(newValue) });
                    }}
                    type="number"
                    prefix="$"
                    showEditIcon
                    displayClassName="font-medium"
                  />
                ) : (
                  formatCurrency(estimate.value)
                )}
              </div>
            </div>
            
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">{contact?.emails?.[0] || 'No email'}</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Phone className="h-4 w-4 shrink-0" />
                <span className="truncate min-w-0">{contact?.phones?.[0] || 'No phone'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Created: {estimate.createdDate}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Expires: {estimate.expiryDate}</span>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5" />
                <span className="line-clamp-2">{estimate.description}</span>
              </div>
            </div>
            
            <CommunicationActionButtons
              recipientName={contact?.name || ''}
              recipientEmail={contact?.emails?.[0] || ''}
              recipientPhone={contact?.phones?.[0] || ''}
              onSendEmail={() => onSendEmail?.(estimate)}
              onSendText={() => onSendText?.(estimate)}
              estimateId={estimate.id}
            />
            
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleViewDetails}
                data-testid={`button-view-estimate-${estimate.id}`}
              >
                View Details
              </Button>
            </div>
            
            {/* Tags Display */}
            {contact?.tags && contact.tags.length > 0 && (
              <div className="pt-2 border-t">
                <div className="flex flex-wrap gap-2">
                  {contact.tags.map((tag: string) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-xs"
                      data-testid={`badge-estimate-tag-${tag}`}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
      
      {/* Tags Dialog */}
      {contact && (
        <TagsDialog
          open={tagsDialogOpen}
          onOpenChange={setTagsDialogOpen}
          tags={contact.tags || []}
          onSave={handleUpdateContactTags}
          entityName={contact.name}
          entityType="estimate"
        />
      )}
    </Card>
    </div>
  );
}