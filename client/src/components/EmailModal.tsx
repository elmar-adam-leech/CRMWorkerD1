import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Mail, Send } from "lucide-react";
import type { Estimate } from "@shared/schema";

const emailSchema = z.object({
  toEmail: z.string().email("Please enter a valid email address"),
  subject: z.string().min(1, "Subject is required"),
  content: z.string().min(1, "Message content is required"),
  leadId: z.string().optional(),
  customerId: z.string().optional(),
  estimateId: z.string().optional(),
});

type EmailFormData = z.infer<typeof emailSchema>;

interface EmailModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  recipient?: {
    id: string;
    name: string;
    email: string;
    type: 'lead' | 'customer' | 'estimate';
  };
  defaultSubject?: string;
}

export function EmailModal({ isOpen, onOpenChange, recipient, defaultSubject }: EmailModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      toEmail: recipient?.email || "",
      subject: defaultSubject || "",
      content: "",
      leadId: recipient?.type === 'lead' ? recipient.id : undefined,
      customerId: recipient?.type === 'customer' ? recipient.id : undefined,
      estimateId: recipient?.type === 'estimate' ? recipient.id : undefined,
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async (data: EmailFormData) => {
      const response = await apiRequest('POST', '/api/messages/send-email', data);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Email Sent Successfully",
        description: `Your email has been sent to ${form.getValues('toEmail')}`,
      });
      
      // Invalidate conversations and messages to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/messages'] });
      
      // Reset form and close modal
      form.reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Send Email",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EmailFormData) => {
    sendEmailMutation.mutate(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-email-compose">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Compose Email
          </DialogTitle>
          <DialogDescription>
            {recipient ? `Send an email to ${recipient.name}` : "Send an email"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="toEmail">To</Label>
            <Input
              id="toEmail"
              type="email"
              placeholder="recipient@example.com"
              {...form.register("toEmail")}
              data-testid="input-email-to"
            />
            {form.formState.errors.toEmail && (
              <p className="text-sm text-destructive">{form.formState.errors.toEmail.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Email subject"
              {...form.register("subject")}
              data-testid="input-email-subject"
            />
            {form.formState.errors.subject && (
              <p className="text-sm text-destructive">{form.formState.errors.subject.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Message</Label>
            <Textarea
              id="content"
              placeholder="Type your message here..."
              rows={8}
              {...form.register("content")}
              data-testid="textarea-email-content"
            />
            {form.formState.errors.content && (
              <p className="text-sm text-destructive">{form.formState.errors.content.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-email-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={sendEmailMutation.isPending}
              data-testid="button-email-send"
            >
              {sendEmailMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}