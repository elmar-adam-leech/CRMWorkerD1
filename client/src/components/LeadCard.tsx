import { memo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./StatusBadge";
import { CustomerBadge } from "./CustomerBadge";
import { Phone, Mail, MapPin, Calendar, MoreHorizontal, Edit, Trash2, Settings, CalendarClock, Tag } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CommunicationActionButtons } from "./CommunicationActionButtons";
import { ViewDetailsButton } from "./ViewDetailsButton";
import { useBulkSelection } from "@/contexts/BulkSelectionContext";
import { InlineEdit } from "./InlineEdit";
import { TagsDialog } from "./TagsDialog";
import { getInitials } from "@/lib/utils";

type LeadCardProps = {
  lead: any; // Accept both real Lead type and mock data structure
  onContact?: (leadId: string, method: "phone" | "email") => void;
  onSchedule?: (leadId: string) => void;
  onSendText?: (lead: any) => void;
  onSendEmail?: (lead: any) => void;
  onEdit?: (leadId: string) => void;
  onDelete?: (leadId: string) => void;
  onEditStatus?: (leadId: string) => void;
  onViewDetails?: (leadId: string) => void;
  onSetFollowUp?: (lead: any) => void;
  onUpdateLead?: (leadId: string, updates: Partial<any>) => Promise<void>;
  selectable?: boolean;
};

export const LeadCard = memo(function LeadCard({ lead, onContact: _onContact, onSchedule, onSendText, onSendEmail, onEdit, onDelete, onEditStatus, onViewDetails, onSetFollowUp, onUpdateLead, selectable = false }: LeadCardProps) {
  const { toggleItem, isSelected } = useBulkSelection();
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  
  // Handle both real and mock data structures
  const leadName = lead.name || lead.customerName || '';
  const leadEmail = (lead.emails && lead.emails.length > 0) ? lead.emails[0] : '';
  const leadPhone = (lead.phones && lead.phones.length > 0) ? lead.phones[0] : '';
  const leadAddress = lead.address || '';
  const leadSource = lead.source || '';
  const leadStatus = lead.status || 'new';
  const leadPriority = lead.priority || 'medium';
  const leadScheduledDate = lead.scheduledDate;
  const leadTags = lead.tags || [];

  const handleSchedule = () => {
    onSchedule?.(lead.id);
  };

  const getPriorityDotClass = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-destructive";
      case "medium":
        return "bg-chart-3";
      default:
        return "bg-chart-2";
    }
  };

  return (
    <div className={`${lead.hasJobs ? 'border-l-4 border-l-green-600' : ''} rounded-xl`}>
      <Card 
        className="hover-elevate border-l-0"
        data-testid={`card-lead-${lead.id}`}
      >
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {selectable && (
            <Checkbox
              checked={isSelected(lead.id)}
              onCheckedChange={() => toggleItem(lead.id, "leads")}
              data-testid={`checkbox-lead-${lead.id}`}
              className="shrink-0"
            />
          )}
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback>{getInitials(leadName)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {onUpdateLead ? (
              <div className="text-base font-medium">
                <InlineEdit
                  value={leadName}
                  onSave={async (newValue) => {
                    await onUpdateLead(lead.id, { name: newValue });
                  }}
                  placeholder="Lead name"
                  showEditIcon
                  displayClassName="font-medium"
                />
              </div>
            ) : (
              <CardTitle className="text-base font-medium truncate">{leadName}</CardTitle>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={leadStatus} />
              <CustomerBadge hasJobs={lead.hasJobs} />
              <div className={`w-2 h-2 rounded-full shrink-0 ${getPriorityDotClass(leadPriority)}`} title={`${leadPriority} priority`} />
              <span className="text-xs text-muted-foreground truncate">{leadSource}</span>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" data-testid={`button-lead-menu-${lead.id}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <ViewDetailsButton 
              onViewDetails={() => onViewDetails?.(lead.id)} 
              testId={`menu-view-details-${lead.id}`}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onSetFollowUp?.(lead)} data-testid={`menu-set-followup-${lead.id}`}>
              <CalendarClock className="h-4 w-4 mr-2" />
              Set Follow Up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit?.(lead.id)} data-testid={`menu-edit-lead-${lead.id}`}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Lead
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditStatus?.(lead.id)} data-testid={`menu-edit-status-${lead.id}`}>
              <Settings className="h-4 w-4 mr-2" />
              Edit Status
            </DropdownMenuItem>
            {onUpdateLead && (
              <DropdownMenuItem onClick={() => setTagsDialogOpen(true)} data-testid={`menu-add-tags-${lead.id}`}>
                <Tag className="h-4 w-4 mr-2" />
                Add Tags
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => onDelete?.(lead.id)} 
              className="text-destructive focus:text-destructive" 
              data-testid={`menu-delete-lead-${lead.id}`}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="h-4 w-4 shrink-0" />
            <span className="truncate min-w-0">{leadEmail || 'No email'}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Phone className="h-4 w-4 shrink-0" />
            <span className="truncate min-w-0">{leadPhone || 'No phone'}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 shrink-0" />
            <span className="truncate min-w-0">{leadAddress || 'No address'}</span>
          </div>
          {leadScheduledDate && (
            <div className="flex items-center gap-2 min-w-0">
              <Calendar className="h-4 w-4 shrink-0" />
              <span className="truncate min-w-0">Scheduled: {leadScheduledDate}</span>
            </div>
          )}
        </div>
        
        <CommunicationActionButtons
          recipientName={leadName}
          recipientEmail={leadEmail}
          recipientPhone={leadPhone}
          onSendEmail={() => onSendEmail?.(lead)}
          onSendText={() => onSendText?.(lead)}
          leadId={lead.id}
        />
        
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-none w-full sm:w-auto"
            onClick={handleSchedule}
            data-testid={`button-schedule-lead-${lead.id}`}
          >
            Schedule
          </Button>
        </div>
        
        {/* Customer Section - shown when lead is converted to customer */}
        {lead.hasJobs && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                Customer
              </Badge>
              <span className="text-muted-foreground text-xs">This lead has been converted to a customer</span>
            </div>
          </div>
        )}
        
        {/* Tags Display */}
        {leadTags.length > 0 && (
          <div className="pt-2 border-t">
            <div className="flex flex-wrap gap-2">
              {leadTags.map((tag: string) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs"
                  data-testid={`badge-lead-tag-${tag}`}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      
      {/* Tags Dialog */}
      {onUpdateLead && (
        <TagsDialog
          open={tagsDialogOpen}
          onOpenChange={setTagsDialogOpen}
          tags={leadTags}
          onSave={async (newTags) => {
            await onUpdateLead(lead.id, { tags: newTags });
          }}
          entityName={leadName}
          entityType="lead"
        />
      )}
    </Card>
    </div>
  );
});