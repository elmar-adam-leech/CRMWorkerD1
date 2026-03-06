import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailHistory } from "@/components/EmailHistory";
import { Mail, Send, X, FileText } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTemplates } from "@/hooks/useTemplates";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface EmailComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  recipientEmail: string;
  companyName?: string;
  contactId?: string;
  leadId?: string;
  customerId?: string;
  estimateId?: string;
}

export function EmailComposerModal({
  isOpen,
  onClose,
  recipientName,
  recipientEmail,
  companyName = "Our Company",
  contactId,
  leadId,
  customerId,
  estimateId
}: EmailComposerModalProps) {
  const [, navigate] = useLocation();
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const { toast } = useToast();

  // Get current user data to check Gmail connection
  const { data: currentUser } = useCurrentUser();

  // Determine contact type and ID for email history
  // Prefer direct contactId prop if provided, otherwise derive from leadId/customerId/estimateId
  const derivedContactId = contactId || leadId || customerId || estimateId || null;
  const contactType = contactId ? null : (leadId ? 'lead' : customerId ? 'customer' : estimateId ? 'estimate' : null);

  // Shared templates hook — uses the global queryFn (credentials: 'include')
  // and shares the cache with the Templates page to avoid duplicate network requests.
  const { data: templates = [] } = useTemplates('email', isOpen);

  // Send email mutation
  const sendEmailMutation = useMutation({
    mutationFn: async (data: {
      to: string;
      subject: string;
      content: string;
      contactId?: string;
      leadId?: string; // Legacy - prefer contactId
      customerId?: string; // Legacy - prefer contactId
      estimateId?: string;
    }) => {
      return apiRequest('POST', '/api/emails/send-gmail', data);
    },
    onSuccess: () => {
      toast({
        title: "Email sent",
        description: "Your email has been sent successfully",
      });
      
      // Clear form but keep modal open so user can see the history update
      setSubject("");
      setContent("");
      setSelectedTemplate("");
      
      // Invalidate queries to refresh
      queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send email",
        description: error.message || "There was an error sending your email",
        variant: "destructive",
      });
    },
  });

  const handleSendEmail = async () => {
    if (!subject.trim()) {
      toast({
        title: "Subject required",
        description: "Please enter an email subject",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim()) {
      toast({
        title: "Content required",
        description: "Please enter email content",
        variant: "destructive",
      });
      return;
    }

    if (!recipientEmail) {
      toast({
        title: "Email address required",
        description: "Recipient email address is required",
        variant: "destructive",
      });
      return;
    }

    // Check if Gmail is connected
    if (!currentUser?.user?.gmailConnected) {
      toast({
        title: "Gmail not connected",
        description: "Please connect your Gmail account in Settings to send emails",
        variant: "destructive",
      });
      return;
    }

    sendEmailMutation.mutate({
      to: recipientEmail,
      subject: subject.trim(),
      content: content.trim(),
      contactId: derivedContactId || undefined,
      leadId,
      customerId,
      estimateId,
    });
  };

  const handleClose = () => {
    setSubject("");
    setContent("");
    setSelectedTemplate("");
    onClose();
  };

  // Centralized template variable substitution helper
  const applyTemplateSubstitution = (content: string, variables: { customerName: string; companyName: string }) => {
    let result = content;
    result = result.replace(/\{customerName\}/g, variables.customerName);
    result = result.replace(/\{companyName\}/g, variables.companyName);
    return result;
  };

  // Handle template selection
  const handleTemplateSelect = (templateId: string) => {
    if (!templateId) {
      setSelectedTemplate("");
      return;
    }

    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      const substitutedContent = applyTemplateSubstitution(template.content, {
        customerName: recipientName,
        companyName: companyName
      });
      setContent(substitutedContent);
      
      // Use template title as subject if subject is empty
      if (!subject && template.title) {
        setSubject(template.title);
      }
    }
  };

  // Show warning if Gmail is not connected
  const showGmailWarning = !currentUser?.user?.gmailConnected;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="w-full max-w-[95vw] sm:max-w-[600px] h-[95vh] sm:h-[85vh] flex flex-col p-0"
        data-testid="modal-email-composer"
        aria-describedby="email-composer-modal-description"
      >
        <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2" data-testid="email-modal-title">
            <Mail className="h-5 w-5" />
            Email to {recipientName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 gap-4">
          {/* Gmail Connection Warning */}
          {showGmailWarning && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3 shrink-0">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Gmail is not connected. Please connect your Gmail account in{' '}
                <button
                  onClick={() => {
                    handleClose();
                    navigate('/settings?tab=integrations');
                  }}
                  className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100"
                >
                  Settings
                </button>
                {' '}to send emails.
              </p>
            </div>
          )}

          {/* Recipient Email */}
          <div className="grid gap-2 shrink-0">
            <Label htmlFor="recipient-email">To</Label>
            <Input
              id="recipient-email"
              type="email"
              value={recipientEmail}
              disabled
              className="bg-muted"
              data-testid="input-recipient-email"
            />
          </div>

          {/* Email History */}
          {contactType && derivedContactId && (
            <EmailHistory
              contactType={contactType}
              contactId={derivedContactId}
              contactEmail={recipientEmail}
              className="flex-1 min-h-0"
              emptyStateMessage="No email messages yet"
              dataTestId="email-message-history"
            />
          )}

          {/* Template Selection */}
          {templates.length > 0 && (
            <div className="grid gap-2 shrink-0">
              <Label htmlFor="template-select">Use Template</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger data-testid="select-email-template">
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="" data-testid="select-no-template">
                    <div className="flex items-center gap-2">
                      <X className="h-4 w-4" />
                      No template
                    </div>
                  </SelectItem>
                  {templates.map((template) => (
                    <SelectItem
                      key={template.id}
                      value={template.id}
                      data-testid={`select-template-${template.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        {template.title}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Subject Field */}
          <div className="grid gap-2 shrink-0">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              type="text"
              placeholder="Enter email subject..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="input-email-subject"
            />
          </div>

          {/* Message Content */}
          <div className="grid gap-2 shrink-0">
            <Label htmlFor="email-content">Message</Label>
            <Textarea
              id="email-content"
              placeholder="Type your message here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px] max-h-[120px] resize-none"
              data-testid="textarea-email-content"
            />
            {selectedTemplate && (
              <div className="text-xs text-muted-foreground">
                Variables like {"{"}customerName{"}"} and {"{"}companyName{"}"} are automatically replaced.
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap justify-end gap-2 shrink-0 pt-2 border-t">
            <Button 
              variant="outline" 
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleClose} 
              data-testid="button-cancel-email"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleSendEmail}
              disabled={!subject.trim() || !content.trim() || sendEmailMutation.isPending || showGmailWarning}
              data-testid="button-send-email"
            >
              {sendEmailMutation.isPending ? (
                <>Sending...</>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2 shrink-0" />
                  Send Email
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
