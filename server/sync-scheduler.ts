import { storage } from './storage';
import { syncHousecallPro, syncHousecallProJobs } from './sync/housecall-pro';
import { syncGmail } from './sync/gmail';

// Batch size for transaction processing
const SYNC_BATCH_SIZE = 25;

export class SyncScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

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
    }, 60 * 1000);

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
   * Helper to split array into batches
   */
  private splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Process a batch of items within a transaction
   */
  private async processBatchInTransaction<T>(
    batch: T[],
    processor: (item: T, tx: any) => Promise<{ success: boolean; isNew: boolean }>,
    batchIndex: number
  ): Promise<{ newCount: number; updatedCount: number; failedCount: number }> {
    const result = { newCount: 0, updatedCount: 0, failedCount: 0 };
    const { db } = await import('./db');

    try {
      await db.transaction(async (tx) => {
        for (const item of batch) {
          try {
            const opResult = await processor(item, tx);
            if (opResult.success) {
              if (opResult.isNew) result.newCount++;
              else result.updatedCount++;
            } else {
              result.failedCount++;
            }
          } catch (itemError) {
            console.error(`[sync-scheduler] Failed to process item in batch ${batchIndex}:`, itemError);
            result.failedCount++;
          }
        }
      });
      console.log(`[sync-scheduler] Batch ${batchIndex} committed: ${result.newCount} new, ${result.updatedCount} updated, ${result.failedCount} failed`);
    } catch (txError) {
      console.error(`[sync-scheduler] Transaction failed for batch ${batchIndex}, rolling back:`, txError);
      result.failedCount = batch.length;
      result.newCount = 0;
      result.updatedCount = 0;
    }

    return result;
  }

  /**
   * Check for syncs that are due to run
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

        const retryAt = new Date(now.getTime() + 60 * 60 * 1000);
        await storage.updateSyncSchedule(schedule.contractorId, schedule.integrationName, { nextSyncAt: retryAt });
        console.log(`[sync-scheduler] Retry scheduled for: ${retryAt.toISOString()}`);
      }
    }
  }

  /**
   * Perform the actual sync operation — delegates to sync module functions
   */
  private async performSync(tenantId: string, integrationName: string): Promise<void> {
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
