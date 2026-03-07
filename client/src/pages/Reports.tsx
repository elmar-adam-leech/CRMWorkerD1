import { LeadsTrendChart } from "@/components/dashboard/LeadsTrendChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";

export default function Reports() {
  return (
    <PageLayout>
      <PageHeader
        title="Reports"
        description="View analytics and insights for your business"
      />

      <div className="grid gap-6">
        <LeadsTrendChart />

        {/* Placeholder for additional reports */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Reports</CardTitle>
            <CardDescription>More analytics coming soon</CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            <p>Additional report components will be added here in future updates.</p>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
