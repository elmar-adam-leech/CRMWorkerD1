/**
 * Variable replacement utility for workflow automation
 * Replaces {{placeholders}} with actual values during workflow execution
 */

/**
 * Replace all {{placeholder}} variables in a string with actual values
 * @param template - String containing {{placeholder}} variables
 * @param variables - Object with variable values
 * @returns String with all variables replaced
 */
export function replaceVariables(template: string, variables: Record<string, any>): string {
  if (!template || typeof template !== 'string') {
    return template;
  }

  // Regular expression to match {{variable.path}} patterns
  const variablePattern = /\{\{([^}]+)\}\}/g;

  return template.replace(variablePattern, (match, variablePath) => {
    // Trim whitespace from variable path
    const cleanPath = variablePath.trim();
    
    // Split the path (e.g., "lead.name" => ["lead", "name"])
    const pathParts = cleanPath.split('.');
    
    // Navigate through the variables object
    let value: any = variables;
    for (const part of pathParts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        // Variable not found, return empty string
        return '';
      }
    }

    // Convert value to string
    if (value === null || value === undefined) {
      return '';
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

/**
 * Replace variables in an object recursively
 * @param obj - Object that may contain {{placeholder}} strings
 * @param variables - Object with variable values
 * @returns New object with all variables replaced
 */
export function replaceVariablesInObject(obj: any, variables: Record<string, any>): any {
  if (typeof obj === 'string') {
    return replaceVariables(obj, variables);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceVariablesInObject(item, variables));
  }

  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = replaceVariablesInObject(obj[key], variables);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Extract all variable placeholders from a string
 * @param template - String that may contain {{placeholder}} variables
 * @returns Array of unique variable paths found
 */
export function extractPlaceholders(template: string): string[] {
  if (!template || typeof template !== 'string') {
    return [];
  }

  const variablePattern = /\{\{([^}]+)\}\}/g;
  const placeholders: string[] = [];
  let match;

  while ((match = variablePattern.exec(template)) !== null) {
    const cleanPath = match[1].trim();
    if (!placeholders.includes(cleanPath)) {
      placeholders.push(cleanPath);
    }
  }

  return placeholders;
}

/**
 * Validate that all required variables are present
 * @param template - String containing {{placeholder}} variables
 * @param variables - Object with variable values
 * @returns Array of missing variable paths
 */
export function findMissingVariables(template: string, variables: Record<string, any>): string[] {
  const placeholders = extractPlaceholders(template);
  const missing: string[] = [];

  for (const placeholder of placeholders) {
    const pathParts = placeholder.split('.');
    let value: any = variables;
    let found = true;

    for (const part of pathParts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        found = false;
        break;
      }
    }

    if (!found || value === null || value === undefined) {
      missing.push(placeholder);
    }
  }

  return missing;
}
