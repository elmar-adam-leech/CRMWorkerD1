import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";
import NodePalette from "@/components/workflow/NodePalette";
import NodeEditDialog from "@/components/workflow/NodeEditDialog";
import { WorkflowHeader } from "@/components/workflow/WorkflowHeader";
import { WorkflowStatusAlert } from "@/components/workflow/WorkflowStatusAlert";
import { WorkflowTemplate } from "@/data/workflow-templates";
import { Node, Edge } from 'reactflow';
import { queryClient, apiRequest } from "@/lib/queryClient";
import { extractTriggerConfig, NODE_TO_ACTION, ACTION_TO_NODE } from "@/lib/workflow-utils";
import type { Workflow } from "@/types/workflow";

export default function WorkflowBuilder() {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [workflowId, setWorkflowId] = useState<string | undefined>(params.id);
  
  useEffect(() => {
    setWorkflowId(params.id);
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
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const isInitialized = useRef(false);

  const { data: workflow, isLoading: workflowLoading } = useQuery<Workflow>({
    queryKey: ['/api/workflows', workflowId],
    queryFn: async () => {
      if (!workflowId) throw new Error('No workflow ID');
      const response = await fetch(`/api/workflows/${workflowId}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return await response.json();
    },
    enabled: !!workflowId,
  });

  type RawWorkflowStep = { id: string; stepOrder: number; actionType: string; actionConfig: string; parentStepId: string | null };

  const { data: workflowSteps, isLoading: stepsLoading } = useQuery<RawWorkflowStep[]>({
    queryKey: ['/api/workflows', workflowId, 'steps'],
    queryFn: async () => {
      if (!workflowId) return [];
      const response = await fetch(`/api/workflows/${workflowId}/steps`, { credentials: 'include' });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return await response.json();
    },
    enabled: !!workflowId,
  });

  const { data: creator } = useQuery<{ id: string; name: string; email: string }>({
    queryKey: ['/api/users', workflow?.createdBy],
    queryFn: async () => {
      if (!workflow?.createdBy) throw new Error('No creator ID');
      const response = await fetch(`/api/users/${workflow.createdBy}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`${response.status}: ${response.statusText}`);
      return await response.json();
    },
    enabled: !!workflow?.createdBy,
  });

  // Convert workflow steps to React Flow nodes and edges when loaded
  useEffect(() => {
    if (!workflow && !workflowSteps) return;
    
    const nodes: Node[] = [];
    
    if (workflow?.triggerType) {
      const triggerConfig = workflow.triggerConfig ? JSON.parse(workflow.triggerConfig) : {};
      const triggerLabel = getTriggerLabel(workflow.triggerType, triggerConfig);
      
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
    
    if (workflowSteps && workflowSteps.length > 0) {
      workflowSteps.forEach((step) => {
        const config = JSON.parse(step.actionConfig);
        nodes.push({
          id: config.nodeId || `node-${step.id}`,
          type: ACTION_TO_NODE[step.actionType] ?? 'notification',
          position: config.position || { x: 100, y: 100 },
          data: config.data || {},
        });
      });
    }

    const edgeSet = new Set<string>();
    const edges: Edge[] = [];
    
    if (workflowSteps && workflowSteps.length > 0) {
      workflowSteps.forEach((step) => {
        const config = JSON.parse(step.actionConfig);
        if (config.edges && Array.isArray(config.edges)) {
          config.edges.forEach((edge: Edge) => {
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
      isInitialized.current = true;
    }
  }, [workflow, workflowSteps]);

  const getTriggerLabel = (triggerType: string, triggerConfig: Record<string, unknown>): string => {
    const entity = String(triggerConfig.entity || 'lead');
    const entityLabel = entity.charAt(0).toUpperCase() + entity.slice(1);
    const event = String(triggerConfig.event || '');

    if (event === 'status_changed') {
      const target = triggerConfig.targetStatus ? ` to ${String(triggerConfig.targetStatus).replace(/_/g, ' ')}` : '';
      return `When ${entityLabel} Status Changes${target}`;
    } else if (triggerType === 'entity_created' || (triggerType === 'entity_event' && event === 'created')) {
      return `When ${entityLabel} is Created`;
    } else if (triggerType === 'entity_updated' || (triggerType === 'entity_event' && event === 'updated')) {
      return `When ${entityLabel} is Updated`;
    } else if (triggerType === 'entity_event' && event === 'deleted') {
      return `When ${entityLabel} is Deleted`;
    } else if (triggerType === 'entity_event') {
      return `When ${entityLabel} is Created`;
    } else if (triggerType === 'time_based') {
      return 'Time-based Trigger';
    } else if (triggerType === 'manual') {
      return 'Manual Trigger';
    }
    return 'New Trigger';
  };

  useEffect(() => {
    if (workflow?.name) setWorkflowName(workflow.name);
  }, [workflow]);

  useEffect(() => {
    if (isInitialized.current) setIsDirty(true);
  }, [currentNodes, currentEdges]);

  const saveWorkflowSteps = async (wfId: string) => {
    if (!wfId || wfId === 'undefined') throw new Error('Cannot save workflow steps: Invalid workflow ID');

    const edgeMap = new Map<string, string[]>();
    currentEdges.forEach(edge => {
      if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
      edgeMap.get(edge.source)!.push(edge.target);
    });

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

    const targetNodes = new Set(currentEdges.map(e => e.target));
    const rootNodes = currentNodes.filter(n => !targetNodes.has(n.id));
    rootNodes.forEach(node => visit(node.id));
    currentNodes.forEach(node => { if (!visited.has(node.id)) sorted.push(node); });

    const actionNodes = sorted.filter(node => node.type !== 'trigger');

    const steps = actionNodes.map((node, i) => ({
      stepOrder: i,
      actionType: NODE_TO_ACTION[node.type || 'notification'] ?? 'create_notification',
      actionConfig: JSON.stringify({
        nodeId: node.id,
        position: node.position,
        data: node.data,
        edges: currentEdges.filter(e => e.source === node.id || e.target === node.id),
      }),
      parentStepId: null as string | null,
    }));

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

  const saveWorkflowMutation = useMutation({
    mutationFn: async () => {
      const { triggerType, triggerConfig } = extractTriggerConfig(currentNodes);
      if (!workflowId) {
        const response = await apiRequest('POST', '/api/workflows', {
          name: workflowName,
          description: 'Created in workflow builder',
          isActive: false,
          triggerType,
          triggerConfig: JSON.stringify(triggerConfig),
        });
        const newWorkflow = await response.json() as Workflow;
        await saveWorkflowSteps(newWorkflow.id);
        return newWorkflow;
      } else {
        await apiRequest('PATCH', `/api/workflows/${workflowId}`, {
          name: workflowName,
          triggerType,
          triggerConfig: JSON.stringify(triggerConfig),
        });
        await saveWorkflowSteps(workflowId);
        return workflow;
      }
    },
    onSuccess: (savedWorkflow) => {
      setIsDirty(false);
      toast({ title: "Workflow saved", description: "Your workflow has been saved successfully." });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      const wfId = workflowId || savedWorkflow?.id;
      if (wfId) {
        queryClient.invalidateQueries({ queryKey: ['/api/workflows', wfId, 'steps'] });
        queryClient.invalidateQueries({ queryKey: ['/api/workflows', wfId] });
      }
      if (!workflowId && savedWorkflow) {
        setWorkflowId(savedWorkflow.id);
        setLocation(`/workflows/${savedWorkflow.id}/edit`);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error saving workflow", description: error.message, variant: "destructive" });
    },
  });

  const deleteWorkflowMutation = useMutation({
    mutationFn: async () => {
      if (!workflowId) throw new Error('No workflow to delete');
      await apiRequest('DELETE', `/api/workflows/${workflowId}`);
    },
    onSuccess: () => {
      toast({ title: "Workflow deleted", description: "The workflow has been deleted successfully." });
      queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
      setLocation('/workflows/manage');
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting workflow", description: error.message, variant: "destructive" });
    },
  });

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
      toast({ title: "Error toggling workflow", description: error.message, variant: "destructive" });
    },
  });

  const handleSelectTemplate = (template: WorkflowTemplate) => {
    setTemplateNodes(template.nodes);
    setTemplateEdges(template.edges);
    setCurrentNodes(template.nodes);
    setCurrentEdges(template.edges);
  };

  const resetToNewWorkflow = () => {
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

  const handleNewWorkflow = async () => {
    if (currentNodes.length > 0 && workflowId) {
      try {
        await saveWorkflowMutation.mutateAsync();
        resetToNewWorkflow();
      } catch {
        setShowDiscardConfirm(true);
      }
    } else {
      resetToNewWorkflow();
    }
  };

  const handleDragStart = useCallback((event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleNodeClick = useCallback((node: Node) => {
    const triggerNode = currentNodes.find(n => n.type === 'trigger');
    const triggerEntityType = triggerNode?.data?.entityType || 'lead';
    setSelectedNode({
      ...node,
      data: { ...node.data, entityType: triggerEntityType },
    });
  }, [currentNodes]);

  const handleNodeSave = useCallback((nodeId: string, newData: Record<string, unknown>) => {
    setCurrentNodes(prevNodes =>
      prevNodes.map(node =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...newData } } : node
      )
    );
  }, []);
  
  const handleNodeDelete = useCallback((nodeId: string) => {
    const nodeToDelete = currentNodes.find(node => node.id === nodeId);
    if (nodeToDelete?.type === 'trigger') {
      toast({ title: 'Cannot delete trigger', description: 'Every workflow must have a trigger.', variant: 'destructive' });
      return;
    }
    setCurrentNodes(prevNodes => prevNodes.filter(node => node.id !== nodeId));
    setCurrentEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
  }, [currentNodes]);

  return (
    <div className="flex flex-col h-full">
      <WorkflowHeader
        workflowId={workflowId}
        workflowName={workflowName}
        setWorkflowName={setWorkflowName}
        workflow={workflow}
        creator={creator}
        isDirty={isDirty}
        isSaving={saveWorkflowMutation.isPending}
        isDeleting={deleteWorkflowMutation.isPending}
        onSave={() => saveWorkflowMutation.mutate()}
        onDelete={() => deleteWorkflowMutation.mutate()}
        onToggleActive={(checked) => toggleActiveMutation.mutate(checked)}
        onNewWorkflow={handleNewWorkflow}
        onSelectTemplate={handleSelectTemplate}
      />

      {workflow && workflow.approvalStatus !== 'approved' && (
        <WorkflowStatusAlert workflow={workflow} />
      )}

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

      <NodeEditDialog
        node={selectedNode}
        open={!!selectedNode}
        onClose={() => setSelectedNode(null)}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />

      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              Failed to save the current workflow. Do you want to discard your changes and start a new workflow?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-discard">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowDiscardConfirm(false); resetToNewWorkflow(); }}
              data-testid="button-confirm-discard"
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
