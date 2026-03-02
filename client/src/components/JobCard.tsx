import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./StatusBadge";
import { Calendar, User, Clock, MoreHorizontal, ExternalLink, Phone, Mail, Edit, Settings, Tag } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ViewDetailsButton } from "./ViewDetailsButton";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { InlineEdit } from "./InlineEdit";
import { TagsDialog } from "./TagsDialog";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Contact } from "@shared/schema";

type JobCardProps = {
  job: {
    id: string;
    title: string;
    contactId: string;
    status: "scheduled" | "in_progress" | "completed" | "cancelled";
    value: number;
    scheduledDate: string;
    type: string;
    priority: "low" | "medium" | "high";
    estimatedHours: number;
    externalSource?: string; // 'housecall-pro' for tracking-only jobs
    estimateId?: string; // Link back to original estimate
  };
  onStatusChange?: (jobId: string, newStatus: string) => void;
  onViewDetails?: (jobId: string) => void;
  onEdit?: (jobId: string) => void;
  onEditStatus?: (jobId: string) => void;
  onUpdateJob?: (jobId: string, updates: Partial<any>) => Promise<void>;
  selectable?: boolean;
};

export function JobCard({ job, onStatusChange, onViewDetails, onEdit, onEditStatus, onUpdateJob, selectable = false }: JobCardProps) {
  const { toggleItem, isSelected } = useBulkSelection();
  const { toast } = useToast();
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  
  // Fetch contact data using contactId
  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: [`/api/contacts/${job.contactId}`],
    enabled: !!job.contactId,
  });

  const isHousecallProJob = job.externalSource === 'housecall-pro';
  
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
  

  const handleViewDetails = () => {
    console.log(`Viewing details for job ${job.title}`);
    onViewDetails?.(job.id);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
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

  return (
    <Card 
      className={`hover-elevate ${getPriorityColor(job.priority)}`}
      data-testid={`card-job-${job.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        {selectable && (
          <Checkbox
            checked={isSelected(job.id)}
            onCheckedChange={() => toggleItem(job.id, "jobs")}
            data-testid={`checkbox-job-${job.id}`}
            className="shrink-0 mt-1"
          />
        )}
        <div className="space-y-1 flex-1 min-w-0">
          <CardTitle className="text-base font-medium line-clamp-2">{job.title}</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={job.status} />
            <span className="text-xs text-muted-foreground">{job.type}</span>
            {isHousecallProJob && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                Housecall Pro
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-job-menu-${job.id}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <ViewDetailsButton 
              onViewDetails={() => onViewDetails?.(job.id)} 
              testId={`menu-view-details-${job.id}`}
            />
            <DropdownMenuSeparator />
            {!isHousecallProJob && (
              <>
                <DropdownMenuItem onClick={() => onEdit?.(job.id)} data-testid={`menu-edit-job-${job.id}`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Job
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditStatus?.(job.id)} data-testid={`menu-edit-status-${job.id}`}>
                  <Settings className="h-4 w-4 mr-2" />
                  Edit Status
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={() => setTagsDialogOpen(true)} data-testid={`menu-add-tags-${job.id}`}>
              <Tag className="h-4 w-4 mr-2" />
              Add Tags
            </DropdownMenuItem>
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
                {onUpdateJob && !isHousecallProJob ? (
                  <InlineEdit
                    value={job.value}
                    onSave={async (newValue) => {
                      await onUpdateJob(job.id, { value: Number(newValue) });
                    }}
                    type="number"
                    prefix="$"
                    showEditIcon
                    displayClassName="font-medium"
                  />
                ) : (
                  formatCurrency(job.value)
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
                <span>{job.scheduledDate}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>{job.estimatedHours}h estimated</span>
              </div>
            </div>
            
            {isHousecallProJob && (
              <div className="text-xs text-muted-foreground bg-muted p-2 rounded border-l-4 border-l-blue-500">
                <span className="font-medium">Tracking Only:</span> This job was automatically synced from Housecall Pro for lead value tracking. Status updates are managed in Housecall Pro.
              </div>
            )}
            
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={handleViewDetails}
                data-testid={`button-view-job-${job.id}`}
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
                      data-testid={`badge-job-tag-${tag}`}
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
          entityType="job"
        />
      )}
    </Card>
  );
}