import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, addDays, isToday, isTomorrow, startOfWeek, addWeeks } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Calendar as CalendarIcon, Clock, User, MapPin, Phone, Mail, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Salesperson {
  userId: string;
  name: string;
  email: string;
  housecallProUserId: string | null;
  lastAssignmentAt: string | null;
  calendarColor: string | null;
  isSalesperson: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  hasCustomSchedule: boolean;
}

interface HCPEstimate {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
  work_status?: string;
}

// Default working hours for salespeople (9 AM - 5 PM, Mon-Fri)
const DEFAULT_WORKING_HOURS = { start: "09:00", end: "17:00" };
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Monday to Friday
const BUFFER_MINUTES = 30; // 30-minute buffer before and after appointments

// Generate time slots for a given date and salesperson (1-hour duration, 15-minute intervals)
const SLOT_DURATION_MINUTES = 60; // Each appointment is 1 hour
const SLOT_INTERVAL_MINUTES = 15; // Offer slots every 15 minutes

const generateTimeSlots = (
  date: Date, 
  salesperson: Salesperson | null,
  busySlots: Array<{ start: Date; end: Date }> = []
) => {
  // Use salesperson's working hours if available, otherwise use defaults
  // Guard against null/empty values that could cause split(':') to fail
  const workingDays = (salesperson?.workingDays && salesperson.workingDays.length > 0) 
    ? salesperson.workingDays 
    : DEFAULT_WORKING_DAYS;
  const workingHoursStart = (salesperson?.workingHoursStart && salesperson.workingHoursStart.includes(':')) 
    ? salesperson.workingHoursStart 
    : DEFAULT_WORKING_HOURS.start;
  const workingHoursEnd = (salesperson?.workingHoursEnd && salesperson.workingHoursEnd.includes(':')) 
    ? salesperson.workingHoursEnd 
    : DEFAULT_WORKING_HOURS.end;
  
  const dayOfWeek = date.getDay();
  
  // Check if it's a working day for this salesperson
  if (!workingDays.includes(dayOfWeek)) {
    return [];
  }
  
  const slots = [];
  const [startHour, startMinute = 0] = workingHoursStart.split(':').map(Number);
  const [endHour, endMinute = 0] = workingHoursEnd.split(':').map(Number);
  
  // Convert to minutes for easier calculation
  const dayStartMinutes = startHour * 60 + startMinute;
  const dayEndMinutes = endHour * 60 + endMinute;
  
  // Generate slots every 15 minutes, each with 1-hour duration
  for (let slotStartMinutes = dayStartMinutes; slotStartMinutes + SLOT_DURATION_MINUTES <= dayEndMinutes; slotStartMinutes += SLOT_INTERVAL_MINUTES) {
    const slotEndMinutes = slotStartMinutes + SLOT_DURATION_MINUTES;
    
    const startHr = Math.floor(slotStartMinutes / 60);
    const startMin = slotStartMinutes % 60;
    const endHr = Math.floor(slotEndMinutes / 60);
    const endMin = slotEndMinutes % 60;
    
    const timeString = `${startHr.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
    const endTimeString = `${endHr.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;
    
    // Create Date objects for this slot (with buffer)
    const slotStart = new Date(date);
    slotStart.setHours(startHr, startMin, 0, 0);
    const slotStartWithBuffer = new Date(slotStart.getTime() - BUFFER_MINUTES * 60 * 1000);
    
    const slotEnd = new Date(date);
    slotEnd.setHours(endHr, endMin, 0, 0);
    const slotEndWithBuffer = new Date(slotEnd.getTime() + BUFFER_MINUTES * 60 * 1000);
    
    // Check if this slot conflicts with any busy slots (including buffer)
    const isConflicting = busySlots.some(busy => {
      // Slot conflicts if busy time overlaps with slot+buffer time
      return slotStartWithBuffer < busy.end && slotEndWithBuffer > busy.start;
    });
    
    slots.push({
      value: timeString,
      label: `${timeString} - ${endTimeString}`,
      available: !isConflicting,
    });
  }
  
  return slots;
};

interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  description?: string;
}

interface LocalSchedulingModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onScheduled?: (lead: Lead) => void;
}

const scheduleFormSchema = z.object({
  salespersonId: z.string().min(1, "Please select a salesperson"),
  date: z.date({ required_error: "Please select a date" }),
  timeSlot: z.string().min(1, "Please select a time slot"),
  address: z.string().optional(),
  notes: z.string().optional(),
});

type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export function LocalSchedulingModal({ lead, isOpen, onClose, onScheduled }: LocalSchedulingModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSalesperson, setSelectedSalesperson] = useState<Salesperson | null>(null);

  // Fetch salespeople from the API (only those marked as salespeople)
  const { data: allTeamMembers = [], isLoading: salespeopleLoading } = useQuery<Salesperson[]>({
    queryKey: ['/api/scheduling/salespeople'],
    enabled: isOpen,
  });

  // Filter to only show users marked as salespeople
  const salespeople = allTeamMembers.filter(member => member.isSalesperson);

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      notes: "",
    },
  });

  const selectedDate = form.watch('date');
  const selectedSalespersonId = form.watch('salespersonId');

  // Update selected salesperson when form value changes
  useEffect(() => {
    const salesperson = salespeople.find(s => s.userId === selectedSalespersonId);
    setSelectedSalesperson(salesperson || null);
  }, [selectedSalespersonId, salespeople]);

  // Reset time slot when date or salesperson changes
  useEffect(() => {
    form.setValue('timeSlot', '');
  }, [selectedDate, selectedSalespersonId, form]);

  // Fetch HCP estimates for selected salesperson and date
  const formattedDate = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '';
  const { data: hcpEstimates = [], isLoading: estimatesLoading } = useQuery<HCPEstimate[]>({
    queryKey: ['/api/housecall/employee-estimates', selectedSalesperson?.housecallProUserId, formattedDate],
    queryFn: async () => {
      if (!selectedSalesperson?.housecallProUserId || !selectedDate) return [];
      const response = await fetch(`/api/housecall/employee-estimates?employeeId=${selectedSalesperson.housecallProUserId}&date=${formattedDate}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: isOpen && !!selectedSalesperson?.housecallProUserId && !!selectedDate,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Convert HCP estimates to busy slots
  const busySlots = hcpEstimates
    .filter(e => e.scheduled_start && e.scheduled_end)
    .map(estimate => ({
      start: new Date(estimate.scheduled_start),
      end: new Date(estimate.scheduled_end),
    }));

  // Generate available time slots with busy slot checking
  const availableSlots = selectedSalesperson && selectedDate 
    ? generateTimeSlots(selectedDate, selectedSalesperson, busySlots) 
    : [];

  // Schedule mutation
  const scheduleMutation = useMutation({
    mutationFn: async (data: ScheduleFormValues) => {
      const salesperson = salespeople.find(s => s.userId === data.salespersonId);
      
      // Check if the selected time is available
      const selectedSlot = availableSlots.find(s => s.value === data.timeSlot);
      if (selectedSlot && !selectedSlot.available) {
        throw new Error("This time slot conflicts with an existing appointment. Please choose a different time.");
      }
      
      // Calculate scheduled start and end times (now handles HH:MM format)
      const scheduledDate = format(data.date, 'yyyy-MM-dd');
      const [hour, minute = 0] = data.timeSlot.split(':').map(Number);
      const startDateTime = new Date(data.date);
      startDateTime.setHours(hour, minute, 0, 0);
      const endDateTime = new Date(startDateTime.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
      
      const scheduleData = {
        leadId: lead?.id,
        salespersonId: data.salespersonId,
        salespersonName: salesperson?.name,
        scheduledDate: scheduledDate,
        scheduledTime: data.timeSlot,
        scheduledStart: startDateTime.toISOString(),
        scheduledEnd: endDateTime.toISOString(),
        notes: data.notes,
        type: 'estimate_appointment',
        housecallProEmployeeId: salesperson?.housecallProUserId,
        createHCPEstimate: true, // Flag to create HCP estimate
      };

      // Create the appointment via unified scheduling (will create HCP estimate if integration enabled)
      // Only include housecallProEmployeeId if salesperson has HCP linkage (for CRM-only salespeople, omit it)
      const bookingPayload: Record<string, any> = {
        startTime: startDateTime.toISOString(),
        title: `Estimate Appointment - ${lead?.name || 'Lead'}`,
        customerName: lead?.name || 'Unknown',
        customerEmail: lead?.email,
        customerPhone: lead?.phone,
        customerAddress: data.address || lead?.address,
        notes: data.notes,
        contactId: lead?.id,
        salespersonId: data.salespersonId,
      };
      
      // Only add HCP employee ID if salesperson has HCP linkage
      if (salesperson?.housecallProUserId) {
        bookingPayload.housecallProEmployeeId = salesperson.housecallProUserId;
      }
      
      await apiRequest('POST', '/api/scheduling/book', bookingPayload);
      
      // Update lead status to scheduled and persist any address entered during scheduling
      await apiRequest('PATCH', `/api/contacts/${lead?.id}`, {
        status: 'scheduled',
        scheduledDate: `${format(data.date, 'MMM dd, yyyy')} at ${data.timeSlot}`,
        ...(data.address ? { address: data.address } : {}),
      });

      return scheduleData;
    },
    onSuccess: () => {
      toast({
        title: "Appointment Scheduled",
        description: `Estimate appointment scheduled with ${selectedSalesperson?.name}`,
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/paginated'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contacts/status-counts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
      
      // Close modal and notify parent
      onClose();
      if (lead && onScheduled) {
        onScheduled(lead);
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
    scheduleMutation.mutate(data);
  };

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      form.reset({
        address: lead?.address || "",
        notes: `Estimate appointment for ${lead?.name}`,
      });
    }
  }, [isOpen, lead, form]);

  const formatDate = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "MMM dd, yyyy");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Schedule Estimate Appointment
          </DialogTitle>
          <DialogDescription>
            Schedule an estimate appointment for {lead?.name} with one of your sales team members.
          </DialogDescription>
        </DialogHeader>

        {lead && (
          <Card className="mb-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lead Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{lead.name}</span>
              </div>
              {lead.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.email}</span>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.phone}</span>
                </div>
              )}
              {lead.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.address}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Service Address
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter service address (sent to Housecall Pro)"
                      {...field}
                      data-testid="input-schedule-address"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="salespersonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Salesperson</FormLabel>
                  <FormControl>
                    {salespeopleLoading ? (
                      <div className="flex items-center gap-2 p-3 border rounded-md">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-muted-foreground">Loading salespeople...</span>
                      </div>
                    ) : salespeople.length === 0 ? (
                      <div className="p-3 border rounded-md text-muted-foreground">
                        No salespeople configured. Go to Settings → Salespeople to add team members.
                      </div>
                    ) : (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger data-testid="select-salesperson">
                          <SelectValue placeholder="Choose a salesperson" />
                        </SelectTrigger>
                        <SelectContent>
                          {salespeople.map((person) => (
                            <SelectItem key={person.userId} value={person.userId}>
                              <div className="flex items-center gap-2">
                                <div>
                                  <div className="font-medium">{person.name}</div>
                                  <div className="text-xs text-muted-foreground">{person.email}</div>
                                </div>
                              </div>
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

            {selectedSalesperson && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Salesperson Details</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedSalesperson.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>Working hours: 9:00 AM - 5:00 PM</span>
                  </div>
                  {selectedSalesperson.housecallProUserId && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Housecall Pro Linked</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Date</FormLabel>
                  <FormControl>
                    <div className="border rounded-md p-3">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date() || date < new Date(new Date().setHours(0, 0, 0, 0))}
                        className="rounded-md"
                        data-testid="calendar-date-picker"
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
                render={({ field }) => {
                  const selectedSlot = availableSlots.find(s => s.value === field.value);
                  const isConflict = selectedSlot && !selectedSlot.available;
                  
                  return (
                    <FormItem>
                      <FormLabel>Select Time</FormLabel>
                      <FormControl>
                        {availableSlots.length > 0 ? (
                          <div className="space-y-2">
                            <Select onValueChange={field.onChange} value={field.value}>
                              <SelectTrigger data-testid="select-time-slot" className={isConflict ? "border-destructive" : ""}>
                                <SelectValue placeholder="Choose a start time">
                                  {field.value && (
                                    <div className="flex items-center gap-2">
                                      <Clock className="h-4 w-4" />
                                      <span>{availableSlots.find(s => s.value === field.value)?.label}</span>
                                    </div>
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="max-h-[300px]">
                                {availableSlots.map((slot) => (
                                  <SelectItem 
                                    key={slot.value} 
                                    value={slot.value}
                                    className={!slot.available ? "text-muted-foreground" : ""}
                                  >
                                    <div className="flex items-center gap-2 w-full">
                                      <span>{slot.label}</span>
                                      {!slot.available && (
                                        <Badge variant="outline" className="ml-2 text-xs">
                                          Busy
                                        </Badge>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {isConflict && (
                              <p className="text-sm text-destructive flex items-center gap-1">
                                <span>This time conflicts with an existing appointment. Choose a different time.</span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-4 text-muted-foreground">
                            {selectedSalesperson 
                              ? `No available slots on ${formatDate(selectedDate)} (weekdays only)`
                              : "Please select a salesperson and date"
                            }
                          </div>
                        )}
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
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
                disabled={scheduleMutation.isPending}
                data-testid="button-confirm-schedule"
              >
                {scheduleMutation.isPending ? "Scheduling..." : "Schedule Appointment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}