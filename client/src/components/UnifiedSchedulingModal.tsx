import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, isSameDay, startOfDay, addDays, isToday, isTomorrow } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, User, MapPin, Phone, Mail, Users, CheckCircle2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AvailabilitySlot {
  start: string;
  end: string;
  availableCount: number;
}

interface AvailabilityResponse {
  startDate: string;
  endDate: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  slots: AvailabilitySlot[];
}

interface Contact {
  id: string;
  name: string;
  email?: string | null;
  emails?: string[] | null;
  phone?: string | null;
  phones?: string[] | null;
  address?: string | null;
}

interface UnifiedSchedulingModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onScheduled?: (contact: Contact) => void;
  appointmentTitle?: string;
}

const scheduleFormSchema = z.object({
  selectedSlot: z.string().min(1, "Please select a time slot"),
  notes: z.string().optional(),
});

type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export function UnifiedSchedulingModal({ 
  contact, 
  isOpen, 
  onClose, 
  onScheduled,
  appointmentTitle = "Estimate Appointment"
}: UnifiedSchedulingModalProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(addDays(new Date(), 1));

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      notes: "",
    },
  });

  const { data: availability, isLoading: isLoadingAvailability } = useQuery<AvailabilityResponse>({
    queryKey: ['/api/scheduling/availability', { days: 14 }],
    enabled: isOpen,
  });

  const slotsForSelectedDate = useMemo(() => {
    if (!availability?.slots || !selectedDate) return [];
    
    return availability.slots.filter(slot => {
      const slotDate = new Date(slot.start);
      return isSameDay(slotDate, selectedDate);
    });
  }, [availability?.slots, selectedDate]);

  const datesWithAvailability = useMemo(() => {
    if (!availability?.slots) return new Set<string>();
    
    const dates = new Set<string>();
    availability.slots.forEach(slot => {
      const date = startOfDay(new Date(slot.start));
      dates.add(date.toISOString());
    });
    return dates;
  }, [availability?.slots]);

  const bookMutation = useMutation({
    mutationFn: async (data: ScheduleFormValues) => {
      const startTime = new Date(data.selectedSlot);
      
      if (isNaN(startTime.getTime())) {
        throw new Error("Invalid time slot selected");
      }
      
      const response = await apiRequest('POST', '/api/scheduling/book', {
        startTime: startTime.toISOString(),
        title: appointmentTitle,
        customerName: contact?.name || 'Unknown',
        customerEmail: contact?.email || contact?.emails?.[0],
        customerPhone: contact?.phone || contact?.phones?.[0],
        notes: data.notes,
        contactId: contact?.id,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Appointment Scheduled",
        description: data.assignedSalespersonName 
          ? `Appointment scheduled with ${data.assignedSalespersonName}`
          : "Appointment successfully scheduled",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/scheduling/availability'] });
      queryClient.invalidateQueries({ queryKey: ['/api/scheduling/bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      
      onClose();
      if (contact && onScheduled) {
        onScheduled(contact);
      }
    },
    onError: (error: any) => {
      toast({
        title: "Scheduling Failed",
        description: error.message || "Failed to schedule appointment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ScheduleFormValues) => {
    bookMutation.mutate(data);
  };

  const formatSlotTime = (isoString: string) => {
    const date = new Date(isoString);
    return format(date, "h:mm a");
  };

  const formatDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "MMM dd, yyyy");
  };

  const hasAvailabilityOnDate = (date: Date) => {
    return datesWithAvailability.has(startOfDay(date).toISOString());
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Schedule Appointment
          </DialogTitle>
          <DialogDescription>
            Select a time slot and we'll automatically assign the best available salesperson.
          </DialogDescription>
        </DialogHeader>

        {contact && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{contact.name}</span>
              </div>
              {(contact.email || contact.emails?.[0]) && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{contact.email || contact.emails?.[0]}</span>
                </div>
              )}
              {(contact.phone || contact.phones?.[0]) && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{contact.phone || contact.phones?.[0]}</span>
                </div>
              )}
              {contact.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{contact.address}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Clock className="h-4 w-4" />
          <span>1-hour appointments with 30-minute buffer between slots</span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <FormLabel>Select Date</FormLabel>
              <div className="border rounded-md p-3 mt-2">
                {isLoadingAvailability ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-[200px] w-full" />
                  </div>
                ) : (
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      form.setValue('selectedSlot', '');
                    }}
                    disabled={(date) => {
                      const today = startOfDay(new Date());
                      if (date < today) return true;
                      return !hasAvailabilityOnDate(date);
                    }}
                    modifiers={{
                      available: (date) => hasAvailabilityOnDate(date),
                    }}
                    modifiersClassNames={{
                      available: "bg-primary/10 font-medium",
                    }}
                    className="rounded-md"
                    data-testid="calendar-date-picker"
                  />
                )}
              </div>
            </div>

            {selectedDate && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Available Times for {formatDateLabel(selectedDate)}
                  </label>
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" />
                    {slotsForSelectedDate.length} slots
                  </Badge>
                </div>
                <FormField
                  control={form.control}
                  name="selectedSlot"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        {isLoadingAvailability ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {[1, 2, 3, 4].map(i => (
                              <Skeleton key={i} className="h-14 w-full" />
                            ))}
                          </div>
                        ) : slotsForSelectedDate.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {slotsForSelectedDate.map((slot) => (
                              <Button
                                key={slot.start}
                                type="button"
                                variant={field.value === slot.start ? "default" : "outline"}
                                className="h-auto p-3 justify-start"
                                onClick={() => field.onChange(slot.start)}
                                data-testid={`time-slot-${slot.start}`}
                              >
                                <div className="flex items-center gap-2 w-full">
                                  <Clock className="h-4 w-4" />
                                  <span>{formatSlotTime(slot.start)} - {formatSlotTime(slot.end)}</span>
                                  <Badge variant="secondary" className="ml-auto gap-1">
                                    <Users className="h-3 w-3" />
                                    {slot.availableCount}
                                  </Badge>
                                </div>
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-4 text-muted-foreground">
                            No available time slots for {formatDateLabel(selectedDate)}
                          </div>
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any specific notes about this appointment..."
                      className="resize-none"
                      rows={3}
                      {...field}
                      data-testid="textarea-appointment-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                data-testid="button-cancel-schedule"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={bookMutation.isPending || !form.watch('selectedSlot')}
                data-testid="button-confirm-schedule"
              >
                {bookMutation.isPending ? (
                  <>Scheduling...</>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Confirm Booking
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
