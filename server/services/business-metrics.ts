import { storage } from "../storage";
import { aiMonitor } from "./ai-monitor";

export interface BusinessMetrics {
  speedToLead: {
    averageHours: number;
    trend: 'improving' | 'declining' | 'stable';
    target: number;
  };
  followUpRate: {
    percentage: number;
    trend: 'improving' | 'declining' | 'stable';
    target: number;
  };
  setRate: {
    percentage: number;
    trend: 'improving' | 'declining' | 'stable';
    target: number;
  };
  closeRate: {
    percentage: number;
    trend: 'improving' | 'declining' | 'stable';
    target: number;
  };
  totalLeads: number;
  totalJobs: number;
  revenue: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface BusinessInsights {
  summary: string;
  recommendations: string[];
  strengths: string[];
  improvements: string[];
  actionItems: string[];
}

export class BusinessMetricsService {
  
  /**
   * Calculate business performance metrics for a contractor using SQL aggregates.
   * No full-table row fetches — each metric is a single aggregate SQL query.
   */
  async calculateMetrics(contractorId: string, daysPeriod: number = 30): Promise<BusinessMetrics> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - daysPeriod);
    const periodEnd = new Date();

    try {
      const [businessTargets, agg] = await Promise.all([
        storage.getBusinessTargets(contractorId),
        storage.getMetricsAggregates(contractorId, periodStart),
      ]);

      const targets = {
        speedToLeadHours: businessTargets ? (businessTargets.speedToLeadMinutes / 60) : 2,
        followUpRatePercent: businessTargets ? parseFloat(businessTargets.followUpRatePercent) : 90,
        setRatePercent: businessTargets ? parseFloat(businessTargets.setRatePercent) : 25,
        closeRatePercent: businessTargets ? parseFloat(businessTargets.closeRatePercent) : 40,
      };

      const speedToLeadHours = agg.avgSpeedToLeadHours;
      const followUpRate = agg.totalLeads > 0
        ? (agg.contactedLeads / agg.totalLeads) * 100
        : 0;
      const setRate = agg.totalLeads > 0
        ? (agg.scheduledLeads / agg.totalLeads) * 100
        : 0;
      const closeRate = agg.totalEstimates > 0
        ? (agg.completedJobs / agg.totalEstimates) * 100
        : 0;

      const getTrend = (value: number, target: number): 'improving' | 'declining' | 'stable' => {
        if (value >= target) return 'improving';
        if (value < target * 0.8) return 'declining';
        return 'stable';
      };

      return {
        speedToLead: {
          averageHours: Math.round(speedToLeadHours * 10) / 10,
          trend: getTrend(speedToLeadHours, targets.speedToLeadHours),
          target: Math.round(targets.speedToLeadHours * 10) / 10,
        },
        followUpRate: {
          percentage: Math.round(followUpRate * 10) / 10,
          trend: getTrend(followUpRate, targets.followUpRatePercent),
          target: Math.round(targets.followUpRatePercent * 10) / 10,
        },
        setRate: {
          percentage: Math.round(setRate * 10) / 10,
          trend: getTrend(setRate, targets.setRatePercent),
          target: Math.round(targets.setRatePercent * 10) / 10,
        },
        closeRate: {
          percentage: Math.round(closeRate * 10) / 10,
          trend: getTrend(closeRate, targets.closeRatePercent),
          target: Math.round(targets.closeRatePercent * 10) / 10,
        },
        totalLeads: agg.totalLeads,
        totalJobs: agg.completedJobs,
        revenue: agg.revenue,
        periodStart,
        periodEnd,
      };
    } catch (error) {
      console.error('Failed to calculate business metrics:', error);
      return {
        speedToLead: { averageHours: 0, trend: 'stable', target: 2 },
        followUpRate: { percentage: 0, trend: 'stable', target: 90 },
        setRate: { percentage: 0, trend: 'stable', target: 25 },
        closeRate: { percentage: 0, trend: 'stable', target: 40 },
        totalLeads: 0,
        totalJobs: 0,
        revenue: 0,
        periodStart,
        periodEnd,
      };
    }
  }

  /**
   * Generate AI-powered business insights and recommendations
   */
  async generateBusinessInsights(metrics: BusinessMetrics): Promise<BusinessInsights> {
    try {
      const insights = await aiMonitor.generateWeeklyReport(
        { 'business_metrics': 1 },
        {
          speedToLead: metrics.speedToLead.averageHours,
          followUpRate: metrics.followUpRate.percentage,
          setRate: metrics.setRate.percentage,
          closeRate: metrics.closeRate.percentage,
          totalLeads: metrics.totalLeads,
          revenue: metrics.revenue,
        },
        ['Business metrics analysis requested']
      );

      return {
        summary: insights.summary || 'Business performance analysis complete.',
        recommendations: insights.recommendations || [
          'Improve lead response time',
          'Implement systematic follow-up process',
          'Optimize estimate presentation',
        ],
        strengths: insights.performanceInsights || ['Consistent lead generation'],
        improvements: insights.codeQualityIssues || ['Speed to lead response'],
        actionItems: insights.priorityActions || [
          'Set up lead response automation',
          'Create follow-up templates',
          'Review estimate pricing strategy',
        ],
      };
    } catch (error) {
      console.error('Failed to generate business insights:', error);
      return {
        summary: 'Business metrics calculated successfully. Review your performance against industry targets.',
        recommendations: [
          'Aim to contact leads within 2 hours of inquiry',
          'Follow up with all leads systematically',
          'Focus on converting estimates to scheduled jobs',
          'Track and improve job completion rates',
        ],
        strengths: ['Active lead generation'],
        improvements: ['Lead response time', 'Follow-up consistency'],
        actionItems: [
          'Set up lead notification alerts',
          'Create follow-up schedule templates',
          'Review pricing and presentation strategies',
        ],
      };
    }
  }
}

export const businessMetrics = new BusinessMetricsService();
