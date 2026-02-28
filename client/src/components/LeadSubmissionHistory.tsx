import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Calendar, ExternalLink, FileText, Briefcase } from "lucide-react";
import { format } from "date-fns";
import type { Lead } from "@shared/schema";
import { Link } from "wouter";

interface LeadSubmissionHistoryProps {
  contactId: string;
}

export function LeadSubmissionHistory({ contactId }: LeadSubmissionHistoryProps) {
  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: [`/api/contacts/${contactId}/leads`],
    enabled: !!contactId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="lead-history-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!leads || leads.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No submission history"
        description="This contact has no lead submissions yet."
        data-testid="lead-history-empty"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="lead-history-list">
      {leads.map((lead) => (
        <Card key={lead.id} className="hover-elevate" data-testid={`lead-submission-${lead.id}`}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base font-medium" data-testid={`lead-date-${lead.id}`}>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {format(new Date(lead.createdAt), "PPP 'at' p")}
                </div>
              </CardTitle>
              <Badge 
                variant={
                  lead.status === 'converted' ? 'default' :
                  lead.status === 'qualified' ? 'secondary' :
                  lead.status === 'disqualified' ? 'destructive' :
                  'outline'
                }
                data-testid={`lead-status-${lead.id}`}
              >
                {lead.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.source && (
              <div data-testid={`lead-source-${lead.id}`}>
                <span className="text-sm font-medium text-muted-foreground">Source: </span>
                <span className="text-sm">{lead.source}</span>
              </div>
            )}

            {lead.message && (
              <div data-testid={`lead-message-${lead.id}`}>
                <span className="text-sm font-medium text-muted-foreground">Message: </span>
                <p className="text-sm mt-1 whitespace-pre-wrap">{lead.message}</p>
              </div>
            )}

            {lead.pageUrl && (
              <div data-testid={`lead-page-url-${lead.id}`}>
                <span className="text-sm font-medium text-muted-foreground">Page: </span>
                <a 
                  href={lead.pageUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  data-testid={`lead-page-link-${lead.id}`}
                >
                  {lead.pageUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {(lead.utmSource || lead.utmMedium || lead.utmCampaign || lead.utmTerm || lead.utmContent) && (
              <div className="space-y-1" data-testid={`lead-utm-params-${lead.id}`}>
                <span className="text-sm font-medium text-muted-foreground">UTM Parameters:</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {lead.utmSource && (
                    <Badge variant="outline" data-testid={`lead-utm-source-${lead.id}`}>
                      Source: {lead.utmSource}
                    </Badge>
                  )}
                  {lead.utmMedium && (
                    <Badge variant="outline" data-testid={`lead-utm-medium-${lead.id}`}>
                      Medium: {lead.utmMedium}
                    </Badge>
                  )}
                  {lead.utmCampaign && (
                    <Badge variant="outline" data-testid={`lead-utm-campaign-${lead.id}`}>
                      Campaign: {lead.utmCampaign}
                    </Badge>
                  )}
                  {lead.utmTerm && (
                    <Badge variant="outline" data-testid={`lead-utm-term-${lead.id}`}>
                      Term: {lead.utmTerm}
                    </Badge>
                  )}
                  {lead.utmContent && (
                    <Badge variant="outline" data-testid={`lead-utm-content-${lead.id}`}>
                      Content: {lead.utmContent}
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {(lead.convertedToEstimateId || lead.convertedToJobId) && (
              <div className="pt-2 border-t space-y-2" data-testid={`lead-conversion-${lead.id}`}>
                <span className="text-sm font-medium text-muted-foreground">Conversion:</span>
                <div className="flex flex-wrap gap-2">
                  {lead.convertedToEstimateId && (
                    <Link 
                      href={`/estimates?highlight=${lead.convertedToEstimateId}`}
                      data-testid={`lead-estimate-link-${lead.id}`}
                    >
                      <Badge variant="secondary" className="hover-elevate cursor-pointer">
                        <FileText className="h-3 w-3 mr-1" />
                        Estimate Created
                      </Badge>
                    </Link>
                  )}
                  {lead.convertedToJobId && (
                    <Link 
                      href={`/jobs?highlight=${lead.convertedToJobId}`}
                      data-testid={`lead-job-link-${lead.id}`}
                    >
                      <Badge variant="secondary" className="hover-elevate cursor-pointer">
                        <Briefcase className="h-3 w-3 mr-1" />
                        Job Created
                      </Badge>
                    </Link>
                  )}
                </div>
                {lead.convertedAt && (
                  <p className="text-xs text-muted-foreground" data-testid={`lead-converted-at-${lead.id}`}>
                    Converted on {format(new Date(lead.convertedAt), "PPP")}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
