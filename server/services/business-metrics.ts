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
   * Calculate business performance metrics for a contractor
   */
  async calculateMetrics(contractorId: string, daysPeriod: number = 30): Promise<BusinessMetrics> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - daysPeriod);
    const periodEnd = new Date();

    try {
      // Get custom business targets for this contractor
      const businessTargets = await storage.getBusinessTargets(contractorId);
      
      // Use custom targets or fall back to defaults
      const targets = {
        speedToLeadHours: businessTargets ? (businessTargets.speedToLeadMinutes / 60) : 2, // Convert minutes to hours
        followUpRatePercent: businessTargets ? parseFloat(businessTargets.followUpRatePercent) : 90,
        setRatePercent: businessTargets ? parseFloat(businessTargets.setRatePercent) : 25,
        closeRatePercent: businessTargets ? parseFloat(businessTargets.closeRatePercent) : 40
      };

      // Get all contacts with type='lead' for the period
      const leads = await storage.getContacts(contractorId, 'lead');
      const recentLeads = leads.filter(lead => 
        lead.createdAt && new Date(lead.createdAt) >= periodStart
      );

      // Get estimates and jobs for conversion tracking
      const estimates = await storage.getEstimates(contractorId);
      const jobs = await storage.getJobs(contractorId);
      
      // Calculate Speed to Lead (average time to first contact)
      const contactedLeads = recentLeads.filter(lead => lead.contactedAt);
      const speedToLeadHours = contactedLeads.length > 0 
        ? contactedLeads.reduce((sum, lead) => {
            const created = new Date(lead.createdAt!);
            const contacted = new Date(lead.contactedAt!);
            const diffHours = (contacted.getTime() - created.getTime()) / (1000 * 60 * 60);
            return sum + diffHours;
          }, 0) / contactedLeads.length
        : 0;

      // Calculate Follow Up Rate
      const followUpRate = recentLeads.length > 0 
        ? (contactedLeads.length / recentLeads.length) * 100 
        : 0;

      // Calculate Set Rate (leads that became scheduled estimates)
      const scheduledLeads = recentLeads.filter(lead => lead.isScheduled);
      const setRate = recentLeads.length > 0 
        ? (scheduledLeads.length / recentLeads.length) * 100 
        : 0;

      // Calculate Close Rate (estimates that became completed jobs)
      const recentEstimates = estimates.filter(estimate => 
        estimate.createdAt && new Date(estimate.createdAt) >= periodStart
      );
      const completedJobs = jobs.filter(job => 
        job.status === 'completed' && 
        job.createdAt && new Date(job.createdAt) >= periodStart
      );
      const closeRate = recentEstimates.length > 0 
        ? (completedJobs.length / recentEstimates.length) * 100 
        : 0;

      // Calculate revenue from completed jobs
      const revenue = completedJobs.reduce((sum, job) => {
        return sum + (parseFloat(job.value) || 0);
      }, 0);

      // Determine trends (simplified - in production, compare with previous period)
      const getTrend = (value: number, target: number): 'improving' | 'declining' | 'stable' => {
        if (value >= target) return 'improving';
        if (value < target * 0.8) return 'declining';
        return 'stable';
      };

      const metrics: BusinessMetrics = {
        speedToLead: {
          averageHours: Math.round(speedToLeadHours * 10) / 10,
          trend: getTrend(speedToLeadHours, targets.speedToLeadHours),
          target: Math.round(targets.speedToLeadHours * 10) / 10
        },
        followUpRate: {
          percentage: Math.round(followUpRate * 10) / 10,
          trend: getTrend(followUpRate, targets.followUpRatePercent),
          target: Math.round(targets.followUpRatePercent * 10) / 10
        },
        setRate: {
          percentage: Math.round(setRate * 10) / 10,
          trend: getTrend(setRate, targets.setRatePercent),
          target: Math.round(targets.setRatePercent * 10) / 10
        },
        closeRate: {
          percentage: Math.round(closeRate * 10) / 10,
          trend: getTrend(closeRate, targets.closeRatePercent),
          target: Math.round(targets.closeRatePercent * 10) / 10
        },
        totalLeads: recentLeads.length,
        totalJobs: completedJobs.length,
        revenue: revenue,
        periodStart,
        periodEnd
      };

      return metrics;
    } catch (error) {
      console.error('Failed to calculate business metrics:', error);
      // Return default metrics on error
      // Use default targets in error case too
      const defaultTargets = {
        speedToLeadHours: 2,
        followUpRatePercent: 90,
        setRatePercent: 25,
        closeRatePercent: 40
      };
      
      return {
        speedToLead: { averageHours: 0, trend: 'stable', target: defaultTargets.speedToLeadHours },
        followUpRate: { percentage: 0, trend: 'stable', target: defaultTargets.followUpRatePercent },
        setRate: { percentage: 0, trend: 'stable', target: defaultTargets.setRatePercent },
        closeRate: { percentage: 0, trend: 'stable', target: defaultTargets.closeRatePercent },
        totalLeads: 0,
        totalJobs: 0,
        revenue: 0,
        periodStart,
        periodEnd
      };
    }
  }

  /**
   * Generate AI-powered business insights and recommendations
   */
  async generateBusinessInsights(metrics: BusinessMetrics): Promise<BusinessInsights> {
    try {
      const prompt = `
Analyze these business performance metrics for an HVAC contractor and provide actionable insights:

Period: ${metrics.periodStart.toLocaleDateString()} to ${metrics.periodEnd.toLocaleDateString()}

Metrics:
- Speed to Lead: ${metrics.speedToLead.averageHours} hours (target: ${metrics.speedToLead.target} hours)
- Follow Up Rate: ${metrics.followUpRate.percentage}% (target: ${metrics.followUpRate.target}%)
- Set Rate: ${metrics.setRate.percentage}% (target: ${metrics.setRate.target}%)
- Close Rate: ${metrics.closeRate.percentage}% (target: ${metrics.closeRate.target}%)
- Total Leads: ${metrics.totalLeads}
- Completed Jobs: ${metrics.totalJobs}
- Revenue: $${metrics.revenue.toLocaleString()}

Provide analysis in JSON format with:
- summary (overall business performance summary)
- recommendations (3-5 specific actionable recommendations)
- strengths (what they're doing well)
- improvements (areas needing attention)
- actionItems (3 priority actions for next week)
`;

      const insights = await aiMonitor.generateWeeklyReport(
        { 'business_metrics': 1 },
        {
          speedToLead: metrics.speedToLead.averageHours,
          followUpRate: metrics.followUpRate.percentage,
          setRate: metrics.setRate.percentage,
          closeRate: metrics.closeRate.percentage,
          totalLeads: metrics.totalLeads,
          revenue: metrics.revenue
        },
        ['Business metrics analysis requested']
      );

      // Transform the AI report into business insights format
      return {
        summary: insights.summary || 'Business performance analysis complete.',
        recommendations: insights.recommendations || [
          'Improve lead response time',
          'Implement systematic follow-up process',
          'Optimize estimate presentation'
        ],
        strengths: insights.performanceInsights || ['Consistent lead generation'],
        improvements: insights.codeQualityIssues || ['Speed to lead response'],
        actionItems: insights.priorityActions || [
          'Set up lead response automation',
          'Create follow-up templates',
          'Review estimate pricing strategy'
        ]
      };
    } catch (error) {
      console.error('Failed to generate business insights:', error);
      // Return default insights on error
      return {
        summary: 'Business metrics calculated successfully. Review your performance against industry targets.',
        recommendations: [
          'Aim to contact leads within 2 hours of inquiry',
          'Follow up with all leads systematically',
          'Focus on converting estimates to scheduled jobs',
          'Track and improve job completion rates'
        ],
        strengths: ['Active lead generation'],
        improvements: ['Lead response time', 'Follow-up consistency'],
        actionItems: [
          'Set up lead notification alerts',
          'Create follow-up schedule templates',
          'Review pricing and presentation strategies'
        ]
      };
    }
  }
}

// Export singleton instance
export const businessMetrics = new BusinessMetricsService();