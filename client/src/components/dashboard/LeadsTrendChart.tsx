import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2 } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";

interface TrendDataPoint {
  date: string;
  count: number;
}

export function LeadsTrendChart() {
  const { data: leads, isLoading } = useQuery<any[]>({
    queryKey: ["/api/contacts", { type: 'lead' }],
    queryFn: async () => {
      const response = await fetch('/api/contacts?type=lead');
      if (!response.ok) throw new Error('Failed to fetch contacts');
      return response.json();
    },
  });

  // Aggregate leads by date (last 30 days)
  const trendData: TrendDataPoint[] = useMemo(() => {
    if (!leads) return [];

    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = startOfDay(subDays(new Date(), 29 - i));
      return {
        date: format(date, "MMM d"),
        fullDate: date,
        count: 0,
      };
    });

    leads.forEach((lead) => {
      const createdDate = startOfDay(new Date(lead.createdAt));
      const dataPoint = last30Days.find(
        (d) => d.fullDate.getTime() === createdDate.getTime()
      );
      if (dataPoint) {
        dataPoint.count++;
      }
    });

    return last30Days.map(({ date, count }) => ({ date, count }));
  }, [leads]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leads Trend</CardTitle>
          <CardDescription>Leads created over the last 30 days</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads Trend</CardTitle>
        <CardDescription>Leads created over the last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              tick={{ fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--background))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: "hsl(var(--primary))" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
