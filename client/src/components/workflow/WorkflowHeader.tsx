import { Link } from "wouter";
import { Plus, Save, Trash2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WorkflowTemplates } from "@/components/workflow/WorkflowTemplates";
import { WorkflowTestDialog } from "@/components/workflow/WorkflowTestDialog";
import { WorkflowTemplate } from "@/data/workflow-templates";
import type { Workflow, WorkflowApprovalStatus } from "@/types/workflow";

type WorkflowHeaderProps = {
  workflowId: string | undefined;
  workflowName: string;
  setWorkflowName: (name: string) => void;
  workflow: Workflow | undefined;
  creator: { id: string; name: string; email: string } | undefined;
  isDirty: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: () => void;
  onDelete: () => void;
  onToggleActive: (isActive: boolean) => void;
  onNewWorkflow: () => void;
  onSelectTemplate: (template: WorkflowTemplate) => void;
};

function getApprovalStatusBadge(status: WorkflowApprovalStatus) {
  switch (status) {
    case 'approved':
      return <Badge variant="default" data-testid="badge-workflow-approved">Approved</Badge>;
    case 'pending_approval':
      return <Badge variant="secondary" data-testid="badge-workflow-pending">Pending Approval</Badge>;
    case 'rejected':
      return <Badge variant="destructive" data-testid="badge-workflow-rejected">Rejected</Badge>;
    default:
      return null;
  }
}

export function WorkflowHeader({
  workflowId,
  workflowName,
  setWorkflowName,
  workflow,
  creator,
  isDirty,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
  onToggleActive,
  onNewWorkflow,
  onSelectTemplate,
}: WorkflowHeaderProps) {
  return (
    <div className="flex flex-col gap-3 p-4 border-b">
      {/* Row 1: Back button + Workflow Name */}
      <div className="flex items-center gap-4">
        <Link href="/workflows/manage">
          <Button
            variant="ghost"
            size="icon"
            data-testid="button-back-to-workflows"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Input
          type="text"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="text-2xl font-bold h-auto border-0 px-2 py-1 focus-visible:ring-1 max-w-md"
          placeholder="Workflow Name"
          data-testid="input-workflow-name"
        />
      </div>

      {/* Row 2: Action Buttons */}
      <div className="flex items-center gap-2 ml-14">
        <WorkflowTemplates onSelectTemplate={onSelectTemplate} />
        
        <Button
          variant="outline"
          size="default"
          data-testid="button-new-workflow"
          onClick={onNewWorkflow}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Workflow
        </Button>
        
        <WorkflowTestDialog 
          workflowId={workflowId} 
          disabled={!workflowId || (!!workflow && workflow.approvalStatus !== 'approved')} 
          unapprovedMessage={workflow && workflow.approvalStatus !== 'approved' ? 'Workflow must be approved before testing' : undefined}
        />
        
        <AlertDialog>
          <AlertDialogTrigger asChild>
            {workflowId ? (
              <Button
                variant="outline"
                size="default"
                data-testid="button-delete-workflow"
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            ) : null}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this workflow? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        
        {isDirty && (
          <Badge variant="outline" className="border-yellow-500 text-yellow-600 dark:text-yellow-400 no-default-active-elevate">
            Unsaved changes
          </Badge>
        )}
        <Button
          variant="default"
          size="default"
          data-testid="button-save-workflow"
          onClick={onSave}
          disabled={isSaving}
        >
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Row 3: Created by + Approval Badge + Active Toggle */}
      {creator && (
        <div className="flex items-center gap-3 ml-14 text-sm text-muted-foreground">
          <span>Created by:</span>
          <span className="font-medium">{creator.name}</span>
          {workflow && getApprovalStatusBadge(workflow.approvalStatus)}
          
          {workflow && workflow.approvalStatus === 'approved' && (
            <div className="flex items-center gap-2 ml-4 border-l pl-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch 
                      id="workflow-active"
                      checked={workflow.isActive}
                      onCheckedChange={onToggleActive}
                      disabled={isDirty}
                      data-testid="switch-workflow-active"
                    />
                  </span>
                </TooltipTrigger>
                {isDirty && (
                  <TooltipContent>
                    <p>Save your changes before activating</p>
                  </TooltipContent>
                )}
              </Tooltip>
              <Label htmlFor="workflow-active" className={isDirty ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}>
                {workflow.isActive ? 'Active' : 'Inactive'}
              </Label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
