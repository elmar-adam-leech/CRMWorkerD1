import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { providerService } from "./providers/provider-service";
import { syncScheduler } from "./sync-scheduler";
import { messageCleanupService } from "./services/message-cleanup";

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize provider service (registers default providers)
  log("Initializing multi-provider communication system...");
  const providers = providerService; // This triggers singleton initialization and provider registration
  log(`Provider system initialized with ${providers.getAvailableProviders('email').length} email, ${providers.getAvailableProviders('sms').length} SMS, ${providers.getAvailableProviders('calling').length} calling providers`);
  
  // Start the sync scheduler for daily syncs
  log("Starting sync scheduler...");
  syncScheduler.start();
  
  // Start the message cleanup service
  log("Starting message cleanup service...");
  messageCleanupService.start();
  
  const server = await registerRoutes(app);

  // Global error-handling contract:
  //  - ZodError  → 400 with the first validation message (no need to catch in individual routes)
  //  - Other errors with an explicit .status/.statusCode → that status
  //  - Everything else → 500 Internal Server Error
  // Route handlers should still catch non-Zod errors they want to handle differently.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ message: err.issues[0]?.message ?? "Validation error", errors: err.issues });
      return;
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
