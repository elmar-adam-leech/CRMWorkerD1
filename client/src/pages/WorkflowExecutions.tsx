import { useQuery } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'wouter';

type WorkflowExecution = {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'entity_event' | 'time_based';
  triggerData: any;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  currentStep: number | null;
};

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export default function WorkflowExecutions() {
  const [, params] = useRoute('/workflows/:id/executions');
  const workflowId = params?.id || null;

  const { data: workflow, isLoading: workflowLoading } = useQuery<Workflow>({
    queryKey: ['/api/workflows', workflowId],
    enabled: !!workflowId,
  });

  const { data: executions, isLoading: executionsLoading } = useQuery<WorkflowExecution[]>({
    queryKey: ['/api/workflows', workflowId, 'executions'],
    enabled: !!workflowId,
  });

  if (!workflowId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="p-6">
          <p className="text-muted-foreground">Invalid workflow ID</p>
        </Card>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <Clock className="h-4 w-4 text-blue-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      completed: 'default',
      failed: 'destructive',
      running: 'secondary',
    } as const;
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'} className="text-xs">
        {status}
      </Badge>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Link href="/workflows">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">
                Execution History
              </h1>
              {workflowLoading ? (
                <Skeleton className="h-4 w-48 mt-1" />
              ) : workflow ? (
                <p className="text-sm text-muted-foreground">
                  {workflow.name}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {executionsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ))
          ) : !executions || executions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No executions yet</p>
                <p className="text-sm text-muted-foreground">
                  This workflow hasn't been run yet
                </p>
              </CardContent>
            </Card>
          ) : (
            executions.map((execution) => (
              <Card
                key={execution.id}
                className="hover-elevate"
                data-testid={`card-execution-${execution.id}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(execution.status)}
                      <CardTitle className="text-lg">
                        Execution #{execution.id}
                      </CardTitle>
                    </div>
                    {getStatusBadge(execution.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">Triggered By</p>
                      <Badge variant="outline" className="text-xs">
                        {execution.triggeredBy.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Started</p>
                      <p className="font-medium">
                        {formatDistanceToNow(new Date(execution.startedAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>

                  {execution.completedAt && (
                    <div className="text-sm">
                      <p className="text-muted-foreground mb-1">Completed</p>
                      <p className="font-medium">
                        {formatDistanceToNow(new Date(execution.completedAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  )}

                  {execution.currentStep !== null && execution.status === 'running' && (
                    <div className="text-sm">
                      <p className="text-muted-foreground mb-1">Current Step</p>
                      <p className="font-medium">Step {execution.currentStep}</p>
                    </div>
                  )}

                  {execution.error && (
                    <div className="mt-3 p-3 bg-destructive/10 rounded-md border border-destructive/20">
                      <div className="flex items-start gap-2">
                        <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-destructive mb-1">
                            Error
                          </p>
                          <p className="text-sm text-destructive/90">
                            {execution.error}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {execution.triggerData && Object.keys(execution.triggerData).length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm text-muted-foreground mb-2">Trigger Data</p>
                      <div className="p-3 bg-muted rounded-md">
                        <pre className="text-xs overflow-auto">
                          {JSON.stringify(execution.triggerData, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
