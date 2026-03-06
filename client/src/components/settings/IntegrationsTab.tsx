import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Settings as SettingsIcon, Mail, MessageSquare, Phone, Calendar,
  CheckCircle, XCircle, AlertTriangle, RefreshCw, Star, Copy, Info, Search
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSyncStatus } from "@/hooks/use-sync-status";

interface IntegrationData {
  name: string;
  hasCredentials: boolean;
  isEnabled: boolean;
}

interface Integration {
  name: string;
  displayName: string;
  description: string;
  icon: any;
  type: 'communication' | 'business' | 'other';
  hasCredentials: boolean;
  isEnabled: boolean;
  setupInstructions?: { title: string; steps: string[]; contactInfo?: string };
}

interface IntegrationsTabProps {
  integrations: IntegrationData[];
  hcpWebhookConfig: { webhookUrl: string; secretConfigured: boolean } | undefined;
  providerData: {
    configured: Array<{ providerType: string; emailProvider?: string; smsProvider?: string; callingProvider?: string; isActive: boolean }>;
  } | undefined;
}

export function IntegrationsTab({ integrations, hcpWebhookConfig, providerData }: IntegrationsTabProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: currentUserData } = useCurrentUser();
  const currentUser = currentUserData;
  const userLoading = !currentUserData;
  const { syncStatus, startSync } = useSyncStatus();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingIntegration, setEditingIntegration] = useState<string | null>(null);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [hcpSecretDialogOpen, setHcpSecretDialogOpen] = useState(false);
  const [hcpSecretInput, setHcpSecretInput] = useState('');

  const getIntegrationConfig = (integration: IntegrationData): Integration => {
    const base = { name: integration.name, displayName: integration.name, hasCredentials: integration.hasCredentials, isEnabled: integration.isEnabled, type: 'other' as const, icon: SettingsIcon };
    switch (integration.name) {
      case 'dialpad': return { ...base, displayName: 'Dialpad', description: 'SMS and calling services for customer communication', icon: Phone, type: 'communication' };
      case 'gmail': return { ...base, displayName: 'Gmail', description: 'Email services for customer communication via Gmail API', icon: Mail, type: 'communication' };
      case 'sendgrid': return { ...base, displayName: 'SendGrid', description: 'Email services for customer communication via SendGrid', icon: Mail, type: 'communication' };
      case 'housecall-pro': return { ...base, displayName: 'Housecall Pro', description: 'Business management and scheduling integration', icon: Calendar, type: 'business',
        setupInstructions: { title: 'Set up Housecall Pro Integration', steps: ['Log in to your Housecall Pro account', 'Go to App Store → API Key Management', 'Generate a new API key', 'Contact your admin to add the API key to this CRM'], contactInfo: 'Contact your system administrator to configure the API key for your organization.' } };
      default: return { ...base, description: 'Third-party service integration' };
    }
  };

  const getStatusIcon = (integration: Integration) => {
    if (!integration.hasCredentials) return <XCircle className="h-5 w-5 text-destructive" />;
    if (integration.isEnabled) return <CheckCircle className="h-5 w-5 text-green-600" />;
    return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
  };

  const getStatusText = (integration: Integration) => {
    if (!integration.hasCredentials) return { text: 'Not Configured', variant: 'destructive' as const };
    if (integration.isEnabled) return { text: 'Active', variant: 'default' as const };
    return { text: 'Configured', variant: 'secondary' as const };
  };

  const enableIntegrationMutation = useMutation({
    mutationFn: async ({ integrationName, enable }: { integrationName: string; enable: boolean }) => {
      const response = await apiRequest('POST', `/api/integrations/${integrationName}/${enable ? 'enable' : 'disable'}`);
      return response.json();
    },
    onSuccess: (_, { integrationName, enable }) => {
      toast({ title: "Integration Updated", description: `${integrationName} has been ${enable ? 'enabled' : 'disabled'} successfully.` });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
    },
    onError: (error: any) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const saveCredentialMutation = useMutation({
    mutationFn: async ({ integrationName, credentials }: { integrationName: string; credentials: Record<string, string> }) => {
      const response = await apiRequest('POST', `/api/integrations/${integrationName}/credentials`, { credentials });
      return response.json();
    },
    onSuccess: (_, { integrationName }) => {
      toast({ title: "Credentials Saved", description: `${integrationName} credentials have been saved successfully.` });
      setCredentialInputs(prev => ({ ...prev, [integrationName]: '' }));
      setEditingIntegration(null);
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
    },
    onError: (error: any) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const setProviderMutation = useMutation({
    mutationFn: async ({ providerType, providerName }: { providerType: 'email' | 'sms' | 'calling'; providerName: string }) => {
      const response = await apiRequest('POST', '/api/providers', { providerType, providerName });
      return response.json();
    },
    onSuccess: (_, { providerType, providerName }) => {
      toast({ title: "Provider Set", description: `${providerName} has been set as your ${providerType} provider.` });
      queryClient.invalidateQueries({ queryKey: ['/api/providers'] });
    },
    onError: (error: any) => { toast({ title: "Error", description: error.message || "Failed to set provider", variant: "destructive" }); },
  });

  const syncDialpadMutation = useMutation({
    mutationFn: async () => {
      startSync();
      const response = await fetch('/api/dialpad/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/dialpad/users/available-phone-numbers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      toast({ title: "Dialpad sync completed", description: `Successfully synced ${data.summary?.users?.cached || 0} users, ${data.summary?.departments?.cached || 0} departments, and ${data.summary?.phoneNumbers?.cached || 0} phone numbers.` });
    },
    onError: (error: any) => { toast({ title: "Dialpad sync failed", description: error.message || "Failed to sync with Dialpad. Please try again.", variant: "destructive" }); },
  });

  const saveHcpWebhookSecretMutation = useMutation({
    mutationFn: async (secret: string) => apiRequest('POST', '/api/integrations/housecall-pro/webhook-secret', { secret }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/housecall-pro/webhook-config'] });
      toast({ title: 'Webhook secret saved' });
      setHcpSecretDialogOpen(false);
      setHcpSecretInput('');
    },
    onError: () => toast({ title: 'Failed to save webhook secret', variant: 'destructive' }),
  });

  const handleSaveCredentials = (integrationName: string) => {
    const apiKey = credentialInputs[integrationName];
    if (!apiKey?.trim()) { toast({ title: "Error", description: "Please enter a valid API key.", variant: "destructive" }); return; }
    saveCredentialMutation.mutate({ integrationName, credentials: { api_key: apiKey.trim() } });
  };

  const handleToggleIntegration = (integrationName: string, currentEnabled: boolean) => {
    enableIntegrationMutation.mutate({ integrationName, enable: !currentEnabled });
  };

  const allIntegrations = integrations.map(getIntegrationConfig);
  const filteredIntegrations = allIntegrations.filter((integration: Integration) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return integration.displayName.toLowerCase().includes(q) || integration.description.toLowerCase().includes(q) || integration.name.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="space-y-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input type="text" placeholder="Search integrations..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-integrations" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {filteredIntegrations.filter(i => i.name !== 'gmail').map((integration) => {
            const IconComponent = integration.icon;
            const status = getStatusText(integration);
            const isEmailProvider = integration.name === 'sendgrid';
            const isDefaultEmailProvider = providerData?.configured?.find(p => p.providerType === 'email' && p.isActive && p.emailProvider === integration.name) !== undefined;
            return (
              <Card key={integration.name}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <IconComponent className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{integration.displayName}</CardTitle>
                          {integration.name === 'housecall-pro' && integration.setupInstructions && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                                  <Info className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-sm">
                                <div className="space-y-2">
                                  <p className="font-medium text-sm">{integration.setupInstructions.title}</p>
                                  <ol className="text-xs space-y-1 list-decimal list-inside">
                                    {integration.setupInstructions.steps.map((step, idx) => <li key={idx}>{step}</li>)}
                                  </ol>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <CardDescription className="text-sm">{integration.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isDefaultEmailProvider && <Badge variant="default" className="gap-1"><Star className="h-3 w-3" />Default</Badge>}
                      {getStatusIcon(integration)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Badge variant={status.variant}>{status.text}</Badge>
                    <div className="flex items-center gap-2">
                      {isEmailProvider && !isDefaultEmailProvider && (
                        <Button variant="outline" size="sm" onClick={() => setProviderMutation.mutate({ providerType: 'email', providerName: integration.name })} disabled={setProviderMutation.isPending || !integration.hasCredentials} data-testid={`button-set-default-${integration.name}`}>
                          <Star className="h-3 w-3 mr-1" />Set as Default
                        </Button>
                      )}
                      {integration.hasCredentials && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`${integration.name}-enabled`} className="text-sm">Enabled</Label>
                          <Switch id={`${integration.name}-enabled`} checked={integration.isEnabled} onCheckedChange={() => handleToggleIntegration(integration.name, integration.isEnabled)} disabled={enableIntegrationMutation.isPending} data-testid={`switch-${integration.name}`} />
                        </div>
                      )}
                    </div>
                  </div>

                  {integration.name === 'dialpad' && integration.hasCredentials && integration.isEnabled && (
                    <div className="pt-3 border-t space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="dialpad-sms-service" checked={providerData?.configured?.find(p => p.providerType === 'sms' && p.isActive && p.smsProvider === 'dialpad') !== undefined} onChange={(e) => { if (e.target.checked) setProviderMutation.mutate({ providerType: 'sms', providerName: 'dialpad' }); }} disabled={setProviderMutation.isPending} className="rounded border-gray-300" data-testid="checkbox-dialpad-sms" />
                          <Label htmlFor="dialpad-sms-service" className="text-sm cursor-pointer">Enable SMS Service</Label>
                        </div>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="dialpad-calling-service" checked={providerData?.configured?.find(p => p.providerType === 'calling' && p.isActive && p.callingProvider === 'dialpad') !== undefined} onChange={(e) => { if (e.target.checked) setProviderMutation.mutate({ providerType: 'calling', providerName: 'dialpad' }); }} disabled={setProviderMutation.isPending} className="rounded border-gray-300" data-testid="checkbox-dialpad-calling" />
                          <Label htmlFor="dialpad-calling-service" className="text-sm cursor-pointer">Enable Calling Service</Label>
                        </div>
                        <Phone className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  )}

                  {integration.name === 'dialpad' && integration.hasCredentials && integration.isEnabled && (
                    <div className="pt-3 border-t">
                      <Button variant="outline" size="sm" onClick={() => syncDialpadMutation.mutate()} disabled={syncDialpadMutation.isPending || syncStatus.isRunning} data-testid="button-dialpad-sync">
                        <RefreshCw className={`h-4 w-4 mr-2 ${(syncDialpadMutation.isPending || syncStatus.isRunning) ? 'animate-spin' : ''}`} />
                        {(syncDialpadMutation.isPending || syncStatus.isRunning) ? 'Syncing...' : 'Sync Dialpad Data'}
                      </Button>
                    </div>
                  )}

                  {integration.name === 'housecall-pro' && integration.isEnabled && hcpWebhookConfig && (
                    <div className="pt-3 border-t space-y-3">
                      <p className="text-sm font-medium">Webhook Integration</p>
                      <p className="text-xs text-muted-foreground">Paste this URL into Housecall Pro under My Apps &rarr; Webhooks to enable real-time workflow triggers for jobs, estimates, and customers.</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md truncate">{hcpWebhookConfig.webhookUrl}</code>
                        <Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(hcpWebhookConfig.webhookUrl)} data-testid="button-copy-hcp-webhook-url"><Copy className="h-4 w-4" /></Button>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          {hcpWebhookConfig.secretConfigured
                            ? <><CheckCircle className="h-4 w-4 text-green-600" /><span>Signing secret configured</span></>
                            : <><AlertTriangle className="h-4 w-4 text-yellow-600" /><span>Signing secret not set</span></>
                          }
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setHcpSecretDialogOpen(true)} data-testid="button-configure-hcp-webhook-secret">
                          {hcpWebhookConfig.secretConfigured ? 'Update Secret' : 'Set Secret'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {integration.hasCredentials && currentUser?.user?.role === 'admin' && editingIntegration !== integration.name && (
                    <div className="pt-3 border-t">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditingIntegration(integration.name)} data-testid={`button-update-${integration.name}-api-key`}>Update API Key</Button>
                        {integration.name === 'dialpad' && (
                          <Button variant="outline" size="sm" onClick={() => navigate('/dialpad-setup')} data-testid="button-enhanced-setup">Enhanced Setup</Button>
                        )}
                      </div>
                    </div>
                  )}

                  {(!integration.hasCredentials || editingIntegration === integration.name) && (
                    userLoading ? (
                      <div className="animate-pulse space-y-3">
                        <div className="h-4 bg-muted rounded w-20"></div>
                        <div className="h-9 bg-muted rounded"></div>
                      </div>
                    ) : currentUser?.user?.role === 'admin' ? (
                      <div className="space-y-3">
                        <Label htmlFor={`${integration.name}-api-key`} className="text-sm font-medium">{integration.hasCredentials ? 'Update API Key' : 'API Key'}</Label>
                        <div className="flex gap-2">
                          <Input id={`${integration.name}-api-key`} type="password" placeholder={integration.hasCredentials ? "Enter new API key..." : "Enter your API key..."} value={credentialInputs[integration.name] || ''} onChange={(e) => setCredentialInputs(prev => ({ ...prev, [integration.name]: e.target.value }))} data-testid={`input-${integration.name}-api-key`} />
                          <Button onClick={() => handleSaveCredentials(integration.name)} disabled={saveCredentialMutation.isPending || !credentialInputs[integration.name]?.trim()} data-testid={`button-save-${integration.name}`}>
                            {saveCredentialMutation.isPending ? "Saving..." : (integration.hasCredentials ? "Update" : "Save")}
                          </Button>
                          {editingIntegration === integration.name && (
                            <Button variant="outline" onClick={() => { setEditingIntegration(null); setCredentialInputs(prev => ({ ...prev, [integration.name]: '' })); }} data-testid={`button-cancel-${integration.name}`}>Cancel</Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-sm">Contact your administrator to configure {integration.displayName} credentials.</AlertDescription>
                      </Alert>
                    )
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={hcpSecretDialogOpen} onOpenChange={setHcpSecretDialogOpen}>
        <DialogContent data-testid="dialog-hcp-webhook-secret">
          <DialogHeader>
            <DialogTitle>Housecall Pro Webhook Signing Secret</DialogTitle>
            <DialogDescription>Find this in Housecall Pro under My Apps &rarr; Webhooks &rarr; your webhook entry &rarr; Signing Secret.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="hcp-secret">Signing Secret</Label>
              <Input id="hcp-secret" data-testid="input-hcp-webhook-secret" type="password" placeholder="Paste secret from Housecall Pro..." value={hcpSecretInput} onChange={e => setHcpSecretInput(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHcpSecretDialogOpen(false); setHcpSecretInput(''); }}>Cancel</Button>
            <Button data-testid="button-save-hcp-webhook-secret" disabled={!hcpSecretInput.trim() || saveHcpWebhookSecretMutation.isPending} onClick={() => saveHcpWebhookSecretMutation.mutate(hcpSecretInput)}>
              {saveHcpWebhookSecretMutation.isPending ? 'Saving...' : 'Save Secret'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
