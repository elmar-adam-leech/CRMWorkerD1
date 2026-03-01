import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header-v2";
import { PageLayout } from "@/components/ui/page-layout";
import type { Employee } from "@shared/schema";
import { 
  Settings as SettingsIcon,
  Settings2,
  Mail, 
  MessageSquare, 
  Phone, 
  Calendar,
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  ExternalLink,
  User,
  UserPlus,
  Shield,
  RefreshCw,
  Users,
  Clock,
  TrendingUp,
  Target,
  Webhook,
  Copy,
  Eye,
  EyeOff,
  Search,
  Info,
  Star,
  Code
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  setupInstructions?: {
    title: string;
    steps: string[];
    contactInfo?: string;
  };
}


const AVAILABLE_ROLES = [
  { value: 'sales', label: 'Sales' },
  { value: 'technician', label: 'Technician' },
  { value: 'estimator', label: 'Estimator' },
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' }
];

export default function Settings() {
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { syncStatus, startSync } = useSyncStatus();
  
  // Get tab from URL params or default to 'account' (safe for all roles)
  const urlParams = new URLSearchParams(window.location.search);
  const urlTab = urlParams.get('tab') as 'integrations' | 'account' | 'security' | 'targets' | 'webhooks' | 'salespeople' | null;
  const urlProvider = urlParams.get('provider');
  const [activeTab, setActiveTab] = useState<'integrations' | 'account' | 'security' | 'targets' | 'webhooks' | 'salespeople'>(urlTab || 'account');
  const [selectedEmailProvider, setSelectedEmailProvider] = useState<string>('');
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [editingIntegration, setEditingIntegration] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWebhook, setSelectedWebhook] = useState<'leads' | 'estimates' | 'jobs'>('leads');
  
  // User management state
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [newUserData, setNewUserData] = useState({ 
    username: "", 
    name: "", 
    email: "", 
    password: "", 
    role: "user" 
  });
  const [userSearchQuery, setUserSearchQuery] = useState('');
  
  // Business targets state
  const [businessTargets, setBusinessTargets] = useState({
    speedToLeadMinutes: 60,
    followUpRatePercent: "80.00",
    setRatePercent: "40.00",
    closeRatePercent: "25.00"
  });

  // Terminology settings state
  const [terminologySettings, setTerminologySettings] = useState({
    leadLabel: 'Lead',
    leadsLabel: 'Leads',
    estimateLabel: 'Estimate',
    estimatesLabel: 'Estimates',
    jobLabel: 'Job',
    jobsLabel: 'Jobs',
    messageLabel: 'Message',
    messagesLabel: 'Messages',
    templateLabel: 'Template',
    templatesLabel: 'Templates'
  });

  // Booking slug state
  const [bookingSlugInput, setBookingSlugInput] = useState('');

  // Get current user data to check role
  const {
    data: currentUser,
    isLoading: userLoading
  } = useQuery<{ user: { id: string; name: string; email: string; role: string; contractorId: string; canManageIntegrations: boolean; gmailConnected?: boolean; gmailEmail?: string } }>({
    queryKey: ['/api/auth/me'],
  });

  // Check if user can manage integrations (for conditional query)
  const userCanManageIntegrations = currentUser?.user?.role === 'admin' 
    || currentUser?.user?.role === 'super_admin' 
    || currentUser?.user?.role === 'manager'
    || currentUser?.user?.canManageIntegrations === true;

  const {
    data: integrations = [],
    isLoading,
    error
  } = useQuery<IntegrationData[]>({
    queryKey: ['/api/integrations'],
    enabled: userCanManageIntegrations, // Only query if user has permission
  });

  const {
    data: employees = [],
    isLoading: employeesLoading,
    error: employeesError
  } = useQuery<Employee[]>({
    queryKey: ['/api/employees'],
  });

  // Fetch current provider preferences
  const { data: providerData, isLoading: providersLoading } = useQuery<{
    available: { email: string[], sms: string[], calling: string[] };
    configured: Array<{ providerType: string; emailProvider?: string; smsProvider?: string; callingProvider?: string; isActive: boolean }>;
  }>({
    queryKey: ['/api/providers'],
  });

  // Fetch current business targets (admin-only endpoint)
  const { data: currentTargets, isLoading: targetsLoading } = useQuery({
    queryKey: ['/api/business-targets'],
    enabled: userCanManageIntegrations,
  });

  // Get terminology settings
  const { data: currentTerminology, isLoading: terminologyLoading } = useQuery<any>({
    queryKey: ['/api/terminology'],
    enabled: activeTab === 'account',
  });

  // Get booking slug configuration
  const { data: bookingSlugData, isLoading: bookingSlugLoading } = useQuery<{
    bookingSlug: string | null;
    bookingUrl: string | null;
  }>({
    queryKey: ['/api/booking-slug'],
    enabled: activeTab === 'account',
  });

  // Fetch webhook configuration
  const { data: webhookConfig, isLoading: webhookLoading } = useQuery<{
    apiKey: string;
    webhooks: {
      leads: {
        url: string;
        documentation: {
          method: string;
          headers: Record<string, string>;
          requiredFields: string[];
          optionalFields: string[];
          phoneNormalization?: string;
          multipleContacts?: string;
          example: Record<string, any>;
        };
      };
      estimates: {
        url: string;
        documentation: {
          method: string;
          headers: Record<string, string>;
          requiredFields: string[];
          optionalFields: string[];
          example: Record<string, any>;
        };
      };
    };
    // Legacy fields for backwards compatibility
    webhookUrl?: string;
    documentation?: any;
  }>({
    queryKey: ['/api/webhook-config'],
    enabled: activeTab === 'webhooks',
  });

  // Fetch all users (admin only)
  type User = {
    id: string;
    username: string;
    name: string;
    email: string;
    role: string;
    contractorId: string;
    canManageIntegrations?: boolean;
    createdAt: string;
  };

  const isAdmin = currentUser?.user?.role === 'admin' || currentUser?.user?.role === 'super_admin';

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/users'],
    enabled: isAdmin && activeTab === 'account',
  });

  // Update business targets when data is fetched
  useEffect(() => {
    if (currentTargets) {
      setBusinessTargets({
        speedToLeadMinutes: currentTargets.speedToLeadMinutes || 60,
        followUpRatePercent: currentTargets.followUpRatePercent || "80.00",
        setRatePercent: currentTargets.setRatePercent || "40.00",
        closeRatePercent: currentTargets.closeRatePercent || "25.00"
      });
    }
  }, [currentTargets]);

  // Update terminology settings when data is fetched
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
        templatesLabel: currentTerminology.templatesLabel || 'Templates'
      });
    }
  }, [currentTerminology]);

  // Redirect users without integration permission away from integrations tab
  useEffect(() => {
    if (!userLoading && currentUser?.user) {
      const canViewIntegrations = currentUser.user.role === 'admin' 
        || currentUser.user.role === 'super_admin' 
        || currentUser.user.role === 'manager'
        || currentUser.user.canManageIntegrations === true;
      
      if (!canViewIntegrations && activeTab === 'integrations') {
        setActiveTab('account');
        navigate('/settings?tab=account');
      }
    }
  }, [currentUser, userLoading, activeTab, navigate]);

  const enableIntegrationMutation = useMutation({
    mutationFn: async ({ integrationName, enable }: { integrationName: string; enable: boolean }) => {
      const endpoint = enable ? 'enable' : 'disable';
      const response = await apiRequest('POST', `/api/integrations/${integrationName}/${endpoint}`);
      return response.json();
    },
    onSuccess: (_, { integrationName, enable }) => {
      toast({
        title: "Integration Updated",
        description: `${integrationName} has been ${enable ? 'enabled' : 'disabled'} successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveCredentialMutation = useMutation({
    mutationFn: async ({ integrationName, credentials }: { integrationName: string; credentials: Record<string, string> }) => {
      const response = await apiRequest('POST', `/api/integrations/${integrationName}/credentials`, {
        credentials
      });
      return response.json();
    },
    onSuccess: (_, { integrationName }) => {
      toast({
        title: "Credentials Saved",
        description: `${integrationName} credentials have been saved successfully.`,
      });
      // Clear the input and exit edit mode
      setCredentialInputs(prev => ({ ...prev, [integrationName]: '' }));
      setEditingIntegration(null);
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Add user mutation
  const addUserMutation = useMutation({
    mutationFn: async (data: { username: string; name: string; email: string; password: string; role: string }) => {
      return await apiRequest('POST', '/api/users', data);
    },
    onSuccess: () => {
      toast({
        title: "User added",
        description: "The user has been added successfully",
      });
      setIsAddUserDialogOpen(false);
      setNewUserData({ username: "", name: "", email: "", password: "", role: "user" });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add user",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Provider selection mutation
  const setProviderMutation = useMutation({
    mutationFn: async ({ providerType, providerName }: { providerType: 'email' | 'sms' | 'calling'; providerName: string }) => {
      const response = await apiRequest('POST', '/api/providers', {
        providerType,
        providerName
      });
      return response.json();
    },
    onSuccess: (_, { providerType, providerName }) => {
      toast({
        title: "Provider Set",
        description: `${providerName} has been set as your ${providerType} provider.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/providers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to set provider",
        variant: "destructive",
      });
    },
  });

  const handleSaveCredentials = (integrationName: string) => {
    const apiKey = credentialInputs[integrationName];
    if (!apiKey?.trim()) {
      toast({
        title: "Error",
        description: "Please enter a valid API key.",
        variant: "destructive",
      });
      return;
    }

    saveCredentialMutation.mutate({
      integrationName,
      credentials: { api_key: apiKey.trim() }
    });
  };

  const handleToggleIntegration = (integrationName: string, currentEnabled: boolean) => {
    enableIntegrationMutation.mutate({
      integrationName,
      enable: !currentEnabled,
    });
  };

  const getIntegrationConfig = (integration: IntegrationData): Integration => {
    const baseConfig = {
      name: integration.name,
      displayName: integration.name,
      hasCredentials: integration.hasCredentials,
      isEnabled: integration.isEnabled,
      type: 'other' as const,
      icon: SettingsIcon,
    };

    switch (integration.name) {
      case 'dialpad':
        return {
          ...baseConfig,
          displayName: 'Dialpad',
          description: 'SMS and calling services for customer communication',
          icon: Phone,
          type: 'communication',
        };
      case 'gmail':
        return {
          ...baseConfig,
          displayName: 'Gmail',
          description: 'Email services for customer communication via Gmail API',
          icon: Mail,
          type: 'communication',
        };
      case 'sendgrid':
        return {
          ...baseConfig,
          displayName: 'SendGrid',
          description: 'Email services for customer communication via SendGrid',
          icon: Mail,
          type: 'communication',
        };
      case 'housecall-pro':
        return {
          ...baseConfig,
          displayName: 'Housecall Pro',
          description: 'Business management and scheduling integration',
          icon: Calendar,
          type: 'business',
          setupInstructions: {
            title: 'Set up Housecall Pro Integration',
            steps: [
              'Log in to your Housecall Pro account',
              'Go to App Store → API Key Management',
              'Generate a new API key',
              'Contact your admin to add the API key to this CRM'
            ],
            contactInfo: 'Contact your system administrator to configure the API key for your organization.'
          },
        };
      default:
        return {
          ...baseConfig,
          description: 'Third-party service integration',
        };
    }
  };

  const getStatusIcon = (integration: Integration) => {
    if (!integration.hasCredentials) {
      return <XCircle className="h-5 w-5 text-destructive" />;
    }
    if (integration.isEnabled) {
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    }
    return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
  };

  const getStatusText = (integration: Integration) => {
    if (!integration.hasCredentials) {
      return { text: 'Not Configured', variant: 'destructive' as const };
    }
    if (integration.isEnabled) {
      return { text: 'Active', variant: 'default' as const };
    }
    return { text: 'Configured', variant: 'secondary' as const };
  };

  // Housecall Pro sync mutation
  const syncHousecallProMutation = useMutation({
    mutationFn: async () => {
      startSync(); // Start tracking sync status in the persistent status bar
      
      const response = await fetch('/api/housecall-pro/sync', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      // The persistent status bar will show success message
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/estimates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
    },
    onError: (error: any) => {
      console.error('Sync failed:', error);
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync with Housecall Pro. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Dialpad sync mutation
  const syncDialpadMutation = useMutation({
    mutationFn: async () => {
      startSync(); // Start tracking sync status in the persistent status bar
      
      const response = await fetch('/api/dialpad/sync', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      // The persistent status bar will show success message
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/dialpad/users/available-phone-numbers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      
      toast({
        title: "Dialpad sync completed",
        description: `Successfully synced ${data.summary?.users?.cached || 0} users, ${data.summary?.departments?.cached || 0} departments, and ${data.summary?.phoneNumbers?.cached || 0} phone numbers.`,
      });
    },
    onError: (error: any) => {
      console.error('Dialpad sync failed:', error);
      toast({
        title: "Dialpad sync failed",
        description: error.message || "Failed to sync with Dialpad. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Employee role update mutation
  const updateEmployeeRolesMutation = useMutation({
    mutationFn: async ({ employeeId, roles }: { employeeId: string; roles: string[] }) => {
      const response = await apiRequest('PATCH', `/api/employees/${employeeId}/roles`, {
        roles
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Roles updated successfully",
        description: "Employee roles have been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating roles",
        description: error.message || "Failed to update employee roles",
        variant: "destructive",
      });
    },
  });

  // Initialize email provider from API data
  useEffect(() => {
    if (providerData?.configured) {
      const emailProvider = providerData.configured.find(p => p.providerType === 'email' && p.isActive);
      if (emailProvider) {
        setSelectedEmailProvider(emailProvider.emailProvider || '');
      }
    }
  }, [providerData]);


  const saveTargetsMutation = useMutation({
    mutationFn: async (targets: typeof businessTargets) => {
      const response = await apiRequest('POST', '/api/business-targets', targets);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Performance Targets Saved",
        description: "Your custom business targets have been updated successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/business-targets'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save business targets.",
        variant: "destructive"
      });
    }
  });

  const saveTerminologyMutation = useMutation({
    mutationFn: async (settings: typeof terminologySettings) => {
      const response = await apiRequest('POST', '/api/terminology', settings);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Terminology Settings Saved",
        description: "Your navigation terminology has been updated successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/terminology'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save terminology settings.",
        variant: "destructive"
      });
    }
  });

  // Sync booking slug from API data
  useEffect(() => {
    if (bookingSlugData) {
      setBookingSlugInput(bookingSlugData.bookingSlug || '');
    }
  }, [bookingSlugData]);

  const saveBookingSlugMutation = useMutation({
    mutationFn: async (bookingSlug: string) => {
      const response = await apiRequest('POST', '/api/booking-slug', { bookingSlug: bookingSlug.trim().toLowerCase() || null });
      return response.json();
    },
    onSuccess: (data) => {
      // Update input with server-normalized value
      setBookingSlugInput(data.bookingSlug || '');
      toast({
        title: "Booking URL Updated",
        description: data.bookingUrl 
          ? "Your public booking page is now accessible." 
          : "Public booking page has been disabled."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/booking-slug'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save booking URL.",
        variant: "destructive"
      });
    }
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-lg"></div>
          <div className="h-32 bg-muted rounded-lg"></div>
          <div className="h-32 bg-muted rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error && userCanManageIntegrations) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load integrations. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Handle API response structure - integrations might be wrapped in an object
  const integrationsArray = Array.isArray(integrations) ? integrations : (integrations?.integrations || []);
  
  const allIntegrations = integrationsArray.map(getIntegrationConfig);
  
  // Filter integrations by search query
  const filteredIntegrations = allIntegrations.filter((integration: Integration) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      integration.displayName.toLowerCase().includes(query) ||
      integration.description.toLowerCase().includes(query) ||
      integration.name.toLowerCase().includes(query)
    );
  });

  // Check if user can manage integrations (admin/manager OR has explicit permission)
  const canManageIntegrations = currentUser?.user?.role === 'admin' 
    || currentUser?.user?.role === 'super_admin' 
    || currentUser?.user?.role === 'manager'
    || currentUser?.user?.canManageIntegrations === true;

  return (
    <PageLayout>
      <PageHeader 
        title="Settings" 
        description="Configure integrations, manage users, and set business targets"
        icon={<SettingsIcon className="h-6 w-6" />}
      />

      {/* Tab Navigation */}
      <div className="flex space-x-1 border-b mb-6">
        {canManageIntegrations && (
          <button
            onClick={() => {
              setActiveTab('integrations');
              navigate('/settings?tab=integrations');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'integrations'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-integrations"
          >
            Integrations
          </button>
        )}
        <button
          onClick={() => {
            setActiveTab('account');
            navigate('/settings?tab=account');
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'account'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="tab-account"
        >
          Account
        </button>
        <button
          onClick={() => {
            setActiveTab('security');
            navigate('/settings?tab=security');
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'security'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="tab-security"
        >
          Security
        </button>
        {(currentUser?.user?.role === 'admin' || currentUser?.user?.role === 'super_admin') && (
          <button
            onClick={() => {
              setActiveTab('targets');
              navigate('/settings?tab=targets');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'targets'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-targets"
          >
            Performance Targets
          </button>
        )}
        <button
          onClick={() => {
            setActiveTab('webhooks');
            navigate('/settings?tab=webhooks');
          }}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'webhooks'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          data-testid="tab-webhooks"
        >
          Webhooks
        </button>
        {(currentUser?.user?.role === 'admin' || currentUser?.user?.role === 'super_admin') && (
          <button
            onClick={() => {
              setActiveTab('salespeople');
              navigate('/settings?tab=salespeople');
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'salespeople'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            data-testid="tab-salespeople"
          >
            Salespeople
          </button>
        )}
      </div>

      {activeTab === 'integrations' && (
        <div className="space-y-6">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search integrations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-integrations"
            />
          </div>

          {/* All Integrations Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Integrations (Gmail OAuth moved to Account tab for all users) */}
            {filteredIntegrations.filter(i => i.name !== 'gmail').map((integration) => {
                const IconComponent = integration.icon;
                const status = getStatusText(integration);
                const isEmailProvider = integration.name === 'sendgrid';
                const isDefaultEmailProvider = providerData?.configured?.find(
                  p => p.providerType === 'email' && p.isActive && p.emailProvider === integration.name
                ) !== undefined;
                
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
                                        {integration.setupInstructions.steps.map((step, idx) => (
                                          <li key={idx}>{step}</li>
                                        ))}
                                      </ol>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <CardDescription className="text-sm">
                              {integration.description}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isDefaultEmailProvider && (
                            <Badge variant="default" className="gap-1">
                              <Star className="h-3 w-3" />
                              Default
                            </Badge>
                          )}
                          {getStatusIcon(integration)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <Badge variant={status.variant}>{status.text}</Badge>
                        <div className="flex items-center gap-2">
                          {isEmailProvider && !isDefaultEmailProvider && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setProviderMutation.mutate({
                                  providerType: 'email',
                                  providerName: integration.name
                                });
                              }}
                              disabled={setProviderMutation.isPending || !integration.hasCredentials}
                              data-testid={`button-set-default-${integration.name}`}
                            >
                              <Star className="h-3 w-3 mr-1" />
                              Set as Default
                            </Button>
                          )}
                          {integration.hasCredentials && (
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`${integration.name}-enabled`} className="text-sm">
                                Enabled
                              </Label>
                              <Switch
                                id={`${integration.name}-enabled`}
                                checked={integration.isEnabled}
                                onCheckedChange={() => handleToggleIntegration(integration.name, integration.isEnabled)}
                                disabled={enableIntegrationMutation.isPending}
                                data-testid={`switch-${integration.name}`}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Add SMS and Calling checkboxes for Dialpad */}
                      {integration.name === 'dialpad' && integration.hasCredentials && integration.isEnabled && (
                        <div className="pt-3 border-t space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="dialpad-sms-service"
                                checked={providerData?.configured?.find(p => p.providerType === 'sms' && p.isActive && p.smsProvider === 'dialpad') !== undefined}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setProviderMutation.mutate({
                                      providerType: 'sms',
                                      providerName: 'dialpad'
                                    });
                                  } else {
                                    // Note: We don't disable providers, just don't set them
                                    // This could be extended to call a disable API if needed
                                  }
                                }}
                                disabled={setProviderMutation.isPending}
                                className="rounded border-gray-300"
                                data-testid="checkbox-dialpad-sms"
                              />
                              <Label htmlFor="dialpad-sms-service" className="text-sm cursor-pointer">
                                Enable SMS Service
                              </Label>
                            </div>
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id="dialpad-calling-service"
                                checked={providerData?.configured?.find(p => p.providerType === 'calling' && p.isActive && p.callingProvider === 'dialpad') !== undefined}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setProviderMutation.mutate({
                                      providerType: 'calling',
                                      providerName: 'dialpad'
                                    });
                                  } else {
                                    // Note: We don't disable providers, just don't set them
                                    // This could be extended to call a disable API if needed
                                  }
                                }}
                                disabled={setProviderMutation.isPending}
                                className="rounded border-gray-300"
                                data-testid="checkbox-dialpad-calling"
                              />
                              <Label htmlFor="dialpad-calling-service" className="text-sm cursor-pointer">
                                Enable Calling Service
                              </Label>
                            </div>
                            <Phone className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      )}
                      
                      {/* Add Dialpad sync button for enabled integration */}
                      {integration.name === 'dialpad' && integration.hasCredentials && integration.isEnabled && (
                        <div className="pt-3 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => syncDialpadMutation.mutate()}
                            disabled={syncDialpadMutation.isPending || syncStatus.isRunning}
                            data-testid="button-dialpad-sync"
                          >
                            <RefreshCw className={`h-4 w-4 mr-2 ${(syncDialpadMutation.isPending || syncStatus.isRunning) ? 'animate-spin' : ''}`} />
                            {(syncDialpadMutation.isPending || syncStatus.isRunning) ? 'Syncing...' : 'Sync Dialpad Data'}
                          </Button>
                        </div>
                      )}
                      
                      {/* Show "Update API Key" option for configured integrations */}
                      {integration.hasCredentials && currentUser?.user?.role === 'admin' && editingIntegration !== integration.name && (
                        <div className="pt-3 border-t">
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditingIntegration(integration.name)}
                              data-testid={`button-update-${integration.name}-api-key`}
                            >
                              Update API Key
                            </Button>
                            {integration.name === 'dialpad' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate('/dialpad-setup')}
                                data-testid="button-enhanced-setup"
                              >
                                Enhanced Setup
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Show API key input when not configured OR when editing */}
                      {(!integration.hasCredentials || editingIntegration === integration.name) && (
                        userLoading ? (
                          <div className="animate-pulse space-y-3">
                            <div className="h-4 bg-muted rounded w-20"></div>
                            <div className="h-9 bg-muted rounded"></div>
                          </div>
                        ) : currentUser?.user?.role === 'admin' ? (
                          <div className="space-y-3">
                            <Label htmlFor={`${integration.name}-api-key`} className="text-sm font-medium">
                              {integration.hasCredentials ? 'Update API Key' : 'API Key'}
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id={`${integration.name}-api-key`}
                                type="password"
                                placeholder={integration.hasCredentials ? "Enter new API key..." : "Enter your API key..."}
                                value={credentialInputs[integration.name] || ''}
                                onChange={(e) => setCredentialInputs(prev => ({ 
                                  ...prev, 
                                  [integration.name]: e.target.value 
                                }))}
                                data-testid={`input-${integration.name}-api-key`}
                              />
                              <Button
                                onClick={() => handleSaveCredentials(integration.name)}
                                disabled={saveCredentialMutation.isPending || !credentialInputs[integration.name]?.trim()}
                                data-testid={`button-save-${integration.name}`}
                              >
                                {saveCredentialMutation.isPending ? "Saving..." : (integration.hasCredentials ? "Update" : "Save")}
                              </Button>
                              {editingIntegration === integration.name && (
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setEditingIntegration(null);
                                    setCredentialInputs(prev => ({ ...prev, [integration.name]: '' }));
                                  }}
                                  data-testid={`button-cancel-${integration.name}`}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-sm">
                              Contact your administrator to configure {integration.displayName} credentials.
                            </AlertDescription>
                          </Alert>
                        )
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
        </div>
      )}

      {activeTab === 'account' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Account Information
              </CardTitle>
              <CardDescription>
                Manage your account settings and preferences
              </CardDescription>
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

          {/* Gmail Connection Card (All Users) */}
          <GmailConnectionCard 
            gmailConnected={currentUser?.user?.gmailConnected || false}
            gmailEmail={currentUser?.user?.gmailEmail}
          />

          {/* Public Booking Page Card (Admin Only) */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Public Booking Page
                </CardTitle>
                <CardDescription>
                  Allow leads to self-schedule appointments through a public booking page
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="booking-slug">Booking URL Slug</Label>
                    <div className="flex gap-2">
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">/book/</span>
                        <Input
                          id="booking-slug"
                          placeholder="your-company-name"
                          value={bookingSlugInput}
                          onChange={(e) => setBookingSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          data-testid="input-booking-slug"
                        />
                      </div>
                      <Button
                        onClick={() => saveBookingSlugMutation.mutate(bookingSlugInput)}
                        disabled={saveBookingSlugMutation.isPending}
                        data-testid="button-save-booking-slug"
                      >
                        {saveBookingSlugMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use lowercase letters, numbers, and hyphens only (3-50 characters)
                    </p>
                  </div>

                  {bookingSlugData?.bookingUrl && (
                    <div className="space-y-2">
                      <Label>Your Public Booking URL</Label>
                      <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                        <a 
                          href={bookingSlugData.bookingUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline flex-1 truncate"
                          data-testid="link-booking-url"
                        >
                          {bookingSlugData.bookingUrl}
                        </a>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard.writeText(bookingSlugData.bookingUrl || '');
                            toast({
                              title: "Copied",
                              description: "Booking URL copied to clipboard"
                            });
                          }}
                          data-testid="button-copy-booking-url"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => window.open(bookingSlugData.bookingUrl || '', '_blank')}
                          data-testid="button-open-booking-url"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {bookingSlugData?.bookingUrl && bookingSlugData?.bookingSlug && (() => {
                    const crmOrigin = new URL(bookingSlugData.bookingUrl).origin;
                    const savedSlug = bookingSlugData.bookingSlug;
                    const embedCode = `<!-- Add this where you want the booking widget -->
<div id="booking-widget"></div>
<script>
  window.BookingWidgetConfig = {
    slug: "${savedSlug}",
    baseUrl: "${crmOrigin}"
  };
</script>
<script src="${crmOrigin}/booking-widget.js"></script>`;
                    return (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        Embed on Your Website
                      </Label>
                      <div className="p-3 bg-muted rounded-md">
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
{embedCode}
                        </pre>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            navigator.clipboard.writeText(embedCode);
                            toast({
                              title: "Copied",
                              description: "Embed code copied to clipboard"
                            });
                          }}
                          data-testid="button-copy-embed-code"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Embed Code
                        </Button>
                      </div>
                    </div>
                    );
                  })()}

                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Share this link with leads to allow them to schedule appointments directly. 
                      They'll see available time slots based on your team's calendar.
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Team Management Card (Admin Only) */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Team Management
                    </CardTitle>
                    <CardDescription>
                      Manage user accounts and permissions for your organization
                    </CardDescription>
                  </div>
                  <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-user">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add User
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-add-user">
                      <DialogHeader>
                        <DialogTitle>Add New User</DialogTitle>
                        <DialogDescription>
                          Create a new user account for your organization
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="username">Username</Label>
                          <Input
                            id="username"
                            placeholder="john.doe"
                            value={newUserData.username}
                            onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                            data-testid="input-username"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="name">Full Name</Label>
                          <Input
                            id="name"
                            placeholder="John Doe"
                            value={newUserData.name}
                            onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                            data-testid="input-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="john.doe@example.com"
                            value={newUserData.email}
                            onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                            data-testid="input-email"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="password">Password</Label>
                          <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={newUserData.password}
                            onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                            data-testid="input-password"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="role">Role</Label>
                          <Select
                            value={newUserData.role}
                            onValueChange={(value) => setNewUserData({ ...newUserData, role: value })}
                          >
                            <SelectTrigger id="role" data-testid="select-role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setIsAddUserDialogOpen(false);
                              setNewUserData({ username: "", name: "", email: "", password: "", role: "user" });
                            }}
                            data-testid="button-cancel-add-user"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={() => addUserMutation.mutate(newUserData)}
                            disabled={
                              !newUserData.username ||
                              !newUserData.name ||
                              !newUserData.email ||
                              !newUserData.password ||
                              addUserMutation.isPending
                            }
                            data-testid="button-create-user"
                          >
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
                    <Input
                      placeholder="Search users..."
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-users"
                    />
                  </div>
                  {usersLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading users...
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allUsers
                        .filter((user) =>
                          userSearchQuery === '' ||
                          user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                          user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                          user.username.toLowerCase().includes(userSearchQuery.toLowerCase())
                        )
                        .map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover-elevate"
                            data-testid={`user-item-${user.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-sm font-medium text-primary">
                                  {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                </span>
                              </div>
                              <div>
                                <p className="text-sm font-medium" data-testid={`text-user-name-${user.id}`}>
                                  {user.name}
                                </p>
                                <p className="text-xs text-muted-foreground" data-testid={`text-user-email-${user.id}`}>
                                  {user.email}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize" data-testid={`badge-role-${user.id}`}>
                                {user.role}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      {allUsers.filter((user) =>
                        userSearchQuery === '' ||
                        user.name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                        user.email.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                        user.username.toLowerCase().includes(userSearchQuery.toLowerCase())
                      ).length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          No users found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Terminology Settings Card (Admin Only) */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5" />
                    Navigation Terminology
                  </CardTitle>
                  <CardDescription>
                    Customize how navigation items appear throughout your CRM
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="leads-label">Plural Label</Label>
                      <Input
                        id="leads-label"
                        value={terminologySettings.leadsLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, leadsLabel: e.target.value })}
                        placeholder="Leads"
                        data-testid="input-leads-label"
                      />
                      <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lead-label">Singular Label</Label>
                      <Input
                        id="lead-label"
                        value={terminologySettings.leadLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, leadLabel: e.target.value })}
                        placeholder="Lead"
                        data-testid="input-lead-label"
                      />
                      <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="estimates-label">Plural Label</Label>
                      <Input
                        id="estimates-label"
                        value={terminologySettings.estimatesLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, estimatesLabel: e.target.value })}
                        placeholder="Estimates"
                        data-testid="input-estimates-label"
                      />
                      <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="estimate-label">Singular Label</Label>
                      <Input
                        id="estimate-label"
                        value={terminologySettings.estimateLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, estimateLabel: e.target.value })}
                        placeholder="Estimate"
                        data-testid="input-estimate-label"
                      />
                      <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="jobs-label">Plural Label</Label>
                      <Input
                        id="jobs-label"
                        value={terminologySettings.jobsLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, jobsLabel: e.target.value })}
                        placeholder="Jobs"
                        data-testid="input-jobs-label"
                      />
                      <p className="text-xs text-muted-foreground">Used in navigation and listings</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="job-label">Singular Label</Label>
                      <Input
                        id="job-label"
                        value={terminologySettings.jobLabel}
                        onChange={(e) => setTerminologySettings({ ...terminologySettings, jobLabel: e.target.value })}
                        placeholder="Job"
                        data-testid="input-job-label"
                      />
                      <p className="text-xs text-muted-foreground">Used when referring to one item</p>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={() => saveTerminologyMutation.mutate(terminologySettings)}
                      disabled={saveTerminologyMutation.isPending}
                      data-testid="button-save-terminology"
                    >
                      {saveTerminologyMutation.isPending ? "Saving..." : "Save Terminology Settings"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'security' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Settings
              </CardTitle>
              <CardDescription>
                Manage your security preferences and authentication
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Security settings coming soon...</p>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'targets' && (
        <div className="space-y-6">
          {currentUser?.user?.role !== 'admin' && currentUser?.user?.role !== 'super_admin' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Access Denied
                </CardTitle>
                <CardDescription>
                  Only administrators can access performance targets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Performance targets can only be viewed and modified by administrators. Please contact your system administrator if you need to update these settings.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Performance Targets
                </CardTitle>
                <CardDescription>
                  Set custom performance targets for your business. These targets are used by the AI monitor to evaluate contractor performance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
              {targetsLoading ? (
                <div className="animate-pulse space-y-4">
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-9 bg-muted rounded"></div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-9 bg-muted rounded"></div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-9 bg-muted rounded"></div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32"></div>
                    <div className="h-9 bg-muted rounded"></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="speed-to-lead" className="text-sm font-medium">
                      Speed to Lead (minutes)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Maximum time allowed to respond to a new lead
                    </p>
                    <Input
                      id="speed-to-lead"
                      type="number"
                      min="1"
                      max="1440"
                      value={businessTargets.speedToLeadMinutes}
                      onChange={(e) => setBusinessTargets({
                        ...businessTargets,
                        speedToLeadMinutes: parseInt(e.target.value) || 60
                      })}
                      data-testid="input-speed-to-lead"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="follow-up-rate" className="text-sm font-medium">
                      Follow Up Rate (%)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Target percentage of leads that should receive follow-up contact
                    </p>
                    <Input
                      id="follow-up-rate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={businessTargets.followUpRatePercent}
                      onChange={(e) => setBusinessTargets({
                        ...businessTargets,
                        followUpRatePercent: e.target.value
                      })}
                      data-testid="input-follow-up-rate"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="set-rate" className="text-sm font-medium">
                      Set Rate (%)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Target percentage of leads that should be converted to scheduled appointments
                    </p>
                    <Input
                      id="set-rate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={businessTargets.setRatePercent}
                      onChange={(e) => setBusinessTargets({
                        ...businessTargets,
                        setRatePercent: e.target.value
                      })}
                      data-testid="input-set-rate"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="close-rate" className="text-sm font-medium">
                      Close Rate (%)
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Target percentage of scheduled appointments that should result in completed jobs
                    </p>
                    <Input
                      id="close-rate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={businessTargets.closeRatePercent}
                      onChange={(e) => setBusinessTargets({
                        ...businessTargets,
                        closeRatePercent: e.target.value
                      })}
                      data-testid="input-close-rate"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-4">
                    <Button
                      onClick={() => saveTargetsMutation.mutate(businessTargets)}
                      disabled={saveTargetsMutation.isPending}
                      data-testid="button-save-targets"
                    >
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

          {(currentUser?.user?.role === 'admin' || currentUser?.user?.role === 'super_admin') && (
            <Alert>
              <Target className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Example Configuration:</strong> Elmar Heating uses 5 minutes for speed to lead, 
                100% follow-up rate, 45% set rate, and 35% close rate. Adjust these targets based on 
                your business.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          {webhookLoading ? (
            <Card>
              <CardHeader>
                <div className="animate-pulse space-y-3">
                  <div className="h-6 bg-muted rounded w-48"></div>
                  <div className="h-4 bg-muted rounded w-64"></div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="animate-pulse space-y-4">
                  <div className="h-10 bg-muted rounded"></div>
                  <div className="h-20 bg-muted rounded"></div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5" />
                  Webhook Configuration
                </CardTitle>
                <CardDescription>
                  Push leads, estimates, and jobs from external sources like Zapier
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Webhook Type Toggle */}
                <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                  <Button
                    variant={selectedWebhook === 'leads' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedWebhook('leads')}
                    data-testid="button-webhook-leads"
                  >
                    Leads Webhook
                  </Button>
                  <Button
                    variant={selectedWebhook === 'estimates' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedWebhook('estimates')}
                    data-testid="button-webhook-estimates"
                  >
                    Estimates Webhook
                  </Button>
                  <Button
                    variant={selectedWebhook === 'jobs' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedWebhook('jobs')}
                    data-testid="button-webhook-jobs"
                  >
                    Jobs Webhook
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhook-url" className="text-sm font-medium">
                    Webhook URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="webhook-url"
                      value={webhookConfig?.webhooks?.[selectedWebhook]?.url || webhookConfig?.webhookUrl || ''}
                      readOnly
                      data-testid="input-webhook-url"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const url = webhookConfig?.webhooks?.[selectedWebhook]?.url || webhookConfig?.webhookUrl;
                        if (url) {
                          navigator.clipboard.writeText(url);
                          toast({
                            title: "Copied",
                            description: "Webhook URL copied to clipboard"
                          });
                        }
                      }}
                      data-testid="button-copy-webhook-url"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api-key" className="text-sm font-medium">
                    API Key
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="api-key"
                      type={showApiKey ? "text" : "password"}
                      value={webhookConfig?.apiKey || ''}
                      readOnly
                      data-testid="input-api-key"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowApiKey(!showApiKey)}
                      data-testid="button-toggle-api-key"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        if (webhookConfig?.apiKey) {
                          navigator.clipboard.writeText(webhookConfig.apiKey);
                          toast({
                            title: "Copied",
                            description: "API key copied to clipboard"
                          });
                        }
                      }}
                      data-testid="button-copy-api-key"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Security Note:</strong> Include the API key in your webhook request headers as <code className="bg-muted px-1 rounded">x-api-key</code>
                  </AlertDescription>
                </Alert>
                
                <Separator />

                {(() => {
                  const currentDoc = webhookConfig?.webhooks?.[selectedWebhook]?.documentation || webhookConfig?.documentation;
                  if (!currentDoc) return null;
                  
                  return (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold">Documentation</h3>
                      
                      {/* HTTP Method Section */}
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">HTTP Method</h4>
                        <div className="p-2 bg-muted rounded">
                          <p className="font-mono text-sm font-semibold">{currentDoc.method}</p>
                        </div>
                      </div>

                      {/* Required Headers Section */}
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">Required Headers</h4>
                        <div className="p-3 bg-muted rounded font-mono text-xs space-y-1">
                          {Object.entries(currentDoc.headers).map(([key, value]) => (
                            <div key={key} className="flex gap-2">
                              <span className="text-primary font-semibold">{key}:</span>
                              <span>
                                {key.toLowerCase() === 'x-api-key' 
                                  ? (showApiKey ? String(value) : '•'.repeat(Math.min(String(value).length, 64)))
                                  : String(value)
                                }
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Required Fields Section */}
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium text-muted-foreground">Required Fields</h4>
                        <div className="flex flex-wrap gap-2">
                          {currentDoc.requiredFields.map((field) => (
                            <Badge key={field} variant="default" className="text-xs font-medium">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* Optional Fields Section */}
                      {currentDoc.optionalFields?.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">Optional Fields</h4>
                          <div className="flex flex-wrap gap-2">
                            {currentDoc.optionalFields.map((field) => (
                              <Badge key={field} variant="secondary" className="text-xs font-medium">
                                {field}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Special Notes for Leads Webhook */}
                      {selectedWebhook === 'leads' && currentDoc.phoneNormalization && (
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription className="text-sm">
                            <strong>Phone Normalization:</strong> {currentDoc.phoneNormalization}
                          </AlertDescription>
                        </Alert>
                      )}

                      {selectedWebhook === 'leads' && currentDoc.multipleContacts && (
                        <Alert>
                          <Info className="h-4 w-4" />
                          <AlertDescription className="text-sm">
                            <strong>Multiple Contacts:</strong> {currentDoc.multipleContacts}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Example Request Body */}
                      {currentDoc.example && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium text-muted-foreground">Example Request Body</h4>
                          <div className="p-3 bg-muted rounded">
                            <pre className="font-mono text-xs overflow-x-auto">
                              {JSON.stringify(currentDoc.example, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* Integration Tips */}
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          <div className="space-y-2">
                            <p className="font-semibold text-sm">Integration Tips:</p>
                            <ul className="space-y-1 text-sm list-disc list-inside ml-2">
                              {selectedWebhook === 'leads' ? (
                                <>
                                  <li>The webhook will automatically create a new lead in your CRM</li>
                                  <li>Use the <code className="bg-muted px-1 rounded">source</code> field to track where leads come from</li>
                                  <li>Include UTM parameters to track marketing campaigns</li>
                                  <li>Set <code className="bg-muted px-1 rounded">followUpDate</code> to schedule automatic follow-ups</li>
                                  <li>The webhook returns a 201 status code and the created lead details on success</li>
                                </>
                              ) : (
                                <>
                                  <li>The webhook will automatically create a new estimate in your CRM</li>
                                  <li>Existing customers are matched by email or phone to avoid duplicates</li>
                                  <li>New customers are created automatically if no match is found</li>
                                  <li>Link estimates to leads using the optional <code className="bg-muted px-1 rounded">leadId</code> field</li>
                                  <li>Set <code className="bg-muted px-1 rounded">status</code> to draft, sent, pending, approved, or rejected</li>
                                  <li>The webhook returns a 201 status code and the created estimate details on success</li>
                                </>
                              )}
                            </ul>
                          </div>
                        </AlertDescription>
                      </Alert>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'salespeople' && (
        <SalespeopleManagement />
      )}
    </PageLayout>
  );
}

// Salespeople Management Component
function SalespeopleManagement() {
  const { toast } = useToast();
  const [syncingUsers, setSyncingUsers] = useState(false);

  interface Salesperson {
    userId: string;
    name: string;
    email: string;
    housecallProUserId: string | null;
    lastAssignmentAt: string | null;
    calendarColor: string | null;
    isSalesperson: boolean;
    workingDays: number[];
    workingHoursStart: string;
    workingHoursEnd: string;
    hasCustomSchedule: boolean;
  }
  
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [scheduleData, setScheduleData] = useState<{
    workingDays: number[];
    workingHoursStart: string;
    workingHoursEnd: string;
  } | null>(null);
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  interface SyncResult {
    synced: number;
    created: number;
    updated: number;
    errors: string[];
    hcpUsersFound?: number;
  }

  const { data: salespeople = [], isLoading: salespeopleLoading, refetch } = useQuery<Salesperson[]>({
    queryKey: ['/api/scheduling/salespeople'],
  });

  const syncUsersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/scheduling/sync-users', {});
      return response.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => {
      let description = `Found ${data.hcpUsersFound || 0} HCP users. `;
      if (data.synced > 0) {
        description += `Matched ${data.synced} to CRM (${data.created} created, ${data.updated} updated)`;
      } else {
        description += 'No matching email addresses found in CRM users.';
      }
      if (data.errors?.length) {
        description += ` Errors: ${data.errors.join(', ')}`;
      }
      toast({
        title: data.synced > 0 ? "Users Synced" : "Sync Complete",
        description,
        variant: data.errors?.length ? "destructive" : "default",
      });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync Housecall Pro users",
        variant: "destructive",
      });
    },
  });

  const toggleSalespersonMutation = useMutation({
    mutationFn: async ({ userId, isSalesperson }: { userId: string; isSalesperson: boolean }) => {
      const response = await apiRequest('PATCH', `/api/scheduling/salespeople/${userId}`, { isSalesperson });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Salesperson status updated",
      });
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update salesperson status",
        variant: "destructive",
      });
    },
  });
  
  const updateScheduleMutation = useMutation({
    mutationFn: async ({ userId, workingDays, workingHoursStart, workingHoursEnd }: { 
      userId: string; 
      workingDays: number[];
      workingHoursStart: string;
      workingHoursEnd: string;
    }) => {
      const response = await apiRequest('PATCH', `/api/scheduling/salespeople/${userId}`, { 
        workingDays,
        workingHoursStart,
        workingHoursEnd,
        hasCustomSchedule: true
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Schedule Updated",
        description: "Working hours saved successfully",
      });
      setEditingSchedule(null);
      setScheduleData(null);
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update schedule",
        variant: "destructive",
      });
    },
  });

  // Mutation to revert to HCP-managed schedule
  const revertScheduleMutation = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const response = await apiRequest('PATCH', `/api/scheduling/salespeople/${userId}`, { 
        hasCustomSchedule: false
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Schedule Reverted",
        description: "Schedule will be managed by Housecall Pro sync",
      });
      setEditingSchedule(null);
      setScheduleData(null);
      refetch();
    },
    onError: (error: any) => {
      toast({
        title: "Revert Failed",
        description: error.message || "Failed to revert schedule",
        variant: "destructive",
      });
    },
  });
  
  const startEditingSchedule = (person: Salesperson) => {
    setEditingSchedule(person.userId);
    setScheduleData({
      workingDays: person.workingDays || [1, 2, 3, 4, 5],
      workingHoursStart: person.workingHoursStart || "08:00",
      workingHoursEnd: person.workingHoursEnd || "17:00"
    });
  };
  
  const toggleDay = (day: number) => {
    if (!scheduleData) return;
    const newDays = scheduleData.workingDays.includes(day)
      ? scheduleData.workingDays.filter(d => d !== day)
      : [...scheduleData.workingDays, day].sort((a, b) => a - b);
    setScheduleData({ ...scheduleData, workingDays: newDays });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Salespeople Management
              </CardTitle>
              <CardDescription>
                Manage which team members are available for appointment scheduling
              </CardDescription>
            </div>
            <Button
              onClick={() => syncUsersMutation.mutate()}
              disabled={syncUsersMutation.isPending}
              data-testid="button-sync-hcp-users"
            >
              {syncUsersMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sync from Housecall Pro
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {salespeopleLoading ? (
            <div className="space-y-3">
              <div className="animate-pulse h-12 bg-muted rounded" />
              <div className="animate-pulse h-12 bg-muted rounded" />
              <div className="animate-pulse h-12 bg-muted rounded" />
            </div>
          ) : salespeople.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Salespeople Configured</h3>
              <p className="text-muted-foreground mb-4">
                Click "Sync from Housecall Pro" to pull your team members and mark them as salespeople.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {salespeople.map((person) => (
                <div
                  key={person.userId}
                  className="border rounded-lg"
                  data-testid={`salesperson-row-${person.userId}`}
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">{person.name}</div>
                        <div className="text-sm text-muted-foreground">{person.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {person.housecallProUserId && (
                        <Badge variant="outline" className="gap-1">
                          <Calendar className="h-3 w-3" />
                          HCP Linked
                        </Badge>
                      )}
                      {person.hasCustomSchedule && (
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" />
                          Custom Schedule
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEditingSchedule(person)}
                        data-testid={`button-edit-schedule-${person.userId}`}
                      >
                        <Clock className="h-4 w-4 mr-1" />
                        Schedule
                      </Button>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`salesperson-${person.userId}`} className="text-sm">
                          Salesperson
                        </Label>
                        <Switch
                          id={`salesperson-${person.userId}`}
                          checked={person.isSalesperson}
                          onCheckedChange={(checked) => 
                            toggleSalespersonMutation.mutate({ userId: person.userId, isSalesperson: checked })
                          }
                          disabled={toggleSalespersonMutation.isPending}
                          data-testid={`switch-salesperson-${person.userId}`}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {editingSchedule === person.userId && scheduleData && (
                    <div className="border-t p-4 bg-muted/30 space-y-4">
                      <div>
                        <Label className="text-sm font-medium mb-2 block">Working Days</Label>
                        <div className="flex gap-2">
                          {dayNames.map((name, idx) => (
                            <Button
                              key={idx}
                              variant={scheduleData.workingDays.includes(idx) ? "default" : "outline"}
                              size="sm"
                              onClick={() => toggleDay(idx)}
                              data-testid={`button-day-${idx}`}
                            >
                              {name}
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <Label className="text-sm font-medium mb-2 block">Start Time</Label>
                          <Input
                            type="time"
                            value={scheduleData.workingHoursStart}
                            onChange={(e) => setScheduleData({ ...scheduleData, workingHoursStart: e.target.value })}
                            data-testid="input-start-time"
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-sm font-medium mb-2 block">End Time</Label>
                          <Input
                            type="time"
                            value={scheduleData.workingHoursEnd}
                            onChange={(e) => setScheduleData({ ...scheduleData, workingHoursEnd: e.target.value })}
                            data-testid="input-end-time"
                          />
                        </div>
                      </div>
                      
                      <div className="flex justify-between gap-2">
                        {/* Revert to HCP button - only show for HCP-linked users with custom schedule */}
                        <div>
                          {person.housecallProUserId && person.hasCustomSchedule && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => revertScheduleMutation.mutate({ userId: person.userId })}
                              disabled={revertScheduleMutation.isPending}
                              data-testid={`button-revert-schedule-${person.userId}`}
                            >
                              {revertScheduleMutation.isPending ? 'Reverting...' : 'Revert to HCP Schedule'}
                            </Button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditingSchedule(null); setScheduleData(null); }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => updateScheduleMutation.mutate({
                              userId: person.userId,
                              ...scheduleData
                            })}
                            disabled={updateScheduleMutation.isPending}
                          >
                            {updateScheduleMutation.isPending ? 'Saving...' : 'Save Schedule'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="shrink-0">1</Badge>
            <p>Click "Sync from Housecall Pro" to pull your team members from HCP</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="shrink-0">2</Badge>
            <p>Users are matched by email address between your CRM and Housecall Pro</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="shrink-0">3</Badge>
            <p>Salespeople are automatically available for scheduling with 1-hour slots and 30-minute buffers</p>
          </div>
          <div className="flex items-start gap-3">
            <Badge variant="outline" className="shrink-0">4</Badge>
            <p>When appointments are booked, the system auto-assigns to the next available salesperson</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Gmail Connection Card Component
function GmailConnectionCard({ gmailConnected, gmailEmail }: { gmailConnected: boolean; gmailEmail?: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  
  const syncGmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/emails/fetch-gmail', {});
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Gmail synced",
        description: `Fetched ${data.count} new email${data.count !== 1 ? 's' : ''}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/messages'] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: error.message || "Failed to sync Gmail emails",
      });
    }
  });
  
  const connectGmailMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/oauth/gmail/connect', {
        method: 'GET',
        credentials: 'include'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to connect Gmail');
      }
      return response.json();
    },
    onSuccess: (data: { authUrl?: string }) => {
      // Defensive check for authUrl
      if (!data.authUrl) {
        toast({
          title: "Gmail Connection Failed",
          description: "No authorization URL received. Please try again.",
          variant: "destructive",
        });
        return;
      }
      // Redirect user to Google OAuth consent screen
      window.location.href = data.authUrl;
    },
    onError: (error: any) => {
      toast({
        title: "Gmail Connection Failed",
        description: error.message || "Failed to initiate Gmail connection. Please try again.",
        variant: "destructive",
      });
    },
  });

  const disconnectGmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/oauth/gmail/disconnect');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Gmail Disconnected",
        description: "Your Gmail account has been disconnected successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    },
    onError: (error: any) => {
      toast({
        title: "Disconnection Failed",
        description: error.message || "Failed to disconnect Gmail. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Check for OAuth callback status in URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gmailStatus = urlParams.get('gmail');
    
    if (gmailStatus === 'connected') {
      toast({
        title: "Gmail Connected",
        description: "Your Gmail account has been connected successfully!",
      });
      // Refresh user data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      // Clean up URL while preserving tab parameter
      navigate('/settings?tab=integrations', { replace: true });
    } else if (gmailStatus === 'error') {
      const reason = urlParams.get('reason');
      toast({
        title: "Gmail Connection Failed",
        description: reason === 'no_refresh_token' 
          ? "No refresh token received. Please disconnect the app from Google Account Permissions and try again."
          : "Failed to connect Gmail. Please try again.",
        variant: "destructive",
      });
      // Clean up URL while preserving tab parameter
      navigate('/settings?tab=integrations', { replace: true });
    }
  }, [toast, navigate]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-lg">Gmail Connection</CardTitle>
              <CardDescription className="text-sm">
                Connect your Gmail business account to send and receive emails from the CRM
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {gmailConnected ? (
              <Badge variant="default">
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                Not Connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {gmailConnected && gmailEmail && (
          <p className="text-sm text-muted-foreground" data-testid="text-gmail-email">
            Connected as: {gmailEmail}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {gmailConnected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncGmailMutation.mutate()}
                disabled={syncGmailMutation.isPending}
                data-testid="button-sync-gmail"
              >
                {syncGmailMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Emails
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnectGmailMutation.mutate()}
                disabled={disconnectGmailMutation.isPending}
                data-testid="button-disconnect-gmail"
              >
                {disconnectGmailMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Disconnecting...
                  </>
                ) : (
                  'Disconnect'
                )}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => connectGmailMutation.mutate()}
              disabled={connectGmailMutation.isPending}
              data-testid="button-connect-gmail"
            >
              {connectGmailMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Connect Gmail
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
