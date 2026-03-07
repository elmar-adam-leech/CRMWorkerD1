import { LeadsTrendChart } from "@/components/dashboard/LeadsTrendChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function Reports() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Reports
          </h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            View analytics and insights for your business
          </p>
        </div>
      </div>

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
    </div>
  );
}
