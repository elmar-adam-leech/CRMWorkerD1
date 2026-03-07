import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Shield, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function SecurityTab() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleLogoutAll = async () => {
    setIsPending(true);
    try {
      await apiRequest("POST", "/api/auth/logout-all");
      toast({ title: "Signed out of all devices", description: "All active sessions have been ended." });
      setTimeout(() => setLocation("/login"), 800);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to sign out all devices",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Settings
          </CardTitle>
          <CardDescription>Manage your security preferences and active sessions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Sign out of all devices</p>
              <p className="text-sm text-muted-foreground">
                Immediately ends every active session on all your devices. Use this if your phone was stolen or you suspect unauthorized access.
              </p>
            </div>
            <Button
              variant="destructive"
              className="shrink-0 sm:w-auto w-full"
              onClick={() => setConfirmOpen(true)}
              data-testid="button-logout-all"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out all devices
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of all devices?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately end all active sessions on every device — including this one. You will be redirected to the login page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogoutAll}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-logout-all"
            >
              {isPending ? "Signing out..." : "Sign out all devices"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
