import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Webhook, Copy, Eye, EyeOff, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WebhooksTabProps {
  webhookLoading: boolean;
  webhookConfig: {
    apiKey: string;
    webhooks: {
      leads: { url: string; documentation: any };
      estimates: { url: string; documentation: any };
    };
    webhookUrl?: string;
    documentation?: any;
  } | undefined;
}

export function WebhooksTab({ webhookLoading, webhookConfig }: WebhooksTabProps) {
  const { toast } = useToast();
  const [selectedWebhook, setSelectedWebhook] = useState<'leads' | 'estimates' | 'jobs'>('leads');
  const [showApiKey, setShowApiKey] = useState(false);

  return (
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
            <CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" />Webhook Configuration</CardTitle>
            <CardDescription>Push leads, estimates, and jobs from external sources like Zapier</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
              <Button variant={selectedWebhook === 'leads' ? 'default' : 'ghost'} size="sm" onClick={() => setSelectedWebhook('leads')} data-testid="button-webhook-leads">Leads Webhook</Button>
              <Button variant={selectedWebhook === 'estimates' ? 'default' : 'ghost'} size="sm" onClick={() => setSelectedWebhook('estimates')} data-testid="button-webhook-estimates">Estimates Webhook</Button>
              <Button variant={selectedWebhook === 'jobs' ? 'default' : 'ghost'} size="sm" onClick={() => setSelectedWebhook('jobs')} data-testid="button-webhook-jobs">Jobs Webhook</Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-url" className="text-sm font-medium">Webhook URL</Label>
              <div className="flex gap-2">
                <Input id="webhook-url" value={webhookConfig?.webhooks?.[selectedWebhook as "leads" | "estimates"]?.url || webhookConfig?.webhookUrl || ''} readOnly data-testid="input-webhook-url" />
                <Button variant="outline" size="icon" onClick={() => {
                  const url = webhookConfig?.webhooks?.[selectedWebhook as "leads" | "estimates"]?.url || webhookConfig?.webhookUrl;
                  if (url) { navigator.clipboard.writeText(url); toast({ title: "Copied", description: "Webhook URL copied to clipboard" }); }
                }} data-testid="button-copy-webhook-url"><Copy className="h-4 w-4" /></Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-sm font-medium">API Key</Label>
              <div className="flex gap-2">
                <Input id="api-key" type={showApiKey ? "text" : "password"} value={webhookConfig?.apiKey || ''} readOnly data-testid="input-api-key" />
                <Button variant="outline" size="icon" onClick={() => setShowApiKey(!showApiKey)} data-testid="button-toggle-api-key">
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={() => {
                  if (webhookConfig?.apiKey) { navigator.clipboard.writeText(webhookConfig.apiKey); toast({ title: "Copied", description: "API key copied to clipboard" }); }
                }} data-testid="button-copy-api-key"><Copy className="h-4 w-4" /></Button>
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
              const currentDoc = webhookConfig?.webhooks?.[selectedWebhook as "leads" | "estimates"]?.documentation || webhookConfig?.documentation;
              if (!currentDoc) return null;
              return (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">Documentation</h3>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">HTTP Method</h4>
                    <div className="p-2 bg-muted rounded"><p className="font-mono text-sm font-semibold">{currentDoc.method}</p></div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Required Headers</h4>
                    <div className="p-3 bg-muted rounded font-mono text-xs space-y-1">
                      {Object.entries(currentDoc.headers).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <span className="text-primary font-semibold">{key}:</span>
                          <span>{key.toLowerCase() === 'x-api-key' ? (showApiKey ? String(value) : '•'.repeat(Math.min(String(value).length, 64))) : String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Required Fields</h4>
                    <div className="flex flex-wrap gap-2">
                      {currentDoc.requiredFields.map((field: string) => <Badge key={field} variant="default" className="text-xs font-medium">{field}</Badge>)}
                    </div>
                  </div>
                  {currentDoc.optionalFields?.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Optional Fields</h4>
                      <div className="flex flex-wrap gap-2">
                        {currentDoc.optionalFields.map((field: string) => <Badge key={field} variant="secondary" className="text-xs font-medium">{field}</Badge>)}
                      </div>
                    </div>
                  )}
                  {selectedWebhook === 'leads' && currentDoc.phoneNormalization && (
                    <Alert><Info className="h-4 w-4" /><AlertDescription className="text-sm"><strong>Phone Normalization:</strong> {currentDoc.phoneNormalization}</AlertDescription></Alert>
                  )}
                  {selectedWebhook === 'leads' && currentDoc.multipleContacts && (
                    <Alert><Info className="h-4 w-4" /><AlertDescription className="text-sm"><strong>Multiple Contacts:</strong> {currentDoc.multipleContacts}</AlertDescription></Alert>
                  )}
                  {currentDoc.example && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-muted-foreground">Example Request Body</h4>
                      <div className="p-3 bg-muted rounded"><pre className="font-mono text-xs overflow-x-auto">{JSON.stringify(currentDoc.example, null, 2)}</pre></div>
                    </div>
                  )}
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
  );
}
