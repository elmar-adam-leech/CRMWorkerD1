import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProviderStatus } from "@/hooks/use-provider-config";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { CallingModal } from "./CallingModal";

interface CallButtonProps {
  recipientName: string;
  recipientPhone: string;
  fromNumber?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
  customerId?: string;
  leadId?: string;
}

export function CallButton({ 
  recipientName, 
  recipientPhone,
  fromNumber,
  variant = "outline",
  size = "default",
  className = "",
  children,
  customerId,
  leadId
}: CallButtonProps) {
  const { toast } = useToast();
  const { calling } = useProviderStatus();
  const queryClient = useQueryClient();
  const [isInitiating, setIsInitiating] = useState(false);
  const [showCallingModal, setShowCallingModal] = useState(false);

  const initiateCallMutation = useMutation({
    mutationFn: async (data: { toNumber: string; fromNumber?: string; customerId?: string; leadId?: string }) => {
      const response = await apiRequest('POST', '/api/calls/initiate', data);
      return response.json();
    },
    onSuccess: (data: { success: boolean; callId?: string; callUrl?: string }) => {
      setIsInitiating(false);
      toast({
        title: "Call initiated",
        description: data.callUrl 
          ? "Your Dialpad app will open shortly" 
          : `Calling ${recipientName}...`,
      });
      
      // Invalidate activities to refresh the activity list
      queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
      
      // Open call URL if provided (will launch Dialpad app)
      if (data.callUrl) {
        window.open(data.callUrl, '_blank');
      }
    },
    onError: (error: any) => {
      setIsInitiating(false);
      toast({
        title: "Call failed",
        description: error?.message || "Failed to initiate call",
        variant: "destructive",
      });
    },
  });

  const handleCall = async () => {
    if (!recipientPhone) {
      toast({
        title: "No phone number",
        description: "This contact doesn't have a phone number",
        variant: "destructive",
      });
      return;
    }

    // If Dialpad calling is enabled
    if (calling.isConfigured) {
      // If fromNumber is provided, call directly
      if (fromNumber) {
        const cleanPhoneNumber = recipientPhone.replace(/[^\d+]/g, '');
        setIsInitiating(true);
        initiateCallMutation.mutate({
          toNumber: cleanPhoneNumber,
          fromNumber,
          customerId,
          leadId,
        });
      } else {
        // Open modal to select phone number
        setShowCallingModal(true);
      }
    } else {
      // Fall back to tel: link for devices with phone capability
      const cleanPhoneNumber = recipientPhone.replace(/[^\d+]/g, '');
      window.location.href = `tel:${cleanPhoneNumber}`;
      console.log(`Contacting ${recipientName} via phone`);
    }
  };

  return (
    <>
      <Button
        onClick={handleCall}
        disabled={!recipientPhone || isInitiating || initiateCallMutation.isPending}
        variant={variant}
        size={size}
        className={className}
        data-testid={`button-call-${recipientPhone}`}
      >
        <Phone className={`${size === 'icon' ? 'h-4 w-4' : 'h-4 w-4 mr-2'}`} />
        {children || (size !== 'icon' && (isInitiating || initiateCallMutation.isPending ? 'Calling...' : 'Call'))}
      </Button>

      <CallingModal
        open={showCallingModal}
        onOpenChange={setShowCallingModal}
        recipientName={recipientName}
        recipientPhone={recipientPhone}
        customerId={customerId}
        leadId={leadId}
      />
    </>
  );
}
