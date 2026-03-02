import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const createJobSchema = z.object({
  contactId: z.string().min(1, "Please select a contact"),
  title: z.string().min(1, "Title is required"),
  type: z.string().min(1, "Type is required"),
  value: z.number().min(0, "Value must be positive"),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  estimatedHours: z.number().optional(),
  scheduledDate: z.date().optional(),
  estimateId: z.string().optional(),
});

const createCustomerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
});

type CreateJobFormData = z.infer<typeof createJobSchema>;
type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;

interface CreateJobFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function CreateJobForm({ onSuccess, onCancel }: CreateJobFormProps) {
  const { toast } = useToast();
  const [scheduledDate, setScheduledDate] = useState<Date>();
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [showCreateCustomerDialog, setShowCreateCustomerDialog] = useState(false);

  // Fetch contacts (customers) for selection — bounded to 100 to avoid fetching all contacts
  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Array<{
    id: string;
    name: string;
    type: string;
    emails: string[];
    phones: string[];
  }>>({
    queryKey: ['/api/contacts/paginated', { limit: 100 }],
    queryFn: async () => {
      const response = await fetch('/api/contacts/paginated?limit=100', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const result = await response.json();
      return result.data ?? [];
    },
  });

  // Estimate search state for lazy linking (only fetches when user types)
  const [estimateSearchQuery, setEstimateSearchQuery] = useState("");
  const [estimatePopoverOpen, setEstimatePopoverOpen] = useState(false);

  const { data: estimateSearchResults = [], isLoading: estimatesSearchLoading } = useQuery<Array<{
    id: string;
    title: string;
    amount: number;
    contactName: string;
  }>>({
    queryKey: ['/api/estimates/paginated', { search: estimateSearchQuery, limit: 10 }],
    queryFn: async () => {
      const response = await fetch(
        `/api/estimates/paginated?search=${encodeURIComponent(estimateSearchQuery)}&limit=10`,
        { credentials: 'include' }
      );
      if (!response.ok) return [];
      const result = await response.json();
      return result.data ?? [];
    },
    enabled: estimatePopoverOpen && estimateSearchQuery.length >= 2,
    staleTime: 10_000,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateJobFormData>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      status: "scheduled",
      priority: "medium",
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
  const selectedStatus = watch("status");
  const selectedPriority = watch("priority");
  const selectedEstimateId = watch("estimateId");

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

  const createJobMutation = useMutation({
    mutationFn: async (data: CreateJobFormData) => {
      const response = await apiRequest('POST', '/api/jobs', {
        title: data.title,
        type: data.type,
        value: data.value,
        contactId: data.contactId,
        status: data.status,
        priority: data.priority,
        estimatedHours: data.estimatedHours,
        scheduledDate: data.scheduledDate?.toISOString(),
        estimateId: data.estimateId || null,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Job created",
        description: "Job has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create job",
        description: error.message || "Please try again",
      });
    },
  });

  const onSubmit = (data: CreateJobFormData) => {
    createJobMutation.mutate(data);
  };

  const onCreateCustomer = (data: CreateCustomerFormData) => {
    createCustomerMutation.mutate(data);
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="contact">Contact (Customer) *</Label>
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
            placeholder="HVAC Repair Service"
            data-testid="input-title"
          />
          {errors.title && (
            <p className="text-sm text-destructive">{errors.title.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Job Type *</Label>
          <Input
            id="type"
            {...register("type")}
            placeholder="Installation, Repair, Maintenance, etc."
            data-testid="input-type"
          />
          {errors.type && (
            <p className="text-sm text-destructive">{errors.type.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="value">Job Value *</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              min="0"
              {...register("value", { valueAsNumber: true })}
              placeholder="500.00"
              data-testid="input-value"
            />
            {errors.value && (
              <p className="text-sm text-destructive">{errors.value.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="estimatedHours">Estimated Hours</Label>
            <Input
              id="estimatedHours"
              type="number"
              step="0.5"
              min="0"
              {...register("estimatedHours", { valueAsNumber: true })}
              placeholder="4"
              data-testid="input-estimated-hours"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={selectedStatus}
              onValueChange={(value: any) => setValue("status", value)}
            >
              <SelectTrigger id="status" data-testid="select-status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={selectedPriority}
              onValueChange={(value: any) => setValue("priority", value)}
            >
              <SelectTrigger id="priority" data-testid="select-priority">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Scheduled Date (Optional)</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !scheduledDate && "text-muted-foreground"
                )}
                data-testid="button-scheduled-date"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {scheduledDate ? format(scheduledDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={scheduledDate}
                onSelect={(date) => {
                  setScheduledDate(date);
                  setValue("scheduledDate", date);
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="estimate">Link to Estimate (Optional)</Label>
          <Popover open={estimatePopoverOpen} onOpenChange={setEstimatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={estimatePopoverOpen}
                className="w-full justify-between"
                data-testid="button-select-estimate"
                type="button"
              >
                {selectedEstimateId
                  ? (estimateSearchResults.find(e => e.id === selectedEstimateId)?.title ?? "Estimate linked")
                  : "Search for an estimate..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Type to search estimates..."
                  value={estimateSearchQuery}
                  onValueChange={setEstimateSearchQuery}
                />
                <CommandList>
                  {selectedEstimateId && (
                    <CommandItem
                      onSelect={() => {
                        setValue("estimateId", undefined);
                        setEstimatePopoverOpen(false);
                      }}
                    >
                      Clear selection
                    </CommandItem>
                  )}
                  {estimateSearchQuery.length < 2 ? (
                    <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
                  ) : estimatesSearchLoading ? (
                    <CommandEmpty>Searching...</CommandEmpty>
                  ) : estimateSearchResults.length === 0 ? (
                    <CommandEmpty>No estimates found</CommandEmpty>
                  ) : (
                    <CommandGroup>
                      {estimateSearchResults.map((est) => (
                        <CommandItem
                          key={est.id}
                          value={est.id}
                          onSelect={() => {
                            setValue("estimateId", est.id);
                            setEstimatePopoverOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", selectedEstimateId === est.id ? "opacity-100" : "opacity-0")} />
                          {est.title} — ${Number(est.amount).toLocaleString()}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
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
            disabled={createJobMutation.isPending}
            data-testid="button-create-job"
          >
            {createJobMutation.isPending ? "Creating..." : "Create Job"}
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
