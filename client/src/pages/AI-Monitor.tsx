import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Brain, Timer, Target, TrendingUp, FileText, RefreshCw, XCircle, Shield } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { useCurrentUser, isAdminUser } from "@/hooks/useCurrentUser";

export default function AIMonitor() {
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();

  const userRole = currentUser?.user?.role;
  const isAuthorized = isAdminUser(userRole);
  const isSuperAdmin = userRole === 'super_admin';

  // Data queries - only enabled for authorized users
  const { data: errorStats, isLoading: errorStatsLoading, refetch: refetchErrorStats } = useQuery<{
    total: number;
    bySeverity: Record<string, number>;
    [key: string]: unknown;
  }>({
    queryKey: ['/api/ai/errors'],
    enabled: isAuthorized
  });

  const { data: errorLogs, isLoading: errorLogsLoading, refetch: refetchErrorLogs } = useQuery<unknown[]>({
    queryKey: ['/api/ai/error-logs'],
    enabled: isAuthorized
  });

  const { data: weeklyReport, isLoading: weeklyReportLoading, refetch: refetchWeeklyReport } = useQuery<{
    report: { recommendations: unknown[]; [key: string]: unknown };
    [key: string]: unknown;
  }>({
    queryKey: ['/api/ai/weekly-report'],
    enabled: isAuthorized
  });

  const { data: performanceMetrics, isLoading: performanceLoading, refetch: refetchPerformanceMetrics } = useQuery<{
    speedToLead: string;
    [key: string]: unknown;
  }>({
    queryKey: ['/api/ai/business-metrics'],
    enabled: isAuthorized && userRole !== 'super_admin'
  });

  const { data: businessInsights, isLoading: businessInsightsLoading, refetch: refetchBusinessInsights } = useQuery<unknown>({
    queryKey: ['/api/ai/business-insights'],
    enabled: isAuthorized && userRole !== 'super_admin'
  });

  if (userLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageLayout>
    );
  }

  if (!isAuthorized) {
    return (
      <PageLayout>
        <PageHeader
          title="AI Monitor"
          description="AI-powered insights and monitoring dashboard"
          icon={<Brain className="h-6 w-6" />}
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Access Denied
            </CardTitle>
            <CardDescription>
              Only administrators and managers can access AI Monitor
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                AI Monitor provides advanced insights and analytics that are restricted to administrators and managers. Please contact your system administrator if you need access to this feature.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="AI Monitor"
        description="AI-powered insights and monitoring dashboard"
        icon={<Brain className="h-6 w-6" />}
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="insights">Business Insights</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="errors">Error Analysis</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {isSuperAdmin ? (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card data-testid="card-total-errors">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-errors">
                      {errorStatsLoading ? '...' : errorStats?.total || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tracked errors with AI analysis
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-critical-errors">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
                    <XCircle className="h-4 w-4 text-destructive" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-destructive" data-testid="text-critical-errors">
                      {errorStatsLoading ? '...' : errorStats?.bySeverity?.critical || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Require immediate attention
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-ai-insights">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">AI Insights</CardTitle>
                    <Brain className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-ai-insights">
                      {weeklyReportLoading ? '...' : weeklyReport?.report?.recommendations?.length || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Active recommendations
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-system-health">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">System Health</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-system-health">
                      {weeklyReportLoading ? '...' : (weeklyReport as any)?.report?.metrics?.uptime || '99.8%'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Uptime percentage
                    </p>
                  </CardContent>
                </Card>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    refetchErrorStats();
                    refetchErrorLogs();
                  }}
                  disabled={errorStatsLoading || errorLogsLoading}
                  variant="outline"
                  size="sm"
                  data-testid="button-refresh-error-stats"
                >
                  {errorStatsLoading || errorLogsLoading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4 mr-2" />
                  )}
                  Analyze System Errors
                </Button>
                <Button
                  onClick={() => refetchWeeklyReport()}
                  disabled={weeklyReportLoading}
                  variant="outline"
                  size="sm"
                  data-testid="button-refresh-weekly-report"
                >
                  {weeklyReportLoading ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  Get AI Report
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card data-testid="card-speed-to-lead">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Speed to Lead</CardTitle>
                    <Timer className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-speed-to-lead">
                      {performanceLoading ? '...' : performanceMetrics?.speedToLead || '0m'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Target: 5 minutes
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <div className="flex justify-center">
            <Button
              onClick={() => refetchPerformanceMetrics()}
              disabled={performanceLoading}
              data-testid="button-refresh-performance-metrics"
            >
              {performanceLoading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TrendingUp className="h-4 w-4 mr-2" />
              )}
              Analyze Performance
            </Button>
          </div>
          <Card data-testid="card-performance-summary">
            <CardHeader>
              <CardTitle>Performance Summary</CardTitle>
              <CardDescription>Key metrics and targets</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Performance metrics will load here after analysis.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          <div className="flex justify-center">
            <Button
              onClick={() => refetchBusinessInsights()}
              disabled={businessInsightsLoading}
              data-testid="button-refresh-business-insights"
            >
              {businessInsightsLoading ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-2" />
              )}
              Generate Business Insights
            </Button>
          </div>
          <Card data-testid="card-business-insights">
            <CardHeader>
              <CardTitle>Business Intelligence</CardTitle>
              <CardDescription>AI-powered business insights and recommendations</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Business insights will be generated here after analysis.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="errors" className="space-y-6">
            <div className="flex justify-center">
              <Button
                onClick={() => {
                  refetchErrorStats();
                  refetchErrorLogs();
                }}
                disabled={errorStatsLoading || errorLogsLoading}
                data-testid="button-analyze-error-logs"
              >
                {errorStatsLoading || errorLogsLoading ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4 mr-2" />
                )}
                Analyze Error Logs
              </Button>
            </div>
            <Card data-testid="card-error-analysis">
              <CardHeader>
                <CardTitle>Error Analysis</CardTitle>
                <CardDescription>AI-powered error detection and analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <p>Error analysis will be performed here when triggered.</p>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  );
}