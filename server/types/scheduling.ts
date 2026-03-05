export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface BusyWindow {
  start: string;
  end: string;
}

export interface AvailableSlot {
  start: Date;
  end: Date;
  availableSalespersonIds: string[];
}

export interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export function parseAddressString(address: string): AddressComponents {
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) {
    const street = parts[0];
    const city = parts[1];
    const stateZipMatch = parts[2].match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
      return {
        street,
        city,
        state: stateZipMatch[1],
        zip: stateZipMatch[2],
        country: parts[3]?.trim() || 'US',
      };
    }
  }
  return { street: address, city: '', state: '', zip: '', country: 'US' };
}

export interface BookingRequest {
  startTime: Date;
  title: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerAddressComponents?: AddressComponents;
  notes?: string;
  contactId?: string;
  salespersonId?: string;
  housecallProEmployeeId?: string;
  timezone?: string;
}

export interface BookingResult {
  success: boolean;
  bookingId?: string;
  assignedSalespersonId?: string;
  assignedSalespersonName?: string;
  housecallProEventId?: string;
  error?: string;
}

export interface SalespersonInfo {
  userId: string;
  name: string;
  email: string;
  housecallProUserId: string | null;
  lastAssignmentAt: Date | null;
  calendarColor: string | null;
  isSalesperson: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  hasCustomSchedule: boolean;
}
