import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import type { Contact } from "@shared/schema";

export type JobListItem = {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  value: number;
  scheduledDate: string;
  type: string;
  priority: "high" | "low" | "medium";
  estimatedHours: number;
  externalSource?: string;
  estimateId?: string;
};

type JobDetailsModalProps = {
  isOpen: boolean;
  job: JobListItem | undefined;
  onClose: () => void;
};

export function JobDetailsModal({ isOpen, job, onClose }: JobDetailsModalProps) {
  const { data: contact, isLoading: contactLoading } = useQuery<Contact>({
    queryKey: [`/api/contacts/${job?.contactId}`],
    enabled: isOpen && !!job?.contactId,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <DialogHeader>
          <DialogTitle>{job?.title} - Job Details</DialogTitle>
          <DialogDescription>View detailed information about this job.</DialogDescription>
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
                  <strong>Customer:</strong> {contact?.name || job.contactName || "Unknown Contact"}
                </div>
                <div>
                  <strong>Type:</strong> {job.type}
                </div>
                <div>
                  <strong>Status:</strong> <StatusBadge status={job.status} />
                </div>
                <div>
                  <strong>Priority:</strong>{" "}
                  <Badge
                    variant={
                      job.priority === "high" ? "destructive" : job.priority === "medium" ? "default" : "secondary"
                    }
                  >
                    {job.priority}
                  </Badge>
                </div>
                <div>
                  <strong>Value:</strong>{" "}
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(job.value)}
                </div>
                <div>
                  <strong>Scheduled Date:</strong> {job.scheduledDate}
                </div>
                <div>
                  <strong>Estimated Hours:</strong> {job.estimatedHours}h
                </div>
                {job.externalSource && (
                  <div>
                    <strong>Source:</strong>{" "}
                    <Badge variant="secondary" className="ml-2">
                      {job.externalSource === "housecall-pro" ? "Housecall Pro" : job.externalSource}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {job.externalSource === "housecall-pro" && (
              <div className="text-sm text-muted-foreground bg-muted border rounded-md p-3">
                <strong>Tracking Only:</strong> This job was automatically synced from Housecall Pro for lead value
                tracking. Status updates and job management should be done in Housecall Pro.
              </div>
            )}

            {job.estimateId && (
              <div className="text-sm text-muted-foreground bg-muted border rounded-md p-3">
                <strong>Generated from Estimate:</strong> This job was created from an approved estimate. You can
                track the original estimate ID: {job.estimateId}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
