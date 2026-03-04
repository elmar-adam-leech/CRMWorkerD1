import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  id: string;
  name: string;
  type: string;
  emails: string[];
  phones: string[];
}

const createCustomerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().min(1, "Phone number is required"),
});

type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;

interface ContactComboboxProps {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}

export function ContactCombobox({ value, onChange, error }: ContactComboboxProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['/api/contacts/paginated', { limit: 100 }],
    queryFn: async () => {
      const response = await fetch('/api/contacts/paginated?limit=100', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const result = await response.json();
      return result.data ?? [];
    },
  });

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.emails?.some(e => e.toLowerCase().includes(searchQuery.toLowerCase())) ||
    contact.phones?.some(p => p.includes(searchQuery))
  );

  const selectedContact = contacts.find(c => c.id === value);

  const {
    register,
    handleSubmit,
    formState: { errors: formErrors },
    reset,
  } = useForm<CreateCustomerFormData>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: { name: searchQuery },
  });

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
      toast({ title: "Customer created", description: "New customer has been created successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      onChange(newCustomer.id);
      setShowCreateDialog(false);
      reset();
      setSearchQuery("");
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to create customer",
        description: error.message || "Please try again",
      });
    },
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            data-testid="button-select-contact"
          >
            {selectedContact
              ? `${selectedContact.name} - ${selectedContact.emails?.[0] || selectedContact.phones?.[0] || 'No contact info'}`
              : isLoading
                ? "Loading contacts..."
                : "Search for a customer..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search customers..."
              value={searchQuery}
              onValueChange={setSearchQuery}
              data-testid="input-search-customer"
            />
            <CommandList>
              <CommandEmpty>
                <div className="p-2 text-sm text-muted-foreground">No customer found.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => { setShowCreateDialog(true); setOpen(false); }}
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
                      onChange(contact.id);
                      setOpen(false);
                      setSearchQuery("");
                    }}
                    data-testid={`option-contact-${contact.id}`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === contact.id ? "opacity-100" : "opacity-0")} />
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
                    onSelect={() => { setShowCreateDialog(true); setOpen(false); }}
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
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent data-testid="dialog-create-customer">
          <DialogHeader>
            <DialogTitle>Create New Customer</DialogTitle>
            <DialogDescription>
              Enter the customer's contact information. At least one phone number is required.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit((data) => createCustomerMutation.mutate(data))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customer-name">Name *</Label>
              <Input id="customer-name" {...register("name")} placeholder="John Doe" data-testid="input-customer-name" />
              {formErrors.name && <p className="text-sm text-destructive">{formErrors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-email">Email (Optional)</Label>
              <Input id="customer-email" type="email" {...register("email")} placeholder="john@example.com" data-testid="input-customer-email" />
              {formErrors.email && <p className="text-sm text-destructive">{formErrors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-phone">Phone *</Label>
              <Input id="customer-phone" type="tel" {...register("phone")} placeholder="(443) 415-4374" data-testid="input-customer-phone" />
              {formErrors.phone && <p className="text-sm text-destructive">{formErrors.phone.message}</p>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowCreateDialog(false); reset(); }}
                data-testid="button-cancel-customer"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createCustomerMutation.isPending} data-testid="button-save-customer">
                {createCustomerMutation.isPending ? "Creating..." : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
