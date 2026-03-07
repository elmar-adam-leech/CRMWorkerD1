import { memo } from "react";
import { Calendar, Phone, Mail, AlertCircle, MessageSquare, FileText, User, CalendarDays, MoreHorizontal, Edit, Trash, Clock, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ActivityList } from "@/components/ActivityList";
import { isPast, isToday, isThisWeek } from "date-fns";

export interface FollowUpItem {
  id: string;
  type: 'lead' | 'estimate';
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  value?: string | number;
  notes?: string;
  followUpDate: string;
  followUpReason: string;
  source?: string;
  title?: string;
  amount?: string | number;
  status?: string;
  customerId?: string;
}

export function getFollowUpStatus(followUpDate: string) {
  const date = new Date(followUpDate);
  if (isPast(date) && !isToday(date)) {
    return { label: "Overdue", variant: "destructive" as const, icon: AlertCircle };
  } else if (isToday(date)) {
    return { label: "Today", variant: "default" as const, icon: Clock };
  } else if (isThisWeek(date)) {
    return { label: "This Week", variant: "secondary" as const, icon: Calendar };
  }
  return { label: "Upcoming", variant: "outline" as const, icon: Calendar };
}

interface FollowUpCardProps {
  item: FollowUpItem;
  onSetFollowUp: (item: FollowUpItem) => void;
  onContact: (item: FollowUpItem, method: 'phone' | 'email') => void;
  onTextContact: (item: FollowUpItem) => void;
  onSchedule: (item: FollowUpItem) => void;
  onEdit: (item: FollowUpItem) => void;
  onDelete: (item: FollowUpItem) => void;
}

export function FollowUpCard({
  item,
  onSetFollowUp,
  onContact,
  onTextContact,
  onSchedule,
  onEdit,
  onDelete,
}: FollowUpCardProps) {
  const status = getFollowUpStatus(item.followUpDate);
  const StatusIcon = status.icon;
  const TypeIcon = item.type === 'lead' ? User : FileText;

  return (
    <Card key={`${item.type}-${item.id}`} className="hover-elevate" data-testid={`card-followup-${item.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg" data-testid={`text-item-name-${item.id}`}>
              {item.name}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              {item.type === 'lead' ? 'Lead' : 'Estimate'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status.variant} className="flex items-center gap-1" data-testid={`badge-status-${item.id}`}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={`button-menu-${item.id}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(item)} data-testid={`menu-edit-${item.id}`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit {item.type === 'lead' ? 'Lead' : 'Estimate'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetFollowUp(item)} data-testid={`menu-followup-${item.id}`}>
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Set Follow-Up
                </DropdownMenuItem>
                {item.type === 'lead' && (
                  <DropdownMenuItem onClick={() => onDelete(item)} data-testid={`menu-delete-${item.id}`}>
                    <Trash className="h-4 w-4 mr-2" />
                    Delete Lead
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span data-testid={`text-followup-date-${item.id}`}>
            {item.followUpReason}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        <div className="grid gap-2 text-sm">
          {item.email && (
            <div className="flex items-center gap-2" data-testid={`text-email-${item.id}`}>
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{item.email}</span>
            </div>
          )}
          {item.phone && (
            <div className="flex items-center gap-2" data-testid={`text-phone-${item.id}`}>
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{item.phone}</span>
            </div>
          )}
          {item.address && (
            <div className="text-muted-foreground" data-testid={`text-address-${item.id}`}>
              {item.address}
            </div>
          )}
          {item.value && (
            <div className="font-medium text-green-600" data-testid={`text-value-${item.id}`}>
              {item.type === 'lead' ? 'Estimated Value:' : 'Amount:'} ${item.value}
            </div>
          )}
          {item.status && item.type === 'estimate' && (
            <div className="text-sm">
              <Badge variant="outline">
                {item.status}
              </Badge>
            </div>
          )}
          {item.notes && (
            <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded" data-testid={`text-notes-${item.id}`}>
              {item.notes}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          {item.type === 'lead' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSchedule(item)}
              data-testid={`button-schedule-${item.id}`}
            >
              <CalendarDays className="h-4 w-4 mr-2" />
              Schedule
            </Button>
          )}
          {item.phone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onContact(item, 'phone')}
              data-testid={`button-call-${item.id}`}
            >
              <Phone className="h-4 w-4 mr-2" />
              Call
            </Button>
          )}
          {item.email && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onContact(item, 'email')}
              data-testid={`button-email-${item.id}`}
            >
              <Mail className="h-4 w-4 mr-2" />
              Email
            </Button>
          )}
          {item.phone && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTextContact(item)}
              data-testid={`button-text-${item.id}`}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Text
            </Button>
          )}
        </div>

        <div className="mt-4">
          <ActivityList
            leadId={item.type === 'lead' ? item.id : undefined}
            estimateId={item.type === 'estimate' ? item.id : undefined}
            limit={1}
            showAddButton={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(FollowUpCard);
