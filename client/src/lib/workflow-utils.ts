import { Node } from 'reactflow';

export function extractTriggerConfig(nodes: Node[]): { triggerType: string; triggerConfig: Record<string, unknown> } {
  const triggerNode = nodes.find(n => n.type === 'trigger');
  const triggerData = triggerNode?.data || {};
  let triggerType: string = triggerData.triggerType || 'manual';
  let triggerConfig: Record<string, unknown> = {};

  if (triggerType === 'entity_event') {
    const entityType = triggerData.entityType || triggerData.entity || 'lead';
    const eventType = triggerData.event || triggerData.eventType || 'created';
    if (eventType === 'created') {
      triggerType = 'entity_created';
      triggerConfig = {
        entity: entityType,
        event: 'created',
        ...(triggerData.tags && (triggerData.tags as unknown[]).length > 0 && { tags: triggerData.tags }),
      };
    } else if (eventType === 'updated') {
      triggerType = 'entity_updated';
      triggerConfig = {
        entity: entityType,
        event: 'updated',
        ...(triggerData.tags && (triggerData.tags as unknown[]).length > 0 && { tags: triggerData.tags }),
      };
    } else {
      triggerConfig = {
        entity: entityType,
        event: eventType,
        ...(triggerData.targetStatus && { targetStatus: triggerData.targetStatus }),
        ...(triggerData.tags && (triggerData.tags as unknown[]).length > 0 && { tags: triggerData.tags }),
      };
    }
  } else if (triggerType === 'entity_created' || triggerType === 'entity_updated') {
    const entityType = triggerData.entity || triggerData.entityType || 'lead';
    const eventType = triggerType === 'entity_created' ? 'created' : 'updated';
    triggerConfig = {
      entity: entityType,
      event: eventType,
      ...(triggerData.tags && (triggerData.tags as unknown[]).length > 0 && { tags: triggerData.tags }),
    };
  } else if (triggerType === 'time_based') {
    triggerConfig = {
      schedule: triggerData.schedule || 'daily',
      time: triggerData.time || '09:00',
    };
  } else {
    triggerConfig = { entity: triggerData.entity || triggerData.entityType || 'lead' };
  }

  return { triggerType, triggerConfig };
}

export const NODE_ACTION_MAP: [nodeType: string, actionType: string][] = [
  ['trigger',      'trigger'],
  ['sendEmail',    'send_email'],
  ['sendSMS',      'send_sms'],
  ['notification', 'create_notification'],
  ['updateEntity', 'update_entity'],
  ['assignUser',   'assign_user'],
  ['aiGenerate',   'ai_generate_content'],
  ['aiAnalyze',    'ai_analyze'],
  ['conditional',  'conditional_branch'],
  ['delay',        'delay'],
  ['waitUntil',    'wait_until'],
];

export const NODE_TO_ACTION = Object.fromEntries(NODE_ACTION_MAP);
export const ACTION_TO_NODE = Object.fromEntries(NODE_ACTION_MAP.map(([n, a]) => [a, n]));
