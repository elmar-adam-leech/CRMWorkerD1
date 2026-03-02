import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, Clock, User, Mail, Phone, MapPin, CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

interface PublicPlacesInputProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (formatted: string, components: AddressComponents) => void;
  placeholder?: string;
}

function PublicPlacesInput({ value, onChange, onAddressSelect, placeholder }: PublicPlacesInputProps) {
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; text: string }>>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = async (input: string) => {
    if (!input || input.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    try {
      const resp = await fetch(`/api/public/places/autocomplete?input=${encodeURIComponent(input)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const mapped = (data.suggestions || []).map((s: any) => ({
        placeId: s.placePrediction?.placeId || '',
        text: s.placePrediction?.text?.text || '',
      })).filter((s: any) => s.placeId && s.text);
      setSuggestions(mapped);
      setShowDropdown(mapped.length > 0);
    } catch (e) {
      console.warn('[Places] Failed to fetch suggestions:', e);
    }
  };

  const handleInputChange = (val: string) => {
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleSelect = async (suggestion: { placeId: string; text: string }) => {
    setShowDropdown(false);
    setSuggestions([]);
    onChange(suggestion.text);
    try {
      const resp = await fetch(`/api/public/places/details?placeId=${encodeURIComponent(suggestion.placeId)}`);
      if (!resp.ok) {
        onAddressSelect(suggestion.text, { street: suggestion.text, city: '', state: '', zip: '', country: 'US' });
        return;
      }
      const place = await resp.json();
      let streetNumber = '', route = '', city = '', state = '', zip = '';
      for (const component of (place.addressComponents || [])) {
        const types: string[] = component.types || [];
        if (types.includes('street_number')) streetNumber = component.longText || '';
        else if (types.includes('route')) route = component.longText || '';
        else if (types.includes('locality')) city = component.longText || '';
        else if (types.includes('administrative_area_level_1')) state = component.shortText || '';
        else if (types.includes('postal_code')) zip = component.longText || '';
      }
      const street = [streetNumber, route].filter(Boolean).join(' ');
      const formatted = place.formattedAddress || suggestion.text;
      onChange(formatted);
      onAddressSelect(formatted, { street, city, state, zip, country: 'US' });
    } catch (e) {
      console.warn('[Places] Failed to fetch place details:', e);
      onAddressSelect(suggestion.text, { street: suggestion.text, city: '', state: '', zip: '', country: 'US' });
    }
  };

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
        placeholder={placeholder}
        data-testid="input-address"
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-background border rounded-md shadow-md overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover-elevate cursor-pointer"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
            >
              {s.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ContractorInfo {
  id: string;
  name: string;
  bookingSlug: string;
}

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

const bookingFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email is required").or(z.string().length(0)),
  phone: z.string().min(10, "Valid phone number is required").or(z.string().length(0)),
  address: z.string().optional(),
  date: z.date({ required_error: "Please select a date" }),
  timeSlot: z.string().min(1, "Please select a time slot"),
  notes: z.string().optional(),
}).refine((data) => data.email || data.phone, {
  message: "Email or phone number is required",
  path: ["email"],
});

type BookingFormValues = z.infer<typeof bookingFormSchema>;

interface PrefillData {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export default function PublicBooking() {
  const { slug } = useParams();
  const searchString = useSearch();
  const urlParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const isEmbedded = urlParams.get('embed') === 'true';
  const contactId = urlParams.get('contact');
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingDetails, setBookingDetails] = useState<{ startTime: string } | null>(null);
  const [addressComponents, setAddressComponents] = useState<AddressComponents | null>(null);

  const { data: contractorData, isLoading: contractorLoading, error: contractorError } = useQuery<{ contractor: ContractorInfo }>({
    queryKey: ['/api/public/book', slug],
    queryFn: async () => {
      const response = await fetch(`/api/public/book/${slug}`);
      if (!response.ok) {
        throw new Error("Booking page not found");
      }
      return response.json();
    },
    enabled: !!slug,
  });

  // Fetch contact data for prefilling if contactId is provided
  const { data: prefillData } = useQuery<{ prefill: PrefillData }>({
    queryKey: ['/api/public/book', slug, 'contact', contactId],
    queryFn: async () => {
      const response = await fetch(`/api/public/book/${slug}/contact/${contactId}`);
      if (!response.ok) {
        return { prefill: null };
      }
      return response.json();
    },
    enabled: !!slug && !!contactId,
  });

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
  });

  const selectedDate = form.watch('date');

  const startDate = selectedDate ? format(startOfDay(selectedDate), "yyyy-MM-dd'T'HH:mm:ss") : undefined;
  const endDate = selectedDate ? format(addDays(startOfDay(selectedDate), 1), "yyyy-MM-dd'T'HH:mm:ss") : undefined;

  const { data: availabilityData, isLoading: slotsLoading } = useQuery<{ slots: TimeSlot[] }>({
    queryKey: ['/api/public/book', slug, 'availability', startDate, endDate],
    queryFn: async () => {
      const response = await fetch(`/api/public/book/${slug}/availability?startDate=${startDate}&endDate=${endDate}`);
      if (!response.ok) {
        throw new Error("Failed to load availability");
      }
      return response.json();
    },
    enabled: !!slug && !!selectedDate,
  });

  const availableSlots = (availabilityData?.slots || [])
    .filter(slot => slot.available)
    .filter(slot => {
      const slotDate = new Date(slot.start);
      return isSameDay(slotDate, selectedDate!);
    })
    .map(slot => {
      const start = new Date(slot.start);
      const end = new Date(slot.end);
      return {
        value: slot.start,
        label: `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`,
      };
    });

  useEffect(() => {
    form.setValue('timeSlot', '');
  }, [selectedDate, form]);

  // Prefill form when contact data is loaded
  useEffect(() => {
    if (prefillData?.prefill) {
      const { name, email, phone, address } = prefillData.prefill;
      if (name) form.setValue('name', name);
      if (email) form.setValue('email', email);
      if (phone) form.setValue('phone', phone);
      if (address) form.setValue('address', address);
    }
  }, [prefillData, form]);

  const bookingMutation = useMutation({
    mutationFn: async (data: BookingFormValues) => {
      const response = await fetch(`/api/public/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email || undefined,
          phone: data.phone || undefined,
          address: data.address || undefined,
          customerAddressComponents: addressComponents || undefined,
          startTime: data.timeSlot,
          notes: data.notes,
          source: 'public_booking',
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to book appointment");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setBookingDetails({ startTime: form.getValues('timeSlot') });
      setBookingComplete(true);
    },
  });

  const onSubmit = (data: BookingFormValues) => {
    bookingMutation.mutate(data);
  };

  if (contractorLoading) {
    return (
      <div className={`flex items-center justify-center bg-background ${isEmbedded ? 'min-h-[400px]' : 'min-h-screen'}`}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (contractorError || !contractorData?.contractor) {
    return (
      <div className={`flex items-center justify-center bg-background p-4 ${isEmbedded ? 'min-h-[400px]' : 'min-h-screen'}`}>
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Booking Page Not Found</h2>
            <p className="text-muted-foreground">
              This booking link is invalid or the company hasn't set up their booking page yet.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bookingComplete && bookingDetails) {
    const appointmentDate = new Date(bookingDetails.startTime);
    return (
      <div className={`flex items-center justify-center bg-background p-4 ${isEmbedded ? 'min-h-[400px]' : 'min-h-screen'}`}>
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Appointment Booked!</h2>
            <p className="text-muted-foreground mb-4">
              Your appointment with {contractorData.contractor.name} has been confirmed.
            </p>
            <div className="bg-muted rounded-lg p-4 text-left">
              <div className="flex items-center gap-2 mb-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{format(appointmentDate, 'EEEE, MMMM d, yyyy')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{format(appointmentDate, 'h:mm a')}</span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              You'll receive a confirmation shortly. If you need to make changes, please contact us directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`bg-background px-4 ${isEmbedded ? 'py-4' : 'min-h-screen py-8'}`}>
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl flex items-center justify-center gap-2">
              <CalendarIcon className="h-6 w-6" />
              Schedule an Appointment
            </CardTitle>
            <CardDescription className="text-lg">
              Book a free estimate with {contractorData.contractor.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Your Information
                  </h3>
                  
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="John Smith" {...field} data-testid="input-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            Email
                          </FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="john@example.com" {...field} data-testid="input-email" />
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
                          <FormLabel className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            Phone
                          </FormLabel>
                          <FormControl>
                            <Input type="tel" placeholder="(555) 123-4567" {...field} data-testid="input-phone" />
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
                        <FormLabel className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          Address (Optional)
                        </FormLabel>
                        <FormControl>
                          <PublicPlacesInput
                            value={field.value || ''}
                            onChange={field.onChange}
                            onAddressSelect={(formatted, components) => {
                              field.onChange(formatted);
                              setAddressComponents(components);
                            }}
                            placeholder="123 Main St, City, State"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Select Date & Time
                  </h3>

                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <div className="border rounded-md p-3 flex justify-center">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => date < new Date() || date < startOfDay(new Date())}
                              className="rounded-md"
                              data-testid="calendar-booking"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedDate && (
                    <FormField
                      control={form.control}
                      name="timeSlot"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Available Times for {format(selectedDate, 'MMMM d, yyyy')}</FormLabel>
                          <FormControl>
                            {slotsLoading ? (
                              <div className="flex items-center gap-2 p-3 border rounded-md">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-muted-foreground">Loading available times...</span>
                              </div>
                            ) : availableSlots.length === 0 ? (
                              <div className="p-4 border rounded-md text-center text-muted-foreground">
                                No available times on this date. Please select another day.
                              </div>
                            ) : (
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger data-testid="select-time">
                                  <SelectValue placeholder="Choose a time slot" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                  {availableSlots.map((slot) => (
                                    <SelectItem key={slot.value} value={slot.value}>
                                      {slot.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>

                <Separator />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Additional Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Tell us about your project or any specific requirements..."
                          className="resize-none"
                          rows={3}
                          {...field}
                          data-testid="textarea-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {bookingMutation.isError && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {bookingMutation.error?.message || "Failed to book appointment. Please try again."}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={bookingMutation.isPending}
                  data-testid="button-submit-booking"
                >
                  {bookingMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Booking...
                    </>
                  ) : (
                    "Book Appointment"
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  By booking, you agree to be contacted regarding your appointment.
                </p>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
