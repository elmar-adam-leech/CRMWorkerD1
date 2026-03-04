import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Info } from 'lucide-react';

interface ConditionalNodeFormProps {
  formData: Record<string, unknown>;
  handleChange: (field: string, value: unknown) => void;
}

export function ConditionalNodeForm({ formData, handleChange }: ConditionalNodeFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Condition Builder</Label>
        <p className="text-sm text-muted-foreground">Build a condition to branch your workflow</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-2">
          <Label htmlFor="conditionField" className="text-xs">Field</Label>
          <Select value={String(formData.conditionField || '')} onValueChange={(value) => handleChange('conditionField', value)}>
            <SelectTrigger id="conditionField" data-testid="select-condition-field"><SelectValue placeholder="Select field" /></SelectTrigger>
            <SelectContent>
              {formData.entityType === 'lead' && (<><SelectItem value="lead.status">Status</SelectItem><SelectItem value="lead.name">Name</SelectItem><SelectItem value="lead.email">Email</SelectItem><SelectItem value="lead.phone">Phone</SelectItem><SelectItem value="lead.source">Source</SelectItem></>)}
              {formData.entityType === 'estimate' && (<><SelectItem value="estimate.status">Status</SelectItem><SelectItem value="estimate.total">Total Amount</SelectItem><SelectItem value="estimate.title">Title</SelectItem><SelectItem value="estimate.customerName">Customer Name</SelectItem></>)}
              {formData.entityType === 'job' && (<><SelectItem value="job.status">Status</SelectItem><SelectItem value="job.type">Type</SelectItem><SelectItem value="job.priority">Priority</SelectItem><SelectItem value="job.scheduledDate">Scheduled Date</SelectItem></>)}
              {formData.entityType === 'customer' && (<><SelectItem value="customer.status">Status</SelectItem><SelectItem value="customer.name">Name</SelectItem><SelectItem value="customer.email">Email</SelectItem></>)}
              {!formData.entityType && (<SelectItem value="custom" disabled>Set trigger entity type first</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="conditionOperator" className="text-xs">Operator</Label>
          <Select value={String(formData.conditionOperator || '')} onValueChange={(value) => handleChange('conditionOperator', value)}>
            <SelectTrigger id="conditionOperator" data-testid="select-condition-operator"><SelectValue placeholder="Operator" /></SelectTrigger>
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

        <div className="space-y-2">
          <Label htmlFor="conditionValue" className="text-xs">Value</Label>
          <Input id="conditionValue" value={String(formData.conditionValue || '')} onChange={(e) => handleChange('conditionValue', e.target.value)} placeholder="Enter value" data-testid="input-condition-value" disabled={formData.conditionOperator === 'is_empty' || formData.conditionOperator === 'is_not_empty'} />
        </div>
      </div>

      {Boolean(formData.conditionField) && Boolean(formData.conditionOperator) && (
        <div className="p-3 bg-muted rounded-md">
          <p className="text-sm font-medium mb-1">Condition Preview:</p>
          <code className="text-sm">
            {String(formData.conditionField)}{' '}
            {formData.conditionOperator === 'equals' ? '=' : formData.conditionOperator === 'not_equals' ? '!=' : formData.conditionOperator === 'greater_than' ? '>' : formData.conditionOperator === 'less_than' ? '<' : formData.conditionOperator === 'greater_or_equal' ? '>=' : formData.conditionOperator === 'less_or_equal' ? '<=' : String(formData.conditionOperator)}{' '}
            {formData.conditionOperator !== 'is_empty' && formData.conditionOperator !== 'is_not_empty' ? (String(formData.conditionValue) || '?') : ''}
          </code>
        </div>
      )}

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
}
