import { DashboardMetrics } from '../DashboardMetrics';

export default function DashboardMetricsExample() {
  // TODO: remove mock functionality
  const mockMetrics = {
    totalLeads: 47,
    pendingEstimates: 18,
    activeJobs: 32,
    monthlyRevenue: 45600,
    leadsGrowth: 12.5,
    estimatesGrowth: 8.3,
    jobsGrowth: 15.2,
    revenueGrowth: -2.1,
  };

  return (
    <div className="p-6">
      <DashboardMetrics metrics={mockMetrics} />
    </div>
  );
}