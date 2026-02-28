/**
 * Variable extraction utility for workflow automation
 * Extracts all available fields from trigger entities (leads, estimates, jobs, customers)
 */

export interface EntityVariable {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'array';
  example?: string;
}

export interface EntityVariables {
  entity: string;
  variables: EntityVariable[];
  contactVariables?: EntityVariable[];
}

/**
 * Contact variables shared across entities that reference contacts
 */
const contactVariables: EntityVariable[] = [
  { key: 'contact.name', label: 'Contact Name', type: 'string', example: 'John Doe' },
  { key: 'contact.emails', label: 'Contact Email', type: 'array', example: 'john@example.com' },
  { key: 'contact.phones', label: 'Contact Phone', type: 'array', example: '(555) 123-4567' },
  { key: 'contact.address', label: 'Contact Address', type: 'string', example: '123 Main St' },
  { key: 'contact.type', label: 'Contact Type', type: 'string', example: 'lead' },
  { key: 'contact.status', label: 'Contact Status', type: 'string', example: 'new' },
  { key: 'contact.source', label: 'Contact Source', type: 'string', example: 'website' },
  { key: 'contact.notes', label: 'Contact Notes', type: 'string', example: 'Interested in HVAC' },
];

/**
 * Get all available variables for a given entity type
 */
export function getEntityVariables(entityType: 'lead' | 'estimate' | 'job' | 'customer'): EntityVariables {
  const baseVariables: EntityVariable[] = [
    { key: 'id', label: 'ID', type: 'string', example: 'abc-123' },
    { key: 'createdAt', label: 'Created Date', type: 'date', example: '2025-01-15' },
  ];

  switch (entityType) {
    case 'lead':
      return {
        entity: 'lead',
        variables: [
          ...baseVariables,
          { key: 'name', label: 'Name', type: 'string', example: 'John Doe' },
          { key: 'emails', label: 'Email Addresses', type: 'array', example: 'john@example.com' },
          { key: 'phones', label: 'Phone Numbers', type: 'array', example: '(555) 123-4567' },
          { key: 'address', label: 'Address', type: 'string', example: '123 Main St' },
          { key: 'type', label: 'Type', type: 'string', example: 'lead' },
          { key: 'status', label: 'Status', type: 'string', example: 'new' },
          { key: 'source', label: 'Source', type: 'string', example: 'website' },
          { key: 'notes', label: 'Notes', type: 'string', example: 'Interested in HVAC installation' },
          { key: 'followUpDate', label: 'Follow-up Date', type: 'date', example: '2025-02-01' },
        ],
      };

    case 'estimate':
      return {
        entity: 'estimate',
        variables: [
          ...baseVariables,
          { key: 'title', label: 'Title', type: 'string', example: 'HVAC Installation Quote' },
          { key: 'description', label: 'Description', type: 'string', example: 'Full system installation' },
          { key: 'amount', label: 'Amount', type: 'string', example: '5000.00' },
          { key: 'status', label: 'Status', type: 'string', example: 'sent' },
          { key: 'validUntil', label: 'Valid Until', type: 'date', example: '2025-02-15' },
          { key: 'followUpDate', label: 'Follow-up Date', type: 'date', example: '2025-01-20' },
          { key: 'contactId', label: 'Contact ID', type: 'string', example: 'contact-789' },
        ],
        contactVariables,
      };

    case 'job':
      return {
        entity: 'job',
        variables: [
          ...baseVariables,
          { key: 'title', label: 'Title', type: 'string', example: 'HVAC Repair Service' },
          { key: 'type', label: 'Type', type: 'string', example: 'repair' },
          { key: 'status', label: 'Status', type: 'string', example: 'scheduled' },
          { key: 'priority', label: 'Priority', type: 'string', example: 'high' },
          { key: 'value', label: 'Value', type: 'string', example: '500.00' },
          { key: 'estimatedHours', label: 'Estimated Hours', type: 'number', example: '4' },
          { key: 'scheduledDate', label: 'Scheduled Date', type: 'date', example: '2025-01-18' },
          { key: 'contactId', label: 'Contact ID', type: 'string', example: 'contact-789' },
          { key: 'estimateId', label: 'Estimate ID', type: 'string', example: 'estimate-456' },
        ],
        contactVariables,
      };

    case 'customer':
      return {
        entity: 'customer',
        variables: [
          ...baseVariables,
          { key: 'name', label: 'Name', type: 'string', example: 'Jane Smith' },
          { key: 'emails', label: 'Email Addresses', type: 'array', example: 'jane@example.com' },
          { key: 'phones', label: 'Phone Numbers', type: 'array', example: '(555) 987-6543' },
          { key: 'address', label: 'Address', type: 'string', example: '456 Oak Ave' },
          { key: 'type', label: 'Type', type: 'string', example: 'customer' },
          { key: 'status', label: 'Status', type: 'string', example: 'active' },
          { key: 'source', label: 'Source', type: 'string', example: 'referral' },
          { key: 'notes', label: 'Notes', type: 'string', example: 'VIP customer' },
        ],
      };

    default:
      return { entity: entityType, variables: baseVariables };
  }
}

/**
 * Extract variable values from an entity object with proper nested structure
 * Handles both direct entity fields and nested contact fields
 */
export function extractVariablesFromEntity(entity: any, entityType: string): Record<string, any> {
  const variables: Record<string, any> = {};
  const entityVars = getEntityVariables(entityType as any);

  // Extract direct entity variables
  for (const varDef of entityVars.variables) {
    const value = entity[varDef.key];
    
    // Handle array fields (emails, phones)
    if (varDef.type === 'array' && Array.isArray(value)) {
      variables[varDef.key] = value.length > 0 ? value[0] : '';
      variables[`${varDef.key}_all`] = value.join(', ');
    } 
    // Handle date fields
    else if (varDef.type === 'date' && value) {
      variables[varDef.key] = value instanceof Date ? value.toISOString() : value;
    }
    // Handle other fields
    else {
      variables[varDef.key] = value ?? '';
    }
  }

  // Extract contact variables if entity has a contact - CREATE NESTED STRUCTURE
  if (entityVars.contactVariables && entity.contact) {
    // Create nested contact object
    const contactData: Record<string, any> = {};
    
    for (const varDef of entityVars.contactVariables) {
      // Extract the field name without the "contact." prefix
      const contactKey = varDef.key.replace('contact.', '');
      const value = entity.contact[contactKey];
      
      // Handle array fields (emails, phones)
      if (varDef.type === 'array' && Array.isArray(value)) {
        contactData[contactKey] = value.length > 0 ? value[0] : '';
        contactData[`${contactKey}_all`] = value.join(', ');
      } 
      // Handle date fields
      else if (varDef.type === 'date' && value) {
        contactData[contactKey] = value instanceof Date ? value.toISOString() : value;
      }
      // Handle other fields
      else {
        contactData[contactKey] = value ?? '';
      }
    }
    
    // Add the nested contact object
    variables.contact = contactData;
  }

  return variables;
}

/**
 * Get all available variable placeholders for an entity type
 */
export function getVariablePlaceholders(entityType: 'lead' | 'estimate' | 'job' | 'customer'): string[] {
  const entityVars = getEntityVariables(entityType);
  const placeholders: string[] = [];

  // Add entity variable placeholders
  for (const varDef of entityVars.variables) {
    if (varDef.type === 'array') {
      placeholders.push(`{{${entityType}.${varDef.key}}}`);
      placeholders.push(`{{${entityType}.${varDef.key}_all}}`);
    } else {
      placeholders.push(`{{${entityType}.${varDef.key}}}`);
    }
  }

  // Add contact variable placeholders if applicable
  if (entityVars.contactVariables) {
    for (const varDef of entityVars.contactVariables) {
      if (varDef.type === 'array') {
        placeholders.push(`{{${entityType}.${varDef.key}}}`);
        placeholders.push(`{{${entityType}.${varDef.key}_all}}`);
      } else {
        placeholders.push(`{{${entityType}.${varDef.key}}}`);
      }
    }
  }

  return placeholders;
}
