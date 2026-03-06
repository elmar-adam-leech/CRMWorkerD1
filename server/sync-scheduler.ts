/**
 * SyncScheduler — background job runner for integration data synchronisation.
 *
 * What it does:
 *   Polls the `sync_schedules` database table every SCHEDULER_POLL_INTERVAL_MS and
 *   runs any schedule whose `next_sync_at` timestamp has elapsed. Currently managed
 *   integrations: housecall-pro (daily), gmail (every 5 minutes).
 *
 * How to add a new sync provider:
 *   1. Create a `server/sync/<provider>.ts` module exporting an async `sync<Provider>(tenantId)` function.
 *   2. Register the integration name in `onIntegrationEnabled` / `onIntegrationDisabled`.
 *   3. Add a `case '<provider>':` entry in the `performSync` switch statement.
 *
 * Known scale limitation — in-memory lock (`activeSyncs`):
 *   Overlapping runs for the same tenant+integration are prevented with an in-memory Set.
 *   This is NOT safe for horizontal scaling (multiple server instances). If you ever run
 *   more than one server process you will need a distributed lock (e.g. Redis SETNX, or
 *   a `locked_at` database column with a heartbeat) instead.
 */
import { storage } from './storage';
import { syncHousecallPro, syncHousecallProJobs } from './sync/housecall-pro';
import { syncGmail } from './sync/gmail';

// How often to poll sync_schedules for due syncs (milliseconds)
const SCHEDULER_POLL_INTERVAL_MS = 60_000; // 1 minute

// How long to wait before retrying a failed sync (milliseconds)
const SYNC_RETRY_DELAY_MS = 60 * 60_000; // 1 hour

export class SyncScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  // In-memory lock set to prevent overlapping syncs for the same tenant+integration.
  // Key format: "<tenantId>:<integrationName>"
  //
  // Without this, a slow sync (e.g., large HCP tenant taking >5 minutes) would be
  // started again by checkDueSyncs() on the next tick, creating concurrent runs that
  // can cause duplicate records and unique-constraint violations.
  //
  // The lock is released in a finally block so it is always cleared on both success
  // and failure. It is NOT persisted — on server restart, all locks are cleared and
  // any stale in-progress sync_schedule rows will be picked up naturally on the next
  // checkDueSyncs() tick.
  private activeSyncs = new Set<string>();

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('[sync-scheduler] Already running');
      return;
    }

    console.log('[sync-scheduler] Starting sync scheduler...');
    this.isRunning = true;

    setInterval(() => {
      this.checkDueSyncs();
    }, SCHEDULER_POLL_INTERVAL_MS);

    this.checkDueSyncs();
  }

  /**
   * Stop the scheduler
   */
  stop() {
    console.log('[sync-scheduler] Stopping sync scheduler...');
    this.isRunning = false;
    this.timers.forEach((timer) => { clearTimeout(timer); });
    this.timers.clear();
  }

  /**
   * Add or update a sync schedule for a tenant
   */
  async scheduleSync(tenantId: string, integrationName: string, frequency: 'daily' | 'weekly' | 'hourly' | 'every-5-minutes' = 'daily') {
    const nextSyncAt = this.calculateNextSyncTime(frequency);
    const existing = await storage.getSyncSchedule(tenantId, integrationName);

    if (existing) {
      await storage.updateSyncSchedule(tenantId, integrationName, { frequency, nextSyncAt, isEnabled: true });
      console.log(`[sync-scheduler] Updated ${frequency} sync for ${integrationName} (contractor: ${tenantId}) - next sync: ${nextSyncAt.toISOString()}`);
    } else {
      await storage.createSyncSchedule({ contractorId: tenantId, integrationName, frequency, nextSyncAt, isEnabled: true });
      console.log(`[sync-scheduler] Created ${frequency} sync for ${integrationName} (contractor: ${tenantId}) - next sync: ${nextSyncAt.toISOString()}`);
    }
  }

  /**
   * Remove a sync schedule
   */
  async removeSchedule(tenantId: string, integrationName: string) {
    const scheduleId = `${tenantId}-${integrationName}`;
    const timer = this.timers.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scheduleId);
    }
    await storage.deleteSyncSchedule(tenantId, integrationName);
    console.log(`[sync-scheduler] Removed sync schedule for ${integrationName} (contractor: ${tenantId})`);
  }

  /**
   * Get all schedules for a tenant
   */
  async getTenantSchedules(tenantId: string) {
    return await storage.getSyncSchedules(tenantId);
  }

  /**
   * Manually trigger a sync for a specific tenant and integration
   */
  async triggerSync(tenantId: string, integrationName: string): Promise<void> {
    console.log(`[sync-scheduler] Manual sync triggered for ${integrationName} (tenant: ${tenantId})`);
    await this.performSync(tenantId, integrationName);
  }

  /**
   * Poll for syncs that are due to run based on their nextSyncAt timestamp.
   *
   * Called every 60 seconds by setInterval. Queries the database for all
   * sync_schedules where nextSyncAt <= now, then delegates each to performSync().
   *
   * Each sync is protected by an in-memory lock (activeSyncs) so that a slow
   * sync started on a previous tick cannot be started again if it's still running.
   * On failure, the next attempt is scheduled 1 hour out to avoid rapid retry storms.
   */
  private async checkDueSyncs() {
    const now = new Date();
    const dueSchedules = await storage.getDueSyncSchedules();

    for (const schedule of dueSchedules) {
      console.log(`[sync-scheduler] Sync due for ${schedule.integrationName} (contractor: ${schedule.contractorId})`);

      try {
        await this.performSync(schedule.contractorId, schedule.integrationName);

        const nextSyncAt = this.calculateNextSyncTime(schedule.frequency, now);
        await storage.updateSyncSchedule(schedule.contractorId, schedule.integrationName, {
          lastSyncAt: now,
          nextSyncAt,
        });

        console.log(`[sync-scheduler] Sync completed for ${schedule.integrationName} (contractor: ${schedule.contractorId}) - next sync: ${nextSyncAt.toISOString()}`);
      } catch (error) {
        console.error(`[sync-scheduler] Sync failed for ${schedule.integrationName} (contractor: ${schedule.contractorId}):`, error);

        const retryAt = new Date(now.getTime() + SYNC_RETRY_DELAY_MS);
        await storage.updateSyncSchedule(schedule.contractorId, schedule.integrationName, { nextSyncAt: retryAt });
        console.log(`[sync-scheduler] Retry scheduled for: ${retryAt.toISOString()}`);
      }
    }
  }

  /**
   * Perform the actual sync operation — delegates to sync module functions.
   *
   * Uses an in-memory lock (activeSyncs) to prevent overlapping runs for the
   * same tenant+integration combination. If a sync is already running, the new
   * request is dropped with a warning instead of stacking up. The lock is always
   * released in the finally block, even if the sync throws.
   */
  private async performSync(tenantId: string, integrationName: string): Promise<void> {
    const lockKey = `${tenantId}:${integrationName}`;

    if (this.activeSyncs.has(lockKey)) {
      console.warn(`[sync-scheduler] Sync already in progress for ${integrationName} (tenant: ${tenantId}), skipping to prevent overlap`);
      return;
    }

    this.activeSyncs.add(lockKey);
    console.log(`[sync-scheduler] Starting sync for ${integrationName} (tenant: ${tenantId})`);

    try {
      const isEnabled = await storage.isIntegrationEnabled(tenantId, integrationName);
      if (!isEnabled) {
        console.log(`[sync-scheduler] Integration ${integrationName} is disabled for tenant ${tenantId}, skipping sync`);
        return;
      }

      switch (integrationName) {
        case 'housecall-pro':
          await syncHousecallPro(tenantId);
          break;
        case 'gmail':
          await syncGmail(tenantId);
          break;
        default:
          console.warn(`[sync-scheduler] Unknown integration: ${integrationName}`);
      }
    } catch (error) {
      console.error(`[sync-scheduler] Sync failed for ${integrationName}:`, error);
      throw error;
    } finally {
      this.activeSyncs.delete(lockKey);
    }
  }

  /**
   * Public method for syncing HCP jobs directly (called from the HCP route)
   */
  async syncHousecallProJobs(tenantId: string): Promise<void> {
    return syncHousecallProJobs(tenantId);
  }

  /**
   * Calculate the next sync time based on frequency
   */
  private calculateNextSyncTime(frequency: 'daily' | 'weekly' | 'hourly' | 'every-5-minutes', fromTime: Date = new Date()): Date {
    const next = new Date(fromTime);

    switch (frequency) {
      case 'every-5-minutes':
        next.setMinutes(next.getMinutes() + 5);
        break;
      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;
      case 'daily':
        next.setDate(next.getDate() + 1);
        next.setHours(2, 0, 0, 0);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        next.setHours(2, 0, 0, 0);
        break;
    }

    return next;
  }

  /**
   * Enable auto-scheduling when an integration is enabled
   */
  async onIntegrationEnabled(tenantId: string, integrationName: string) {
    if (integrationName === 'housecall-pro') {
      await this.scheduleSync(tenantId, integrationName, 'daily');
    } else if (integrationName === 'gmail') {
      await this.scheduleSync(tenantId, integrationName, 'every-5-minutes');
    }
  }

  /**
   * Remove scheduling when an integration is disabled
   */
  async onIntegrationDisabled(tenantId: string, integrationName: string) {
    await this.removeSchedule(tenantId, integrationName);
  }
}

export const syncScheduler = new SyncScheduler();
