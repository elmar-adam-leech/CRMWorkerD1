import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
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
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'wouter';
import { PageLayout } from '@/components/ui/page-layout';
import type { Workflow } from '@/types/workflow';

type StepLog = {
  stepId: string;
  stepOrder: number;
  actionType: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'success' | 'failed';
  result?: unknown;
  error?: string;
};

type WorkflowExecution = {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'entity_event' | 'time_based';
  triggerData: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  currentStep: number | null;
  stepLogs: StepLog[];
};

function formatActionType(actionType: string): string {
  return actionType
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function WorkflowExecutions() {
  const [, params] = useRoute('/workflows/:id/executions');
  const workflowId = params?.id || null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: workflow, isLoading: workflowLoading } = useQuery<Workflow>({
    queryKey: ['/api/workflows', workflowId],
    enabled: !!workflowId,
  });

  const { data: executions, isLoading: executionsLoading } = useQuery<WorkflowExecution[]>({
    queryKey: ['/api/workflows', workflowId, 'executions'],
    enabled: !!workflowId,
  });

  const { subscribe } = useWebSocketContext();
  useEffect(() => {
    if (!workflowId) return;
    const unsubscribe = subscribe((message: { type: string; workflowId?: string }) => {
      if (
        ['workflow_started', 'workflow_completed', 'workflow_failed'].includes(message.type) &&
        (!message.workflowId || message.workflowId === workflowId)
      ) {
        queryClient.invalidateQueries({ queryKey: ['/api/workflows', workflowId, 'executions'] });
      }
    });
    return unsubscribe;
  }, [subscribe, queryClient, workflowId]);

  if (!workflowId) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-full">
          <Card className="p-6">
            <p className="text-muted-foreground">Invalid workflow ID</p>
          </Card>
        </div>
      </PageLayout>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
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

  const getStepIcon = (status: 'success' | 'failed') => {
    if (status === 'success') {
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
    }
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  };

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Header */}
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
              <p className="text-sm text-muted-foreground">{workflow.name}</p>
            ) : null}
          </div>
        </div>

        {/* Executions */}
        <div className="space-y-4">
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
            executions.map((execution) => {
              const isExpanded = expandedId === execution.id;
              const hasStepLogs = execution.stepLogs && execution.stepLogs.length > 0;
              return (
                <Card
                  key={execution.id}
                  data-testid={`card-execution-${execution.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(execution.status)}
                        <CardTitle className="text-base">
                          Execution #{execution.id.slice(0, 8)}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getStatusBadge(execution.status)}
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-steps-${execution.id}`}
                          disabled={!hasStepLogs}
                          onClick={() => setExpandedId(isExpanded ? null : execution.id)}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 mr-1" />
                            : <ChevronRight className="h-3.5 w-3.5 mr-1" />
                          }
                          Steps ({execution.stepLogs?.length ?? 0})
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground mb-1">Triggered By</p>
                        <Badge variant="outline" className="text-xs">
                          {(execution.triggeredBy || 'manual').replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">Started</p>
                        <p className="font-medium">
                          {execution.startedAt
                            ? formatDistanceToNow(new Date(execution.startedAt), { addSuffix: true })
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {execution.completedAt && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">Completed</p>
                        <p className="font-medium">
                          {formatDistanceToNow(new Date(execution.completedAt), { addSuffix: true })}
                        </p>
                      </div>
                    )}

                    {execution.currentStep !== null && execution.status === 'running' && (
                      <div className="text-sm">
                        <p className="text-muted-foreground mb-1">Current Step</p>
                        <p className="font-medium">Step {execution.currentStep}</p>
                      </div>
                    )}

                    {execution.errorMessage && (
                      <div className="mt-3 p-3 bg-destructive/10 rounded-md border border-destructive/20">
                        <div className="flex items-start gap-2">
                          <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-destructive mb-1">Error</p>
                            <p className="text-sm text-destructive/90">{execution.errorMessage}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step timeline — expandable */}
                    {isExpanded && hasStepLogs && (
                      <div className="mt-3 pt-3 border-t space-y-2" data-testid={`step-timeline-${execution.id}`}>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                          Step Timeline
                        </p>
                        {execution.stepLogs.map((log, idx) => (
                          <div key={log.stepId || idx} className="flex items-start gap-3 py-1.5">
                            {getStepIcon(log.status)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">
                                  {formatActionType(log.actionType)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {log.durationMs}ms
                                </span>
                              </div>
                              {log.error && (
                                <p className="text-xs text-destructive mt-0.5">{log.error}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </PageLayout>
  );
}
