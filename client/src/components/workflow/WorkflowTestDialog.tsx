import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { Play, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';

type WorkflowTestDialogProps = {
  workflowId?: string;
  disabled?: boolean;
  unapprovedMessage?: string;
};

export function WorkflowTestDialog({ workflowId, disabled, unapprovedMessage }: WorkflowTestDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerType, setTriggerType] = useState<'manual' | 'entity_event' | 'time_based'>('manual');
  const [testData, setTestData] = useState('{\n  "entityId": 1,\n  "entityType": "lead"\n}');
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const { toast } = useToast();

  const handleTest = async () => {
    if (!workflowId) {
      toast({
        title: 'Error',
        description: 'Please save the workflow before testing',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      // Parse the test data
      let triggerData;
      try {
        triggerData = JSON.parse(testData);
      } catch (e) {
        throw new Error('Invalid JSON format in test data');
      }

      // Trigger the workflow
      await apiRequest('POST', `/api/workflows/${workflowId}/execute`, {
        triggerData,
      });

      setTestResult({
        success: true,
        message: 'Workflow execution started successfully. Check the execution logs for results.',
      });

      toast({
        title: 'Test Started',
        description: 'Workflow is now running in test mode',
      });

      // Invalidate executions cache to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/workflows', workflowId, 'executions'] });

      // Close dialog after brief delay
      setTimeout(() => {
        setIsOpen(false);
        setTestResult(null);
      }, 2000);
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Failed to start workflow execution',
      });

      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to start workflow execution',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" tabIndex={disabled ? 0 : undefined}>
            <DialogTrigger asChild disabled={disabled}>
              <Button
                variant="outline"
                size="default"
                disabled={disabled}
                data-testid="button-test-workflow"
              >
                <Play className="h-4 w-4 mr-2" />
                Test
              </Button>
            </DialogTrigger>
          </span>
        </TooltipTrigger>
        {unapprovedMessage && disabled && (
          <TooltipContent data-testid="tooltip-test-disabled">
            <p>{unapprovedMessage}</p>
          </TooltipContent>
        )}
      </Tooltip>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Test Workflow</DialogTitle>
          <DialogDescription>
            Manually trigger this workflow with sample data to test its execution
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="trigger-type">Trigger Type</Label>
            <Select
              value={triggerType}
              onValueChange={(value) => setTriggerType(value as any)}
            >
              <SelectTrigger id="trigger-type" data-testid="select-trigger-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Trigger</SelectItem>
                <SelectItem value="entity_event">Entity Event</SelectItem>
                <SelectItem value="time_based">Time Based</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-data">Test Data (JSON)</Label>
            <Textarea
              id="test-data"
              value={testData}
              onChange={(e) => setTestData(e.target.value)}
              placeholder='{\n  "entityId": 1,\n  "entityType": "lead"\n}'
              className="font-mono text-sm min-h-[200px]"
              data-testid="textarea-test-data"
            />
            <p className="text-xs text-muted-foreground">
              Provide sample data that will be available to workflow steps (e.g., lead data, estimate data)
            </p>
          </div>

          {testResult && (
            <Alert variant={testResult.success ? 'default' : 'destructive'}>
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                )}
                <AlertDescription>{testResult.message}</AlertDescription>
              </div>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isLoading}
            data-testid="button-cancel-test"
          >
            Cancel
          </Button>
          <Button
            onClick={handleTest}
            disabled={isLoading || !workflowId}
            data-testid="button-run-test"
          >
            {isLoading ? 'Running...' : 'Run Test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
