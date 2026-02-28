import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface EmailButtonProps {
  recipientName: string;
  recipientEmail: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
  onSendEmail: () => void;
  leadId?: string;
  customerId?: string;
  estimateId?: string;
}

export function EmailButton({ 
  recipientName, 
  recipientEmail,
  variant = "outline",
  size = "default",
  className = "",
  children,
  onSendEmail,
  leadId,
  customerId,
  estimateId
}: EmailButtonProps) {
  const { data: currentUser } = useCurrentUser();
  const gmailConnected = currentUser?.user?.gmailConnected || false;

  // Determine test ID based on entity type
  const entityType = leadId ? 'lead' : customerId ? 'customer' : estimateId ? 'estimate' : 'contact';
  const entityId = leadId || customerId || estimateId || '';

  if (!recipientEmail) {
    return null;
  }

  // If Gmail is not connected, fallback to mailto link
  if (!gmailConnected) {
    return (
      <Button
        variant={variant}
        size={size}
        className={className}
        asChild
        data-testid={`button-email-${entityType}-${entityId}`}
      >
        <a href={`mailto:${recipientEmail}`}>
          {children || (
            <>
              <Mail className="h-3 w-3 mr-1 shrink-0" />
              Email
            </>
          )}
        </a>
      </Button>
    );
  }

  // If Gmail is connected, use the modal
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={onSendEmail}
      data-testid={`button-email-${entityType}-${entityId}`}
    >
      {children || (
        <>
          <Mail className="h-3 w-3 mr-1 shrink-0" />
          Email
        </>
      )}
    </Button>
  );
}
