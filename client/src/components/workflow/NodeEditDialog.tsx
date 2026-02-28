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
import { Trash2 } from 'lucide-react';

type NodeEditDialogProps = {
  node: Node | null;
  open: boolean;
  onClose: () => void;
  onSave: (nodeId: string, newData: any) => void;
  onDelete?: (nodeId: string) => void;
};

export default function NodeEditDialog({ node, open, onClose, onSave, onDelete }: NodeEditDialogProps) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // Refs for text inputs to support cursor-position variable insertion
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const emailToRef = useRef<HTMLInputElement>(null);
  const smsToRef = useRef<HTMLInputElement>(null);

  // Get current user to check admin permissions
  const { data: currentUser } = useQuery<{ user: { id: string; name: string; email: string; role: string } }>({
    queryKey: ['/api/auth/me'],
  });
  const isAdmin = currentUser?.user?.role === 'admin' 
    || currentUser?.user?.role === 'super_admin' 
    || currentUser?.user?.role === 'manager';

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

  // Fetch terminology settings
  const { data: terminology } = useQuery<any>({
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
    const currentValue = formData[fieldName] || '';
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
      if (confirm(`Are you sure you want to delete this node?`)) {
        onDelete(node.id);
        onClose();
      }
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

  const handleChange = (field: string, value: any) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      
      // Auto-generate trigger label when entity/event types change
      if (node?.type === 'trigger' && (field === 'entityType' || field === 'eventType' || field === 'targetStatus')) {
        const entity = field === 'entityType' ? value : (prev.entityType || 'lead');
        const event = field === 'eventType' ? value : (prev.eventType || 'created');
        const targetStatus = field === 'targetStatus' ? value : prev.targetStatus;
        
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

    switch (nodeType) {
      case 'trigger':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="label">Trigger Name</Label>
              <Input
                id="label"
                value={formData.label || ''}
                onChange={(e) => handleChange('label', e.target.value)}
                placeholder={`When ${terminology?.leadLabel || 'Lead'} is Created`}
                data-testid="input-trigger-label"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="triggerType">Trigger Type</Label>
              <Select
                value={formData.triggerType || 'entity_event'}
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
                    value={formData.entityType || 'lead'}
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
                    value={formData.eventType || 'created'}
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
                      value={formData.targetStatus || ''}
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
                    tags={formData.tags || []}
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
                    value={formData.scheduleType || 'interval'}
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
                      value={formData.interval || ''}
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
                      value={formData.time || ''}
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
                      value={formData.cronExpression || ''}
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="to">To (Email)</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('to', v, emailToRef)}
                />
              </div>
              <Input
                ref={emailToRef}
                id="to"
                value={formData.to || ''}
                onChange={(e) => handleChange('to', e.target.value)}
                placeholder="email@example.com or {{lead.emails}}"
                data-testid="input-email-to"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="subject">Subject</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('subject', v, subjectRef)}
                />
              </div>
              <Input
                ref={subjectRef}
                id="subject"
                value={formData.subject || ''}
                onChange={(e) => handleChange('subject', e.target.value)}
                placeholder="Email subject (use Insert Variable button)"
                data-testid="input-email-subject"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="body">Body</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('body', v, bodyRef)}
                />
              </div>
              <Textarea
                ref={bodyRef}
                id="body"
                value={formData.body || ''}
                onChange={(e) => handleChange('body', e.target.value)}
                placeholder="Email body content (use Insert Variable button)"
                rows={4}
                data-testid="input-email-body"
              />
            </div>
            
            {/* Admin-only: Override sender email */}
            {isAdmin && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-sm font-medium">Advanced (Admin Only)</div>
                <div className="space-y-2">
                  <Label htmlFor="fromEmail">From Email (Optional)</Label>
                  <Select
                    value={formData.fromEmail || undefined}
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

            {/* Optional entity update after sending email */}
            <div className="space-y-3 pt-3 border-t">
              <div className="text-sm font-medium">After Sending (Optional)</div>
              {formData.entityType ? (
                <div className="space-y-2">
                  <Label htmlFor="updateStatus">Update Status</Label>
                  <Select
                    value={formData.updateStatus || undefined}
                    onValueChange={(value) => handleChange('updateStatus', value)}
                  >
                    <SelectTrigger id="updateStatus" data-testid="select-email-update-status">
                      <SelectValue placeholder="No change" />
                    </SelectTrigger>
                    <SelectContent>
                      {formData.entityType === 'lead' && (
                        <>
                          <SelectItem value="contacted">Contacted</SelectItem>
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                          <SelectItem value="disqualified">Disqualified</SelectItem>
                        </>
                      )}
                      {formData.entityType === 'estimate' && (
                        <>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="viewed">Viewed</SelectItem>
                          <SelectItem value="accepted">Accepted</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </>
                      )}
                      {formData.entityType === 'job' && (
                        <>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Configure the trigger's entity type to enable status updates
                </p>
              )}
            </div>
          </>
        );

      case 'sendSMS':
        return (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="to">To (Phone Number)</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('to', v, smsToRef)}
                />
              </div>
              <Input
                ref={smsToRef}
                id="to"
                value={formData.to || ''}
                onChange={(e) => handleChange('to', e.target.value)}
                placeholder="(555) 123-4567 or {{lead.phones}}"
                data-testid="input-sms-to"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="message">Message</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('message', v, messageRef)}
                />
              </div>
              <Textarea
                ref={messageRef}
                id="message"
                value={formData.message || ''}
                onChange={(e) => handleChange('message', e.target.value)}
                placeholder="SMS message content (use Insert Variable button)"
                rows={3}
                data-testid="input-sms-message"
              />
            </div>
            
            {/* Admin-only: Override sender phone number */}
            {isAdmin && (
              <div className="space-y-3 pt-3 border-t">
                <div className="text-sm font-medium">Advanced (Admin Only)</div>
                <div className="space-y-2">
                  <Label htmlFor="fromNumber">From Phone Number (Optional)</Label>
                  <Select
                    value={formData.fromNumber || undefined}
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

            {/* Optional entity update after sending SMS */}
            <div className="space-y-3 pt-3 border-t">
              <div className="text-sm font-medium">After Sending (Optional)</div>
              {formData.entityType ? (
                <div className="space-y-2">
                  <Label htmlFor="updateStatus">Update Status</Label>
                  <Select
                    value={formData.updateStatus || undefined}
                    onValueChange={(value) => handleChange('updateStatus', value)}
                  >
                    <SelectTrigger id="updateStatus" data-testid="select-sms-update-status">
                      <SelectValue placeholder="No change" />
                    </SelectTrigger>
                    <SelectContent>
                      {formData.entityType === 'lead' && (
                        <>
                          <SelectItem value="contacted">Contacted</SelectItem>
                          <SelectItem value="scheduled">Scheduled</SelectItem>
                          <SelectItem value="disqualified">Disqualified</SelectItem>
                        </>
                      )}
                      {formData.entityType === 'estimate' && (
                        <>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="viewed">Viewed</SelectItem>
                          <SelectItem value="accepted">Accepted</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </>
                      )}
                      {formData.entityType === 'job' && (
                        <>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Configure the trigger's entity type to enable status updates
                </p>
              )}
            </div>
          </>
        );

      case 'notification':
        const notificationTitleRef = useRef<HTMLInputElement>(null);
        const notificationMessageRef = useRef<HTMLTextAreaElement>(null);
        
        return (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="title">Notification Title</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('title', v, notificationTitleRef)}
                />
              </div>
              <Input
                ref={notificationTitleRef}
                id="title"
                value={formData.title || ''}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="Important update"
                data-testid="input-notification-title"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="message">Message</Label>
                <VariablePicker
                  entityType={formData.entityType || 'lead'}
                  onSelect={(v) => handleVariableInsert('message', v, notificationMessageRef)}
                />
              </div>
              <Textarea
                ref={notificationMessageRef}
                id="message"
                value={formData.message || ''}
                onChange={(e) => handleChange('message', e.target.value)}
                placeholder="Notification message"
                rows={3}
                data-testid="input-notification-message"
              />
            </div>
          </>
        );


      case 'assignUser':
        return (
          <div className="space-y-2">
            <Label htmlFor="userId">Assign to User ID</Label>
            <Input
              id="userId"
              value={formData.userId || ''}
              onChange={(e) => handleChange('userId', e.target.value)}
              placeholder="user-id"
              data-testid="input-assign-user"
            />
          </div>
        );

      case 'aiGenerate':
        const aiPromptRef = useRef<HTMLTextAreaElement>(null);
        
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt">AI Prompt</Label>
              <VariablePicker
                entityType={formData.entityType || 'lead'}
                onSelect={(v) => handleVariableInsert('prompt', v, aiPromptRef)}
              />
            </div>
            <Textarea
              ref={aiPromptRef}
              id="prompt"
              value={formData.prompt || ''}
              onChange={(e) => handleChange('prompt', e.target.value)}
              placeholder="Generate a personalized welcome email for {{lead.name}}"
              rows={4}
              data-testid="input-ai-prompt"
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
              value={formData.analysisType || 'general'}
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
                  value={formData.conditionField || ''}
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
                  value={formData.conditionOperator || ''}
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
                  value={formData.conditionValue || ''}
                  onChange={(e) => handleChange('conditionValue', e.target.value)}
                  placeholder="Enter value"
                  data-testid="input-condition-value"
                  disabled={formData.conditionOperator === 'is_empty' || formData.conditionOperator === 'is_not_empty'}
                />
              </div>
            </div>

            {/* Preview of the condition */}
            {formData.conditionField && formData.conditionOperator && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">Condition Preview:</p>
                <code className="text-sm">
                  {formData.conditionField} {
                    formData.conditionOperator === 'equals' ? '=' :
                    formData.conditionOperator === 'not_equals' ? '!=' :
                    formData.conditionOperator === 'greater_than' ? '>' :
                    formData.conditionOperator === 'less_than' ? '<' :
                    formData.conditionOperator === 'greater_or_equal' ? '>=' :
                    formData.conditionOperator === 'less_or_equal' ? '<=' :
                    formData.conditionOperator
                  } {formData.conditionOperator !== 'is_empty' && formData.conditionOperator !== 'is_not_empty' ? (formData.conditionValue || '?') : ''}
                </code>
              </div>
            )}

            {/* Help text */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-900 dark:text-blue-100 font-medium mb-1">💡 How it works:</p>
              <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 ml-4 list-disc">
                <li>Select a field from the trigger entity</li>
                <li>Choose an operator to compare</li>
                <li>Enter the value to compare against</li>
                <li>Connect branches to the "true" and "false" handles</li>
              </ul>
            </div>
          </div>
        );

      case 'delay':
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
        
        const { value: durationValue, unit: durationUnit } = parseDuration(formData.duration || '');
        
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

      case 'waitUntil':
        return (
          <div className="space-y-2">
            <Label htmlFor="dateTime">Date/Time</Label>
            <Input
              id="dateTime"
              type="datetime-local"
              value={formData.dateTime || ''}
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
  );
}
