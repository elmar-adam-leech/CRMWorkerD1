import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: "new" | "draft" | "pending" | "scheduled" | "sent" | "approved" | "rejected" | "in_progress" | "completed" | "cancelled" | "contacted" | "disqualified";
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusConfig = {
    new: {
      label: "New",
      variant: "secondary" as const,
    },
    contacted: {
      label: "Contacted",
      variant: "default" as const,
    },
    draft: {
      label: "Draft",
      variant: "secondary" as const,
    },
    scheduled: {
      label: "Scheduled",
      variant: "default" as const,
    },
    pending: {
      label: "Pending",
      variant: "secondary" as const,
    },
    sent: {
      label: "Sent",
      variant: "default" as const,
    },
    approved: {
      label: "Approved",
      variant: "default" as const,
    },
    rejected: {
      label: "Rejected",
      variant: "destructive" as const,
    },
    disqualified: {
      label: "Disqualified",
      variant: "destructive" as const,
    },
    in_progress: {
      label: "In Progress",
      variant: "default" as const,
    },
    completed: {
      label: "Completed",
      variant: "default" as const,
    },
    cancelled: {
      label: "Cancelled",
      variant: "destructive" as const,
    },
  };

  const config = statusConfig[status];
  
  if (!config) {
    console.warn(`Unknown status: ${status}`);
    return (
      <Badge variant="secondary" className={className} data-testid={`badge-status-${status}`}>
        {status}
      </Badge>
    );
  }

  return (
    <Badge
      variant={config.variant}
      className={cn(
        {
          "bg-chart-3 text-white": status === "scheduled" || status === "sent" || status === "contacted",
          "bg-chart-2 text-white": status === "completed" || status === "approved" || status === "in_progress",
        },
        className
      )}
      data-testid={`badge-status-${status}`}
    >
      {config.label}
    </Badge>
  );
}