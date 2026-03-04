import { useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { VariableTextareaField, insertVariableAtCursor } from './shared-fields';

interface AiNodeFormProps {
  formData: Record<string, unknown>;
  handleChange: (field: string, value: unknown) => void;
  entityType: "lead" | "estimate" | "job" | "customer";
  nodeType: string;
}

export function AiNodeForm({ formData, handleChange, entityType, nodeType }: AiNodeFormProps) {
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);

  if (nodeType === 'aiGenerate') {
    return (
      <div className="space-y-2">
        <VariableTextareaField label="AI Prompt" fieldName="prompt" textareaRef={aiPromptRef} entityType={entityType} value={String(formData.prompt || '')} onChange={(e) => handleChange('prompt', e.target.value)} onVariableSelect={(v) => insertVariableAtCursor('prompt', v, aiPromptRef, String(formData.prompt || ''), handleChange)} placeholder="Generate a personalized welcome email for {{lead.name}}" rows={4} testId="input-ai-prompt" />
        <p className="text-xs text-muted-foreground">Use variables to personalize AI-generated content</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="analysisType">Analysis Type</Label>
      <Select value={String(formData.analysisType || 'general')} onValueChange={(value) => handleChange('analysisType', value)}>
        <SelectTrigger id="analysisType" data-testid="select-analysis-type"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="general">General Analysis</SelectItem>
          <SelectItem value="sentiment">Sentiment Analysis</SelectItem>
          <SelectItem value="priority">Priority Assessment</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
