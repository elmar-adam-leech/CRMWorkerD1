import OpenAI from "openai";

// xAI API configuration - uses same interface as OpenAI
const grok = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export interface ErrorAnalysis {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  description: string;
  suggestedFix: string;
  confidence: number;
  preventionTips: string[];
}

export interface LogInsight {
  pattern: string;
  frequency: number;
  impact: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface WeeklyReport {
  summary: string;
  errorTrends: string[];
  performanceInsights: string[];
  codeQualityIssues: string[];
  recommendations: string[];
  priorityActions: string[];
}

export class AIMonitorService {
  
  /**
   * Get the appropriate model for the task type
   */
  private getModel(taskType: 'coding' | 'business'): string {
    switch (taskType) {
      case 'coding':
        return 'grok-code-fast-1'; // For technical/coding tasks
      case 'business':
        return 'grok-4-fast-reasoning'; // For business intelligence tasks
      default:
        return 'grok-code-fast-1'; // Default to coding model
    }
  }
  
  /**
   * Analyze an error using Grok AI to provide intelligent insights
   */
  async analyzeError(error: Error, context?: string): Promise<ErrorAnalysis> {
    try {
      const prompt = `
Analyze this error and provide actionable insights:

Error: ${error.message}
Stack: ${error.stack}
Context: ${context || 'Not provided'}

Provide analysis in JSON format with:
- severity (low/medium/high/critical)
- category (database, api, validation, sync, etc)
- description (clear explanation)
- suggestedFix (specific fix recommendation)
- confidence (0-1 score)
- preventionTips (array of prevention strategies)
`;

      const response = await grok.chat.completions.create({
        model: this.getModel('coding'),
        messages: [
          {
            role: "system",
            content: "You are an expert software engineer analyzing errors in a multi-tenant CRM system. Provide practical, actionable insights."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      return JSON.parse(response.choices[0].message.content || '{}');
    } catch (aiError) {
      console.error('AI error analysis failed:', aiError);
      // Fallback analysis
      return {
        severity: 'medium',
        category: 'unknown',
        description: `Error: ${error.message}`,
        suggestedFix: 'Review error logs and stack trace for debugging',
        confidence: 0.1,
        preventionTips: ['Add better error handling', 'Implement monitoring']
      };
    }
  }

  /**
   * Analyze application logs to find patterns and insights
   */
  async analyzeLogs(logs: string[], timeframe: string = 'last 24 hours'): Promise<LogInsight[]> {
    try {
      const logSample = logs.slice(-100).join('\n'); // Last 100 log entries
      
      const prompt = `
Analyze these application logs from ${timeframe} and identify patterns:

${logSample}

Find:
- Recurring error patterns
- Performance bottlenecks
- Unusual activity patterns
- Resource usage issues

Return JSON array of insights with: pattern, frequency, impact, recommendation
`;

      const response = await grok.chat.completions.create({
        model: this.getModel('coding'),
        messages: [
          {
            role: "system",
            content: "You are a DevOps expert analyzing application logs for a CRM system. Focus on actionable insights."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      const result = JSON.parse(response.choices[0].message.content || '{"insights": []}');
      return result.insights || [];
    } catch (error) {
      console.error('AI log analysis failed:', error);
      return [];
    }
  }

  /**
   * Generate weekly code review and improvement report
   */
  async generateWeeklyReport(
    errorCounts: Record<string, number>,
    performanceMetrics: any,
    recentChanges: string[]
  ): Promise<WeeklyReport> {
    try {
      const prompt = `
Generate a weekly improvement report for a CRM system:

Error Summary:
${Object.entries(errorCounts).map(([type, count]) => `- ${type}: ${count} occurrences`).join('\n')}

Performance Metrics:
${JSON.stringify(performanceMetrics, null, 2)}

Recent Changes:
${recentChanges.map(change => `- ${change}`).join('\n')}

Provide comprehensive analysis with:
- summary (overall system health)
- errorTrends (patterns in errors)
- performanceInsights (performance analysis)
- codeQualityIssues (potential code problems)
- recommendations (specific improvements)
- priorityActions (top 3 urgent actions)
`;

      const response = await grok.chat.completions.create({
        model: this.getModel('business'),
        messages: [
          {
            role: "system",
            content: "You are a senior business analyst and software architect reviewing a multi-tenant CRM system. Provide strategic business insights and actionable recommendations for both technical and business performance."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.4
      });

      return JSON.parse(response.choices[0].message.content || '{}');
    } catch (error) {
      console.error('AI weekly report failed:', error);
      return {
        summary: 'AI analysis unavailable',
        errorTrends: [],
        performanceInsights: [],
        codeQualityIssues: [],
        recommendations: [],
        priorityActions: []
      };
    }
  }

  /**
   * Analyze code quality and suggest improvements
   */
  async analyzeCodeQuality(filePath: string, codeContent: string): Promise<{
    score: number;
    issues: string[];
    suggestions: string[];
  }> {
    try {
      const prompt = `
Analyze this ${filePath} file for code quality:

\`\`\`
${codeContent.slice(0, 4000)} // Truncated for analysis
\`\`\`

Evaluate:
- Code structure and organization
- Error handling
- Performance considerations
- Security issues
- Maintainability

Return JSON with: score (0-100), issues (array), suggestions (array)
`;

      const response = await grok.chat.completions.create({
        model: this.getModel('coding'),
        messages: [
          {
            role: "system",
            content: "You are a code quality expert. Provide specific, actionable feedback for TypeScript/JavaScript code."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      return JSON.parse(response.choices[0].message.content || '{"score": 50, "issues": [], "suggestions": []}');
    } catch (error) {
      console.error('AI code analysis failed:', error);
      return {
        score: 50,
        issues: ['AI analysis unavailable'],
        suggestions: ['Manual code review recommended']
      };
    }
  }
}

// Export singleton instance
export const aiMonitor = new AIMonitorService();