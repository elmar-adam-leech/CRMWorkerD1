import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCurrentUser, isStrictAdmin } from "@/hooks/useCurrentUser";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import { Settings as SettingsIcon, XCircle } from "lucide-react";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { AccountTab } from "@/components/settings/AccountTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { TargetsTab } from "@/components/settings/TargetsTab";
import { WebhooksTab } from "@/components/settings/WebhooksTab";
import { SalespeopleTab } from "@/components/settings/SalespeopleTab";

interface IntegrationData {
  name: string;
  hasCredentials: boolean;
  isEnabled: boolean;
}

type TabId = 'integrations' | 'account' | 'security' | 'targets' | 'webhooks' | 'salespeople';

export default function Settings() {
  const [, navigate] = useLocation();

  const urlParams = new URLSearchParams(window.location.search);
  const urlTab = urlParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(urlTab || 'account');

  const [businessTargets, setBusinessTargets] = useState({
    speedToLeadMinutes: 60,
    followUpRatePercent: "80.00",
    setRatePercent: "40.00",
    closeRatePercent: "25.00",
  });

  const [terminologySettings, setTerminologySettings] = useState({
    leadLabel: 'Lead', leadsLabel: 'Leads',
    estimateLabel: 'Estimate', estimatesLabel: 'Estimates',
    jobLabel: 'Job', jobsLabel: 'Jobs',
    messageLabel: 'Message', messagesLabel: 'Messages',
    templateLabel: 'Template', templatesLabel: 'Templates',
  });

  const [bookingSlugInput, setBookingSlugInput] = useState('');

  const { data: currentUser, isLoading: userLoading } = useCurrentUser();

  const isAdmin = isStrictAdmin(currentUser?.user?.role);
  const canManageIntegrations = isAdmin
    || currentUser?.user?.role === 'manager'
    || currentUser?.user?.canManageIntegrations === true;

  const { data: integrationsResponse, isLoading, error } = useQuery<{ integrations: IntegrationData[] }>({
    queryKey: ['/api/integrations'],
    enabled: canManageIntegrations,
  });
  const integrations: IntegrationData[] = integrationsResponse?.integrations ?? [];

  const { data: hcpWebhookConfig } = useQuery<{ webhookUrl: string; secretConfigured: boolean }>({
    queryKey: ['/api/integrations/housecall-pro/webhook-config'],
    enabled: integrations.some(i => i.name === 'housecall-pro' && i.isEnabled),
  });

  const { data: providerData } = useQuery<{
    available: { email: string[]; sms: string[]; calling: string[] };
    configured: Array<{ providerType: string; emailProvider?: string; smsProvider?: string; callingProvider?: string; isActive: boolean }>;
  }>({ queryKey: ['/api/providers'] });

  const { data: currentTargets, isLoading: targetsLoading } = useQuery<{
    speedToLeadMinutes: number; followUpRatePercent: string; setRatePercent: string; closeRatePercent: string;
  }>({ queryKey: ['/api/business-targets'], enabled: canManageIntegrations });

  const { data: currentTerminology } = useQuery<any>({
    queryKey: ['/api/terminology'],
    enabled: activeTab === 'account',
  });

  const { data: bookingSlugData } = useQuery<{ bookingSlug: string | null; bookingUrl: string | null }>({
    queryKey: ['/api/booking-slug'],
    enabled: activeTab === 'account',
  });

  const { data: webhookConfig, isLoading: webhookLoading } = useQuery<{
    apiKey: string;
    webhooks: { leads: { url: string; documentation: any }; estimates: { url: string; documentation: any } };
    webhookUrl?: string;
    documentation?: any;
  }>({ queryKey: ['/api/webhook-config'], enabled: activeTab === 'webhooks' });

  type User = { id: string; username: string; name: string; email: string; role: string; contractorId: string; createdAt: string };
  const { data: allUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: isAdmin && activeTab === 'account',
  });

  useEffect(() => {
    if (currentTargets) {
      setBusinessTargets({
        speedToLeadMinutes: currentTargets.speedToLeadMinutes || 60,
        followUpRatePercent: currentTargets.followUpRatePercent || "80.00",
        setRatePercent: currentTargets.setRatePercent || "40.00",
        closeRatePercent: currentTargets.closeRatePercent || "25.00",
      });
    }
  }, [currentTargets]);

  useEffect(() => {
    if (currentTerminology) {
      setTerminologySettings({
        leadLabel: currentTerminology.leadLabel || 'Lead',
        leadsLabel: currentTerminology.leadsLabel || 'Leads',
        estimateLabel: currentTerminology.estimateLabel || 'Estimate',
        estimatesLabel: currentTerminology.estimatesLabel || 'Estimates',
        jobLabel: currentTerminology.jobLabel || 'Job',
        jobsLabel: currentTerminology.jobsLabel || 'Jobs',
        messageLabel: currentTerminology.messageLabel || 'Message',
        messagesLabel: currentTerminology.messagesLabel || 'Messages',
        templateLabel: currentTerminology.templateLabel || 'Template',
        templatesLabel: currentTerminology.templatesLabel || 'Templates',
      });
    }
  }, [currentTerminology]);

  useEffect(() => {
    if (bookingSlugData) { setBookingSlugInput(bookingSlugData.bookingSlug || ''); }
  }, [bookingSlugData]);

  useEffect(() => {
    if (!userLoading && currentUser?.user) {
      if (!canManageIntegrations && activeTab === 'integrations') {
        setActiveTab('account');
        navigate('/settings?tab=account');
      }
    }
  }, [currentUser, userLoading, activeTab, navigate, canManageIntegrations]);

  const goTab = (tab: TabId) => {
    setActiveTab(tab);
    navigate(`/settings?tab=${tab}`);
  };

  const tabBtn = (id: TabId, label: string, testId: string) => (
    <button
      key={id}
      onClick={() => goTab(id)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
      data-testid={testId}
    >
      {label}
    </button>
  );

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <SettingsIcon className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error && canManageIntegrations) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>Failed to load integrations. Please try again later.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PageLayout>
      <PageHeader title="Settings" description="Configure integrations, manage users, and set business targets" icon={<SettingsIcon className="h-6 w-6" />} />

      <div className="flex space-x-1 border-b mb-6">
        {canManageIntegrations && tabBtn('integrations', 'Integrations', 'tab-integrations')}
        {tabBtn('account', 'Account', 'tab-account')}
        {tabBtn('security', 'Security', 'tab-security')}
        {isAdmin && tabBtn('targets', 'Performance Targets', 'tab-targets')}
        {tabBtn('webhooks', 'Webhooks', 'tab-webhooks')}
        {isAdmin && tabBtn('salespeople', 'Salespeople', 'tab-salespeople')}
      </div>

      {activeTab === 'integrations' && (
        <IntegrationsTab integrations={integrations} hcpWebhookConfig={hcpWebhookConfig} providerData={providerData} />
      )}
      {activeTab === 'account' && (
        <AccountTab
          currentUser={currentUser}
          isAdmin={isAdmin}
          bookingSlugInput={bookingSlugInput}
          setBookingSlugInput={setBookingSlugInput}
          bookingSlugData={bookingSlugData}
          terminologySettings={terminologySettings}
          setTerminologySettings={setTerminologySettings}
          allUsers={allUsers}
          usersLoading={usersLoading}
        />
      )}
      {activeTab === 'security' && <SecurityTab />}
      {activeTab === 'targets' && (
        <TargetsTab currentUser={currentUser} targetsLoading={targetsLoading} businessTargets={businessTargets} setBusinessTargets={setBusinessTargets} />
      )}
      {activeTab === 'webhooks' && <WebhooksTab webhookConfig={webhookConfig} webhookLoading={webhookLoading} />}
      {activeTab === 'salespeople' && <SalespeopleTab />}
    </PageLayout>
  );
}
