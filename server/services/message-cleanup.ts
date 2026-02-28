import { db } from "../db";
import { messages, activities, contractors } from "@shared/schema";
import { and, isNull, sql, eq, isNotNull, or } from "drizzle-orm";

interface ContractorCleanupResult {
  contractorId: string;
  contractorName: string;
  deletedMessagesCount: number;
  deletedActivitiesCount: number;
}

class MessageCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  // Extended grace period for safety - messages/activities should have ample time to be linked
  private readonly CLEANUP_DAYS = 30; // Increased from 7 to 30 days for safety
  private readonly CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  start() {
    if (this.cleanupInterval) {
      console.log('[Message Cleanup] Service already running');
      return;
    }

    console.log(`[Message Cleanup] Starting cleanup service - will delete orphaned messages and activities older than ${this.CLEANUP_DAYS} days`);
    console.log('[Message Cleanup] Safety criteria: Only deletes items with NULL foreign keys AND no userId');
    console.log('[Message Cleanup] Tenant isolation: Cleanup is performed per-contractor for auditability');
    
    // Don't run cleanup immediately on startup - wait for first scheduled run
    // This prevents accidental data loss during development/testing
    console.log('[Message Cleanup] First cleanup scheduled in 24 hours');
    
    // Schedule daily cleanup
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, this.CHECK_INTERVAL);
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[Message Cleanup] Service stopped');
    }
  }

  /**
   * Perform cleanup for a specific contractor
   * This ensures tenant isolation by only deleting orphaned records within a single contractor's scope
   */
  private async performCleanupForContractor(contractorId: string, contractorName: string, cutoffDate: Date): Promise<ContractorCleanupResult> {
    // Delete SMS messages where:
    // - contractorId matches (tenant isolation)
    // - contactId is null AND
    // - estimateId is null AND
    // - userId is null (additional safety - messages with user association are preserved)
    // - created more than 30 days ago
    const messagesResult = await db.delete(messages)
      .where(
        and(
          eq(messages.contractorId, contractorId),
          isNull(messages.contactId),
          isNull(messages.estimateId),
          isNull(messages.userId),
          sql`${messages.createdAt} < ${cutoffDate}`
        )
      );

    const deletedMessagesCount = messagesResult.rowCount || 0;

    // Delete ALL orphaned activities where:
    // - contractorId matches (tenant isolation)
    // - contactId is null AND
    // - estimateId is null AND
    // - jobId is null AND
    // - userId is null (additional safety - activities with user association are preserved)
    // - created more than 30 days ago
    const activitiesResult = await db.delete(activities)
      .where(
        and(
          eq(activities.contractorId, contractorId),
          isNull(activities.contactId),
          isNull(activities.estimateId),
          isNull(activities.jobId),
          isNull(activities.userId),
          sql`${activities.createdAt} < ${cutoffDate}`
        )
      );

    const deletedActivitiesCount = activitiesResult.rowCount || 0;

    return {
      contractorId,
      contractorName,
      deletedMessagesCount,
      deletedActivitiesCount
    };
  }

  async performCleanup() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.CLEANUP_DAYS);

      console.log(`[Message Cleanup] Starting tenant-isolated cleanup for orphaned items older than ${cutoffDate.toISOString()}`);

      // Get all contractors for per-tenant cleanup
      const allContractors = await db.select({ id: contractors.id, name: contractors.name }).from(contractors);
      
      if (allContractors.length === 0) {
        console.log('[Message Cleanup] No contractors found, skipping cleanup');
        return { 
          success: true, 
          deletedMessagesCount: 0,
          deletedActivitiesCount: 0,
          totalDeleted: 0,
          contractorResults: []
        };
      }

      const contractorResults: ContractorCleanupResult[] = [];
      let totalMessagesDeleted = 0;
      let totalActivitiesDeleted = 0;

      // Process each contractor separately for tenant isolation
      for (const contractor of allContractors) {
        const result = await this.performCleanupForContractor(contractor.id, contractor.name, cutoffDate);
        
        if (result.deletedMessagesCount > 0 || result.deletedActivitiesCount > 0) {
          contractorResults.push(result);
          totalMessagesDeleted += result.deletedMessagesCount;
          totalActivitiesDeleted += result.deletedActivitiesCount;
          
          console.log(`[Message Cleanup] Contractor "${contractor.name}" (${contractor.id}): Deleted ${result.deletedMessagesCount} message(s), ${result.deletedActivitiesCount} activity(ies)`);
        }
      }

      if (totalMessagesDeleted === 0 && totalActivitiesDeleted === 0) {
        console.log('[Message Cleanup] No orphaned messages or activities to clean up across all contractors');
      } else {
        console.log(`[Message Cleanup] Total cleanup: ${totalMessagesDeleted} message(s), ${totalActivitiesDeleted} activity(ies) across ${contractorResults.length} contractor(s)`);
      }

      return { 
        success: true, 
        deletedMessagesCount: totalMessagesDeleted,
        deletedActivitiesCount: totalActivitiesDeleted,
        totalDeleted: totalMessagesDeleted + totalActivitiesDeleted,
        contractorResults
      };
    } catch (error) {
      console.error('[Message Cleanup] Error during cleanup:', error);
      return { success: false, error };
    }
  }

  /**
   * Perform cleanup for a specific contractor only (admin use)
   * Useful for targeted cleanup without affecting other tenants
   */
  async forceCleanupForContractor(contractorId: string): Promise<{ success: boolean; result?: ContractorCleanupResult; error?: unknown }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.CLEANUP_DAYS);

      // Get contractor name for logging
      const contractorResult = await db.select({ name: contractors.name }).from(contractors).where(eq(contractors.id, contractorId)).limit(1);
      const contractorName = contractorResult[0]?.name || 'Unknown';

      console.log(`[Message Cleanup] Manual cleanup triggered for contractor "${contractorName}" (${contractorId})`);
      
      const result = await this.performCleanupForContractor(contractorId, contractorName, cutoffDate);
      
      console.log(`[Message Cleanup] Contractor "${contractorName}": Deleted ${result.deletedMessagesCount} message(s), ${result.deletedActivitiesCount} activity(ies)`);
      
      return { success: true, result };
    } catch (error) {
      console.error(`[Message Cleanup] Error during cleanup for contractor ${contractorId}:`, error);
      return { success: false, error };
    }
  }

  // Manual cleanup for admin use - requires explicit call (cleans all contractors)
  async forceCleanup(): Promise<{ success: boolean; deletedMessagesCount?: number; deletedActivitiesCount?: number; totalDeleted?: number; contractorResults?: ContractorCleanupResult[]; error?: unknown }> {
    console.log('[Message Cleanup] Manual cleanup triggered by admin (all contractors)');
    return this.performCleanup();
  }

  getCleanupDays(): number {
    return this.CLEANUP_DAYS;
  }
}

export const messageCleanupService = new MessageCleanupService();
