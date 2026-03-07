import { Request, Response, NextFunction } from 'express';
import { aiMonitor } from '../services/ai-monitor';

interface ErrorLog {
  id: string;
  timestamp: Date;
  error: Error;
  context: string;
  analysis?: any;
  contractorId?: string;
}

// In-memory error storage (in production, use database)
const errorLogs: ErrorLog[] = [];
const MAX_ERROR_LOGS = 1000;

/**
 * Enhanced error handling middleware with AI analysis
 */
export function aiErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const context = `${req.method} ${req.path} - User: ${req.user?.userId || 'anonymous'}`;
  
  // Store error log
  const errorLog: ErrorLog = {
    id: errorId,
    timestamp: new Date(),
    error: err,
    context,
    contractorId: req.user?.contractorId
  };
  
  errorLogs.push(errorLog);
  
  // Keep only recent errors
  if (errorLogs.length > MAX_ERROR_LOGS) {
    errorLogs.splice(0, errorLogs.length - MAX_ERROR_LOGS);
  }

  // Analyze error with AI (async, don't block response)
  aiMonitor.analyzeError(err, context)
    .then(analysis => {
      errorLog.analysis = analysis;
      
      // Log critical errors immediately
      if (analysis.severity === 'critical') {
        console.error(`[CRITICAL ERROR] ${errorId}: ${analysis.description}`);
        console.error(`[SUGGESTED FIX] ${analysis.suggestedFix}`);
      }
    })
    .catch(aiErr => {
      console.error('AI error analysis failed:', aiErr.message);
    });

  // Log error details
  console.error(`[ERROR ${errorId}] ${err.message}`);
  console.error(`[CONTEXT] ${context}`);
  console.error(`[STACK] ${err.stack}`);

  // Send response
  const isDevelopment = process.env.NODE_ENV === 'development';
  res.status(500).json({
    message: 'Internal server error',
    errorId: isDevelopment ? errorId : undefined,
    details: isDevelopment ? err.message : undefined
  });
}

/**
 * Get error statistics for monitoring
 */
export function getErrorStats(contractorId?: string): {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recent: ErrorLog[];
} {
  const filteredLogs = contractorId 
    ? errorLogs.filter(log => log.contractorId === contractorId)
    : errorLogs;

  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  
  filteredLogs.forEach(log => {
    if (log.analysis) {
      byCategory[log.analysis.category] = (byCategory[log.analysis.category] || 0) + 1;
      bySeverity[log.analysis.severity] = (bySeverity[log.analysis.severity] || 0) + 1;
    }
  });

  return {
    total: filteredLogs.length,
    byCategory,
    bySeverity,
    recent: filteredLogs.slice(-10) // Last 10 errors
  };
}

/**
 * Get detailed error logs with AI analysis
 */
export function getErrorLogs(contractorId?: string, limit = 50): ErrorLog[] {
  const filteredLogs = contractorId 
    ? errorLogs.filter(log => log.contractorId === contractorId)
    : errorLogs;
    
  return filteredLogs.slice(-limit);
}