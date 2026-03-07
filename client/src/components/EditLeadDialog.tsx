import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { insertContactSchema } from "@shared/schema";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { useEffect } from "react";

// Form schema for lead editing — emails/phones replaced with singular string
// fields so the UI can work with a single value at a time.
const leadFormSchema = insertContactSchema
  .omit({ contractorId: true, type: true, emails: true, phones: true })
  .extend({
    email: z.string().optional(),
    phone: z.string().optional(),
  });

type LeadFormValues = z.infer<typeof leadFormSchema>;

interface EditLeadDialogProps {
  lead: Contact | undefined;
  open: boolean;
  onClose: () => void;
}

/**
 * Extracted edit-lead dialog for the Follow-ups page.
 * Owns the leadFormSchema, react-hook-form instance, and updateLeadMutation
 * so the Follow-ups page is not burdened with ~130 lines of dialog boilerplate.
 */
export function EditLeadDialog({ lead, open, onClose }: EditLeadDialogProps) {
  const { toast } = useToast();

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      source: "",
      notes: "",
      followUpDate: undefined,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      pageUrl: "",
    },
  });

  // Populate form whenever the lead prop changes
  useEffect(() => {
    if (lead) {
      form.reset({
        name: lead.name || "",
        email: (lead.emails && lead.emails.length > 0) ? lead.emails[0] : "",
        phone: (lead.phones && lead.phones.length > 0) ? lead.phones[0] : "",
        address: lead.address || "",
        source: lead.source || "",
        notes: lead.notes || "",
        followUpDate: lead.followUpDate ? new Date(lead.followUpDate) : undefined,
        utmSource: lead.utmSource || "",
        utmMedium: lead.utmMedium || "",
        utmCampaign: lead.utmCampaign || "",
        utmTerm: lead.utmTerm || "",
        utmContent: lead.utmContent || "",
        pageUrl: lead.pageUrl || "",
      });
    }
  }, [lead, form]);

  const updateLeadMutation = useMutation({
    mutationFn: async (data: { leadId: string; leadData: LeadFormValues }) => {
      const response = await apiRequest('PUT', `/api/contacts/${data.leadId}`, data.leadData);
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Lead Updated",
        description: "Lead information has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/follow-ups'] });
      form.reset();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Lead",
        description: error.message || "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (values: LeadFormValues) => {
    if (!lead) return;

    const processedValues = {
      ...values,
      emails: values.email ? [values.email] : [],
      phones: values.phone ? [values.phone] : [],
      address: values.address || null,
      source: values.source || null,
      notes: values.notes || null,
    };
    delete (processedValues as Record<string, unknown>).email;
    delete (processedValues as Record<string, unknown>).phone;

    updateLeadMutation.mutate({
      leadId: lead.id,
      leadData: processedValues as LeadFormValues,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <DialogHeader>
          <DialogTitle>Edit Lead - {lead?.name}</DialogTitle>
          <DialogDescription>
            Update the lead's contact information and details.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter lead name" {...field} data-testid="input-edit-lead-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter email address" {...field} data-testid="input-edit-lead-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter phone number" {...field} data-testid="input-edit-lead-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <FormControl>
                      <Input placeholder="Where did this lead come from?" {...field} value={field.value ?? ""} data-testid="input-edit-lead-source" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter address" {...field} value={field.value ?? ""} data-testid="input-edit-lead-address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any additional notes..."
                      className="min-h-[100px]"
                      {...field}
                      value={field.value ?? ""}
                      data-testid="input-edit-lead-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-cancel-edit-lead"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateLeadMutation.isPending}
                data-testid="button-save-edit-lead"
              >
                {updateLeadMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
