import type { Contact } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityList } from "@/components/ActivityList";
import { LeadSubmissionHistory } from "@/components/LeadSubmissionHistory";

interface LeadDetailsModalProps {
  isOpen: boolean;
  contact: Contact | undefined;
  onClose: () => void;
}

export function LeadDetailsModal({ isOpen, contact, onClose }: LeadDetailsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-2 sm:mx-4">
        <DialogHeader>
          <DialogTitle>{contact?.name} - Lead Details</DialogTitle>
          <DialogDescription>
            View detailed information and activity history for this lead.
          </DialogDescription>
        </DialogHeader>

        {contact && (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <strong>Name:</strong> {contact.name}
                </div>
                {contact.emails && contact.emails.length > 0 && (
                  <div>
                    <strong>Email:</strong> {contact.emails[0]}
                  </div>
                )}
                {contact.phones && contact.phones.length > 0 && (
                  <div>
                    <strong>Phone:</strong> {contact.phones[0]}
                  </div>
                )}
                {contact.address && (
                  <div>
                    <strong>Address:</strong> {contact.address}
                  </div>
                )}
                {contact.source && (
                  <div>
                    <strong>Source:</strong> {contact.source}
                  </div>
                )}
                {contact.notes && (
                  <div>
                    <strong>Notes:</strong>
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                      {contact.notes}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Submission History</CardTitle>
              </CardHeader>
              <CardContent>
                <LeadSubmissionHistory contactId={contact.id} />
              </CardContent>
            </Card>

            <ActivityList leadId={contact.id} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
