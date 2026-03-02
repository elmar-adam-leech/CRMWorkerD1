import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { Plus, Save, AlertCircle, ExternalLink, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useToast } from "@/hooks/use-toast";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";
import NodePalette from "@/components/workflow/NodePalette";
import NodeEditDialog from "@/components/workflow/NodeEditDialog";
import { WorkflowTemplates } from "@/components/workflow/WorkflowTemplates";
import { WorkflowTestDialog } from "@/components/workflow/WorkflowTestDialog";
import { WorkflowTemplate } from "@/data/workflow-templates";
import { Node, Edge } from 'reactflow';
import { queryClient, apiRequest } from "@/lib/queryClient";

type WorkflowApprovalStatus = "approved" | "pending_approval" | "rejected";

type Workflow = {
  id: string;
  contractorId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: string;
  approvalStatus: WorkflowApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export default function WorkflowBuilder() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Track workflow ID in state to handle navigation updates
  const [workflowId, setWorkflowId] = useState<string | undefined>(params.id);
  
  // Update workflowId when params change
  useEffect(() => {
    setWorkflowId(params.id);
    // Reset dirty state when switching workflows
    isInitialized.current = false;
    setIsDirty(false);
  }, [params.id]);

  const [templateNodes, setTemplateNodes] = useState<Node[] | undefined>();
  const [templateEdges, setTemplateEdges] = useState<Edge[] | undefined>();
  const [currentNodes, setCurrentNodes] = useState<Node[]>([]);
  const [currentEdges, setCurrentEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState<string>('New Workflow');
  const [isDirty, setIsDirty] = useState(false);
  const isInitialized = useRef(false);

  // Fetch existing workflow if editing
  const { data: workflow, isLoading: workflowLoading } = useQuery<Workflow>({
    queryKey: ['/api/workflows', workflowId],
    queryFn: async () => {
      if (!workflowId) throw new Error('No workflow ID');
      const response = await fetch(`/api/workflows/${workflowId}`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return await response.json();
    },
    enabled: !!workflowId,
  });

  // Fetch workflow steps if editing existing workflow
  const { data: workflowSteps, isLoading: stepsLoading } = useQuery<any[]>({
    queryKey: ['/api/workflows', workflowId, 'steps'],
    queryFn: async () => {
      if (!workflowId) return [];
      const response = await fetch(`/api/workflows/${workflowId}/steps`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return await response.json();
    },
    enabled: !!workflowId,
  });

  // Fetch creator user details
  const { data: creator } = useQuery<{ id: string; name: string; email: string }>({
    queryKey: ['/api/users', workflow?.createdBy],
    queryFn: async () => {
      if (!workflow?.createdBy) throw new Error('No creator ID');
      const response = await fetch(`/api/users/${workflow.createdBy}`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }
      return await response.json();
    },
    enabled: !!workflow?.createdBy,
  });

  // Convert workflow steps to React Flow nodes and edges when loaded
  useEffect(() => {
    if (!workflow && !workflowSteps) return;
    
    const nodes: Node[] = [];
    
    // First, add trigger node if workflow has trigger configuration
    if (workflow?.triggerType) {
      const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};
      const triggerLabel = getTriggerLabel(workflow.triggerType, triggerConfig);
      
      // Normalize field names: backend uses 'entity' but frontend form uses 'entityType'
      // Also preserve eventType field for proper form population
      const normalizedConfig = {
        ...triggerConfig,
        entityType: triggerConfig.entity || triggerConfig.entityType || 'lead',
        eventType: triggerConfig.event || triggerConfig.eventType || 'created',
      };
      
      nodes.push({
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 250, y: 50 },
        data: {
          label: triggerLabel,
          triggerType: workflow.triggerType === 'entity_created' || workflow.triggerType === 'entity_updated' 
            ? 'entity_event' 
            : workflow.triggerType,
          ...normalizedConfig
        },
      });
    }
    
    // Then add action nodes from workflow steps
    if (workflowSteps && workflowSteps.length > 0) {
      workflowSteps.forEach((step) => {
        const config = JSON.parse(step.actionConfig);
        nodes.push({
          id: config.nodeId || `node-${step.id}`,
          type: mapActionTypeToNodeType(step.actionType),
          position: config.position || { x: 100, y: 100 },
          data: config.data || {},
        });
      });
    }

    // Collect all edges from all steps' actionConfig
    const edgeSet = new Set<string>();
    const edges: Edge[] = [];
    
    if (workflowSteps && workflowSteps.length > 0) {
      workflowSteps.forEach((step) => {
        const config = JSON.parse(step.actionConfig);
        if (config.edges && Array.isArray(config.edges)) {
          config.edges.forEach((edge: Edge) => {
            // Include handles in the key to distinguish between different branches from same source
            const edgeKey = `${edge.source}-${edge.sourceHandle || 'default'}-${edge.target}-${edge.targetHandle || 'default'}`;
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              edges.push({
                id: edge.id || `edge-${edge.source}-${edge.target}`,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle || undefined,
                targetHandle: edge.targetHandle || undefined,
                label: edge.label || undefined,
                type: edge.type || undefined,
                animated: edge.animated || undefined,
              });
            }
          });
        }
      });
    }

    if (nodes.length > 0) {
      setCurrentNodes(nodes);
      setCurrentEdges(edges);
      setTemplateNodes(nodes);
      setTemplateEdges(edges);
      // Mark as initialized so subsequent changes are tracked as dirty
      setTimeout(() => { isInitialized.current = true; }, 0);
    }
  }, [workflow, workflowSteps]);

  // Helper to generate trigger label from trigger type and config
  const getTriggerLabel = (triggerType: string, triggerConfig: any): string => {
    if (triggerType === 'entity_created' || triggerType === 'entity_event') {
      const entity = triggerConfig.entity || 'lead';
      return `When ${entity.charAt(0).toUpperCase() + entity.slice(1)} is Created`;
    } else if (triggerType === 'entity_updated') {
      const entity = triggerConfig.entity || 'lead';
      return `When ${entity.charAt(0).toUpperCase() + entity.slice(1)} is Updated`;
    } else if (triggerType === 'time_based') {
      return 'Time-based Trigger';
    } else if (triggerType === 'manual') {
      return 'Manual Trigger';
    }
    return 'New Trigger';
  };

  // Sync workflow name when workflow loads
  useEffect(() => {
    if (workflow?.name) {
      setWorkflowName(workflow.name);
    }
  }, [workflow]);

  // Track unsaved changes — only after the canvas has been initialized from the DB
  useEffect(() => {
    if (isInitialized.current) {
      setIsDirty(true);
    }
  }, [currentNodes, currentEdges]);

  const mapActionTypeToNodeType = (actionType: string): string => {
    const mapping: Record<string, string> = {
      'trigger': 'trigger',
      'send_email': 'sendEmail',
      'send_sms': 'sendSMS',
      'create_notification': 'notification',
      'update_entity': 'notification', // Legacy support: map to notification
      'assign_user': 'assignUser',
      'ai_generate': 'aiGenerate',
      'ai_analyze': 'aiAnalyze',
      'conditional': 'conditional',
      'delay': 'delay',
      'wait_until': 'waitUntil',
    };
    return mapping[actionType] || 'notification';
  };

  // Save workflow mutation
  const saveWorkflowMutation = useMutation({
    mutationFn: async () => {
      // If no workflow ID, create a new workflow first
      if (!workflowId) {
        // Find trigger node to extract trigger configuration
        const triggerNode = currentNodes.find(node => node.type === 'trigger');
        const triggerData = triggerNode?.data || {};
        
        // Determine trigger type from node data
        let triggerType = triggerData.triggerType || 'manual';
        let triggerConfig: any = {};
        
        // For entity event triggers, extract entityType and eventType from node data
        if (triggerType === 'entity_event') {
          const entityType = triggerData.entityType || 'lead';
          const eventType = triggerData.event || triggerData.eventType || 'created';
          
          // Map to the legacy entity_created/entity_updated types if applicable
          if (eventType === 'created') {
            triggerType = 'entity_created';
            triggerConfig = { 
              entity: entityType, 
              event: 'created',
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          } else if (eventType === 'updated') {
            triggerType = 'entity_updated';
            triggerConfig = { 
              entity: entityType, 
              event: 'updated',
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          } else {
            // For other event types, use entity_event
            triggerConfig = { 
              entity: entityType, 
              event: eventType,
              ...(triggerData.statusValue && { targetStatus: triggerData.statusValue }),
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          }
        } else if (triggerType === 'entity_created' || triggerType === 'entity_updated') {
          // For direct entity_created/entity_updated triggers, extract entity from node data
          const entityType = triggerData.entity || triggerData.entityType || 'lead';
          const eventType = triggerType === 'entity_created' ? 'created' : 'updated';
          triggerConfig = { 
            entity: entityType, 
            event: eventType,
            ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
          };
        } else if (triggerType === 'time_based') {
          triggerConfig = {
            schedule: triggerData.schedule || 'daily',
            time: triggerData.time || '09:00'
          };
        } else {
          // Manual trigger or default
          triggerConfig = { entity: 'lead' };
        }
        
        // Create new workflow
        const workflowData = {
          name: workflowName,
          description: 'Created in workflow builder',
          isActive: false,
          triggerType,
          triggerConfig: JSON.stringify(triggerConfig),
        };

        const response = await apiRequest('POST', '/api/workflows', workflowData);
        const newWorkflow = await response.json() as Workflow;

        // Save steps for new workflow
        await saveWorkflowSteps(newWorkflow.id);
        return newWorkflow;
      } else {
        // Update existing workflow - extract trigger configuration just like for new workflows
        const triggerNode = currentNodes.find(node => node.type === 'trigger');
        const triggerData = triggerNode?.data || {};
        
        // Determine trigger type from node data
        let triggerType = triggerData.triggerType || 'manual';
        let triggerConfig: any = {};
        
        // For entity event triggers, extract entityType and eventType from node data
        if (triggerType === 'entity_event') {
          const entityType = triggerData.entityType || triggerData.entity || 'lead';
          const eventType = triggerData.event || triggerData.eventType || 'created';
          
          // Map to the legacy entity_created/entity_updated types if applicable
          if (eventType === 'created') {
            triggerType = 'entity_created';
            triggerConfig = { 
              entity: entityType, 
              event: 'created',
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          } else if (eventType === 'updated') {
            triggerType = 'entity_updated';
            triggerConfig = { 
              entity: entityType, 
              event: 'updated',
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          } else {
            // For other event types, use entity_event
            triggerConfig = { 
              entity: entityType, 
              event: eventType,
              ...(triggerData.statusValue && { targetStatus: triggerData.statusValue }),
              ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
            };
          }
        } else if (triggerType === 'entity_created' || triggerType === 'entity_updated') {
          // For direct entity_created/entity_updated triggers, extract entity from node data
          const entityType = triggerData.entity || triggerData.entityType || 'lead';
          const eventType = triggerType === 'entity_created' ? 'created' : 'updated';
          triggerConfig = { 
            entity: entityType, 
            event: eventType,
            ...(triggerData.tags && triggerData.tags.length > 0 && { tags: triggerData.tags })
          };
        } else if (triggerType === 'time_based') {
          triggerConfig = {
            schedule: triggerData.schedule || 'daily',
            time: triggerData.time || '09:00'
          };
        } else {
          // Manual trigger or default
          triggerConfig = { entity: triggerData.entity || triggerData.entityType || 'lead' };
        }
        
        // Update existing workflow with name and trigger configuration
        await apiRequest('PATCH', `/api/workflows/${workflowId}`, { 
          name: workflowName,
          triggerType,
          triggerConfig: JSON.stringify(triggerConfig)
        });
        
        // Update existing workflow steps
        await saveWorkflowSteps(workflowId);
        return workflow;
      }
    },
    onSuccess: (savedWorkflow) => {
      setIsDirty(false);
      toast({
        title: "Workflow saved",
        description: "Your workflow has been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      
      // Invalidate workflow steps to refetch after save (using array format to match query key)
      const wfId = workflowId || savedWorkflow?.id;
      if (wfId) {
        queryClient.invalidateQueries({ queryKey: ['/api/workflows', wfId, 'steps'] });
        queryClient.invalidateQueries({ queryKey: ['/api/workflows', wfId] });
      }
      
      // Navigate to the workflow edit page with the new ID if it was just created
      if (!workflowId && savedWorkflow) {
        // Update the workflowId state immediately before navigation
        setWorkflowId(savedWorkflow.id);
        setLocation(`/workflows/${savedWorkflow.id}/edit`);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving workflow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete workflow mutation
  const deleteWorkflowMutation = useMutation({
    mutationFn: async () => {
      if (!workflowId) throw new Error('No workflow to delete');
      await apiRequest('DELETE', `/api/workflows/${workflowId}`);
    },
    onSuccess: () => {
      toast({
        title: "Workflow deleted",
        description: "The workflow has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      setLocation('/workflows/manage');
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting workflow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle workflow active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      if (!workflowId) throw new Error('No workflow to toggle');
      await apiRequest('PATCH', `/api/workflows/${workflowId}`, { isActive });
    },
    onSuccess: (_, isActive) => {
      toast({
        title: isActive ? "Workflow activated" : "Workflow deactivated",
        description: isActive 
          ? "Your workflow is now active and will execute when triggered." 
          : "Your workflow has been deactivated.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows', workflowId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error toggling workflow",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveWorkflowSteps = async (wfId: string) => {
    if (!wfId || wfId === 'undefined') {
      throw new Error('Cannot save workflow steps: Invalid workflow ID');
    }

    // Build adjacency map from edges to preserve relationships
    const edgeMap = new Map<string, string[]>(); // nodeId -> child nodeIds
    currentEdges.forEach(edge => {
      if (!edgeMap.has(edge.source)) {
        edgeMap.set(edge.source, []);
      }
      edgeMap.get(edge.source)!.push(edge.target);
    });

    // Topological sort to get nodes in execution order
    const visited = new Set<string>();
    const sorted: Node[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = currentNodes.find(n => n.id === nodeId);
      if (!node) return;
      const children = edgeMap.get(nodeId) || [];
      children.forEach(visit);
      sorted.unshift(node);
    };

    // Find root nodes (nodes with no incoming edges)
    const targetNodes = new Set(currentEdges.map(e => e.target));
    const rootNodes = currentNodes.filter(n => !targetNodes.has(n.id));
    rootNodes.forEach(node => visit(node.id));

    // Add any unvisited nodes (disconnected components)
    currentNodes.forEach(node => {
      if (!visited.has(node.id)) sorted.push(node);
    });

    // Filter out trigger nodes — they're saved on the workflow itself, not as steps
    const actionNodes = sorted.filter(node => node.type !== 'trigger');

    // Build steps array with a temporary nodeId->index map for parentStepId resolution
    // Since we don't know final DB IDs yet, we'll pass parentStepId as null for now
    // and rely on stepOrder + edges stored in actionConfig for reconstruction
    const steps = actionNodes.map((node, i) => ({
      stepOrder: i,
      actionType: mapNodeTypeToActionType(node.type || 'notification'),
      actionConfig: JSON.stringify({
        nodeId: node.id,
        position: node.position,
        data: node.data,
        edges: currentEdges.filter(e => e.source === node.id || e.target === node.id),
      }),
      parentStepId: null as string | null,
    }));

    // Single PUT atomically replaces all steps
    const response = await fetch(`/api/workflows/${wfId}/steps`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ steps }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save workflow steps: ${errorText || response.statusText}`);
    }
  };

  const mapNodeTypeToActionType = (nodeType: string): string => {
    const mapping: Record<string, string> = {
      'trigger': 'trigger',
      'sendEmail': 'send_email',
      'sendSMS': 'send_sms',
      'notification': 'create_notification',
      'assignUser': 'assign_user',
      'aiGenerate': 'ai_generate',
      'aiAnalyze': 'ai_analyze',
      'conditional': 'conditional',
      'delay': 'delay',
      'waitUntil': 'wait_until',
    };
    return mapping[nodeType] || 'create_notification';
  };

  const handleSelectTemplate = (template: WorkflowTemplate) => {
    setTemplateNodes(template.nodes);
    setTemplateEdges(template.edges);
    setCurrentNodes(template.nodes);
    setCurrentEdges(template.edges);
  };

  const handleNewWorkflow = async () => {
    // Save current workflow if there are unsaved changes
    if (currentNodes.length > 0 && workflowId) {
      try {
        await saveWorkflowMutation.mutateAsync();
      } catch (error) {
        // If save fails, ask user if they want to continue
        if (!confirm('Failed to save current workflow. Continue anyway?')) {
          return;
        }
      }
    }

    // Reset to default state
    const defaultNodes: Node[] = [{
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 250, y: 50 },
      data: { label: 'When Lead is Created', triggerType: 'entity_created' },
    }];
    setTemplateNodes(defaultNodes);
    setTemplateEdges([]);
    setCurrentNodes(defaultNodes);
    setCurrentEdges([]);
    setLocation('/workflows/new');
  };

  const handleSave = () => {
    saveWorkflowMutation.mutate();
  };

  const handleDelete = () => {
    deleteWorkflowMutation.mutate();
  };

  const handleDragStart = useCallback((event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleNodeClick = useCallback((node: Node) => {
    // Find the trigger node to get entityType
    const triggerNode = currentNodes.find(n => n.type === 'trigger');
    const triggerEntityType = triggerNode?.data?.entityType || 'lead';
    
    // Add trigger's entityType to the node data so VariablePicker shows correct fields
    const nodeWithEntityType = {
      ...node,
      data: {
        ...node.data,
        entityType: triggerEntityType,
      }
    };
    
    setSelectedNode(nodeWithEntityType);
  }, [currentNodes]);

  const handleNodeSave = useCallback((nodeId: string, newData: any) => {
    setCurrentNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...newData } } : node
      )
    );
  }, []);
  
  const handleNodeDelete = useCallback((nodeId: string) => {
    // Find the node to delete
    const nodeToDelete = currentNodes.find(node => node.id === nodeId);
    
    // Prevent deleting trigger nodes
    if (nodeToDelete?.type === 'trigger') {
      alert('Cannot delete trigger node. Every workflow must have a trigger.');
      return;
    }
    
    // Remove the node and any connected edges
    setCurrentNodes(prevNodes => prevNodes.filter(node => node.id !== nodeId));
    setCurrentEdges(prevEdges => prevEdges.filter(edge => 
      edge.source !== nodeId && edge.target !== nodeId
    ));
    setSelectedNode(null);
  }, [currentNodes]);

  const getApprovalStatusBadge = (status: WorkflowApprovalStatus) => {
    switch (status) {
      case 'approved':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600" data-testid="badge-workflow-approved">Approved</Badge>;
      case 'pending_approval':
        return <Badge variant="secondary" data-testid="badge-workflow-pending">Pending Approval</Badge>;
      case 'rejected':
        return <Badge variant="destructive" data-testid="badge-workflow-rejected">Rejected</Badge>;
      default:
        return null;
    }
  };

  const showApprovalAlert = workflow && workflow.approvalStatus !== 'approved';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
          <WorkflowTemplates onSelectTemplate={handleSelectTemplate} />
          
          <Button
            variant="outline"
            size="default"
            data-testid="button-new-workflow"
            onClick={handleNewWorkflow}
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
                  disabled={deleteWorkflowMutation.isPending}
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
                  onClick={handleDelete}
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
            onClick={handleSave}
            disabled={saveWorkflowMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveWorkflowMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>

        {/* Row 3: Created by + Approval Badge + Active Toggle */}
        {creator && (
          <div className="flex items-center gap-3 ml-14 text-sm text-muted-foreground">
            <span>Created by:</span>
            <span className="font-medium">{creator.name}</span>
            {workflow && getApprovalStatusBadge(workflow.approvalStatus)}
            
            {/* Active/Inactive Toggle - Only show for approved workflows */}
            {workflow && workflow.approvalStatus === 'approved' && (
              <div className="flex items-center gap-2 ml-4 border-l pl-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Switch 
                        id="workflow-active"
                        checked={workflow.isActive}
                        onCheckedChange={(checked) => toggleActiveMutation.mutate(checked)}
                        disabled={toggleActiveMutation.isPending || isDirty}
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

      {/* Approval Status Alert */}
      {showApprovalAlert && (
        <Alert variant={workflow.approvalStatus === 'rejected' ? 'destructive' : 'default'} data-testid="alert-approval-status">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <div>
              {workflow.approvalStatus === 'pending_approval' && (
                <span>
                  This workflow is pending admin approval. You cannot activate it until it's approved.
                </span>
              )}
              {workflow.approvalStatus === 'rejected' && (
                <div className="space-y-1">
                  <div>This workflow has been rejected and cannot be activated.</div>
                  {workflow.rejectionReason && (
                    <div className="text-sm">
                      <strong>Reason:</strong> {workflow.rejectionReason}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Link href="/workflows/manage">
              <Button variant={workflow.approvalStatus === 'rejected' ? 'outline' : 'secondary'} size="sm" data-testid="button-view-approvals">
                View Approvals
                <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content - Node Palette + Canvas */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onDragStart={handleDragStart} />
        
        <div className="flex-1">
          {(workflowLoading || stepsLoading) ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground">Loading workflow...</div>
            </div>
          ) : (
            <WorkflowCanvas 
              initialNodes={currentNodes.length > 0 ? currentNodes : templateNodes} 
              initialEdges={currentEdges.length > 0 ? currentEdges : templateEdges}
              workflowId={workflowId}
              approvalStatus={workflow?.approvalStatus}
              onNodesChange={setCurrentNodes}
              onEdgesChange={setCurrentEdges}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>
      </div>

      {/* Node Edit Dialog */}
      <NodeEditDialog
        node={selectedNode}
        open={!!selectedNode}
        onClose={() => setSelectedNode(null)}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />
    </div>
  );
}
