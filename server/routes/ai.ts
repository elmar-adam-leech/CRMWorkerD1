import type { Express, Response } from "express";
import { requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { weeklyReporter } from "../services/weekly-reporter";
import { aiMonitor } from "../services/ai-monitor";
import { businessMetrics } from "../services/business-metrics";
import { getErrorStats, getErrorLogs } from "../middleware/error-monitor";
import { aiRateLimiter } from "../middleware/rate-limiter";

export function registerAiRoutes(app: Express): void {
  // ================================
  // AI MONITORING ROUTES
  // ================================
  
  // Get error statistics and analysis
  app.get("/api/ai/errors", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const stats = getErrorStats(req.user!.contractorId);
      res.json(stats);
    } catch (error) {
      console.error('Failed to get error stats:', error);
      res.status(500).json({ message: "Failed to get error statistics" });
    }
  });

  // Get detailed error logs with AI analysis
  app.get("/api/ai/error-logs", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = getErrorLogs(req.user!.contractorId, limit);
      res.json(logs);
    } catch (error) {
      console.error('Failed to get error logs:', error);
      res.status(500).json({ message: "Failed to get error logs" });
    }
  });

  // Generate weekly AI report
  app.post("/api/ai/weekly-report", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const report = await weeklyReporter.generateWeeklyReport(req.user!.contractorId);
      res.json(report);
    } catch (error) {
      console.error('Failed to generate weekly report:', error);
      res.status(500).json({ message: "Failed to generate weekly report" });
    }
  });

  // Get latest weekly report
  app.get("/api/ai/weekly-report", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const report = weeklyReporter.getLatestReport(req.user!.contractorId);
      if (!report) {
        res.status(404).json({ message: "No weekly report found" });
        return;
      }
      res.json(report);
    } catch (error) {
      console.error('Failed to get weekly report:', error);
      res.status(500).json({ message: "Failed to get weekly report" });
    }
  });

  // Get all weekly reports
  app.get("/api/ai/weekly-reports", aiRateLimiter, requireManagerOrAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const reports = weeklyReporter.getReports(req.user!.contractorId);
      res.json(reports);
    } catch (error) {
      console.error('Failed to get weekly reports:', error);
      res.status(500).json({ message: "Failed to get weekly reports" });
    }
  });

  // Analyze code quality for a specific file
  app.post("/api/ai/analyze-code", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filePath, codeContent } = req.body;
      
      if (!filePath || !codeContent) {
        res.status(400).json({ message: "filePath and codeContent are required" });
        return;
      }
      
      const analysis = await aiMonitor.analyzeCodeQuality(filePath, codeContent);
      res.json(analysis);
    } catch (error) {
      console.error('Failed to analyze code:', error);
      res.status(500).json({ message: "Failed to analyze code quality" });
    }
  });

  // Business metrics for contractors
  app.get("/api/ai/business-metrics", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only non-super-admin users get business metrics
      if (req.user!.role === 'super_admin') {
        res.status(403).json({ message: "Business metrics not available for super admins" });
        return;
      }

      const daysPeriod = parseInt(req.query.days as string) || 30;
      const metrics = await businessMetrics.calculateMetrics(req.user!.contractorId, daysPeriod);
      res.json(metrics);
    } catch (error) {
      console.error('Failed to get business metrics:', error);
      res.status(500).json({ message: "Failed to get business metrics" });
    }
  });

  // Business insights for contractors
  app.get("/api/ai/business-insights", aiRateLimiter, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only non-super-admin users get business insights
      if (req.user!.role === 'super_admin') {
        res.status(403).json({ message: "Business insights not available for super admins" });
        return;
      }

      const daysPeriod = parseInt(req.query.days as string) || 30;
      const metrics = await businessMetrics.calculateMetrics(req.user!.contractorId, daysPeriod);
      const insights = await businessMetrics.generateBusinessInsights(metrics);
      res.json(insights);
    } catch (error) {
      console.error('Failed to get business insights:', error);
      res.status(500).json({ message: "Failed to get business insights" });
    }
  });

}
