import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Check, ChevronsUpDown, Plus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const createEstimateSchema = z.object({
  contactId: z.string().min(1, "Please select a contact"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  amount: z.number().min(0, "Amount must be positive"),
  validUntil: z.date().optional(),
  followUpDate: z.date().optional(),
  status: z.enum(["draft", "sent", "pending", "approved", "rejected"]).default("draft"),
});

const createCustomerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
});

type CreateEstimateFormData = z.infer<typeof createEstimateSchema>;
type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;

interface CreateEstimateFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function CreateEstimateForm({ onSuccess, onCancel }: CreateEstimateFormProps) {
  const { toast } = useToast();
  const [validUntilDate, setValidUntilDate] = useState<Date>();
  const [followUpDate, setFollowUpDate] = useState<Date>();
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [showCreateCustomerDialog, setShowCreateCustomerDialog] = useState(false);

  // Fetch contacts (leads and customers) for selection
  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Array<{
    id: string;
    name: string;
    type: string;
    emails: string[];
    phones: string[];
  }>>({
    queryKey: ['/api/contacts'],
    queryFn: async () => {
      const response = await fetch('/api/contacts', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch contacts');
      return response.json();
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateEstimateFormData>({
    resolver: zodResolver(createEstimateSchema),
    defaultValues: {
      status: "draft",
    },
  });

  const {
    register: registerCustomer,
    handleSubmit: handleSubmitCustomer,
    formState: { errors: customerErrors },
    reset: resetCustomerForm,
  } = useForm<CreateCustomerFormData>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: customerSearchQuery,
    },
  });

  const selectedContactId = watch("contactId");
  const selectedContact = contacts.find(c => c.id === selectedContactId);

  // Filter contacts based on search query
  const filteredContacts = contacts.filter(contact => 
    contact.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
    contact.emails?.some(e => e.toLowerCase().includes(customerSearchQuery.toLowerCase())) ||
    contact.phones?.some(p => p.includes(customerSearchQuery))
  );

  const createCustomerMutation = useMutation({
    mutationFn: async (data: CreateCustomerFormData) => {
      const response = await apiRequest('POST', '/api/contacts', {
        name: data.name,
        emails: data.email ? [data.email] : [],
        phones: [data.phone],
        type: 'customer',
        address: '',
        source: '',
        notes: '',
      });
      return response.json();
    },
    onSuccess: (newCustomer) => {
      toast({
        title: "Customer created",
        description: "New customer has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      setValue("contactId", newCustomer.id);
      setShowCreateCustomerDialog(false);
      resetCustomerForm();
      setCustomerSearchQuery("");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create customer",
        description: error.message || "Please try again",
      });
    },
  });

  const createEstimateMutation = useMutation({
    mutationFn: async (data: CreateEstimateFormData) => {
      const response = await apiRequest('POST', '/api/estimates', {
        title: data.title,
        description: data.description || '',
        amount: data.amount,
        contactId: data.contactId,
        status: data.status,
        validUntil: data.validUntil?.toISOString(),
        followUpDate: data.followUpDate?.toISOString(),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Estimate created",
        description: "Estimate has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create estimate",
        description: error.message || "Please try again",
      });
    },
  });

  const onSubmit = (data: CreateEstimateFormData) => {
    createEstimateMutation.mutate(data);
  };

  const onCreateCustomer = (data: CreateCustomerFormData) => {
    createCustomerMutation.mutate(data);
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="contact">Contact *</Label>
          <Popover open={customerSearchOpen} onOpenChange={setCustomerSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={customerSearchOpen}
                className="w-full justify-between"
                data-testid="button-select-contact"
              >
                {selectedContact
                  ? `${selectedContact.name} - ${selectedContact.emails?.[0] || selectedContact.phones?.[0] || 'No contact info'}`
                  : contactsLoading 
                    ? "Loading contacts..." 
                    : "Search for a customer..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput 
                  placeholder="Search customers..." 
                  value={customerSearchQuery}
                  onValueChange={setCustomerSearchQuery}
                  data-testid="input-search-customer"
                />
                <CommandList>
                  <CommandEmpty>
                    <div className="p-2 text-sm text-muted-foreground">
                      No customer found.
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => {
                        setShowCreateCustomerDialog(true);
                        setCustomerSearchOpen(false);
                      }}
                      data-testid="button-create-new-customer"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create new customer
                    </Button>
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredContacts.map((contact) => (
                      <CommandItem
                        key={contact.id}
                        value={contact.id}
                        onSelect={() => {
                          setValue("contactId", contact.id);
                          setCustomerSearchOpen(false);
                          setCustomerSearchQuery("");
                        }}
                        data-testid={`option-contact-${contact.id}`}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedContactId === contact.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{contact.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {contact.emails?.[0] || contact.phones?.[0] || 'No contact info'}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                    {filteredContacts.length > 0 && (
                      <CommandItem
                        onSelect={() => {
                          setShowCreateCustomerDialog(true);
                          setCustomerSearchOpen(false);
                        }}
                        data-testid="button-create-new-customer-bottom"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Create new customer
                      </CommandItem>
                    )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {errors.contactId && (
            <p className="text-sm text-destructive">{errors.contactId.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            {...register("title")}
            placeholder="HVAC Installation Quote"
            data-testid="input-title"
          />
          {errors.title && (
            <p className="text-sm text-destructive">{errors.title.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            {...register("description")}
            placeholder="Detailed description of the work to be performed"
            rows={3}
            data-testid="input-description"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Amount *</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            {...register("amount", { valueAsNumber: true })}
            placeholder="5000.00"
            data-testid="input-amount"
          />
          {errors.amount && (
            <p className="text-sm text-destructive">{errors.amount.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={watch("status")}
            onValueChange={(value: any) => setValue("status", value)}
          >
            <SelectTrigger id="status" data-testid="select-status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Valid Until (Optional)</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !validUntilDate && "text-muted-foreground"
                )}
                data-testid="button-valid-until"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {validUntilDate ? format(validUntilDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={validUntilDate}
                onSelect={(date) => {
                  setValidUntilDate(date);
                  setValue("validUntil", date);
                }}
                disabled={(date) => date < new Date()}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label>Follow-Up Date (Optional)</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !followUpDate && "text-muted-foreground"
                )}
                data-testid="button-follow-up"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {followUpDate ? format(followUpDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={followUpDate}
                onSelect={(date) => {
                  setFollowUpDate(date);
                  setValue("followUpDate", date);
                }}
                disabled={(date) => date < new Date()}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createEstimateMutation.isPending}
            data-testid="button-create-estimate"
          >
            {createEstimateMutation.isPending ? "Creating..." : "Create Estimate"}
          </Button>
        </div>
      </form>

      {/* Create New Customer Dialog */}
      <Dialog open={showCreateCustomerDialog} onOpenChange={setShowCreateCustomerDialog}>
        <DialogContent data-testid="dialog-create-customer">
          <DialogHeader>
            <DialogTitle>Create New Customer</DialogTitle>
            <DialogDescription>
              Enter the customer's contact information. At least one phone number is required.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitCustomer(onCreateCustomer)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customer-name">Name *</Label>
              <Input
                id="customer-name"
                {...registerCustomer("name")}
                placeholder="John Doe"
                data-testid="input-customer-name"
              />
              {customerErrors.name && (
                <p className="text-sm text-destructive">{customerErrors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-email">Email (Optional)</Label>
              <Input
                id="customer-email"
                type="email"
                {...registerCustomer("email")}
                placeholder="john@example.com"
                data-testid="input-customer-email"
              />
              {customerErrors.email && (
                <p className="text-sm text-destructive">{customerErrors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer-phone">Phone *</Label>
              <Input
                id="customer-phone"
                type="tel"
                {...registerCustomer("phone")}
                placeholder="(443) 415-4374"
                data-testid="input-customer-phone"
              />
              {customerErrors.phone && (
                <p className="text-sm text-destructive">{customerErrors.phone.message}</p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowCreateCustomerDialog(false);
                  resetCustomerForm();
                }}
                data-testid="button-cancel-customer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createCustomerMutation.isPending}
                data-testid="button-save-customer"
              >
                {createCustomerMutation.isPending ? "Creating..." : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
