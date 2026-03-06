import { CallButton } from "./CallButton";
import { EmailButton } from "./EmailButton";
import { TextButton } from "./TextButton";
import { QuickNoteButton } from "./QuickNoteButton";

interface CommunicationActionButtonsProps {
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  onSendEmail: () => void;
  onSendText: () => void;
  leadId?: string;
  estimateId?: string;
  jobId?: string;
  customerId?: string;
}

export function CommunicationActionButtons({
  recipientName,
  recipientEmail,
  recipientPhone,
  onSendEmail,
  onSendText,
  leadId,
  estimateId,
}: CommunicationActionButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <CallButton
        recipientName={recipientName}
        recipientPhone={recipientPhone}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        leadId={leadId}
        estimateId={estimateId}
      />
      <EmailButton
        recipientName={recipientName}
        recipientEmail={recipientEmail}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        onSendEmail={onSendEmail}
        leadId={leadId}
        estimateId={estimateId}
      />
      <TextButton
        recipientName={recipientName}
        recipientPhone={recipientPhone}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
        onSendText={onSendText}
        leadId={leadId}
        estimateId={estimateId}
      />
      <QuickNoteButton
        leadId={leadId}
        estimateId={estimateId}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
      />
    </div>
  );
}
