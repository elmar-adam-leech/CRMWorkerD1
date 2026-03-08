import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneNumberSelector } from "@/components/PhoneNumberSelector";
import { SmsHistory } from "@/components/SmsHistory";
import { MessageSquare, Send, X, FileText } from "lucide-react";
import { useTemplates } from "@/hooks/useTemplates";
import { useToast } from "@/hooks/use-toast";
import { useSendSms, formatForDialpad } from "@/hooks/useSendSms";
import { useProviderStatus } from "@/hooks/use-provider-config";
import { ProviderIntegrationPrompt } from "./ProviderIntegrationPrompt";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface TextingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string;
  companyName?: string;
  contactId?: string;
  leadId?: string;
  customerId?: string;
  estimateId?: string;
}

export function TextingModal({
  isOpen,
  onClose,
  recipientName,
  recipientPhone,
  recipientEmail: _recipientEmail,
  companyName = "Our Company",
  contactId,
  leadId,
  customerId,
  estimateId
}: TextingModalProps) {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");
  const { toast } = useToast();
  const providerStatus = useProviderStatus();
  const { sendSmsAsync, isLoading: isSendingSms } = useSendSms();

  // Get current user data (cached and shared across the app)
  const { data: currentUser } = useCurrentUser();

  // Determine contact type and ID for message history
  // Prefer direct contactId prop if provided, otherwise derive from leadId/customerId/estimateId
  const derivedContactId = contactId || leadId || customerId || estimateId || null;
  const contactType = contactId ? null : (leadId ? 'lead' : customerId ? 'customer' : estimateId ? 'estimate' : null);

  // Shared templates hook — uses the global queryFn (credentials: 'include')
  // and shares the cache with the Templates page to avoid duplicate network requests.
  const { data: templates = [] } = useTemplates('text', isOpen);

  // Set default phone number when modal opens
  useEffect(() => {
    if (isOpen && currentUser?.user?.dialpadDefaultNumber && !selectedFromNumber) {
      setSelectedFromNumber(currentUser.user.dialpadDefaultNumber);
    }
  }, [isOpen, currentUser, selectedFromNumber]);

  const handleSendMessage = async () => {
    if (!message.trim()) {
      toast({
        title: "Message required",
        description: "Please enter a message to send",
        variant: "destructive",
      });
      return;
    }

    if (!recipientPhone) {
      toast({
        title: "Phone number required",
        description: "Recipient phone number is required for text messages",
        variant: "destructive",
      });
      return;
    }

    if (!selectedFromNumber) {
      toast({
        title: "From number required",
        description: "Please select a phone number to send from",
        variant: "destructive",
      });
      return;
    }

    const formattedTo = formatForDialpad(recipientPhone);
    const formattedFrom = formatForDialpad(selectedFromNumber);

    if (!formattedTo || !formattedFrom) {
      toast({
        title: "Invalid phone number",
        description: "Please ensure both sender and recipient phone numbers are valid (e.g., 10-digit US number or +1 followed by 10 digits)",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await sendSmsAsync({
        content: message.trim(),
        toNumber: recipientPhone,
        fromNumber: selectedFromNumber,
        contactId: derivedContactId || undefined,
        leadId,
        customerId,
        estimateId,
      });
      
      if (result.success) {
        // Clear message input but keep modal open
        setMessage("");
        setSelectedTemplate("");
      }
    } catch (error) {
      // Error is already handled by the hook
    }
  };

  const handleClose = () => {
    setMessage("");
    setSelectedTemplate("");
    setSelectedFromNumber("");
    onClose();
  };

  const formatPhoneNumber = (phone: string) => {
    // Simple phone number formatting - handle both +1XXXXXXXXXX and XXXXXXXXXX formats
    const cleaned = phone.replace(/\D/g, '');

    // Handle US numbers with country code (+1)
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const number = cleaned.slice(1); // Remove the '1' country code
      return `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
    }
    // Handle US numbers without country code
    else if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }

    return phone;
  };

  // Centralized template variable substitution helper
  const applyTemplateSubstitution = (content: string, variables: { customerName: string; companyName: string }) => {
    let result = content;
    // Double-brace format (new variable picker)
    result = result.replace(/\{\{contact\.name\}\}/g, variables.customerName);
    result = result.replace(/\{\{name\}\}/g, variables.customerName);
    result = result.replace(/\{\{title\}\}/g, variables.customerName);
    // Legacy single-brace format (backward compat)
    result = result.replace(/\{customerName\}/g, variables.customerName);
    result = result.replace(/\{companyName\}/g, variables.companyName);
    return result;
  };

  // Handle template selection
  const handleTemplateSelect = (templateId: string) => {
    if (!templateId || templateId === "__none__") {
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
      setMessage(substitutedContent);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="w-full max-w-[95vw] sm:max-w-[600px] h-[95vh] sm:h-[85vh] flex flex-col p-0"
        data-testid="modal-texting"
        aria-describedby="texting-modal-description"
      >
        <DialogHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2" data-testid="text-modal-title">
            <MessageSquare className="h-5 w-5" />
            Message {recipientName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 gap-4">
          {/* Provider Configuration Check */}
          {(() => {
            if (providerStatus.isLoading) {
              return <div className="text-center py-8">Loading provider status...</div>;
            }

            if (!providerStatus.sms.isConfigured) {
              return (
                <ProviderIntegrationPrompt
                  type="sms"
                  availableProviders={providerStatus.sms.availableProviders || []}
                  onSetupClick={() => {
                    // Close the modal first
                    onClose();
                    // Navigate to Settings page Communication section
                    navigate('/settings?tab=integrations');
                  }}
                />
              );
            }

            return (
              <>
          {/* Phone Number Info */}
          <PhoneNumberSelector
            value={selectedFromNumber}
            onValueChange={setSelectedFromNumber}
            dataTestId="select-from-number"
          />
          <div className="grid gap-2">
            <Label htmlFor="recipient-phone">To Number</Label>
            <Input
              id="recipient-phone"
              value={formatPhoneNumber(recipientPhone)}
              disabled
              data-testid="input-recipient-phone"
            />
          </div>
          {/* Message History */}
          {contactType && derivedContactId && (
            <SmsHistory
              contactType={contactType}
              contactId={derivedContactId}
              className="flex-1 min-h-0"
              emptyStateMessage="No messages yet"
              dataTestId="text-message-history"
            />
          )}
          {/* Template Selection */}
          {templates.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="template-select">Use Template</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger data-testid="select-message-template">
                  <SelectValue placeholder="Choose a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" data-testid="select-no-template">
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
          {/* New Message */}
          <div className="grid gap-2 shrink-0">
            <Label htmlFor="new-message">Message</Label>
            <Textarea
              id="new-message"
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[100px] max-h-[120px] resize-none"
              data-testid="textarea-new-message"
            />
            {selectedTemplate && (
              <div className="text-xs text-muted-foreground">
                Variables like {"{{"}contact.name{"}}"} are automatically replaced with real values when sent.
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 shrink-0 pt-2 border-t">
            <Button 
              variant="outline" 
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleClose} 
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleSendMessage}
              disabled={!message.trim() || isSendingSms}
              data-testid="button-send-text"
            >
              {isSendingSms ? (
                <>Sending...</>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2 shrink-0" />
                  Send Text
                </>
              )}
            </Button>
          </div>
              </>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}