import { useCallback, useState, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  Connection,
  EdgeChange,
  NodeChange,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { nodeTypes } from './WorkflowNodes';

const defaultNodes: Node[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 250, y: 50 },
    data: { 
      label: 'When Lead is Created',
      triggerType: 'entity_event'
    },
  },
];

const defaultEdges: Edge[] = [];

type WorkflowCanvasProps = {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  workflowId?: string;
  approvalStatus?: string;
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onNodeClick?: (node: Node) => void;
};

export default function WorkflowCanvas({ 
  initialNodes, 
  initialEdges, 
  workflowId, 
  approvalStatus,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onNodeClick,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes || defaultNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges || defaultEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const isUpdatingFromParent = useRef(false);

  // Update nodes and edges when props change (template selected)
  useEffect(() => {
    if (initialNodes !== undefined) {
      isUpdatingFromParent.current = true;
      setNodes(initialNodes);
      setTimeout(() => {
        isUpdatingFromParent.current = false;
      }, 0);
    }
  }, [initialNodes]);

  useEffect(() => {
    if (initialEdges !== undefined) {
      isUpdatingFromParent.current = true;
      setEdges(initialEdges);
      setTimeout(() => {
        isUpdatingFromParent.current = false;
      }, 0);
    }
  }, [initialEdges]);

  // Notify parent of changes (but not during parent updates to prevent bouncing)
  useEffect(() => {
    if (onNodesChangeCallback && !isUpdatingFromParent.current) {
      onNodesChangeCallback(nodes);
    }
  }, [nodes, onNodesChangeCallback]);

  useEffect(() => {
    if (onEdgesChangeCallback && !isUpdatingFromParent.current) {
      onEdgesChangeCallback(edges);
    }
  }, [edges, onEdgesChangeCallback]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    []
  );

  // Handle drag and drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');

      if (!type) return;

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      // Generate unique ID
      const id = `${type}-${Date.now()}`;

      // Default data based on node type
      const defaultData: Record<string, any> = {
        trigger: { label: 'New Trigger', triggerType: 'entity_event' },
        sendEmail: { to: '', subject: '' },
        sendSMS: { to: '', message: '' },
        notification: { title: '', message: '' },
        updateEntity: { entityType: '', updates: {} },
        assignUser: { userId: '' },
        aiGenerate: { prompt: '' },
        aiAnalyze: { analysisType: 'general' },
        conditional: { condition: '' },
        delay: { duration: '1 hour' },
        waitUntil: { dateTime: '' },
      };

      const newNode: Node = {
        id,
        type,
        position,
        data: defaultData[type] || {},
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        onNodeClick(node);
      }
    },
    [onNodeClick]
  );

  return (
    <div ref={reactFlowWrapper} className="w-full h-full" data-testid="workflow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={true} />
        <MiniMap
          nodeColor={(node) => {
            if (node.type === 'trigger') return 'hsl(var(--primary))';
            if (node.type?.startsWith('ai')) return 'hsl(var(--accent))';
            if (node.type === 'conditional') return 'hsl(var(--secondary))';
            return 'hsl(var(--muted))';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          position="bottom-right"
        />
      </ReactFlow>
    </div>
  );
}
