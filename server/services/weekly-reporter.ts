import { aiMonitor } from './ai-monitor';
import { getErrorStats } from '../middleware/error-monitor';

interface WeeklyReportData {
  contractorId: string;
  reportDate: Date;
  report: any;
  status: 'pending' | 'generated' | 'sent';
}

// In-memory storage for weekly reports (in production, use database)
const weeklyReports: WeeklyReportData[] = [];

export class WeeklyReporterService {
  
  /**
   * Generate a comprehensive weekly report for a contractor
   */
  async generateWeeklyReport(contractorId: string): Promise<WeeklyReportData> {
    try {
      console.log(`[AI-Reporter] Generating weekly report for contractor ${contractorId}`);
      
      // Collect data from the past week
      const errorStats = getErrorStats(contractorId);
      
      // Mock performance metrics (in production, collect from monitoring)
      const performanceMetrics = {
        averageResponseTime: '150ms',
        errorRate: `${((errorStats.total / 1000) * 100).toFixed(2)}%`,
        uptime: '99.8%',
        syncSuccessRate: '95%',
        activeUsers: Math.floor(Math.random() * 50) + 10
      };
      
      // Mock recent changes (in production, get from git commits)
      const recentChanges = [
        'Fixed Housecall Pro sync constraint violations',
        'Implemented persistent sync status bar',
        'Added AI-powered error monitoring',
        'Improved database error handling'
      ];
      
      // Generate AI report
      const aiReport = await aiMonitor.generateWeeklyReport(
        errorStats.byCategory,
        performanceMetrics,
        recentChanges
      );
      
      const reportData: WeeklyReportData = {
        contractorId,
        reportDate: new Date(),
        report: {
          ...aiReport,
          metrics: performanceMetrics,
          errorStats: errorStats,
          changes: recentChanges
        },
        status: 'generated'
      };
      
      weeklyReports.push(reportData);
      
      console.log(`[AI-Reporter] Weekly report generated for contractor ${contractorId}`);
      return reportData;
      
    } catch (error) {
      console.error(`[AI-Reporter] Failed to generate weekly report:`, error);
      throw error;
    }
  }
  
  /**
   * Schedule weekly reports for all active contractors
   */
  async scheduleWeeklyReports(): Promise<void> {
    // In production, this would query the database for active contractors
    const activeContractors = ['800173c8-2385-431a-895e-3b27f8553834']; // Demo contractor
    
    for (const contractorId of activeContractors) {
      try {
        await this.generateWeeklyReport(contractorId);
      } catch (error) {
        console.error(`[AI-Reporter] Failed to generate report for ${contractorId}:`, error);
      }
    }
  }
  
  /**
   * Get the latest weekly report for a contractor
   */
  getLatestReport(contractorId: string): WeeklyReportData | undefined {
    return weeklyReports
      .filter(report => report.contractorId === contractorId)
      .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime())[0];
  }
  
  /**
   * Get all reports for a contractor
   */
  getReports(contractorId: string): WeeklyReportData[] {
    return weeklyReports
      .filter(report => report.contractorId === contractorId)
      .sort((a, b) => b.reportDate.getTime() - a.reportDate.getTime());
  }
}

// Export singleton instance
export const weeklyReporter = new WeeklyReporterService();

// Schedule weekly reports (in production, use proper cron job)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    console.log('[AI-Reporter] Running scheduled weekly reports...');
    weeklyReporter.scheduleWeeklyReports().catch(console.error);
  }, 7 * 24 * 60 * 60 * 1000); // Every 7 days
}