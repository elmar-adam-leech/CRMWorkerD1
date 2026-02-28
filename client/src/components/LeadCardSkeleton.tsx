import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function LeadCardSkeleton() {
  return (
    <Card className="bg-muted/20">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
        <Skeleton className="h-8 w-8 rounded-md shrink-0" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        
        <div className="flex gap-2 pt-2 border-t">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}