import { DashboardMetrics } from "@/components/DashboardMetrics";
import { FollowUpsWidget } from "@/components/FollowUpsWidget";
import { RecentActivityTimeline } from "@/components/RecentActivityTimeline";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { LayoutDashboard } from "lucide-react";

export default function Dashboard() {
  return (
    <PageLayout>
      <PageHeader 
        title="Dashboard" 
        description="Overview of your business performance and recent activity"
      />

      <DashboardMetrics />
      <FollowUpsWidget />
      <RecentActivityTimeline limit={8} />
    </PageLayout>
  );
}
