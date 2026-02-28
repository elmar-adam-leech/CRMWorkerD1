import { Handle, Position, NodeProps } from 'reactflow';
import {
  Mail,
  MessageSquare,
  Bell,
  Edit,
  UserPlus,
  Brain,
  GitBranch,
  Clock,
  Calendar,
  Play,
  Zap,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Base node styles
const nodeStyles = {
  trigger: {
    background: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
    border: '2px solid hsl(var(--primary))',
  },
  action: {
    background: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    border: '2px solid hsl(var(--border))',
  },
  ai: {
    background: 'hsl(var(--accent))',
    color: 'hsl(var(--accent-foreground))',
    border: '2px solid hsl(var(--accent))',
  },
  condition: {
    background: 'hsl(var(--secondary))',
    color: 'hsl(var(--secondary-foreground))',
    border: '2px solid hsl(var(--secondary))',
  },
  delay: {
    background: 'hsl(var(--muted))',
    color: 'hsl(var(--muted-foreground))',
    border: '2px solid hsl(var(--border))',
  },
};

// Trigger Node Component
export function TriggerNode({ data }: NodeProps) {
  const triggerType = data.triggerType || 'entity_event';
  const triggerLabel = data.label || 'Trigger';
  
  const getIcon = () => {
    if (triggerType === 'time_based') return <Calendar className="h-4 w-4" />;
    if (triggerType === 'manual') return <Play className="h-4 w-4" />;
    return <Zap className="h-4 w-4" />;
  };

  return (
    <Card
      className="min-w-[200px] shadow-md"
      style={nodeStyles.trigger}
    >
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          {getIcon()}
          <CardTitle className="text-sm font-semibold">{triggerLabel}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <Badge variant="secondary" className="text-xs">
          {triggerType.replace('_', ' ')}
        </Badge>
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Send Email Action Node
export function SendEmailNode({ data }: NodeProps) {
  const fromInfo = data.fromEmail 
    ? `From: ${data.fromEmail}`
    : "From: Creator's Gmail";
  
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.action}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Send Email</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground space-y-1">
        <div>{data.to ? `To: ${data.to}` : 'Configure recipient'}</div>
        <div className="text-[10px] opacity-70">{fromInfo}</div>
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Send SMS Action Node
export function SendSMSNode({ data }: NodeProps) {
  const fromInfo = data.fromNumber 
    ? `From: ${data.fromNumber}`
    : "From: Creator's phone";
  
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.action}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Send SMS</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground space-y-1">
        <div>{data.to ? `To: ${data.to}` : 'Configure phone number'}</div>
        <div className="text-[10px] opacity-70">{fromInfo}</div>
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Create Notification Node
export function NotificationNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.action}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Create Notification</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
        {data.title || 'Configure notification'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Update Entity Node
export function UpdateEntityNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.action}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Edit className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Update Entity</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
        {data.entityType ? `Update ${data.entityType}` : 'Configure entity'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Assign User Node
export function AssignUserNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.action}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Assign User</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
        {data.userId ? `Assign to user` : 'Configure assignment'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// AI Generate Content Node
export function AIGenerateNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.ai}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">AI Generate Content</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs">
        {data.prompt ? data.prompt.substring(0, 40) + '...' : 'Configure AI prompt'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// AI Analyze Node
export function AIAnalyzeNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.ai}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">AI Analyze Data</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <Badge variant="secondary" className="text-xs">
          {data.analysisType || 'general'}
        </Badge>
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Conditional Branch Node
export function ConditionalNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.condition}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">If/Else Condition</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs">
        {data.condition || 'Configure condition'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: '35%' }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: '65%' }} />
    </Card>
  );
}

// Delay Node
export function DelayNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.delay}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Delay</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
        {data.duration || 'Configure duration'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Wait Until Node
export function WaitUntilNode({ data }: NodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={nodeStyles.delay}>
      <Handle type="target" position={Position.Top} />
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <CardTitle className="text-sm font-semibold">Wait Until</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
        {data.dateTime || 'Configure date/time'}
      </CardContent>
      <Handle type="source" position={Position.Bottom} />
    </Card>
  );
}

// Export node types mapping
export const nodeTypes = {
  trigger: TriggerNode,
  sendEmail: SendEmailNode,
  sendSMS: SendSMSNode,
  notification: NotificationNode,
  updateEntity: UpdateEntityNode,
  assignUser: AssignUserNode,
  aiGenerate: AIGenerateNode,
  aiAnalyze: AIAnalyzeNode,
  conditional: ConditionalNode,
  delay: DelayNode,
  waitUntil: WaitUntilNode,
};
