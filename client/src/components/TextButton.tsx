import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

interface TextButtonProps {
  recipientName: string;
  recipientPhone: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
  onSendText: () => void;
  leadId?: string;
  customerId?: string;
  estimateId?: string;
}

export function TextButton({ 
  recipientName, 
  recipientPhone,
  variant = "outline",
  size = "default",
  className = "",
  children,
  onSendText,
  leadId,
  customerId,
  estimateId
}: TextButtonProps) {
  // Determine test ID based on entity type
  const entityType = leadId ? 'lead' : customerId ? 'customer' : estimateId ? 'estimate' : 'contact';
  const entityId = leadId || customerId || estimateId || '';

  if (!recipientPhone) {
    return null;
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={onSendText}
      data-testid={`button-text-${entityType}-${entityId}`}
    >
      {children || (
        <>
          <MessageSquare className="h-3 w-3 mr-1 shrink-0" />
          Text
        </>
      )}
    </Button>
  );
}
