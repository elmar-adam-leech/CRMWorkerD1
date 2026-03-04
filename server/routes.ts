import type { Express, NextFunction } from "express";
import { createServer, type Server } from "http";
import cookieParser from "cookie-parser";
import { requireAuth } from "./auth-service";
import { aiErrorHandler } from './middleware/error-monitor';
import { setupWebSocket } from './websocket';

import { registerAuthRoutes } from './routes/auth';
import { registerUserRoutes } from './routes/users';
import { registerContactRoutes } from './routes/contacts';
import { registerJobEstimateRoutes } from './routes/jobs-estimates';
import { registerEmployeeRoutes } from './routes/employees';
import { registerMessagingRoutes } from './routes/messaging';
import { registerWorkflowRoutes } from './routes/workflows';
import { registerAiRoutes } from './routes/ai';
import { registerSettingsRoutes } from './routes/settings';
import { registerIntegrationRoutes } from './routes/integrations';
import { registerDialpadRoutes } from './routes/dialpad';
import { registerHousecallProRoutes } from './routes/housecall-pro';
import { registerGoogleSheetsRoutes } from './routes/google-sheets';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerPublicRoutes } from './routes/public';

export async function registerRoutes(app: Express): Promise<Server> {
  // Add cookie parser middleware for JWT tokens in cookies
  app.use(cookieParser());
  
  // Add cache control headers for better cache management
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
  
  // Apply authentication middleware to all /api routes except public auth routes and webhooks
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

  // Register all domain route handlers
  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerContactRoutes(app);
  registerJobEstimateRoutes(app);
  registerEmployeeRoutes(app);
  registerMessagingRoutes(app);
  registerWorkflowRoutes(app);
  registerAiRoutes(app);
  registerSettingsRoutes(app);
  registerIntegrationRoutes(app);
  registerDialpadRoutes(app);
  registerHousecallProRoutes(app);
  registerGoogleSheetsRoutes(app);
  registerWebhookRoutes(app);
  registerPublicRoutes(app);

  // Add AI error handler middleware (should be last middleware)
  app.use(aiErrorHandler);

  const httpServer = createServer(app);
  
  // Setup WebSocket server for real-time messaging
  setupWebSocket(httpServer);
  
  return httpServer;
}
