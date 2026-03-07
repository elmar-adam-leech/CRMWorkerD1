import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { GmailConnectionCard } from "@/components/settings/GmailConnectionCard";
import {
  User, Calendar, Users, UserPlus, Settings2, Search, ExternalLink, Copy, Code, Info, Phone, Smartphone
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProviderStatus } from "@/hooks/use-provider-config";


type UserRow = { id: string; username: string; name: string; email: string; role: string; contractorId: string; createdAt: string };

interface AccountTabProps {
  currentUser: { user: { id: string; name: string; email: string; role: string; gmailConnected?: boolean; gmailEmail?: string } } | undefined;
  isAdmin: boolean;
  bookingSlugInput: string;
  setBookingSlugInput: (v: string) => void;
  bookingSlugData: { bookingSlug: string | null; bookingUrl: string | null } | undefined;
  terminologySettings: { leadLabel: string; leadsLabel: string; estimateLabel: string; estimatesLabel: string; jobLabel: string; jobsLabel: string; messageLabel: string; messagesLabel: string; templateLabel: string; templatesLabel: string };
  setTerminologySettings: (v: any) => void;
  allUsers: UserRow[];
  usersLoading: boolean;
}

export function AccountTab({
  currentUser, isAdmin, bookingSlugInput, setBookingSlugInput,
  bookingSlugData, terminologySettings, setTerminologySettings,
  allUsers, usersLoading,
}: AccountTabProps) {
  const { toast } = useToast();
  const { data: me, refetch: refetchMe } = useCurrentUser();
  const { calling } = useProviderStatus();
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [newUserData, setNewUserData] = useState({ username: "", name: "", email: "", password: "", role: "user" });
  const [userSearchQuery, setUserSearchQuery] = useState('');

  const callPreferenceMutation = useMutation({
    mutationFn: async (callPreference: 'integration' | 'personal') => {
      const response = await apiRequest('PATCH', '/api/user/call-preference', { callPreference });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      refetchMe();
      toast({
        title: "Call preference updated",
        description: data.callPreference === 'personal'
          ? "You'll now use your personal phone when calling contacts."
          : "You'll now use the calling integration when calling contacts.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: async (data: typeof newUserData) => apiRequest('POST', '/api/users', data),
    onSuccess: () => {
      toast({ title: "User added", description: "The user has been added successfully" });
      setIsAddUserDialogOpen(false);
      setNewUserData({ username: "", name: "", email: "", password: "", role: "user" });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    },
    onError: (error: Error) => { toast({ title: "Failed to add user", description: error.message, variant: "destructive" }); },
  });

  const saveTerminologyMutation = useMutation({
    mutationFn: async (settings: typeof terminologySettings) => {
      const response = await apiRequest('POST', '/api/terminology', settings);
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Terminology Settings Saved", description: "Your navigation terminology has been updated successfully." });
      queryClient.invalidateQueries({ queryKey: ['/api/terminology'] });
    },
    onError: (error: any) => { toast({ title: "Error", description: error.message || "Failed to save terminology settings.", variant: "destructive" }); },
  });

  const saveBookingSlugMutation = useMutation({
    mutationFn: async (bookingSlug: string) => {
      const response = await apiRequest('POST', '/api/booking-slug', { bookingSlug: bookingSlug.trim().toLowerCase() || null });
      return response.json();
    },
    onSuccess: (data) => {
      setBookingSlugInput(data.bookingSlug || '');
      toast({ title: "Booking URL Updated", description: data.bookingUrl ? "Your public booking page is now accessible." : "Public booking page has been disabled." });
      queryClient.invalidateQueries({ queryKey: ['/api/booking-slug'] });
    },
    onError: (error: any) => { toast({ title: "Error", description: error.message || "Failed to save booking URL.", variant: "destructive" }); },
  });

  const filteredUsers = allUsers.filter((user) =>
    userSearchQuery === '' ||
    user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
    user.username.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />Account Information</CardTitle>
          <CardDescription>Manage your account settings and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Profile Information</h3>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <p className="text-sm" data-testid="text-user-name">{currentUser?.user.name || 'N/A'}</p>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm" data-testid="text-user-email">{currentUser?.user.email || 'N/A'}</p>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <p className="text-sm capitalize" data-testid="text-user-role">{currentUser?.user.role || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <GmailConnectionCard gmailConnected={currentUser?.user?.gmailConnected || false} gmailEmail={currentUser?.user?.gmailEmail} />

      {calling.isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Phone className="h-5 w-5" />Calling Preference</CardTitle>
            <CardDescription>Choose how you want to make calls from the CRM</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => callPreferenceMutation.mutate('integration')}
                  disabled={callPreferenceMutation.isPending}
                  data-testid="button-call-pref-integration"
                  className={`flex items-start gap-3 p-4 rounded-md border text-left transition-colors ${
                    (me?.user?.callPreference ?? 'integration') === 'integration'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover-elevate'
                  }`}
                >
                  <Phone className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Calling integration</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Uses your connected calling service. Calls are automatically logged.</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => callPreferenceMutation.mutate('personal')}
                  disabled={callPreferenceMutation.isPending}
                  data-testid="button-call-pref-personal"
                  className={`flex items-start gap-3 p-4 rounded-md border text-left transition-colors ${
                    me?.user?.callPreference === 'personal'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover-elevate'
                  }`}
                >
                  <Smartphone className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Personal phone</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Opens your device's native dialer. Calls won't be automatically logged.</div>
                  </div>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />Public Booking Page</CardTitle>
            <CardDescription>Allow leads to self-schedule appointments through a public booking page</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="booking-slug">Booking URL Slug</Label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground whitespace-nowrap">/book/</span>
                    <Input id="booking-slug" placeholder="your-company-name" value={bookingSlugInput} onChange={(e) => setBookingSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} data-testid="input-booking-slug" />
                  </div>
                  <Button onClick={() => saveBookingSlugMutation.mutate(bookingSlugInput)} disabled={saveBookingSlugMutation.isPending} data-testid="button-save-booking-slug">
                    {saveBookingSlugMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Use lowercase letters, numbers, and hyphens only (3-50 characters)</p>
              </div>

              {bookingSlugData?.bookingUrl && (
                <div className="space-y-2">
                  <Label>Your Public Booking URL</Label>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                    <a href={bookingSlugData.bookingUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex-1 truncate" data-testid="link-booking-url">{bookingSlugData.bookingUrl}</a>
                    <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(bookingSlugData.bookingUrl || ''); toast({ title: "Copied", description: "Booking URL copied to clipboard" }); }} data-testid="button-copy-booking-url"><Copy className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => window.open(bookingSlugData.bookingUrl || '', '_blank')} data-testid="button-open-booking-url"><ExternalLink className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}

              {bookingSlugData?.bookingUrl && bookingSlugData?.bookingSlug && (() => {
                const crmOrigin = new URL(bookingSlugData.bookingUrl!).origin;
                const savedSlug = bookingSlugData.bookingSlug;
                const embedCode = `<!-- Add this where you want the booking widget -->\n<div id="booking-widget"></div>\n<script>\n  window.BookingWidgetConfig = {\n    slug: "${savedSlug}",\n    baseUrl: "${crmOrigin}"\n  };\n</script>\n<script src="${crmOrigin}/booking-widget.js"></script>`;
                return (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2"><Code className="h-4 w-4" />Embed on Your Website</Label>
                    <div className="p-3 bg-muted rounded-md">
                      <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">{embedCode}</pre>
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => { navigator.clipboard.writeText(embedCode); toast({ title: "Copied", description: "Embed code copied to clipboard" }); }} data-testid="button-copy-embed-code">
                        <Copy className="h-4 w-4 mr-2" />Copy Embed Code
                      </Button>
                    </div>
                  </div>
                );
              })()}

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>Share this link with leads to allow them to schedule appointments directly. They'll see available time slots based on your team's calendar.</AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Team Management</CardTitle>
                <CardDescription>Manage user accounts and permissions for your organization</CardDescription>
              </div>
              <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-add-user"><UserPlus className="h-4 w-4 mr-2" />Add User</Button>
                </DialogTrigger>
                <DialogContent data-testid="dialog-add-user">
                  <DialogHeader>
                    <DialogTitle>Add New User</DialogTitle>
                    <DialogDescription>Create a new user account for your organization</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input id="username" placeholder="john.doe" value={newUserData.username} onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })} data-testid="input-username" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <Input id="name" placeholder="John Doe" value={newUserData.name} onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })} data-testid="input-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" placeholder="john.doe@example.com" value={newUserData.email} onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })} data-testid="input-email" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" type="password" placeholder="••••••••" value={newUserData.password} onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })} data-testid="input-password" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={newUserData.role} onValueChange={(value) => setNewUserData({ ...newUserData, role: value })}>
                        <SelectTrigger id="role" data-testid="select-role"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => { setIsAddUserDialogOpen(false); setNewUserData({ username: "", name: "", email: "", password: "", role: "user" }); }} data-testid="button-cancel-add-user">Cancel</Button>
                      <Button onClick={() => addUserMutation.mutate(newUserData)} disabled={!newUserData.username || !newUserData.name || !newUserData.email || !newUserData.password || addUserMutation.isPending} data-testid="button-create-user">
                        {addUserMutation.isPending ? "Creating..." : "Create User"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search users..." value={userSearchQuery} onChange={(e) => setUserSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-users" />
              </div>
              {usersLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading users...</div>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate" data-testid={`user-item-${user.id}`}>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium" data-testid={`text-user-name-${user.id}`}>{user.name}</p>
                          <p className="text-xs text-muted-foreground" data-testid={`text-user-email-${user.id}`}>{user.email}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize" data-testid={`badge-role-${user.id}`}>{user.role}</Badge>
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <div className="text-center py-8 text-muted-foreground">No users found</div>}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" />Navigation Terminology</CardTitle>
              <CardDescription>Customize how navigation items appear throughout your CRM</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="leads-label">Plural Label</Label>
                  <Input id="leads-label" value={terminologySettings.leadsLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, leadsLabel: e.target.value })} placeholder="Leads" data-testid="input-leads-label" />
                  <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead-label">Singular Label</Label>
                  <Input id="lead-label" value={terminologySettings.leadLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, leadLabel: e.target.value })} placeholder="Lead" data-testid="input-lead-label" />
                  <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="estimates-label">Plural Label</Label>
                  <Input id="estimates-label" value={terminologySettings.estimatesLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, estimatesLabel: e.target.value })} placeholder="Estimates" data-testid="input-estimates-label" />
                  <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estimate-label">Singular Label</Label>
                  <Input id="estimate-label" value={terminologySettings.estimateLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, estimateLabel: e.target.value })} placeholder="Estimate" data-testid="input-estimate-label" />
                  <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jobs-label">Plural Label</Label>
                  <Input id="jobs-label" value={terminologySettings.jobsLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, jobsLabel: e.target.value })} placeholder="Jobs" data-testid="input-jobs-label" />
                  <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="job-label">Singular Label</Label>
                  <Input id="job-label" value={terminologySettings.jobLabel} onChange={(e) => setTerminologySettings({ ...terminologySettings, jobLabel: e.target.value })} placeholder="Job" data-testid="input-job-label" />
                  <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={() => saveTerminologyMutation.mutate(terminologySettings)} disabled={saveTerminologyMutation.isPending} data-testid="button-save-terminology">
                  {saveTerminologyMutation.isPending ? "Saving..." : "Save Terminology Settings"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
