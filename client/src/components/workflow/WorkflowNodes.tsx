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
  Zap,
  Play,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Node style variants
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

// Handle configurations:
//   'trigger'     — source only (no incoming handle)
//   'action'      — target top + source bottom (default)
//   'conditional' — target top + two labelled source handles at bottom
type HandleConfig = 'trigger' | 'action' | 'conditional';

type BaseNodeProps = {
  icon: React.ReactNode;
  title: string;
  preview?: React.ReactNode;
  style: React.CSSProperties;
  handles?: HandleConfig;
};

function BaseNode({ icon, title, preview, style, handles = 'action' }: BaseNodeProps) {
  return (
    <Card className="min-w-[200px] shadow-md" style={style}>
      {handles !== 'trigger' && <Handle type="target" position={Position.Top} />}
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
      </CardHeader>
      {preview !== undefined && (
        <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
          {preview}
        </CardContent>
      )}
      {handles === 'conditional' ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: '35%' }} />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: '65%' }} />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} />
      )}
    </Card>
  );
}

export function TriggerNode({ data }: NodeProps) {
  const triggerType = data.triggerType || 'entity_event';
  const icon = triggerType === 'time_based'
    ? <Calendar className="h-4 w-4" />
    : triggerType === 'manual'
      ? <Play className="h-4 w-4" />
      : <Zap className="h-4 w-4" />;

  return (
    <BaseNode
      icon={icon}
      title={String(data.label || 'Trigger')}
      preview={<Badge variant="secondary" className="text-xs">{String(triggerType).replace('_', ' ')}</Badge>}
      style={nodeStyles.trigger}
      handles="trigger"
    />
  );
}

export function SendEmailNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Mail className="h-4 w-4" />}
      title="Send Email"
      preview={
        <div className="space-y-1">
          <div>{data.to ? `To: ${data.to}` : 'Configure recipient'}</div>
          <div className="text-[10px] opacity-70">
            {data.fromEmail ? `From: ${data.fromEmail}` : "From: Creator's Gmail"}
          </div>
        </div>
      }
      style={nodeStyles.action}
    />
  );
}

export function SendSMSNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<MessageSquare className="h-4 w-4" />}
      title="Send SMS"
      preview={
        <div className="space-y-1">
          <div>{data.to ? `To: ${data.to}` : 'Configure phone number'}</div>
          <div className="text-[10px] opacity-70">
            {data.fromNumber ? `From: ${data.fromNumber}` : "From: Creator's phone"}
          </div>
        </div>
      }
      style={nodeStyles.action}
    />
  );
}

export function NotificationNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Bell className="h-4 w-4" />}
      title="Create Notification"
      preview={<>{data.title || 'Configure notification'}</>}
      style={nodeStyles.action}
    />
  );
}

export function UpdateEntityNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Edit className="h-4 w-4" />}
      title="Update Entity"
      preview={<>{data.entityType ? `Update ${data.entityType}` : 'Configure entity'}</>}
      style={nodeStyles.action}
    />
  );
}

export function AssignUserNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<UserPlus className="h-4 w-4" />}
      title="Assign User"
      preview={<>{data.userId ? 'Assign to user' : 'Configure assignment'}</>}
      style={nodeStyles.action}
    />
  );
}

export function AIGenerateNode({ data }: NodeProps) {
  const preview = data.prompt
    ? String(data.prompt).substring(0, 40) + '...'
    : 'Configure AI prompt';
  return (
    <BaseNode
      icon={<Brain className="h-4 w-4" />}
      title="AI Generate Content"
      preview={<>{preview}</>}
      style={nodeStyles.ai}
    />
  );
}

export function AIAnalyzeNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Brain className="h-4 w-4" />}
      title="AI Analyze Data"
      preview={<Badge variant="secondary" className="text-xs">{String(data.analysisType || 'general')}</Badge>}
      style={nodeStyles.ai}
    />
  );
}

export function ConditionalNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<GitBranch className="h-4 w-4" />}
      title="If/Else Condition"
      preview={<>{data.condition || 'Configure condition'}</>}
      style={nodeStyles.condition}
      handles="conditional"
    />
  );
}

export function DelayNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Clock className="h-4 w-4" />}
      title="Delay"
      preview={<>{data.duration || 'Configure duration'}</>}
      style={nodeStyles.delay}
    />
  );
}

export function WaitUntilNode({ data }: NodeProps) {
  return (
    <BaseNode
      icon={<Calendar className="h-4 w-4" />}
      title="Wait Until"
      preview={<>{data.dateTime || 'Configure date/time'}</>}
      style={nodeStyles.delay}
    />
  );
}

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
