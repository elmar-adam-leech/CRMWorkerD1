import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Shield, Target, TrendingUp, AlertTriangle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isStrictAdmin } from "@/hooks/useCurrentUser";

interface TargetsTabProps {
  currentUser: { user: { role: string } } | undefined;
  targetsLoading: boolean;
  businessTargets: { speedToLeadMinutes: number; followUpRatePercent: string; setRatePercent: string; closeRatePercent: string };
  setBusinessTargets: (targets: any) => void;
}

export function TargetsTab({ currentUser, targetsLoading, businessTargets, setBusinessTargets }: TargetsTabProps) {
  const { toast } = useToast();
  const isAdmin = isStrictAdmin(currentUser?.user?.role);

  const saveTargetsMutation = useMutation({
    mutationFn: async (targets: typeof businessTargets) => {
      const response = await apiRequest('POST', '/api/business-targets', targets);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Performance Targets Saved", description: "Your custom business targets have been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ['/api/business-targets'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save business targets.", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {!isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Access Denied</CardTitle>
            <CardDescription>Only administrators can access performance targets</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Performance targets can only be viewed and modified by administrators. Please contact your system administrator if you need to update these settings.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" />Performance Targets</CardTitle>
            <CardDescription>Set custom performance targets for your business. These targets are used by the AI monitor to evaluate contractor performance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {targetsLoading ? (
              <div className="animate-pulse space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-9 bg-muted rounded"></div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="speed-to-lead" className="text-sm font-medium">Speed to Lead (minutes)</Label>
                  <p className="text-xs text-muted-foreground">Maximum time allowed to respond to a new lead</p>
                  <Input id="speed-to-lead" type="number" min="1" max="1440" value={businessTargets.speedToLeadMinutes} onChange={(e) => setBusinessTargets({ ...businessTargets, speedToLeadMinutes: parseInt(e.target.value) || 60 })} data-testid="input-speed-to-lead" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="follow-up-rate" className="text-sm font-medium">Follow Up Rate (%)</Label>
                  <p className="text-xs text-muted-foreground">Target percentage of leads that should receive follow-up contact</p>
                  <Input id="follow-up-rate" type="number" min="0" max="100" step="0.01" value={businessTargets.followUpRatePercent} onChange={(e) => setBusinessTargets({ ...businessTargets, followUpRatePercent: e.target.value })} data-testid="input-follow-up-rate" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="set-rate" className="text-sm font-medium">Set Rate (%)</Label>
                  <p className="text-xs text-muted-foreground">Target percentage of leads that should be converted to scheduled appointments</p>
                  <Input id="set-rate" type="number" min="0" max="100" step="0.01" value={businessTargets.setRatePercent} onChange={(e) => setBusinessTargets({ ...businessTargets, setRatePercent: e.target.value })} data-testid="input-set-rate" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close-rate" className="text-sm font-medium">Close Rate (%)</Label>
                  <p className="text-xs text-muted-foreground">Target percentage of scheduled appointments that should result in completed jobs</p>
                  <Input id="close-rate" type="number" min="0" max="100" step="0.01" value={businessTargets.closeRatePercent} onChange={(e) => setBusinessTargets({ ...businessTargets, closeRatePercent: e.target.value })} data-testid="input-close-rate" />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <Button onClick={() => saveTargetsMutation.mutate(businessTargets)} disabled={saveTargetsMutation.isPending} data-testid="button-save-targets">
                    {saveTargetsMutation.isPending ? "Saving..." : "Save Performance Targets"}
                  </Button>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4" />
                    <span>Used by AI Monitor for performance evaluation</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Alert>
          <Target className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>Example Configuration:</strong> Elmar Heating uses 5 minutes for speed to lead, 100% follow-up rate, 45% set rate, and 35% close rate. Adjust these targets based on your business.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
