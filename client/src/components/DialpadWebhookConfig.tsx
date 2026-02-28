import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MessageSquare, Copy, ExternalLink, CheckCircle2, Info, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

interface WebhookConfig {
  webhookUrl: string;
  apiKey: string | null;
  service: string;
  documentation: {
    title: string;
    description: string;
    setupInstructions: string[];
    webhookUrl: string;
    expectedPayload: Record<string, string>;
    requiredFields?: string[];
    optionalFields?: Record<string, string>;
  };
}

export function DialpadWebhookConfig() {
  const { toast } = useToast();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const { data: webhookConfig, isLoading, error } = useQuery<WebhookConfig>({
    queryKey: ['/api/dialpad-webhook-config'],
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache
  });

  const handleCopyUrl = async () => {
    if (!webhookConfig?.webhookUrl) return;
    
    try {
      await navigator.clipboard.writeText(webhookConfig.webhookUrl);
      setCopiedUrl(true);
      toast({
        title: "Copied!",
        description: "Webhook URL copied to clipboard",
      });
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the URL manually",
        variant: "destructive",
      });
    }
  };

  const handleCopyApiKey = async () => {
    if (!webhookConfig?.apiKey) return;
    
    try {
      await navigator.clipboard.writeText(webhookConfig.apiKey);
      setCopiedApiKey(true);
      toast({
        title: "Copied!",
        description: "API key copied to clipboard",
      });
      setTimeout(() => setCopiedApiKey(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the API key manually",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Webhook Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading webhook configuration...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !webhookConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Webhook Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load webhook configuration. Please refresh the page or contact support if the issue persists.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          How to Configure Dialpad SMS Webhook
        </CardTitle>
        <CardDescription>
          This webhook URL is specific to your company and automatically configured when you enable Dialpad integration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>Automatic Setup:</strong> When you enable Dialpad integration, a tenant-specific webhook is automatically created in Dialpad. This ensures incoming SMS messages are correctly routed to your CRM.
          </AlertDescription>
        </Alert>

        {/* HTTP Request Section */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Your Webhook URL</h4>
            <div className="flex gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                <span className="text-primary font-semibold">POST</span> {webhookConfig.webhookUrl}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyUrl}
                data-testid="button-copy-webhook-url"
              >
                {copiedUrl ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Your API Key</h4>
            <p className="text-xs text-muted-foreground">
              Include this API key in the x-api-key header for authentication
            </p>
            <div className="flex gap-2">
              <div className="flex-1 p-3 bg-muted rounded-md font-mono text-sm break-all">
                {webhookConfig.apiKey 
                  ? (showApiKey ? webhookConfig.apiKey : '•'.repeat(Math.min(webhookConfig.apiKey.length, 64)))
                  : 'No API key generated'
                }
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowApiKey(!showApiKey)}
                data-testid="button-toggle-api-key"
                disabled={!webhookConfig.apiKey}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyApiKey}
                data-testid="button-copy-api-key"
                disabled={!webhookConfig.apiKey}
              >
                {copiedApiKey ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Headers Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Required Headers</h4>
          <div className="space-y-2">
            <div className="p-3 bg-muted rounded-md font-mono text-xs space-y-1">
              <div className="flex gap-2">
                <span className="text-primary">Content-Type:</span>
                <span>application/json</span>
              </div>
              <div className="flex gap-2">
                <span className="text-primary">x-api-key:</span>
                <span className="text-muted-foreground">
                  {webhookConfig.apiKey 
                    ? (showApiKey ? webhookConfig.apiKey : '•'.repeat(Math.min(webhookConfig.apiKey.length, 64)))
                    : '[your-api-key]'
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Expected Payload Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Expected Payload</h4>
          <div className="p-3 bg-muted rounded-md">
            <pre className="font-mono text-xs overflow-x-auto">
{`{
  "text": "Message content",
  "from_number": "+15551234567",
  "to_number": "+15559876543",
  "sms_id": "unique-message-id",
  "timestamp": "2024-01-15T10:30:00Z"
}`}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> Include <code className="px-1 py-0.5 bg-muted rounded">sms_id</code> for proper deduplication when using Zapier or other webhook sources.
          </p>
        </div>

        <Separator />

        {/* Setup Instructions */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">How It Works</h4>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>When you enable Dialpad integration, a webhook is automatically created in your Dialpad account</li>
            <li>The webhook is configured to listen for incoming SMS messages</li>
            <li>Each company gets a unique webhook URL to ensure proper message routing</li>
            <li>Incoming messages are automatically matched to leads or customers in your CRM</li>
            <li>Messages appear in real-time in the messaging interface</li>
          </ol>
        </div>

        {/* Integration Tips */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-semibold">Integration Tips:</p>
              <ul className="space-y-1 text-sm list-disc list-inside ml-2">
                <li>Your tenant-specific webhook URL ensures messages are routed only to your CRM</li>
                <li>The webhook is automatically created when you enable Dialpad integration</li>
                <li>Phone numbers are normalized to E.164 format for matching</li>
                <li>Messages appear in real-time in the CRM messaging interface</li>
                <li>Test by sending an SMS to one of your Dialpad numbers</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>

        {/* Testing Alert */}
        <Alert>
          <AlertDescription>
            <strong>Testing:</strong> Send a test SMS to one of your Dialpad numbers. The message should appear in the CRM under the matching lead or customer within seconds.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
