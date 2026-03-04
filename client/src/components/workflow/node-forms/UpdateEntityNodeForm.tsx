import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface UpdateEntityNodeFormProps {
  formData: Record<string, unknown>;
  handleChange: (field: string, value: unknown) => void;
  setFormData: (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  terminology: { leadLabel?: string; estimateLabel?: string; jobLabel?: string } | undefined;
}

export function UpdateEntityNodeForm({ formData, handleChange, setFormData, terminology }: UpdateEntityNodeFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="entityType">Entity Type</Label>
        <Select value={String(formData.entityType || 'lead')} onValueChange={(value) => handleChange('entityType', value)}>
          <SelectTrigger id="entityType" data-testid="select-update-entity-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">{terminology?.leadLabel || 'Lead'}</SelectItem>
            <SelectItem value="estimate">{terminology?.estimateLabel || 'Estimate'}</SelectItem>
            <SelectItem value="job">{terminology?.jobLabel || 'Job'}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="updateField">Field to Update</Label>
        <Input id="updateField" value={String(formData.updateField || '')} onChange={(e) => {
          const newField = e.target.value;
          setFormData(prev => ({ ...prev, updateField: newField, updates: { [newField]: prev.updateValue || '' } }));
        }} placeholder="e.g. status, priority, notes" data-testid="input-update-entity-field" />
        <p className="text-xs text-muted-foreground">The field name on the entity to change</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="updateValue">New Value</Label>
        <Input id="updateValue" value={String(formData.updateValue || '')} onChange={(e) => {
          const newValue = e.target.value;
          setFormData(prev => ({ ...prev, updateValue: newValue, updates: { [String(prev.updateField || '')]: newValue } }));
        }} placeholder="e.g. contacted, high, Follow-up sent" data-testid="input-update-entity-value" />
      </div>
      {Boolean(formData.updateField) && Boolean(formData.updateValue) && (
        <div className="p-3 bg-muted rounded-md">
          <p className="text-sm font-medium mb-1">Preview:</p>
          <code className="text-sm">Set {String(formData.entityType || 'lead')}.{String(formData.updateField)} = "{String(formData.updateValue)}"</code>
        </div>
      )}
    </div>
  );
}
