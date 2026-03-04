import { useState, useEffect, useRef, type RefObject } from 'react';
import { Node } from 'reactflow';
import { useQuery } from '@tanstack/react-query';
import VariablePicker from './VariablePicker';
import { TagManager } from '@/components/TagManager';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Info } from 'lucide-react';
import { useCurrentUser, isAdminUser } from '@/hooks/useCurrentUser';

type NodeEditDialogProps = {
  node: Node | null;
  open: boolean;
  onClose: () => void;
  onSave: (nodeId: string, newData: Record<string, unknown>) => void;
  onDelete?: (nodeId: string) => void;
};

function StatusOptions({ entityType }: { entityType?: string }) {
  if (entityType === 'lead') return (<>
    <SelectItem value="contacted">Contacted</SelectItem>
    <SelectItem value="scheduled">Scheduled</SelectItem>
    <SelectItem value="disqualified">Disqualified</SelectItem>
  </>);
  if (entityType === 'estimate') return (<>
    <SelectItem value="sent">Sent</SelectItem>
    <SelectItem value="viewed">Viewed</SelectItem>
    <SelectItem value="accepted">Accepted</SelectItem>
    <SelectItem value="rejected">Rejected</SelectItem>
  </>);
  if (entityType === 'job') return (<>
    <SelectItem value="in_progress">In Progress</SelectItem>
    <SelectItem value="completed">Completed</SelectItem>
  </>);
  return null;
}

// ─── Reusable field components ───────────────────────────────────────────────

type VariableInputFieldProps = {
  label: string;
  fieldName: string;
  inputRef: React.RefObject<HTMLInputElement>;
  entityType: "lead" | "estimate" | "job" | "customer";
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVariableSelect: (variable: string) => void;
  placeholder?: string;
  testId?: string;
};

function VariableInputField({ label, fieldName, inputRef, entityType, value, onChange, onVariableSelect, placeholder, testId }: VariableInputFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={fieldName}>{label}</Label>
        <VariablePicker entityType={entityType} onSelect={onVariableSelect} />
      </div>
      <Input ref={inputRef} id={fieldName} value={value} onChange={onChange} placeholder={placeholder} data-testid={testId} />
    </div>
  );
}

type VariableTextareaFieldProps = {
  label: string;
  fieldName: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  entityType: "lead" | "estimate" | "job" | "customer";
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onVariableSelect: (variable: string) => void;
  placeholder?: string;
  testId?: string;
  rows?: number;
};

function VariableTextareaField({ label, fieldName, textareaRef, entityType, value, onChange, onVariableSelect, placeholder, testId, rows = 3 }: VariableTextareaFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={fieldName}>{label}</Label>
        <VariablePicker entityType={entityType} onSelect={onVariableSelect} />
      </div>
      <Textarea ref={textareaRef} id={fieldName} value={value} onChange={onChange} placeholder={placeholder} rows={rows} data-testid={testId} />
    </div>
  );
}

type AfterSendingSectionProps = {
  entityType: string | undefined;
  updateStatus: string | undefined;
  onStatusChange: (value: string) => void;
  testId: string;
};

function AfterSendingSection({ entityType, updateStatus, onStatusChange, testId }: AfterSendingSectionProps) {
  return (
    <div className="space-y-3 pt-3 border-t">
      <div className="text-sm font-medium">After Sending (Optional)</div>
      {entityType ? (
        <div className="space-y-2">
          <Label htmlFor={`${testId}-status`}>Update Status</Label>
          <Select value={updateStatus || undefined} onValueChange={onStatusChange}>
            <SelectTrigger id={`${testId}-status`} data-testid={testId}>
              <SelectValue placeholder="No change" />
            </SelectTrigger>
            <SelectContent>
              <StatusOptions entityType={entityType} />
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Configure the trigger's entity type to enable status updates
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NodeEditDialog({ node, open, onClose, onSave, onDelete }: NodeEditDialogProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Refs for text inputs to support cursor-position variable insertion
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const emailToRef = useRef<HTMLInputElement>(null);
  const smsToRef = useRef<HTMLInputElement>(null);
  const notificationTitleRef = useRef<HTMLInputElement>(null);
  const notificationMessageRef = useRef<HTMLTextAreaElement>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);

  // Get current user to check admin permissions
  const { data: currentUser } = useCurrentUser();
  const isAdmin = isAdminUser(currentUser?.user?.role);

  // Get available Gmail users (those with gmailRefreshToken)
  const { data: gmailUsers = [] } = useQuery<Array<{ id: string; name: string; email: string }>>({
    queryKey: ['/api/users/gmail-connected'],
    enabled: isAdmin && open,
  });

  // Get available phone numbers
  const { data: phoneNumbers = [] } = useQuery<Array<{ id: string; phoneNumber: string; displayName: string | null }>>({
    queryKey: ['/api/dialpad/phone-numbers'],
    enabled: isAdmin && open,
  });

  // Get team users for assignUser node
  const { data: teamUsers = [] } = useQuery<Array<{ id: string; name: string; email: string }>>({
    queryKey: ['/api/users'],
    enabled: isAdmin && open,
  });

  // Fetch terminology settings
  const { data: terminology } = useQuery<{ leadLabel?: string; estimateLabel?: string; jobLabel?: string }>({
    queryKey: ['/api/terminology'],
  });

  useEffect(() => {
    if (node) {
      setFormData(node.data || {});
    }
  }, [node]);

  // Insert variable at cursor position
  const handleVariableInsert = (fieldName: string, variable: string, ref: RefObject<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!ref.current) {
      // Fallback: append to end
      setFormData(prev => ({
        ...prev,
        [fieldName]: (prev[fieldName] || '') + variable
      }));
      return;
    }

    const input = ref.current;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const currentValue = String(formData[fieldName] || '');
    const newValue = currentValue.slice(0, start) + variable + currentValue.slice(end);
    
    setFormData(prev => ({
      ...prev,
      [fieldName]: newValue
    }));

    // Restore cursor position after the inserted variable
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + variable.length, start + variable.length);
    }, 0);
  };

  const handleSave = () => {
    if (node) {
      onSave(node.id, formData);
      onClose();
    }
  };
  
  const handleDelete = () => {
    if (node && onDelete) {
      setShowDeleteConfirm(true);
    }
  };

  // Helper to get entity label with custom terminology
  const getEntityLabel = (entity: string) => {
    if (!terminology) return entity.charAt(0).toUpperCase() + entity.slice(1);
    
    switch (entity) {
      case 'lead':
        return terminology.leadLabel || 'Lead';
      case 'estimate':
        return terminology.estimateLabel || 'Estimate';
      case 'job':
        return terminology.jobLabel || 'Job';
      case 'customer':
        return 'Customer';
      default:
        return entity.charAt(0).toUpperCase() + entity.slice(1);
    }
  };

  const handleChange = (field: string, value: unknown) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Auto-generate trigger label when entity/event types change
      if (node?.type === 'trigger' && (field === 'entityType' || field === 'eventType' || field === 'targetStatus')) {
        const entity = String(field === 'entityType' ? value : (prev.entityType || 'lead'));
        const event = String(field === 'eventType' ? value : (prev.eventType || 'created'));
        const targetStatus = String(field === 'targetStatus' ? value : (prev.targetStatus || ''));
        
        // Get entity label with custom terminology
        const entityLabel = getEntityLabel(entity);
        
        // Generate label based on event type
        if (event === 'status_changed' && targetStatus) {
          const statusLabel = targetStatus.replace('_', ' ');
          newData.label = `When ${entityLabel} Status Changes to ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}`;
        } else if (event === 'created') {
          newData.label = `When ${entityLabel} is Created`;
        } else if (event === 'updated') {
          newData.label = `When ${entityLabel} is Updated`;
        } else if (event === 'deleted') {
          newData.label = `When ${entityLabel} is Deleted`;
        }
      }
      
      return newData;
    });
  };

  if (!node) return null;

  const renderFields = () => {
    const nodeType = node.type;
    const entityType = (formData.entityType as "lead" | "estimate" | "job" | "customer") || "lead";

    switch (nodeType) {
      case 'trigger':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="label">Trigger Name</Label>
              <Input
                id="label"
                value={String(formData.label || '')}
                onChange={(e) => handleChange('label', e.target.value)}
                placeholder={`When ${terminology?.leadLabel || 'Lead'} is Created`}
                data-testid="input-trigger-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Type</Label>
              <Select
                value={String(formData.triggerType || 'entity_event')}
                onValueChange={(value) => handleChange('triggerType', value)}
              >
                <SelectTrigger id="triggerType" data-testid="select-trigger-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entity_event">Entity Event</SelectItem>
                  <SelectItem value="time_based">Time Based</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Conditional fields based on trigger type */}
            {formData.triggerType === 'entity_event' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="entityType">Entity</Label>
                  <Select
                    value={String(formData.entityType || 'lead')}
                    onValueChange={(value) => handleChange('entityType', value)}
                  >
                    <SelectTrigger id="entityType" data-testid="select-trigger-entity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">{terminology?.leadLabel || 'Lead'}</SelectItem>
                      <SelectItem value="estimate">{terminology?.estimateLabel || 'Estimate'}</SelectItem>
                      <SelectItem value="job">{terminology?.jobLabel || 'Job'}</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eventType">Event Type</Label>
                  <Select
                    value={String(formData.eventType || 'created')}
                    onValueChange={(value) => handleChange('eventType', value)}
                  >
                    <SelectTrigger id="eventType" data-testid="select-trigger-event">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created">Created</SelectItem>
                      <SelectItem value="updated">Updated</SelectItem>
                      <SelectItem value="status_changed">Status Changed</SelectItem>
                      <SelectItem value="deleted">Deleted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formData.eventType === 'status_changed' && (
                  <div className="space-y-2">
                    <Label htmlFor="targetStatus">Status Changed To</Label>
                    <Select
                      value={String(formData.targetStatus || '')}
                      onValueChange={(value) => handleChange('targetStatus', value)}
                    >
                      <SelectTrigger id="targetStatus" data-testid="select-target-status">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        {formData.entityType === 'lead' && (
                          <>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="scheduled">Scheduled</SelectItem>
                            <SelectItem value="disqualified">Disqualified</SelectItem>
                          </>
                        )}
                        {formData.entityType === 'estimate' && (
                          <>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="sent">Sent</SelectItem>
                            <SelectItem value="viewed">Viewed</SelectItem>
                            <SelectItem value="accepted">Accepted</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </>
                        )}
                        {formData.entityType === 'job' && (
                          <>
                            <SelectItem value="scheduled">Scheduled</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </>
                        )}
                        {formData.entityType === 'customer' && (
                          <>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                {/* Tag filtering for entity events */}
                <div className="space-y-2">
                  <Label>Filter by Tags (Optional)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Only trigger this workflow for contacts with these tags. Leave empty to trigger for all contacts.
                  </p>
                  <TagManager
                    tags={(formData.tags as string[]) || []}
                    onChange={(tags) => handleChange('tags', tags)}
                    placeholder="Add tag filter (e.g., Ductless, Emergency)..."
                  />
                </div>
              </>
            )}

            {formData.triggerType === 'time_based' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="scheduleType">Schedule Type</Label>
                  <Select
                    value={String(formData.scheduleType || 'interval')}
                    onValueChange={(value) => handleChange('scheduleType', value)}
                  >
                    <SelectTrigger id="scheduleType" data-testid="select-schedule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="interval">Interval</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="cron">Custom (Cron)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formData.scheduleType === 'interval' && (
                  <div className="space-y-2">
                    <Label htmlFor="interval">Interval</Label>
                    <Input
                      id="interval"
                      value={String(formData.interval || '')}
                      onChange={(e) => handleChange('interval', e.target.value)}
                      placeholder="e.g., 1 hour, 30 minutes"
                      data-testid="input-trigger-interval"
                    />
                  </div>
                )}
                {formData.scheduleType === 'daily' && (
                  <div className="space-y-2">
                    <Label htmlFor="time">Time of Day</Label>
                    <Input
                      id="time"
                      type="time"
                      value={String(formData.time || '')}
                      onChange={(e) => handleChange('time', e.target.value)}
                      data-testid="input-trigger-time"
                    />
                  </div>
                )}
                {formData.scheduleType === 'cron' && (
                  <div className="space-y-2">
                    <Label htmlFor="cronExpression">Cron Expression</Label>
                    <Input
                      id="cronExpression"
                      value={String(formData.cronExpression || '')}
                      onChange={(e) => handleChange('cronExpression', e.target.value)}
                      placeholder="0 9 * * 1-5"
                      data-testid="input-trigger-cron"
                    />
                  </div>
                )}
              </>
            )}

            {formData.triggerType === 'manual' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This workflow can be triggered manually from the workflows page or via API.
                </p>
              </div>
            )}
          </>
        );

      case 'sendEmail':
        return (
          <>
            <VariableInputField
              label="To (Email)"
              fieldName="to"
              inputRef={emailToRef}
              entityType={entityType}
              value={String(formData.to || '')}
              onChange={(e) => handleChange('to', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('to', v, emailToRef)}
              placeholder="email@example.com or {{lead.emails}}"
              testId="input-email-to"
            />
            <VariableInputField
              label="Subject"
              fieldName="subject"
              inputRef={subjectRef}
              entityType={entityType}
              value={String(formData.subject || '')}
              onChange={(e) => handleChange('subject', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('subject', v, subjectRef)}
              placeholder="Email subject (use Insert Variable button)"
              testId="input-email-subject"
            />
            <VariableTextareaField
              label="Body"
              fieldName="body"
              textareaRef={bodyRef}
              entityType={entityType}
              value={String(formData.body || '')}
              onChange={(e) => handleChange('body', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('body', v, bodyRef)}
              placeholder="Email body content (use Insert Variable button)"
              rows={4}
              testId="input-email-body"
            />

            {/* Admin-only: Override sender email */}
            {isAdmin && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-sm font-medium">Advanced (Admin Only)</div>
                <div className="space-y-2">
                  <Label htmlFor="fromEmail">From Email (Optional)</Label>
                  <Select
                    value={(formData.fromEmail as string | undefined) || undefined}
                    onValueChange={(value) => handleChange('fromEmail', value === 'default' ? undefined : value)}
                  >
                    <SelectTrigger id="fromEmail" data-testid="select-email-from">
                      <SelectValue placeholder="Use workflow creator's Gmail" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use workflow creator's Gmail</SelectItem>
                      {gmailUsers.map((user) => (
                        <SelectItem key={user.id} value={user.email}>
                          {user.name} ({user.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    By default, emails are sent from the workflow creator's connected Gmail account
                  </p>
                </div>
              </div>
            )}

            <AfterSendingSection
              entityType={formData.entityType ? String(formData.entityType) : undefined}
              updateStatus={formData.updateStatus as string | undefined}
              onStatusChange={(value) => handleChange('updateStatus', value)}
              testId="select-email-update-status"
            />
          </>
        );

      case 'sendSMS':
        return (
          <>
            <VariableInputField
              label="To (Phone Number)"
              fieldName="to"
              inputRef={smsToRef}
              entityType={entityType}
              value={String(formData.to || '')}
              onChange={(e) => handleChange('to', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('to', v, smsToRef)}
              placeholder="(555) 123-4567 or {{lead.phones}}"
              testId="input-sms-to"
            />
            <VariableTextareaField
              label="Message"
              fieldName="message"
              textareaRef={messageRef}
              entityType={entityType}
              value={String(formData.message || '')}
              onChange={(e) => handleChange('message', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('message', v, messageRef)}
              placeholder="SMS message content (use Insert Variable button)"
              rows={3}
              testId="input-sms-message"
            />

            {/* Admin-only: Override sender phone number */}
            {isAdmin && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-sm font-medium">Advanced (Admin Only)</div>
                <div className="space-y-2">
                  <Label htmlFor="fromNumber">From Phone Number (Optional)</Label>
                  <Select
                    value={(formData.fromNumber as string | undefined) || undefined}
                    onValueChange={(value) => handleChange('fromNumber', value === 'default' ? undefined : value)}
                  >
                    <SelectTrigger id="fromNumber" data-testid="select-sms-from">
                      <SelectValue placeholder="Use workflow creator's default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use workflow creator's default</SelectItem>
                      {phoneNumbers.map((phone) => (
                        <SelectItem key={phone.id} value={phone.phoneNumber}>
                          {phone.displayName || phone.phoneNumber} ({phone.phoneNumber})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    By default, SMS messages use the workflow creator's default phone number
                  </p>
                </div>
              </div>
            )}

            <AfterSendingSection
              entityType={formData.entityType ? String(formData.entityType) : undefined}
              updateStatus={formData.updateStatus as string | undefined}
              onStatusChange={(value) => handleChange('updateStatus', value)}
              testId="select-sms-update-status"
            />
          </>
        );

      case 'notification':
        return (
          <>
            <VariableInputField
              label="Notification Title"
              fieldName="title"
              inputRef={notificationTitleRef}
              entityType={entityType}
              value={String(formData.title || '')}
              onChange={(e) => handleChange('title', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('title', v, notificationTitleRef)}
              placeholder="Important update"
              testId="input-notification-title"
            />
            <VariableTextareaField
              label="Message"
              fieldName="message"
              textareaRef={notificationMessageRef}
              entityType={entityType}
              value={String(formData.message || '')}
              onChange={(e) => handleChange('message', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('message', v, notificationMessageRef)}
              placeholder="Notification message"
              rows={3}
              testId="input-notification-message"
            />
          </>
        );

      case 'updateEntity':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entityType">Entity Type</Label>
              <Select
                value={String(formData.entityType || 'lead')}
                onValueChange={(value) => handleChange('entityType', value)}
              >
                <SelectTrigger id="entityType" data-testid="select-update-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">{terminology?.leadLabel || 'Lead'}</SelectItem>
                  <SelectItem value="estimate">{terminology?.estimateLabel || 'Estimate'}</SelectItem>
                  <SelectItem value="job">{terminology?.jobLabel || 'Job'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="updateField">Field to Update</Label>
              <Input
                id="updateField"
                value={String(formData.updateField || '')}
                onChange={(e) => {
                  const newField = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    updateField: newField,
                    updates: { [newField]: prev.updateValue || '' },
                  }));
                }}
                placeholder="e.g. status, priority, notes"
                data-testid="input-update-entity-field"
              />
              <p className="text-xs text-muted-foreground">The field name on the entity to change</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="updateValue">New Value</Label>
              <Input
                id="updateValue"
                value={String(formData.updateValue || '')}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    updateValue: newValue,
                    updates: { [String(prev.updateField || '')]: newValue },
                  }));
                }}
                placeholder="e.g. contacted, high, Follow-up sent"
                data-testid="input-update-entity-value"
              />
            </div>
            {Boolean(formData.updateField) && Boolean(formData.updateValue) && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">Preview:</p>
                <code className="text-sm">
                  Set {String(formData.entityType || 'lead')}.{String(formData.updateField)} = "{String(formData.updateValue)}"
                </code>
              </div>
            )}
          </div>
        );


      case 'assignUser':
        return (
          <div className="space-y-2">
            <Label htmlFor="userId">Assign to Team Member</Label>
            {isAdmin ? (
              <Select
                value={String(formData.userId || '')}
                onValueChange={(v) => handleChange('userId', v)}
              >
                <SelectTrigger id="userId" data-testid="select-assign-user">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {teamUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="userId"
                value={String(formData.userId || '')}
                onChange={(e) => handleChange('userId', e.target.value)}
                placeholder="user-id"
                data-testid="input-assign-user"
              />
            )}
          </div>
        );

      case 'aiGenerate':
        return (
          <div className="space-y-2">
            <VariableTextareaField
              label="AI Prompt"
              fieldName="prompt"
              textareaRef={aiPromptRef}
              entityType={entityType}
              value={String(formData.prompt || '')}
              onChange={(e) => handleChange('prompt', e.target.value)}
              onVariableSelect={(v) => handleVariableInsert('prompt', v, aiPromptRef)}
              placeholder="Generate a personalized welcome email for {{lead.name}}"
              rows={4}
              testId="input-ai-prompt"
            />
            <p className="text-xs text-muted-foreground">
              Use variables to personalize AI-generated content
            </p>
          </div>
        );

      case 'aiAnalyze':
        return (
          <div className="space-y-2">
            <Label htmlFor="analysisType">Analysis Type</Label>
            <Select
              value={String(formData.analysisType || 'general')}
              onValueChange={(value) => handleChange('analysisType', value)}
            >
              <SelectTrigger id="analysisType" data-testid="select-analysis-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General Analysis</SelectItem>
                <SelectItem value="sentiment">Sentiment Analysis</SelectItem>
                <SelectItem value="priority">Priority Assessment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );

      case 'conditional':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Condition Builder</Label>
              <p className="text-sm text-muted-foreground">
                Build a condition to branch your workflow
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Field selector */}
              <div className="space-y-2">
                <Label htmlFor="conditionField" className="text-xs">Field</Label>
                <Select
                  value={String(formData.conditionField || '')}
                  onValueChange={(value) => handleChange('conditionField', value)}
                >
                  <SelectTrigger id="conditionField" data-testid="select-condition-field">
                    <SelectValue placeholder="Select field" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.entityType === 'lead' && (
                      <>
                        <SelectItem value="lead.status">Status</SelectItem>
                        <SelectItem value="lead.name">Name</SelectItem>
                        <SelectItem value="lead.email">Email</SelectItem>
                        <SelectItem value="lead.phone">Phone</SelectItem>
                        <SelectItem value="lead.source">Source</SelectItem>
                      </>
                    )}
                    {formData.entityType === 'estimate' && (
                      <>
                        <SelectItem value="estimate.status">Status</SelectItem>
                        <SelectItem value="estimate.total">Total Amount</SelectItem>
                        <SelectItem value="estimate.title">Title</SelectItem>
                        <SelectItem value="estimate.customerName">Customer Name</SelectItem>
                      </>
                    )}
                    {formData.entityType === 'job' && (
                      <>
                        <SelectItem value="job.status">Status</SelectItem>
                        <SelectItem value="job.type">Type</SelectItem>
                        <SelectItem value="job.priority">Priority</SelectItem>
                        <SelectItem value="job.scheduledDate">Scheduled Date</SelectItem>
                      </>
                    )}
                    {formData.entityType === 'customer' && (
                      <>
                        <SelectItem value="customer.status">Status</SelectItem>
                        <SelectItem value="customer.name">Name</SelectItem>
                        <SelectItem value="customer.email">Email</SelectItem>
                      </>
                    )}
                    {!formData.entityType && (
                      <SelectItem value="custom" disabled>Set trigger entity type first</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Operator selector */}
              <div className="space-y-2">
                <Label htmlFor="conditionOperator" className="text-xs">Operator</Label>
                <Select
                  value={String(formData.conditionOperator || '')}
                  onValueChange={(value) => handleChange('conditionOperator', value)}
                >
                  <SelectTrigger id="conditionOperator" data-testid="select-condition-operator">
                    <SelectValue placeholder="Operator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">=</SelectItem>
                    <SelectItem value="not_equals">≠</SelectItem>
                    <SelectItem value="greater_than">&gt;</SelectItem>
                    <SelectItem value="less_than">&lt;</SelectItem>
                    <SelectItem value="greater_or_equal">≥</SelectItem>
                    <SelectItem value="less_or_equal">≤</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="not_contains">does not contain</SelectItem>
                    <SelectItem value="starts_with">starts with</SelectItem>
                    <SelectItem value="ends_with">ends with</SelectItem>
                    <SelectItem value="is_empty">is empty</SelectItem>
                    <SelectItem value="is_not_empty">is not empty</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Value input */}
              <div className="space-y-2">
                <Label htmlFor="conditionValue" className="text-xs">Value</Label>
                <Input
                  id="conditionValue"
                  value={String(formData.conditionValue || '')}
                  onChange={(e) => handleChange('conditionValue', e.target.value)}
                  placeholder="Enter value"
                  data-testid="input-condition-value"
                  disabled={formData.conditionOperator === 'is_empty' || formData.conditionOperator === 'is_not_empty'}
                />
              </div>
            </div>

            {Boolean(formData.conditionField) && Boolean(formData.conditionOperator) && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">Condition Preview:</p>
                <code className="text-sm">
                  {String(formData.conditionField)}{' '}
                  {formData.conditionOperator === 'equals' ? '=' :
                    formData.conditionOperator === 'not_equals' ? '!=' :
                    formData.conditionOperator === 'greater_than' ? '>' :
                    formData.conditionOperator === 'less_than' ? '<' :
                    formData.conditionOperator === 'greater_or_equal' ? '>=' :
                    formData.conditionOperator === 'less_or_equal' ? '<=' :
                    String(formData.conditionOperator)
                  }{' '}
                  {formData.conditionOperator !== 'is_empty' && formData.conditionOperator !== 'is_not_empty' ? (String(formData.conditionValue) || '?') : ''}
                </code>
              </div>
            )}

            {/* Help text */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-900 dark:text-blue-100 font-medium mb-1"><Info className="h-3 w-3 inline-block mr-1" />How it works:</p>
              <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 ml-4 list-disc">
                <li>Select a field from the trigger entity</li>
                <li>Choose an operator to compare</li>
                <li>Enter the value to compare against</li>
                <li>Connect branches to the "true" and "false" handles</li>
              </ul>
            </div>
          </div>
        );

      case 'delay': {
        // Parse duration to extract value and unit, handling multi-part durations
        const parseDuration = (duration: string) => {
          if (!duration) return { value: '1', unit: 'm' };
          
          // Convert duration parts to total seconds
          const toSeconds = (val: number, unit: string): number => {
            const multipliers: Record<string, number> = {
              's': 1,
              'm': 60,
              'h': 3600,
              'd': 86400,
              'second': 1,
              'minute': 60,
              'hour': 3600,
              'day': 86400
            };
            return val * (multipliers[unit] || 60);
          };
          
          // Convert total seconds to best unit representation
          const fromSeconds = (totalSeconds: number): { value: string; unit: string } => {
            if (totalSeconds >= 86400 && totalSeconds % 86400 === 0) {
              return { value: String(totalSeconds / 86400), unit: 'd' };
            }
            if (totalSeconds >= 3600 && totalSeconds % 3600 === 0) {
              return { value: String(totalSeconds / 3600), unit: 'h' };
            }
            if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
              return { value: String(totalSeconds / 60), unit: 'm' };
            }
            return { value: String(totalSeconds), unit: 's' };
          };
          
          let totalSeconds = 0;
          
          // Try short format (1s, 30m, 2h, 1d)
          const shortMatch = duration.match(/^(\d+)([smhd])$/);
          if (shortMatch) {
            return { value: shortMatch[1], unit: shortMatch[2] };
          }
          
          // Try single long format (15 seconds, 1 minute, 2 hours, 3 days)
          const singleLongMatch = duration.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
          if (singleLongMatch) {
            const unitMap: Record<string, string> = {
              'second': 's',
              'minute': 'm',
              'hour': 'h',
              'day': 'd'
            };
            return { value: singleLongMatch[1], unit: unitMap[singleLongMatch[2].toLowerCase()] || 'm' };
          }
          
          // Try multi-part format (1 hour, 30 minutes)
          const multiPartRegex = /(\d+)\s*(second|minute|hour|day)s?/gi;
          let match;
          while ((match = multiPartRegex.exec(duration)) !== null) {
            const value = parseInt(match[1]);
            const unit = match[2].toLowerCase();
            totalSeconds += toSeconds(value, unit);
          }
          
          if (totalSeconds > 0) {
            return fromSeconds(totalSeconds);
          }
          
          // Default
          return { value: '1', unit: 'm' };
        };
        
        const { value: durationValue, unit: durationUnit } = parseDuration(String(formData.duration || ''));
        
        const handleDurationChange = (newValue: string, newUnit: string) => {
          // Create duration string in short format (e.g., "30m", "1h", "2d")
          const duration = `${newValue}${newUnit}`;
          handleChange('duration', duration);
        };
        
        return (
          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  min="1"
                  value={durationValue}
                  onChange={(e) => handleDurationChange(e.target.value, durationUnit)}
                  placeholder="1"
                  data-testid="input-delay-value"
                />
              </div>
              <div className="w-32">
                <Select
                  value={durationUnit}
                  onValueChange={(value) => handleDurationChange(durationValue, value)}
                >
                  <SelectTrigger data-testid="select-delay-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="s">Seconds</SelectItem>
                    <SelectItem value="m">Minutes</SelectItem>
                    <SelectItem value="h">Hours</SelectItem>
                    <SelectItem value="d">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      }

      case 'waitUntil':
        return (
          <div className="space-y-2">
            <Label htmlFor="dateTime">Date/Time</Label>
            <Input
              id="dateTime"
              type="datetime-local"
              value={String(formData.dateTime || '')}
              onChange={(e) => handleChange('dateTime', e.target.value)}
              data-testid="input-wait-datetime"
            />
          </div>
        );

      default:
        return <div className="text-muted-foreground">No editable properties for this node type.</div>;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent data-testid="dialog-node-edit">
          <DialogHeader>
            <DialogTitle>Edit Node</DialogTitle>
            <DialogDescription>
              Configure the properties for this workflow node.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {renderFields()}
          </div>
          <DialogFooter className="flex justify-between items-center">
            <div>
              {onDelete && (
                <Button 
                  variant="destructive" 
                  onClick={handleDelete} 
                  data-testid="button-delete-node"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Node
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button onClick={handleSave} data-testid="button-save-edit">
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Node</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this node? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-node">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete-node"
              onClick={() => {
                if (node && onDelete) {
                  onDelete(node.id);
                  onClose();
                }
                setShowDeleteConfirm(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
