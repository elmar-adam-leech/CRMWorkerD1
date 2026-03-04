import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export function SecurityTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Settings
          </CardTitle>
          <CardDescription>Manage your security preferences and authentication</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Security settings coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}
