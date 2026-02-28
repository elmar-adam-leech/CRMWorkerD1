import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Phone, Users, Settings, CheckCircle, AlertTriangle, MessageSquare, PhoneCall, RotateCcw, Plus, Star, Trash2 } from 'lucide-react';
import { DialpadWebhookConfig } from './DialpadWebhookConfig';

interface DialpadUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  extension: string;
  department?: string;
}

interface DialpadPhoneNumber {
  id: string;
  phoneNumber: string;
  displayName?: string;
  department?: string;
  canSendSms: boolean;
  canMakeCalls: boolean;
  isActive: boolean;
  permissions?: Array<{
    userId: string;
    canSendSms: boolean;
    canMakeCalls: boolean;
  }>;
}

interface UserPermission {
  userId: string;
  userName: string;
  userEmail: string;
  canSendSms: boolean;
  canMakeCalls: boolean;
}

interface EnhancedDialpadConfigProps {
  onComplete?: () => void;
}

// Component for managing organization-wide default phone number
function DefaultPhoneNumberSection({ phoneNumbers }: { phoneNumbers: DialpadPhoneNumber[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Get current organization default number
  const { data: defaultNumberData } = useQuery({
    queryKey: ['/api/contractor/dialpad-default-number']
  });
  const currentDefaultNumber = (defaultNumberData as { defaultDialpadNumber: string | null })?.defaultDialpadNumber || null;
  
  // Mutation to update the organization default number
  const updateDefaultNumberMutation = useMutation({
    mutationFn: async (phoneNumber: string | null) => {
      return await apiRequest('PUT', '/api/contractor/dialpad-default-number', {
        defaultDialpadNumber: phoneNumber
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contractor/dialpad-default-number'] });
      toast({
        title: "Success",
        description: "Organization default phone number updated successfully"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update default phone number",
        variant: "destructive"
      });
    }
  });
  
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold">Organization Default Phone Number</h4>
        <p className="text-sm text-muted-foreground">
          Set a default phone number for all users who haven't configured their own. This number will be used for calls and SMS.
        </p>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Select
            value={currentDefaultNumber || 'none'}
            onValueChange={(value) => updateDefaultNumberMutation.mutate(value === 'none' ? null : value)}
            disabled={updateDefaultNumberMutation.isPending || phoneNumbers.length === 0}
          >
            <SelectTrigger data-testid="select-org-default-number">
              <SelectValue placeholder="Select default phone number..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No default (users must set their own)</SelectItem>
              {phoneNumbers.map((phoneNumber) => (
                <SelectItem key={phoneNumber.id} value={phoneNumber.phoneNumber}>
                  {phoneNumber.phoneNumber}
                  {phoneNumber.department && ` (${phoneNumber.department})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {currentDefaultNumber && (
          <Badge variant="outline" className="shrink-0">
            <Star className="h-3 w-3 mr-1" />
            Default Set
          </Badge>
        )}
      </div>
      
      {phoneNumbers.length === 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Sync phone numbers first to set an organization default.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function EnhancedDialpadConfig({ onComplete }: EnhancedDialpadConfigProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [apiKey, setApiKey] = useState('');
  const [userId, setUserId] = useState('');
  const [selectedPhoneNumbers, setSelectedPhoneNumbers] = useState<Set<string>>(new Set());
  const [phoneNumberDepartments, setPhoneNumberDepartments] = useState<Record<string, string>>({});
  const [userPermissions, setUserPermissions] = useState<Record<string, UserPermission>>({});
  const [isLoadingState, setIsLoadingState] = useState(true);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check integration status to determine initial step
  const { data: integrationStatus } = useQuery({
    queryKey: ['/api/integrations/dialpad/status']
  });
  const typedIntegrationStatus = integrationStatus as { hasCredentials: boolean; isEnabled: boolean } | undefined;

  // Get existing phone numbers (always enabled for management)
  const { data: phoneNumbers = [], isLoading: phoneNumbersLoading, refetch: refetchPhoneNumbers } = useQuery({
    queryKey: ['/api/dialpad/phone-numbers']
  });
  const typedPhoneNumbers = phoneNumbers as DialpadPhoneNumber[];

  // Get users for permission assignment (always enabled for management)
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['/api/users']
  });
  const typedUsers = users as any[];

  // Determine initial step based on existing configuration
  useEffect(() => {
    if (!typedIntegrationStatus || phoneNumbersLoading) return;
    
    const hasCredentials = typedIntegrationStatus.hasCredentials;
    const hasPhoneNumbers = typedPhoneNumbers.length > 0;
    const isEnabled = typedIntegrationStatus.isEnabled;
    
    if (isEnabled) {
      // If already enabled, go directly to management (step 3)
      setCurrentStep(3);
    } else if (hasPhoneNumbers && hasCredentials) {
      // If has phone numbers and credentials but not enabled, go to permissions step
      setCurrentStep(3);
    } else if (hasCredentials) {
      // If has credentials but no phone numbers, go to sync step
      setCurrentStep(2);
    } else {
      // If no credentials, start from beginning
      setCurrentStep(1);
    }
    
    setIsLoadingState(false);
  }, [typedIntegrationStatus, typedPhoneNumbers.length, phoneNumbersLoading]);

  // Get Dialpad users for department mapping (always enabled for management)
  const { data: dialpadUsers = [], isLoading: dialpadUsersLoading } = useQuery({
    queryKey: ['/api/dialpad/users']
  });
  const typedDialpadUsers = dialpadUsers as DialpadUser[];

  // Fetch existing credentials to populate the form
  const { data: existingCredentials } = useQuery({
    queryKey: ['/api/integrations/dialpad/credentials'],
    enabled: !!typedIntegrationStatus?.hasCredentials
  });

  // Populate form fields with existing credentials
  useEffect(() => {
    if (existingCredentials) {
      const response = existingCredentials as { credentials?: { user_id?: string } };
      if (response.credentials?.user_id) {
        setUserId(response.credentials.user_id);
      }
    }
  }, [existingCredentials]);

  const saveCrendentialsMutation = useMutation({
    mutationFn: async ({ apiKey, userId }: { apiKey: string; userId: string }) => {
      const response = await apiRequest('POST', '/api/integrations/dialpad/credentials', {
        credentials: { 
          api_key: apiKey,
          user_id: userId
        }
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Credentials Saved",
        description: "Dialpad API key and User ID have been saved successfully."
      });
      setCurrentStep(2);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save credentials. Please check your inputs and try again.",
        variant: "destructive"
      });
    }
  });

  const syncPhoneNumbersMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/dialpad/sync-phone-numbers');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Phone Numbers Synced",
        description: `Successfully synced ${data.synced} phone numbers from Dialpad.`
      });
      refetchPhoneNumbers();
      setCurrentStep(3);
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to sync phone numbers. Please try again.",
        variant: "destructive"
      });
    }
  });

  const updatePhoneNumberMutation = useMutation({
    mutationFn: async ({ id, displayName, department }: { id: string; displayName?: string; department?: string }) => {
      const response = await apiRequest('PUT', `/api/dialpad/phone-numbers/${id}`, {
        displayName,
        department
      });
      return response.json();
    },
    onSuccess: () => {
      refetchPhoneNumbers();
    }
  });

  const setPermissionMutation = useMutation({
    mutationFn: async ({ phoneNumberId, userId, canSendSms, canMakeCalls }: {
      phoneNumberId: string;
      userId: string;
      canSendSms: boolean;
      canMakeCalls: boolean;
    }) => {
      const response = await apiRequest('POST', `/api/dialpad/phone-numbers/${phoneNumberId}/permissions`, {
        userId,
        canSendSms,
        canMakeCalls
      });
      return response.json();
    },
    onSuccess: () => {
      refetchPhoneNumbers();
    }
  });

  const setUserDefaultNumberMutation = useMutation({
    mutationFn: async ({ userId, dialpadDefaultNumber }: { userId: string; dialpadDefaultNumber: string | null }) => {
      const response = await fetch(`/api/users/${userId}/dialpad-default-number`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dialpadDefaultNumber }),
      });
      if (!response.ok) throw new Error('Failed to update default number');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "User's default phone number updated successfully"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update user's default phone number",
        variant: "destructive"
      });
    }
  });

  const enableIntegrationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/integrations/dialpad/enable');
      return response.json();
    },
    onSuccess: (data) => {
      // Check if webhook was created successfully
      if (data.webhookCreated) {
        toast({
          title: "Dialpad Enabled",
          description: "Dialpad integration and SMS webhook have been configured successfully."
        });
      } else if (data.webhookError) {
        toast({
          title: "Dialpad Enabled (Webhook Failed)",
          description: `Integration enabled, but webhook creation failed: ${data.webhookError}. You can create it manually from the Complete Setup step.`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Dialpad Enabled",
          description: "Dialpad integration has been enabled successfully."
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dialpad/webhooks/list'] });
      onComplete?.();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to enable Dialpad integration.",
        variant: "destructive"
      });
    }
  });

  // Webhook creation mutation
  const createWebhookMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/dialpad/webhooks/create');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Webhook Created",
        description: "Dialpad SMS webhook has been created successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/dialpad/webhooks/list'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create Dialpad webhook.",
        variant: "destructive"
      });
    }
  });

  // Webhook deletion mutation
  const deleteWebhookMutation = useMutation({
    mutationFn: async (webhookId: string) => {
      const response = await apiRequest('DELETE', `/api/dialpad/webhooks/${webhookId}`);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Webhook Deleted",
        description: "Dialpad SMS webhook has been deleted successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/dialpad/webhooks/list'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete Dialpad webhook.",
        variant: "destructive"
      });
    }
  });

  // Query for webhook list
  const { data: webhookList, isLoading: webhooksLoading, refetch: refetchWebhooks } = useQuery({
    queryKey: ['/api/dialpad/webhooks/list'],
    enabled: !!typedIntegrationStatus?.hasCredentials
  });
  const typedWebhookList = webhookList as { webhooks?: Array<{ id: string; hook_url: string }> } | undefined;

  const handleApiKeySubmit = () => {
    // At least one field must be provided
    if (!apiKey.trim() && !userId.trim()) {
      toast({
        title: "Credentials Required",
        description: "Please enter at least API Key or User ID to update.",
        variant: "destructive"
      });
      return;
    }

    // Build credentials object with only provided fields
    const credentials: Record<string, string> = {};
    if (apiKey.trim()) {
      credentials.api_key = apiKey.trim();
    }
    if (userId.trim()) {
      credentials.user_id = userId.trim();
    }

    // Call the mutation with the credentials
    apiRequest('POST', '/api/integrations/dialpad/credentials', { credentials })
      .then(() => {
        toast({
          title: "Credentials Updated",
          description: "Dialpad credentials have been updated successfully."
        });
        queryClient.invalidateQueries({ queryKey: ['/api/integrations/dialpad/credentials'] });
        queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      })
      .catch(() => {
        toast({
          title: "Error",
          description: "Failed to update credentials. Please try again.",
          variant: "destructive"
        });
      });
  };

  const handlePhoneNumberUpdate = (phoneNumberId: string, field: 'displayName' | 'department', value: string) => {
    if (field === 'department') {
      setPhoneNumberDepartments(prev => ({ ...prev, [phoneNumberId]: value }));
    }
    
    const phoneNumber = typedPhoneNumbers.find((pn: DialpadPhoneNumber) => pn.id === phoneNumberId);
    if (phoneNumber) {
      updatePhoneNumberMutation.mutate({
        id: phoneNumberId,
        displayName: field === 'displayName' ? value : phoneNumber.displayName,
        department: field === 'department' ? value : phoneNumber.department
      });
    }
  };

  const handleUserPermissionToggle = (phoneNumberId: string, userId: string, permission: 'sms' | 'call', enabled: boolean) => {
    const key = `${phoneNumberId}-${userId}`;
    const currentPermission = userPermissions[key] || {
      userId,
      userName: typedUsers.find((u: any) => u.id === userId)?.name || 'Unknown',
      userEmail: typedUsers.find((u: any) => u.id === userId)?.email || '',
      canSendSms: false,
      canMakeCalls: false
    };

    const updatedPermission = {
      ...currentPermission,
      [permission === 'sms' ? 'canSendSms' : 'canMakeCalls']: enabled
    };

    setUserPermissions(prev => ({ ...prev, [key]: updatedPermission }));

    setPermissionMutation.mutate({
      phoneNumberId,
      userId,
      canSendSms: updatedPermission.canSendSms,
      canMakeCalls: updatedPermission.canMakeCalls
    });
  };

  const departments = Array.from(new Set(typedDialpadUsers.map((user: DialpadUser) => user.department).filter(Boolean))) as string[];

  // Show loading state while determining initial step
  if (isLoadingState) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Loading Dialpad Configuration...</h3>
          </div>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-sm text-muted-foreground mt-2">Checking existing configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Step 1: Configure API Access
              </CardTitle>
              <CardDescription>
                Enter your Dialpad API key to connect your account. You can find this in your Dialpad admin settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-key">Dialpad API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="Enter your Dialpad API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  data-testid="input-dialpad-api-key"
                />
                <p className="text-sm text-muted-foreground">
                  Your API key will be stored securely and encrypted.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="user-id">Dialpad User ID</Label>
                <Input
                  id="user-id"
                  type="text"
                  placeholder="Enter your Dialpad User ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  data-testid="input-dialpad-user-id"
                />
                <p className="text-sm text-muted-foreground">
                  Your User ID is required for making calls. Find it in Dialpad settings or your admin panel.
                </p>
              </div>
              
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Important:</strong> Make sure your Dialpad API key has permissions for SMS and calling features, and your User ID is correct.
                </AlertDescription>
              </Alert>

              <Button 
                onClick={handleApiKeySubmit}
                disabled={saveCrendentialsMutation.isPending}
                className="w-full"
                data-testid="button-save-api-key"
              >
                {saveCrendentialsMutation.isPending ? 'Saving...' : 'Save Credentials & Continue'}
              </Button>
            </CardContent>
          </Card>
        );

      case 2:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Step 2: Sync Phone Numbers
              </CardTitle>
              <CardDescription>
                Import your Dialpad phone numbers and assign them to departments for better organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium">Phone Numbers</h4>
                  <p className="text-sm text-muted-foreground">
                    {typedPhoneNumbers.length} phone numbers currently synced
                  </p>
                </div>
                <Button
                  onClick={() => syncPhoneNumbersMutation.mutate()}
                  disabled={syncPhoneNumbersMutation.isPending}
                  variant="outline"
                  size="sm"
                  data-testid="button-sync-phone-numbers"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {syncPhoneNumbersMutation.isPending ? 'Syncing...' : 'Sync from Dialpad'}
                </Button>
              </div>

              {phoneNumbersLoading ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                  <p className="text-sm text-muted-foreground mt-2">Loading phone numbers...</p>
                </div>
              ) : typedPhoneNumbers.length > 0 ? (
                <div className="space-y-3">
                  {typedPhoneNumbers.map((phoneNumber: DialpadPhoneNumber) => (
                    <Card key={phoneNumber.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded-lg">
                            <Phone className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium">{phoneNumber.phoneNumber}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {phoneNumber.canSendSms && (
                                <Badge variant="outline" className="text-xs">
                                  <MessageSquare className="h-3 w-3 mr-1" />
                                  SMS
                                </Badge>
                              )}
                              {phoneNumber.canMakeCalls && (
                                <Badge variant="outline" className="text-xs">
                                  <PhoneCall className="h-3 w-3 mr-1" />
                                  Calls
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs">Department</Label>
                            <Select
                              value={phoneNumberDepartments[phoneNumber.id] || phoneNumber.department || 'none'}
                              onValueChange={(value) => handlePhoneNumberUpdate(phoneNumber.id, 'department', value === 'none' ? '' : value)}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {departments.map((dept) => (
                                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No phone numbers found. Click "Sync from Dialpad" to import your phone numbers.
                  </AlertDescription>
                </Alert>
              )}

              {typedPhoneNumbers.length > 0 && (
                <Button 
                  onClick={() => setCurrentStep(3)}
                  className="w-full"
                  data-testid="button-continue-final"
                >
                  Continue to Final Setup
                </Button>
              )}
            </CardContent>
          </Card>
        );

      case 3:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                {typedIntegrationStatus?.isEnabled ? 'Configuration Complete' : 'Step 3: Complete Setup'}
              </CardTitle>
              <CardDescription>
                {typedIntegrationStatus?.isEnabled 
                  ? 'Your Dialpad integration is active and configured.'
                  : 'Review your configuration and enable the Dialpad integration for your CRM.'
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span>Phone Numbers Configured</span>
                  <Badge>{typedPhoneNumbers.length}</Badge>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span>Calling Capability</span>
                  <Badge variant={typedPhoneNumbers.some((pn: DialpadPhoneNumber) => pn.canMakeCalls) ? "default" : "secondary"}>
                    {typedPhoneNumbers.some((pn: DialpadPhoneNumber) => pn.canMakeCalls) ? "Enabled" : "Not Available"}
                  </Badge>
                </div>
              </div>

              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Your Dialpad integration is ready! Users will only be able to send SMS or make calls from phone numbers they have permissions for.
                </AlertDescription>
              </Alert>

              <Separator />

              {/* Organization Default Phone Number Section */}
              <DefaultPhoneNumberSection phoneNumbers={typedPhoneNumbers} />

              <Separator />

              <DialpadWebhookConfig />

              {!typedIntegrationStatus?.isEnabled ? (
                <Button 
                  onClick={() => enableIntegrationMutation.mutate()}
                  disabled={enableIntegrationMutation.isPending}
                  className="w-full"
                  data-testid="button-enable-dialpad"
                >
                  {enableIntegrationMutation.isPending ? 'Enabling...' : 'Enable Dialpad Integration'}
                </Button>
              ) : (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your Dialpad integration is active! You can modify phone number assignments and user permissions above.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  const stepTitles = [
    'API Configuration',
    'Phone Numbers',
    typedIntegrationStatus?.isEnabled ? 'Management' : 'Complete Setup'
  ];

  return (
    <div className="space-y-6">
      {/* Progress Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Enhanced Dialpad Setup</h3>
          <Badge variant="outline">Step {currentStep} of 3</Badge>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>{typedIntegrationStatus?.isEnabled ? 'Configuration Status' : 'Setup Progress'}</span>
            <span>{typedIntegrationStatus?.isEnabled ? 'Active' : `${Math.round((currentStep / 3) * 100)}%`}</span>
          </div>
          <Progress value={typedIntegrationStatus?.isEnabled ? 100 : (currentStep / 3) * 100} className="h-2" />
        </div>

        <div className="flex items-center gap-4 text-sm">
          {stepTitles.map((title, index) => (
            <div key={index} className={`flex items-center gap-2 ${
              index + 1 === currentStep ? 'text-primary font-medium' : 
              index + 1 < currentStep ? 'text-muted-foreground' : 'text-muted-foreground'
            }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                index + 1 === currentStep ? 'bg-primary text-primary-foreground' :
                index + 1 < currentStep ? 'bg-muted' : 'bg-muted'
              }`}>
                {index + 1 < currentStep ? <CheckCircle className="h-3 w-3" /> : index + 1}
              </div>
              <span className="hidden sm:inline">{title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      {renderStepContent()}
    </div>
  );
}