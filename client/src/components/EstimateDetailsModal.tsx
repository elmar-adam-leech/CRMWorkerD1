import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActivityList } from "@/components/ActivityList";
import { Phone, Mail, MessageSquare, Calendar, User } from "lucide-react";
import type { Contact, EstimateSummary } from "@shared/schema";

export type EstimateListItem = {
  id: string;
  title: string;
  contactId: string;
  contactName: string;
  status: EstimateSummary["status"] | "cancelled";
  value: number;
  createdDate: string;
  expiryDate: string;
  description: string;
  priority: "high" | "medium" | "low";
  externalSource?: string;
  externalId?: string;
};

type ContactEntity = {
  id: string;
  name: string;
  emails: string[] | null;
  phones: string[] | null;
};

type EstimateDetailsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  estimate: EstimateListItem | undefined;
  detailsContact: Contact | undefined;
  onContact: (entity: ContactEntity, method: "phone" | "email") => void;
  onSendText: (entity: ContactEntity, type: "estimate") => void;
  onSendEmail: (entity: ContactEntity, type: "estimate") => void;
};

export function EstimateDetailsModal({
  isOpen,
  onClose,
  estimate,
  detailsContact,
  onContact,
  onSendText,
  onSendEmail: _onSendEmail,
}: EstimateDetailsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto mx-2 sm:mx-4">
        <DialogHeader>
          <DialogTitle>{estimate?.title}</DialogTitle>
          <DialogDescription>Estimate details and activity history</DialogDescription>
        </DialogHeader>

        {estimate && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Customer:</span>
                  <span>{detailsContact?.name || estimate.contactName || "Not provided"}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Email:</span>
                  <span>
                    {detailsContact?.emails && detailsContact.emails.length > 0
                      ? detailsContact.emails.join(", ")
                      : "Not provided"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Phone:</span>
                  <span>
                    {detailsContact?.phones && detailsContact.phones.length > 0
                      ? detailsContact.phones.join(", ")
                      : "Not provided"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Created:</span>
                  <span>{estimate.createdDate}</span>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Expires:</span>
                  <span>{estimate.expiryDate}</span>
                </div>

                <div className="pt-4">
                  <span className="font-medium">Description:</span>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {estimate.description || "No description provided"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 pt-4">
                  {detailsContact?.phones && detailsContact.phones.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onContact(
                          {
                            id: estimate.id,
                            name: detailsContact.name,
                            emails: detailsContact.emails,
                            phones: detailsContact.phones,
                          },
                          "phone"
                        )
                      }
                    >
                      <Phone className="h-4 w-4 mr-1" />
                      Call
                    </Button>
                  )}
                  {detailsContact?.emails && detailsContact.emails.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onContact(
                          {
                            id: estimate.id,
                            name: detailsContact.name,
                            emails: detailsContact.emails,
                            phones: detailsContact.phones,
                          },
                          "email"
                        )
                      }
                    >
                      <Mail className="h-4 w-4 mr-1" />
                      Email
                    </Button>
                  )}
                  {detailsContact?.phones && detailsContact.phones.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onSendText(
                          {
                            id: estimate.id,
                            name: detailsContact.name,
                            emails: detailsContact.emails,
                            phones: detailsContact.phones,
                          },
                          "estimate"
                        )
                      }
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Text
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <ActivityList estimateId={estimate.id} className="md:col-span-1" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
