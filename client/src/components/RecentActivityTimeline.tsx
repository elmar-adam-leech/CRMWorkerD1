import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, FileText, Phone, Mail, MessageSquare, Calendar, UserCheck, AlertCircle, ArrowRight, Users, Briefcase, FileText as EstimateIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { useWebSocketContext } from "@/contexts/WebSocketContext";
import { useEffect } from "react";

type Activity = {
  id: string;
  type: 'note' | 'call' | 'email' | 'sms' | 'meeting' | 'follow_up' | 'status_change';
  title?: string;
  content?: string;
  leadId?: string;
  estimateId?: string;
  jobId?: string;
  customerId?: string;
  createdAt: string;
  entityName?: string;
  entityType?: 'lead' | 'estimate' | 'job';
};

const getActivityIcon = (type: Activity['type']) => {
  switch (type) {
    case 'note': return <FileText className="w-4 h-4" />;
    case 'call': return <Phone className="w-4 h-4" />;
    case 'email': return <Mail className="w-4 h-4" />;
    case 'sms': return <MessageSquare className="w-4 h-4" />;
    case 'meeting': return <Calendar className="w-4 h-4" />;
    case 'follow_up': return <UserCheck className="w-4 h-4" />;
    case 'status_change': return <AlertCircle className="w-4 h-4" />;
    default: return <FileText className="w-4 h-4" />;
  }
};

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getActivityTypeColor = (type: Activity['type']) => {
  switch (type) {
    case 'note': return 'bg-chart-1/10 text-chart-1';
    case 'call': return 'bg-chart-2/10 text-chart-2';
    case 'email': return 'bg-chart-3/10 text-chart-3';
    case 'sms': return 'bg-chart-4/10 text-chart-4';
    case 'meeting': return 'bg-chart-5/10 text-chart-5';
    case 'follow_up': return 'bg-primary/10 text-primary';
    case 'status_change': return 'bg-destructive/10 text-destructive';
    default: return 'bg-muted text-muted-foreground';
  }
};

const getEntityIcon = (entityType?: string) => {
  switch (entityType) {
    case 'lead': return <Users className="w-3 h-3" />;
    case 'estimate': return <EstimateIcon className="w-3 h-3" />;
    case 'job': return <Briefcase className="w-3 h-3" />;
    default: return null;
  }
};

interface RecentActivityTimelineProps {
  limit?: number;
  className?: string;
}

export function RecentActivityTimeline({ limit = 10, className }: RecentActivityTimelineProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocketContext();

  // Fetch all recent activities (not filtered by entity)
  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ['/api/activities', { limit }],
    queryFn: async () => {
      const response = await fetch(`/api/activities?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch activities');
      return response.json();
    },
  });

  // Subscribe to deletion events to refresh activity feed
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type === 'contact_deleted' || 
          message.type === 'estimate_deleted' || 
          message.type === 'job_deleted') {
        queryClient.invalidateQueries({ queryKey: ['/api/activities'] });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, queryClient]);

  const handleViewEntity = (activity: Activity) => {
    if (activity.leadId) {
      setLocation(`/leads?id=${activity.leadId}`);
    } else if (activity.estimateId) {
      setLocation(`/estimates?id=${activity.estimateId}`);
    } else if (activity.jobId) {
      setLocation(`/jobs?id=${activity.jobId}`);
    }
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="font-medium">No recent activity</p>
            <p className="text-sm">Activities will appear here as you work with leads, estimates, and jobs</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 p-3 rounded-lg border hover-elevate"
                data-testid={`activity-${activity.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  <Badge variant="secondary" className={`${getActivityTypeColor(activity.type)} border-0`}>
                    {getActivityIcon(activity.type)}
                  </Badge>
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {activity.title || activity.type.replace('_', ' ')}
                    </span>
                    {activity.entityType && (
                      <Badge variant="outline" className="text-xs gap-1">
                        {getEntityIcon(activity.entityType)}
                        {activity.entityType}
                      </Badge>
                    )}
                  </div>

                  {activity.content && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {activity.type === 'email' ? stripHtml(activity.content) : activity.content}
                    </p>
                  )}

                  {activity.entityName && (
                    <p className="text-xs text-muted-foreground">
                      {activity.entityName}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                  </p>
                </div>

                {(activity.leadId || activity.estimateId || activity.jobId) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => handleViewEntity(activity)}
                    data-testid={`button-view-activity-${activity.id}`}
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
