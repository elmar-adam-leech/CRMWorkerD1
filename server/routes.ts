import type { Express, NextFunction } from "express";
import { createServer, type Server } from "http";
import cookieParser from "cookie-parser";
import { requireAuth } from "./auth-service";
import { aiErrorHandler } from './middleware/error-monitor';
import { setupWebSocket } from './websocket';

import { registerAuthRoutes } from './routes/auth';
import { registerOAuthRoutes } from './routes/oauth';
import { registerUserRoutes } from './routes/users';
import { registerContactRoutes } from './routes/contacts';
import { registerContactActionRoutes } from './routes/contact-actions';
import { registerJobRoutes } from './routes/jobs';
import { registerEstimateRoutes } from './routes/estimates';
import { registerActivityRoutes } from './routes/activities';
import { registerEmployeeRoutes } from './routes/employees';
import { registerMessagingRoutes } from './routes/messaging';
import { registerTemplateRoutes } from './routes/templates';
import { registerEmailSyncRoutes } from './routes/email-sync';
import { registerWorkflowRoutes } from './routes/workflows';
import { registerNotificationRoutes } from './routes/notifications';
import { registerAiRoutes } from './routes/ai';
import { registerSettingsRoutes } from './routes/settings';
import { registerIntegrationRoutes } from './routes/integrations';
import { registerDialpadRoutes } from './routes/integrations/dialpad';
import { registerHousecallProRoutes } from './routes/integrations/housecall-pro';
import { registerHcpSyncRoutes } from './routes/integrations/hcp-sync';
import { registerHcpSchedulingRoutes } from './routes/integrations/hcp-scheduling';
import { registerGoogleSheetsRoutes } from './routes/integrations/google-sheets';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerPublicRoutes } from './routes/public';

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(cookieParser());

  app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path === '/' || req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    else if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
      res.setHeader('Cache-Control', 'max-age=300, must-revalidate');
    }
    next();
  });

  app.use("/api", (req, res, next: NextFunction) => {
    if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/logout') {
      return next();
    }
    if (req.path === '/auth/forgot-password' || req.path === '/auth/reset-password') {
      return next();
    }
    if (req.path === '/version') {
      return next();
    }
    if (req.path.startsWith('/webhooks/')) {
      return next();
    }
    if (req.path.startsWith('/public/')) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  registerAuthRoutes(app);
  registerOAuthRoutes(app);
  registerUserRoutes(app);
  registerContactActionRoutes(app);
  registerContactRoutes(app);
  registerJobRoutes(app);
  registerEstimateRoutes(app);
  registerActivityRoutes(app);
  registerEmployeeRoutes(app);
  registerMessagingRoutes(app);
  registerTemplateRoutes(app);
  registerEmailSyncRoutes(app);
  registerWorkflowRoutes(app);
  registerNotificationRoutes(app);
  registerAiRoutes(app);
  registerSettingsRoutes(app);
  registerIntegrationRoutes(app);
  registerDialpadRoutes(app);
  registerHousecallProRoutes(app);
  registerHcpSyncRoutes(app);
  registerHcpSchedulingRoutes(app);
  registerGoogleSheetsRoutes(app);
  registerWebhookRoutes(app);
  registerPublicRoutes(app);

  app.use(aiErrorHandler);

  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status ?? err.statusCode ?? 500;
    const message = err.message ?? "Internal server error";
    if (status >= 500) console.error("[route error]", err);
    res.status(status).json({ message });
  });

  const httpServer = createServer(app);
  setupWebSocket(httpServer);

  return httpServer;
}
