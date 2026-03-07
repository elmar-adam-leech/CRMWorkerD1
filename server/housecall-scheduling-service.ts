import { db } from './db';
import { users, userContractors, scheduledBookings, contacts, estimates, contractors } from '@shared/schema';
import { eq, and, gte, lte, asc, sql } from 'drizzle-orm';
import { housecallProService } from './housecall-pro-service';
import type { TimeSlot, BusyWindow, AvailableSlot, AddressComponents, BookingRequest, BookingResult, SalespersonInfo } from './types/scheduling';
import { parseAddressString } from './types/scheduling';
import {
  parseWorkingHours as parseWorkingHoursUtil,
  createDateInTimezone as createDateInTimezoneUtil,
  getDayOfWeekInTimezone as getDayOfWeekInTimezoneUtil,
} from './utils/time';

/**
 * Housecall Pro employee object shape as returned by the HCP API.
 *
 * The HCP API is not strictly typed in our codebase (no SDK). This interface
 * captures the fields we actually use. Any additional fields returned by HCP
 * are simply ignored. If the HCP API changes field names, update this interface
 * and the usages below — the TypeScript compiler will highlight every call-site.
 *
 * Fields marked optional reflect uncertainty about whether HCP always returns them
 * (the API docs are inconsistent). Runtime guards (|| null) are used at each access.
 */
interface HCPEmployee {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  /** `true` if the employee is active. HCP returns this field inconsistently — some
   *  responses use `is_active`, others `active`. Both are checked at usage sites. */
  is_active?: boolean;
  active?: boolean;
  /** Working day schedule data — format varies by HCP account configuration. */
  working_days?: number[];
  work_days?: number[];
  schedule?: {
    working_days?: number[];
    start_time?: string;
    end_time?: string;
  };
  working_hours_start?: string;
  working_hours_end?: string;
  work_start_time?: string;
  work_end_time?: string;
  /** Average rating for the employee, used in salesperson scoring. */
  average_rating?: number;
  /** Total number of jobs completed, used in salesperson scoring. */
  total_jobs?: number;
}

export type { TimeSlot, BusyWindow, AvailableSlot, AddressComponents, BookingRequest, BookingResult, SalespersonInfo };

const SLOT_DURATION_MINUTES = 60;
const SLOT_INTERVAL_MINUTES = 15; // Time slots offered every 15 minutes for more booking options
const BUFFER_MINUTES = 30;
// const DEFAULT_WORKING_HOURS = { start: 8, end: 17 }; // Reserved for future use

export class HousecallSchedulingService {

  // ── Sync / Business Logic Methods ───────────────────────────────────────────
  // The methods in this service reconcile Housecall Pro employee/scheduling data
  // with the local database. They call housecallProService (API client) internally
  // and write to the local DB. Side effects on local state are expected and intentional.

  async syncHousecallUsers(tenantId: string): Promise<{ synced: number; created: number; updated: number; errors: string[]; hcpUsersFound: number }> {
    const result = { synced: 0, created: 0, updated: 0, errors: [] as string[], hcpUsersFound: 0 };
    
    try {
      console.log('[scheduling-sync] Fetching HCP employees for tenant:', tenantId);
      const hcpUsersResponse = await housecallProService.getEmployees(tenantId);
      
      if (!hcpUsersResponse.success || !hcpUsersResponse.data) {
        console.log('[scheduling-sync] Failed to fetch HCP users:', hcpUsersResponse.error);
        result.errors.push('Failed to fetch Housecall Pro users: ' + (hcpUsersResponse.error || 'Unknown error'));
        return result;
      }
      
      const hcpUsers = hcpUsersResponse.data as HCPEmployee[];
      result.hcpUsersFound = hcpUsers.length;
      console.log('[scheduling-sync] Found', hcpUsers.length, 'HCP users:', hcpUsers.map((u) => u.email));
      
      for (const hcpUser of hcpUsers) {
        console.log('[scheduling-sync] Processing HCP user:', hcpUser.email, 'is_active:', hcpUser.is_active, 'active:', hcpUser.active);
        
        // Skip users without email. Only skip if is_active is explicitly false (not undefined)
        const isActive = hcpUser.is_active !== false && hcpUser.active !== false;
        if (!hcpUser.email) {
          console.log('[scheduling-sync] Skipping emailless user:', hcpUser.first_name);
          continue;
        }
        if (!isActive) {
          console.log('[scheduling-sync] Skipping inactive user:', hcpUser.email);
          continue;
        }
        
        try {
          const email = hcpUser.email.toLowerCase().trim();
          const userName = `${hcpUser.first_name || ''} ${hcpUser.last_name || ''}`.trim() || email.split('@')[0];
          
          // Try to find existing user by email for THIS contractor only (tenant-scoped query)
          // This prevents cross-tenant data access by only looking at users already associated with this contractor
          const contractorUsers = await db.select({ user: users })
            .from(users)
            .innerJoin(userContractors, eq(users.id, userContractors.userId))
            .where(and(
              eq(userContractors.contractorId, tenantId),
              sql`LOWER(${users.email}) = ${email}`
            ))
            .limit(1);
          const existingUser = contractorUsers[0]?.user;
          
          let userId: string;
          
          if (existingUser) {
            // Update existing user
            userId = existingUser.id;
            console.log('[scheduling-sync] Found existing user:', email, '- updating');
            
            // Build update data - always set contractorId if it's null
            const updateData: any = {
              name: userName || existingUser.name,
            };
            
            // Set contractorId if not already set
            if (!existingUser.contractorId) {
              updateData.contractorId = tenantId;
            }
            
            await db.update(users)
              .set(updateData)
              .where(eq(users.id, userId));
            
            result.updated++;
          } else {
            // Create new user for this HCP employee
            console.log('[scheduling-sync] Creating new user for HCP employee:', email);
            
            // Generate a username from email
            const username = email.split('@')[0].replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            // Create the user with a random password (they can reset later)
            const bcrypt = await import('bcrypt');
            const randomPassword = Math.random().toString(36).slice(-12);
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            
            const [newUser] = await db.insert(users).values({
              username: username,
              email: email,
              name: userName,
              password: hashedPassword,
              role: 'user',
              contractorId: tenantId, // Associate user with the contractor that synced them
            }).returning();
            
            userId = newUser.id;
            result.created++;
            console.log('[scheduling-sync] Created new user:', email, 'with ID:', userId);
          }
          
          // Now handle user_contractors relationship
          const existingUC = await db.select()
            .from(userContractors)
            .where(and(
              eq(userContractors.userId, userId),
              eq(userContractors.contractorId, tenantId)
            ))
            .limit(1);
          
          // Extract working hours from HCP employee if available.
          // HCP provides schedule data in multiple possible field locations depending
          // on the account configuration and API version — the HCPEmployee interface
          // documents all known variants. Fall back to null if none are present.
          const hcpWorkingDays = hcpUser.working_days || hcpUser.work_days ||
            hcpUser.schedule?.working_days || null;
          const hcpWorkingHoursStart = hcpUser.working_hours_start ||
            hcpUser.schedule?.start_time || hcpUser.work_start_time || null;
          const hcpWorkingHoursEnd = hcpUser.working_hours_end ||
            hcpUser.schedule?.end_time || hcpUser.work_end_time || null;
          
          // Default working hours if not provided by HCP (Mon-Fri, 8AM-5PM)
          const defaultWorkingDays = [1, 2, 3, 4, 5]; // Monday to Friday
          const defaultWorkingHoursStart = "08:00";
          const defaultWorkingHoursEnd = "17:00";
          
          if (existingUC.length > 0) {
            // Only update HCP linkage and working hours (if not custom) - preserve isSalesperson setting
            const updateData: any = {
              housecallProUserId: hcpUser.id,
              // Do NOT overwrite isSalesperson - preserve existing setting
            };
            
            // Respect hasCustomSchedule flag - don't overwrite custom settings
            if (!existingUC[0].hasCustomSchedule) {
              updateData.workingDays = hcpWorkingDays || existingUC[0].workingDays || defaultWorkingDays;
              updateData.workingHoursStart = hcpWorkingHoursStart || existingUC[0].workingHoursStart || defaultWorkingHoursStart;
              updateData.workingHoursEnd = hcpWorkingHoursEnd || existingUC[0].workingHoursEnd || defaultWorkingHoursEnd;
            }
            
            await db.update(userContractors)
              .set(updateData)
              .where(eq(userContractors.id, existingUC[0].id));
          } else {
            await db.insert(userContractors).values({
              userId: userId,
              contractorId: tenantId,
              housecallProUserId: hcpUser.id,
              isSalesperson: true,
              role: 'user',
              workingDays: hcpWorkingDays || defaultWorkingDays,
              workingHoursStart: hcpWorkingHoursStart || defaultWorkingHoursStart,
              workingHoursEnd: hcpWorkingHoursEnd || defaultWorkingHoursEnd,
              hasCustomSchedule: false,
            });
          }
          
          result.synced++;
        } catch (userError: any) {
          console.error('[scheduling-sync] Error syncing user:', hcpUser.email, userError);
          result.errors.push(`Error syncing user ${hcpUser.email}: ${userError.message}`);
        }
      }
      
      console.log('[scheduling-sync] Sync complete:', result);
      return result;
    } catch (error: any) {
      console.error('[scheduling-sync] Sync failed:', error);
      result.errors.push(`Sync failed: ${error.message}`);
      return result;
    }
  }
  
  // ── Query / Read Methods ─────────────────────────────────────────────────────
  // The methods below read from the local database (no HCP API calls).
  // They derive scheduling state from data already synced into the local DB.

  async getSalespeople(tenantId: string): Promise<SalespersonInfo[]> {
    const salespeople = await db.select({
      userId: userContractors.userId,
      name: users.name,
      email: users.email,
      housecallProUserId: userContractors.housecallProUserId,
      lastAssignmentAt: userContractors.lastAssignmentAt,
      calendarColor: userContractors.calendarColor,
      isSalesperson: userContractors.isSalesperson,
      workingDays: userContractors.workingDays,
      workingHoursStart: userContractors.workingHoursStart,
      workingHoursEnd: userContractors.workingHoursEnd,
      hasCustomSchedule: userContractors.hasCustomSchedule,
    })
    .from(userContractors)
    .innerJoin(users, eq(users.id, userContractors.userId))
    .where(and(
      eq(userContractors.contractorId, tenantId),
      eq(userContractors.isSalesperson, true)
    ));
    
    return salespeople.map(sp => ({
      ...sp,
      isSalesperson: sp.isSalesperson ?? false,
      workingDays: sp.workingDays ?? [1, 2, 3, 4, 5],
      workingHoursStart: sp.workingHoursStart ?? "08:00",
      workingHoursEnd: sp.workingHoursEnd ?? "17:00",
      hasCustomSchedule: sp.hasCustomSchedule ?? false,
    }));
  }

  async getTeamMembers(tenantId: string): Promise<SalespersonInfo[]> {
    const members = await db.select({
      userId: userContractors.userId,
      name: users.name,
      email: users.email,
      housecallProUserId: userContractors.housecallProUserId,
      lastAssignmentAt: userContractors.lastAssignmentAt,
      calendarColor: userContractors.calendarColor,
      isSalesperson: userContractors.isSalesperson,
      workingDays: userContractors.workingDays,
      workingHoursStart: userContractors.workingHoursStart,
      workingHoursEnd: userContractors.workingHoursEnd,
      hasCustomSchedule: userContractors.hasCustomSchedule,
    })
    .from(userContractors)
    .innerJoin(users, eq(users.id, userContractors.userId))
    .where(eq(userContractors.contractorId, tenantId));
    
    return members.map(m => ({
      ...m,
      isSalesperson: m.isSalesperson ?? false,
      workingDays: m.workingDays ?? [1, 2, 3, 4, 5],
      workingHoursStart: m.workingHoursStart ?? "08:00",
      workingHoursEnd: m.workingHoursEnd ?? "17:00",
      hasCustomSchedule: m.hasCustomSchedule ?? false,
    }));
  }
  
  async getCalendarEvents(tenantId: string, userId: string, startDate: Date, endDate: Date): Promise<BusyWindow[]> {
    const salesperson = await db.select()
      .from(userContractors)
      .where(and(
        eq(userContractors.userId, userId),
        eq(userContractors.contractorId, tenantId),
        eq(userContractors.isSalesperson, true)
      ))
      .limit(1);
    
    if (!salesperson.length || !salesperson[0].housecallProUserId) {
      return [];
    }
    
    const hcpUserId = salesperson[0].housecallProUserId;
    const busyWindows: BusyWindow[] = [];
    
    try {
      // Fetch scheduled estimates from HCP for this employee
      const estimatesResponse = await housecallProService.getEmployeeScheduledEstimates(
        tenantId, 
        hcpUserId, 
        startDate, 
        endDate
      );
      
      if (estimatesResponse.success && estimatesResponse.data) {
        // Convert scheduled estimates to busy windows
        // HCP estimates have schedule times in estimate.schedule.scheduled_start/scheduled_end
        const estimateBusyWindows: BusyWindow[] = [];
        for (const est of estimatesResponse.data) {
          // Check for schedule directly on estimate (legacy format)
          if (est.scheduled_start && est.scheduled_end) {
            estimateBusyWindows.push({
              start: est.scheduled_start,
              end: est.scheduled_end,
            });
          }
          // Check schedule object on estimate (HCP format: schedule.scheduled_start/scheduled_end)
          if (est.schedule?.scheduled_start && est.schedule?.scheduled_end) {
            estimateBusyWindows.push({
              start: est.schedule.scheduled_start,
              end: est.schedule.scheduled_end,
            });
          }
          // Check options array for scheduled times
          if (est.options && Array.isArray(est.options)) {
            for (const opt of est.options) {
              if (opt.schedule?.scheduled_start && opt.schedule?.scheduled_end) {
                estimateBusyWindows.push({
                  start: opt.schedule.scheduled_start,
                  end: opt.schedule.scheduled_end,
                });
              }
              if (opt.scheduled_start && opt.scheduled_end) {
                estimateBusyWindows.push({
                  start: opt.scheduled_start,
                  end: opt.scheduled_end,
                });
              }
            }
          }
        }
        busyWindows.push(...estimateBusyWindows);
        console.log(`[scheduling] Found ${estimateBusyWindows.length} HCP estimate busy windows for user ${userId}`);
      }
      
      // Fetch scheduled jobs from HCP for this employee
      const jobsResponse = await housecallProService.getEmployeeScheduledJobs(
        tenantId, 
        hcpUserId, 
        startDate, 
        endDate
      );
      
      if (jobsResponse.success && jobsResponse.data) {
        // Convert scheduled jobs to busy windows
        const jobBusyWindows = jobsResponse.data
          .filter((job: any) => job.scheduled_start && job.scheduled_end)
          .map((job: any) => ({
            start: job.scheduled_start,
            end: job.scheduled_end,
          }));
        busyWindows.push(...jobBusyWindows);
        console.log(`[scheduling] Found ${jobBusyWindows.length} HCP jobs for user ${userId}`);
      }
      
      return busyWindows;
    } catch (error) {
      console.error(`Error fetching HCP calendar for user ${userId}:`, error);
      return busyWindows;
    }
  }
  
  /**
   * Expands a busy window by BUFFER_MINUTES on both start and end.
   * This ensures a 30-min separation before AND after any busy period.
   */
  private expandBusyWindowWithBuffer(start: Date | string, end: Date | string): BusyWindow {
    const startTime = new Date(start);
    const endTime = new Date(end);
    
    return {
      start: new Date(startTime.getTime() - BUFFER_MINUTES * 60 * 1000).toISOString(),
      end: new Date(endTime.getTime() + BUFFER_MINUTES * 60 * 1000).toISOString(),
    };
  }
  
  private parseWorkingHours(timeStr: string) { return parseWorkingHoursUtil(timeStr); }
  private createDateInTimezone(date: Date, hours: number, minutes: number, timezone: string) { return createDateInTimezoneUtil(date, hours, minutes, timezone); }
  private getDayOfWeekInTimezone(date: Date, timezone: string) { return getDayOfWeekInTimezoneUtil(date, timezone); }

  async getUnifiedAvailability(tenantId: string, startDate: Date, endDate: Date, timezone: string = 'America/New_York'): Promise<AvailableSlot[]> {
    const salespeople = await this.getSalespeople(tenantId);
    
    if (!salespeople.length) {
      console.log('[scheduling] No salespeople found for tenant:', tenantId);
      return [];
    }
    
    console.log(`[scheduling] Found ${salespeople.length} salespeople for availability calculation. Timezone: ${timezone}`);
    
    const salespersonBusyWindows = new Map<string, BusyWindow[]>();

    const expandedStart = new Date(startDate.getTime() - BUFFER_MINUTES * 60 * 1000);
    const expandedEnd = new Date(endDate.getTime() + BUFFER_MINUTES * 60 * 1000);

    // Fire all per-salesperson HCP API calls concurrently instead of sequentially
    const calendarResults = await Promise.all(
      salespeople.map(sp => this.getCalendarEvents(tenantId, sp.userId, startDate, endDate))
    );
    const bookingResults = await Promise.all(
      salespeople.map(sp =>
        db.select()
          .from(scheduledBookings)
          .where(and(
            eq(scheduledBookings.assignedSalespersonId, sp.userId),
            eq(scheduledBookings.contractorId, tenantId),
            lte(scheduledBookings.startTime, expandedEnd),
            gte(scheduledBookings.endTime, expandedStart)
          ))
      )
    );

    for (let i = 0; i < salespeople.length; i++) {
      const sp = salespeople[i];
      const busyWindows = calendarResults[i];
      const existingBookings = bookingResults[i];

      const allBusyWindows = [
        ...busyWindows.map(bw => this.expandBusyWindowWithBuffer(bw.start, bw.end)),
        ...existingBookings.map(b => this.expandBusyWindowWithBuffer(b.startTime, b.endTime))
      ];

      salespersonBusyWindows.set(sp.userId, allBusyWindows);
      console.log(`[scheduling] Salesperson ${sp.name}: workingDays=${JSON.stringify(sp.workingDays)}, hours=${sp.workingHoursStart}-${sp.workingHoursEnd}, busyWindows=${allBusyWindows.length}`);
    }
    
    const availableSlots: AvailableSlot[] = [];
    const currentDate = new Date(startDate);
    
    const oneDayMs = 24 * 60 * 60 * 1000;
    while (currentDate <= endDate) {
      const dayOfWeek = this.getDayOfWeekInTimezone(currentDate, timezone);
      
      for (const sp of salespeople) {
        if (!sp.workingDays.includes(dayOfWeek)) {
          continue;
        }
        
        const workStart = this.parseWorkingHours(sp.workingHoursStart || "08:00");
        const workEnd = this.parseWorkingHours(sp.workingHoursEnd || "17:00");
        
        const dayStart = this.createDateInTimezone(currentDate, workStart.hours, workStart.minutes, timezone);
        const dayEnd = this.createDateInTimezone(currentDate, workEnd.hours, workEnd.minutes, timezone);
        
            // Sliding-window slot search for this salesperson on this day.
        //
        // We step through the working day in SLOT_INTERVAL_MINUTES increments (15 min),
        // testing candidate windows of SLOT_DURATION_MINUTES (60 min) each.
        // A slot is "available" when the salesperson has no overlapping busy windows
        // (HCP calendar events + existing local bookings, pre-computed in salespersonBusyWindows).
        //
        // If another salesperson already opened the same time slot, we append this one's
        // ID to existingSlot.availableSalespersonIds rather than creating a duplicate entry.
        // This lets the caller pick whichever salesperson they prefer for that window.
        let slotStart = new Date(dayStart);
        
        while (slotStart.getTime() + SLOT_DURATION_MINUTES * 60 * 1000 <= dayEnd.getTime()) {
          const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
          
          // Skip slots that have already started (can't book in the past)
          if (slotStart < new Date()) {
            slotStart = new Date(slotStart.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);
            continue;
          }
          
          const busyWindows = salespersonBusyWindows.get(sp.userId) || [];
          const isAvailable = !this.isSlotBusy(slotStart, slotEnd, busyWindows);
          
          if (isAvailable) {
            const existingSlot = availableSlots.find(
              s => s.start.getTime() === slotStart.getTime() && s.end.getTime() === slotEnd.getTime()
            );
            
            if (existingSlot) {
              if (!existingSlot.availableSalespersonIds.includes(sp.userId)) {
                existingSlot.availableSalespersonIds.push(sp.userId);
              }
            } else {
              availableSlots.push({
                start: new Date(slotStart),
                end: new Date(slotEnd),
                availableSalespersonIds: [sp.userId],
              });
            }
          }
          
          slotStart = new Date(slotStart.getTime() + SLOT_INTERVAL_MINUTES * 60 * 1000);
        }
      }
      
      currentDate.setTime(currentDate.getTime() + oneDayMs);
    }
    
    availableSlots.sort((a, b) => a.start.getTime() - b.start.getTime());
    
    console.log(`[scheduling] Generated ${availableSlots.length} available slots`);
    return availableSlots;
  }
  
  private isSlotBusy(slotStart: Date, slotEnd: Date, busyWindows: BusyWindow[]): boolean {
    for (const busy of busyWindows) {
      const busyStart = new Date(busy.start);
      const busyEnd = new Date(busy.end);
      
      if (slotStart < busyEnd && slotEnd > busyStart) {
        return true;
      }
    }
    return false;
  }
  
  async selectNextAvailableSalesperson(tenantId: string, startTime: Date, timezoneParam?: string): Promise<SalespersonInfo | null> {
    const endTime = new Date(startTime.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
    
    // Get the contractor's timezone if not provided
    let timezone = timezoneParam;
    if (!timezone) {
      const [contractor] = await db.select({ timezone: contractors.timezone })
        .from(contractors)
        .where(eq(contractors.id, tenantId))
        .limit(1);
      timezone = contractor?.timezone || 'America/New_York';
    }
    
    // Expand search window to include buffer periods for accurate conflict detection
    const searchStart = new Date(startTime.getTime() - BUFFER_MINUTES * 60 * 1000);
    const searchEnd = new Date(endTime.getTime() + BUFFER_MINUTES * 60 * 1000);
    
    const salespeople = await this.getSalespeople(tenantId);
    
    if (!salespeople.length) {
      return null;
    }
    
    // Get day of week for the requested time in the correct timezone
    const dayOfWeek = this.getDayOfWeekInTimezone(startTime, timezone);
    
    const availableSalespeople: SalespersonInfo[] = [];
    
    for (const sp of salespeople) {
      // First check if this salesperson works on the requested day
      if (!sp.workingDays.includes(dayOfWeek)) {
        console.log(`[scheduling] Skipping ${sp.name}: not working on day ${dayOfWeek} (works: ${JSON.stringify(sp.workingDays)})`);
        continue;
      }
      
      // Check if the requested time is within the salesperson's working hours
      const workStart = this.parseWorkingHours(sp.workingHoursStart || "08:00");
      const workEnd = this.parseWorkingHours(sp.workingHoursEnd || "17:00");
      
      // Get the start and end of the salesperson's working hours on the requested day
      const dayWorkStart = this.createDateInTimezone(startTime, workStart.hours, workStart.minutes, timezone);
      const dayWorkEnd = this.createDateInTimezone(startTime, workEnd.hours, workEnd.minutes, timezone);
      
      // Check if the slot is within working hours
      if (startTime < dayWorkStart || endTime > dayWorkEnd) {
        console.log(`[scheduling] Skipping ${sp.name}: slot outside working hours (${sp.workingHoursStart}-${sp.workingHoursEnd})`);
        continue;
      }
      
      const busyWindows = await this.getCalendarEvents(tenantId, sp.userId, searchStart, searchEnd);
      
      // Query bookings where there's ANY overlap with our expanded window
      // A booking overlaps if: booking.start < searchEnd AND booking.end > searchStart
      const existingBookings = await db.select()
        .from(scheduledBookings)
        .where(and(
          eq(scheduledBookings.assignedSalespersonId, sp.userId),
          eq(scheduledBookings.contractorId, tenantId),
          lte(scheduledBookings.startTime, searchEnd),
          gte(scheduledBookings.endTime, searchStart)
        ));
      
      // Apply buffer to BOTH start and end of all busy windows
      const allBusyWindows = [
        ...busyWindows.map(bw => this.expandBusyWindowWithBuffer(bw.start, bw.end)),
        ...existingBookings.map(b => this.expandBusyWindowWithBuffer(b.startTime, b.endTime))
      ];
      
      if (!this.isSlotBusy(startTime, endTime, allBusyWindows)) {
        availableSalespeople.push(sp);
      }
    }
    
    if (!availableSalespeople.length) {
      return null;
    }
    
    availableSalespeople.sort((a, b) => {
      if (!a.lastAssignmentAt && !b.lastAssignmentAt) {
        return a.name.localeCompare(b.name);
      }
      if (!a.lastAssignmentAt) return -1;
      if (!b.lastAssignmentAt) return 1;
      return a.lastAssignmentAt.getTime() - b.lastAssignmentAt.getTime();
    });
    
    return availableSalespeople[0];
  }
  
  async bookAppointment(tenantId: string, request: BookingRequest): Promise<BookingResult> {
    let selectedSalesperson: SalespersonInfo | null = null;
    
    // If salespersonId is specified, use that salesperson directly
    if (request.salespersonId) {
      const salespeople = await this.getSalespeople(tenantId);
      selectedSalesperson = salespeople.find(sp => sp.userId === request.salespersonId) || null;
      
      // If HCP employee ID was provided, ensure it's set on the salesperson
      if (selectedSalesperson && request.housecallProEmployeeId) {
        selectedSalesperson.housecallProUserId = request.housecallProEmployeeId;
      }
    } else {
      // Auto-assign to next available salesperson
      const timezone = request.timezone || 'America/New_York';
      selectedSalesperson = await this.selectNextAvailableSalesperson(tenantId, request.startTime, timezone);
    }
    
    if (!selectedSalesperson) {
      return { success: false, error: 'No available salespeople for the requested time slot' };
    }
    
    const endTime = new Date(request.startTime.getTime() + SLOT_DURATION_MINUTES * 60 * 1000);
    
    let hcpEstimateId: string | undefined;
    
    // Create HCP estimate if salesperson has HCP linkage and we have a contact
    if (selectedSalesperson.housecallProUserId && request.contactId) {
      // Look up the contact to get their HCP customer ID
      const [contact] = await db.select()
        .from(contacts)
        .where(eq(contacts.id, request.contactId))
        .limit(1);
      
      let hcpCustomerId: string | undefined = contact?.housecallProCustomerId || undefined;
      
      // If no HCP customer ID stored, search for or create one
      if (!hcpCustomerId && contact) {
        // Get primary email and phone from arrays
        const primaryEmail = contact.emails && contact.emails.length > 0 ? contact.emails[0] : undefined;
        const primaryPhone = contact.phones && contact.phones.length > 0 ? contact.phones[0] : undefined;
        
        // First, search for existing customer in HCP by email or phone
        if (primaryEmail || primaryPhone) {
          console.log('[scheduling] Searching for existing HCP customer for contact:', contact.id);
          
          const searchResult = await housecallProService.searchCustomers(tenantId, {
            email: primaryEmail,
            phone: primaryPhone,
          });
          
          if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
            // Found existing customer - use their ID
            hcpCustomerId = searchResult.data[0].id;
            console.log('[scheduling] Found existing HCP customer:', hcpCustomerId);
            
            // Update contact with HCP customer ID for future reference
            await db.update(contacts)
              .set({ housecallProCustomerId: hcpCustomerId })
              .where(eq(contacts.id, contact.id));
          }
        }
        
        // If still no HCP customer, create one
        if (!hcpCustomerId) {
          console.log('[scheduling] Creating new HCP customer for contact:', contact.id);
          
          // Parse name into first/last
          const nameParts = (contact.name || '').trim().split(' ');
          const firstName = nameParts[0] || 'Customer';
          const lastName = nameParts.slice(1).join(' ') || '';
          
          // Build address object — prefer structured components from booking request,
          // then plain string from request, then fall back to what's stored on the contact
          let addressData: AddressComponents | undefined;
          if (request.customerAddressComponents?.street) {
            addressData = {
              street: request.customerAddressComponents.street,
              city: request.customerAddressComponents.city || '',
              state: request.customerAddressComponents.state || '',
              zip: request.customerAddressComponents.zip || '',
              country: request.customerAddressComponents.country || 'US',
            };
          } else {
            const resolvedAddress = request.customerAddress || contact.address;
            if (resolvedAddress) {
              addressData = parseAddressString(resolvedAddress);
            }
          }
          
          const customerResult = await housecallProService.createCustomer(tenantId, {
            first_name: firstName,
            last_name: lastName,
            email: primaryEmail,
            mobile_number: primaryPhone,
            addresses: addressData ? [addressData] : undefined,
          });
          
          if (customerResult.success && customerResult.data?.id) {
            hcpCustomerId = customerResult.data.id;
            console.log('[scheduling] Created HCP customer:', hcpCustomerId);
            
            // Update contact with HCP customer ID
            await db.update(contacts)
              .set({ housecallProCustomerId: hcpCustomerId })
              .where(eq(contacts.id, contact.id));
          } else {
            console.warn(`Failed to create HCP customer: ${customerResult.error}`);
          }
        }
      }
      
      if (hcpCustomerId) {
        // Build estimate address from structured components, or fall back to plain string / contact address
        let estimateAddress: AddressComponents | undefined;
        if (request.customerAddressComponents?.street) {
          estimateAddress = {
            street: request.customerAddressComponents.street,
            city: request.customerAddressComponents.city || '',
            state: request.customerAddressComponents.state || '',
            zip: request.customerAddressComponents.zip || '',
            country: request.customerAddressComponents.country || 'US',
          };
        } else {
          const fallbackAddr = request.customerAddress || contact?.address;
          if (fallbackAddr) {
            estimateAddress = parseAddressString(fallbackAddr);
          }
        }

        // Step 1: Create an estimate in HCP with required options array
        const estimateResult = await housecallProService.createEstimate(tenantId, {
          customer_id: hcpCustomerId,
          employee_id: selectedSalesperson.housecallProUserId,
          message: request.notes || request.title || 'Estimate appointment',
          options: [{
            name: request.title || 'Estimate Appointment',
            message: request.notes || 'Scheduled estimate appointment',
          }],
          address: estimateAddress,
        });
        
        if (estimateResult.success && estimateResult.data?.id) {
          hcpEstimateId = estimateResult.data.id;
          console.log('[scheduling] Created HCP estimate:', hcpEstimateId);
          
          // Step 2: Get the option ID from the created estimate and update its schedule
          const estimateData = estimateResult.data as { id: string; options?: Array<{ id: string }> };
          const optionId = estimateData.options?.[0]?.id;
          
          if (optionId && selectedSalesperson.housecallProUserId) {
            console.log('[scheduling] Updating HCP estimate option schedule, option:', optionId);
            
            const scheduleResult = await housecallProService.updateEstimateOptionSchedule(
              tenantId,
              hcpEstimateId,
              optionId,
              {
                start_time: request.startTime.toISOString(),
                end_time: endTime.toISOString(),
                arrival_window_in_minutes: 60,
                notify: false,
                notify_pro: true,
                dispatched_employees: [{ employee_id: selectedSalesperson.housecallProUserId }],
              }
            );
            
            if (scheduleResult.success) {
              console.log('[scheduling] Successfully scheduled HCP estimate option');
            } else {
              console.warn(`[scheduling] Failed to schedule HCP estimate option: ${scheduleResult.error}`);
            }
          } else {
            console.warn('[scheduling] Could not get option ID from estimate, skipping schedule update');
          }
        } else {
          console.warn(`Failed to create HCP estimate: ${estimateResult.error}`);
        }
      } else {
        console.warn('[scheduling] Could not create HCP customer, skipping HCP estimate creation');
      }
    }
    
    // Create a CRM estimate record only if we have a contactId
    if (request.contactId) {
      const [crmEstimate] = await db.insert(estimates).values({
        contractorId: tenantId,
        contactId: request.contactId,
        title: request.title || 'Scheduled Estimate',
        description: request.notes,
        amount: '0', // Will be filled in during the estimate appointment
        status: 'pending',
        scheduledStart: request.startTime,
        scheduledEnd: endTime,
        scheduledEmployeeId: selectedSalesperson.housecallProUserId || undefined,
        housecallProEstimateId: hcpEstimateId,
      }).returning();
      
      console.log('[scheduling] Created CRM estimate:', crmEstimate.id);
    }
    
    const [booking] = await db.insert(scheduledBookings).values({
      contractorId: tenantId,
      assignedSalespersonId: selectedSalesperson.userId,
      contactId: request.contactId,
      housecallProEventId: hcpEstimateId,
      title: request.title,
      startTime: request.startTime,
      endTime,
      customerName: request.customerName,
      customerEmail: request.customerEmail,
      customerPhone: request.customerPhone,
      notes: request.notes,
      status: 'confirmed',
    }).returning();
    
    await db.update(userContractors)
      .set({ lastAssignmentAt: new Date() })
      .where(and(
        eq(userContractors.userId, selectedSalesperson.userId),
        eq(userContractors.contractorId, tenantId)
      ));
    
    return {
      success: true,
      bookingId: booking.id,
      assignedSalespersonId: selectedSalesperson.userId,
      assignedSalespersonName: selectedSalesperson.name,
      housecallProEventId: hcpEstimateId,
    };
  }
  
  async getBookings(tenantId: string, _startDate?: Date, _endDate?: Date): Promise<any[]> {
    let query = db.select({
      id: scheduledBookings.id,
      title: scheduledBookings.title,
      startTime: scheduledBookings.startTime,
      endTime: scheduledBookings.endTime,
      customerName: scheduledBookings.customerName,
      customerEmail: scheduledBookings.customerEmail,
      customerPhone: scheduledBookings.customerPhone,
      status: scheduledBookings.status,
      salespersonId: scheduledBookings.assignedSalespersonId,
      salespersonName: users.name,
    })
    .from(scheduledBookings)
    .innerJoin(users, eq(users.id, scheduledBookings.assignedSalespersonId))
    .where(eq(scheduledBookings.contractorId, tenantId))
    .orderBy(asc(scheduledBookings.startTime));
    
    return await query;
  }
}

export const housecallSchedulingService = new HousecallSchedulingService();
