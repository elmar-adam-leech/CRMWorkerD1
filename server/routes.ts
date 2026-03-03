import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertUserSchema, insertContractorSchema, insertContactSchema, insertJobSchema, insertEstimateSchema, insertMessageSchema, insertTemplateSchema, insertCallSchema, insertActivitySchema, updateEmployeeRolesSchema, paginatedEstimatesSchema, paginatedJobsSchema, jobsPaginationQuerySchema, insertWorkflowSchema, insertWorkflowStepSchema, users, templates, webhookEvents, webhooks, dialpadPhoneNumbers, passwordResetTokens, contractors, messages, activities, userContractors } from "@shared/schema";
import { db } from "./db";
import { eq, and, gt, sql, isNotNull, ilike, desc } from "drizzle-orm";
import { dialpadService } from "./dialpad-service";
import { dialpadEnhancedService, DialpadEnhancedService } from "./dialpad-enhanced-service";
import { gmailService } from "./gmail-service";
import { providerService, INTEGRATION_NAMES } from "./providers/provider-service";
import { housecallProService } from "./housecall-pro-service";
import { AuthService, requireAuth, requireManagerOrAdmin, requireAdmin, requireContractorAccess, type AuthenticatedRequest } from "./auth-service";
import { CredentialService } from "./credential-service";
import { GoogleSheetsService, suggestColumnMappings, type ColumnMapping, type LeadRowData } from "./google-sheets-service";
import cookieParser from "cookie-parser";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { aiErrorHandler, getErrorStats, getErrorLogs } from './middleware/error-monitor';
import { publicBookingRateLimiter, publicBookingSubmitRateLimiter, webhookRateLimiter, authLoginRateLimiter, authRegisterRateLimiter, authForgotPasswordRateLimiter, aiRateLimiter } from './middleware/rate-limiter';
import { weeklyReporter } from './services/weekly-reporter';
import { aiMonitor } from './services/ai-monitor';
import { businessMetrics } from './services/business-metrics';
import { sendGridService } from './sendgrid-service';
import { setupWebSocket, broadcastToContractor } from './websocket';
import { workflowEngine } from './workflow-engine';

// Validation schemas
const scheduleContactSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  scheduledStart: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid start date format"
  }),
  scheduledEnd: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid end date format" 
  }),
  description: z.string().optional()
});

// Note: AuthenticatedRequest interface and authentication middleware are now imported from auth-service.ts

export async function registerRoutes(app: Express): Promise<Server> {
  // Add cookie parser middleware for JWT tokens in cookies
  app.use(cookieParser());
  
  // Add cache control headers for better cache management
  app.use((req, res, next) => {
    // For HTML files, prevent caching to ensure fresh content
    if (req.path.endsWith('.html') || req.path === '/' || req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    // For static assets (JS, CSS), allow short-term caching with validation
    else if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
      res.setHeader('Cache-Control', 'max-age=300, must-revalidate'); // 5 minutes
    }
    next();
  });
  
  // Apply authentication middleware to all /api routes except public auth routes and webhooks
  app.use("/api", (req, res, next) => {
    // Allow public access to login and registration routes
    if (req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/logout') {
      return next();
    }
    // Allow public access to password reset routes
    if (req.path === '/auth/forgot-password' || req.path === '/auth/reset-password') {
      return next();
    }
    // Allow public access to version endpoint (for cache-busting)
    if (req.path === '/version') {
      return next();
    }
    // Allow public access to webhook endpoints (external services need unauthenticated access)
    if (req.path.startsWith('/webhooks/')) {
      return next();
    }
    // Allow public access to booking endpoints (leads can self-schedule without authentication)
    if (req.path.startsWith('/public/')) {
      return next();
    }
    // Apply authentication to all other routes
    return requireAuth(req, res, next);
  });

  // Authentication routes
  app.post("/api/auth/login", authLoginRateLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ message: "Email and password are required" });
        return;
      }

      const user = await storage.verifyPasswordByEmail(email, password);
      if (!user) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
      }

      if (!user.contractorId) {
        res.status(500).json({ message: "User account has no contractor association" });
        return;
      }

      // Ensure user_contractors junction table entry exists (fixes authentication persistence)
      await storage.ensureUserContractorEntry(
        user.id,
        user.contractorId,
        user.role,
        user.canManageIntegrations || false
      );

      // Generate JWT token
      const token = AuthService.generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        contractorId: user.contractorId,
        canManageIntegrations: user.canManageIntegrations || false
      });

      // Set HTTP-only cookie for web apps (more secure)
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'lax', // 'lax' allows OAuth redirects while still protecting against CSRF
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (sliding expiration)
        path: '/', // Explicit path for better cookie persistence
      });

      // Also return token for API clients
      res.json({ 
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          contractorId: user.contractorId! // We already checked this above
        },
        message: "Login successful" 
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // User registration route - supports multi-contractor signup
  app.post("/api/auth/register", authRegisterRateLimiter, async (req: Request, res: Response) => {
    try {
      const { contractorName, ...userData } = req.body;
      
      // SECURITY: Never accept role or contractorId from request body
      delete userData.role;
      
      // SECURITY: Reject any request with contractorId - must use invitation system
      if (userData.contractorId) {
        res.status(400).json({ 
          message: "Direct contractor assignment not allowed. Please request an invitation from your administrator." 
        });
        return;
      }
      
      // Contractor name is required for public signup
      if (!contractorName) {
        res.status(400).json({ message: "Company name is required" });
        return;
      }

      // Generate a domain from the contractor name
      const domain = contractorName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      
      // Check if contractor domain already exists
      const existingContractor = await storage.getContractorByDomain(domain);
      if (existingContractor) {
        // SECURITY: Don't allow joining existing contractor without invitation
        res.status(400).json({ 
          message: "Company already exists. Please contact your administrator for an invitation." 
        });
        return;
      }

      // SECURITY: Check if user already exists and verify credentials BEFORE creating contractor
      // This prevents domain squatting attacks where attackers create contractors with other users' emails
      const userByUsername = await storage.getUserByUsername(userData.username);
      const userByEmail = userData.email ? await storage.getUserByEmail(userData.email) : undefined;

      // If username is taken by someone other than the email holder, block with a clear message
      if (userByUsername && (!userByEmail || userByUsername.id !== userByEmail.id)) {
        res.status(400).json({ 
          message: "Username already taken. Please choose a different username." 
        });
        return;
      }

      // Existing user = same person matched by email (username may or may not also match)
      const existingUser = userByEmail || null;

      const userRole: 'user' = 'user'; // New users start with minimal access; super_admin promotes as needed

      // SECURITY: Verify all credentials/data BEFORE creating contractor to prevent domain squatting
      if (existingUser) {
        // For existing users: verify password before proceeding
        if (!userData.password) {
          res.status(400).json({ 
            message: "Password is required to add a new company to your existing account." 
          });
          return;
        }
        
        const verifiedUser = await storage.verifyPassword(existingUser.id, userData.password);
        if (!verifiedUser) {
          res.status(401).json({ 
            message: "Incorrect password for the account associated with this email. Please enter your existing account password." 
          });
          return;
        }
      } else {
        // For new users: validate data with Zod before proceeding
        // Note: We temporarily set contractorId to a dummy value for validation, will replace after contractor creation
        try {
          insertUserSchema.parse({
            ...userData,
            contractorId: 'validation-only', // Dummy value for validation
            role: userRole,
          });
        } catch (error) {
          if (error instanceof z.ZodError) {
            res.status(400).json({ message: "Invalid user data", errors: error.errors });
            return;
          }
          throw error;
        }
      }
      
      // Now safe to create contractor - all credentials and data have been validated
      const newContractor = await storage.createContractor({
        name: contractorName,
        domain,
      });
      const contractorId = newContractor.id;

      let user: any;
      
      if (existingUser) {
        // User already exists and password was verified above - add to new contractor
        user = existingUser;
        
        // Check if user is already in this contractor
        const existingMembership = await storage.getUserContractor(user.id, contractorId);
        if (existingMembership) {
          res.status(400).json({ 
            message: "You are already a member of this company." 
          });
          return;
        }
        
        // Add existing user to new contractor
        await storage.addUserToContractor({
          userId: user.id,
          contractorId,
          role: userRole,
          canManageIntegrations: (userRole as string) === 'admin',
        });
        
        console.log(`[Registration] Existing user ${user.email} added to new contractor ${contractorName}`);
      } else {
        // New user - data was validated above, now create user
        
        // Note: We no longer check for email uniqueness globally since users can belong to multiple contractors
        // Email uniqueness is now per-contractor through the user_contractors table

        // Parse user data with actual contractorId
        const parsedUserData = insertUserSchema.parse({
          ...userData,
          contractorId,
          role: userRole,
        });

        // Create the user
        user = await storage.createUser(parsedUserData);
        
        if (!user.contractorId) {
          res.status(500).json({ message: "User registration failed - no contractor assigned" });
          return;
        }
        
        // Add user to contractor in user_contractors table
        await storage.addUserToContractor({
          userId: user.id,
          contractorId: user.contractorId,
          role: userRole,
          canManageIntegrations: (userRole as string) === 'admin',
        });

        // Send welcome email for new users only
        try {
          await sendGridService.sendWelcomeEmail(user.email, user.name);
        } catch (emailError) {
          console.error('Failed to send welcome email:', emailError);
          // Don't fail registration if email fails
        }
        
        console.log(`[Registration] New user ${user.email} created and added to contractor ${contractorName}`);
      }

      // Generate JWT token for immediate login to the new contractor
      const token = AuthService.generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: userRole, // Use the role for this contractor
        contractorId
      });

      // Set HTTP-only cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // 'lax' allows OAuth redirects while still protecting against CSRF
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (sliding expiration)
        path: '/', // Explicit path for better cookie persistence
      });

      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: userRole,
          contractorId
        },
        message: existingUser ? "Successfully joined new company" : "User registered successfully"
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid user data", errors: error.errors });
        return;
      }
      console.error('Registration error:', error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Logout route
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    // Clear the auth cookie
    res.clearCookie('auth_token');
    res.json({ message: "Logged out successfully" });
  });

  // Request password reset
  app.post("/api/auth/forgot-password", authForgotPasswordRateLimiter, async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ message: "Email is required" });
        return;
      }

      // Find user by email (case-insensitive) - use lower() for consistent matching
      // and order by createdAt DESC to get the most recent record if duplicates exist
      const userResult = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${email})`)
        .orderBy(desc(users.createdAt))
        .limit(1);
      
      // Always return success to prevent email enumeration attacks
      if (userResult.length === 0) {
        res.json({ message: "If an account exists with that email, you will receive a password reset link" });
        return;
      }

      const user = userResult[0];

      // Generate a secure random token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Store the reset token
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token: resetToken,
        expiresAt,
      });

      // Send reset email
      await sendGridService.sendPasswordResetEmail(user.email, user.name, resetToken);

      res.json({ message: "If an account exists with that email, you will receive a password reset link" });
    } catch (error) {
      console.error('Password reset request error:', error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  });

  // Reset password with token
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        res.status(400).json({ message: "Token and new password are required" });
        return;
      }

      // Validate password strength
      if (newPassword.length < 8) {
        res.status(400).json({ message: "Password must be at least 8 characters long" });
        return;
      }

      // Find the reset token
      const tokenResult = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.token, token))
        .limit(1);

      if (tokenResult.length === 0) {
        res.status(400).json({ message: "Invalid or expired reset token" });
        return;
      }

      const resetTokenRecord = tokenResult[0];

      // Check if token is expired
      if (new Date() > resetTokenRecord.expiresAt) {
        res.status(400).json({ message: "Reset token has expired" });
        return;
      }

      // Check if token has already been used
      if (resetTokenRecord.usedAt) {
        res.status(400).json({ message: "Reset token has already been used" });
        return;
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update user password
      await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, resetTokenRecord.userId));

      // Mark token as used
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetTokenRecord.id));

      // Get user info to send confirmation email
      const userResult = await db
        .select()
        .from(users)
        .where(eq(users.id, resetTokenRecord.userId))
        .limit(1);

      if (userResult.length > 0) {
        const user = userResult[0];
        await sendGridService.sendPasswordChangedEmail(user.email, user.name);
      }

      res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Get current user info
  app.get("/api/auth/me", async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    // Fetch full user data from database to get dialpadDefaultNumber and Gmail status
    const fullUser = await storage.getUser(req.user.userId);

    // Check if the company has any active integrations (Dialpad, Housecall Pro, etc.)
    const enabledIntegrations = await storage.getEnabledIntegrations(req.user.contractorId);

    res.json({
      user: {
        id: req.user.userId,
        username: req.user.username,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        contractorId: req.user.contractorId,
        canManageIntegrations: req.user.canManageIntegrations,
        dialpadDefaultNumber: fullUser?.dialpadDefaultNumber || undefined,
        gmailConnected: fullUser?.gmailConnected || false,
        gmailEmail: fullUser?.gmailEmail || undefined,
        hasActiveCompanyIntegrations: enabledIntegrations.length > 0
      }
    });
  });

  // Gmail OAuth routes
  app.get("/api/oauth/gmail/connect", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      // Check if Gmail OAuth is configured
      if (!gmailService.isConfigured()) {
        res.status(500).json({ 
          message: "Gmail integration not configured. Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables." 
        });
        return;
      }

      // Pre-check encryption key so users get a clear error before OAuth flow
      try {
        gmailService.validateEncryptionKey();
      } catch (error) {
        res.status(500).json({ 
          message: error instanceof Error ? error.message : "Encryption key not configured" 
        });
        return;
      }

      // Extract the current host from the request to use as redirect URI
      const host = req.get('host');
      if (!host) {
        res.status(400).json({ message: "Unable to determine request host" });
        return;
      }

      // Validate the host is in the allowlist
      if (!gmailService.validateHost(host)) {
        console.error(`[Gmail OAuth] Invalid host: ${host}`);
        res.status(403).json({ 
          message: `Invalid domain. OAuth is only allowed from approved domains.` 
        });
        return;
      }

      console.log(`[Gmail OAuth] Initiating OAuth for user ${req.user.userId} from host ${host}`);

      // Generate OAuth URL with dynamic redirect URI based on current host
      const authUrl = await gmailService.generateAuthUrl(req.user.userId, host);
      res.json({ authUrl });
    } catch (error) {
      console.error('[Gmail OAuth] Error generating auth URL:', error);
      res.status(500).json({ message: "Failed to initiate Gmail connection" });
    }
  });

  app.get("/api/oauth/gmail/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        res.status(400).send('Missing authorization code or state parameter');
        return;
      }

      // SECURITY: Validate state token and get userId + redirectHost
      const stateData = await gmailService.getStateData(state as string);
      if (!stateData) {
        console.error('[Gmail OAuth] Invalid or expired state token');
        res.status(403).send('Invalid or expired state parameter');
        return;
      }

      const { userId, redirectHost } = stateData;

      // Verify user exists
      const user = await storage.getUser(userId);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }

      console.log(`[Gmail OAuth] Processing callback for user ${userId}, will redirect to ${redirectHost}`);

      // Exchange code for tokens using the same redirectHost
      const result = await gmailService.exchangeCodeForTokens(code as string, redirectHost);
      
      if (!result.refreshToken) {
        console.error('[Gmail OAuth] No refresh token received for user:', userId);
        const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
        res.redirect(`${protocol}://${redirectHost}/settings?gmail=error&reason=no_refresh_token`);
        return;
      }

      // Store refresh token for this user
      const userForContractor = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const contractorId = userForContractor[0]?.contractorId;
      
      await db.update(users)
        .set({
          gmailConnected: true,
          gmailRefreshToken: result.refreshToken,
          gmailEmail: result.email,
        })
        .where(eq(users.id, userId));

      console.log(`[Gmail OAuth] User ${userId} successfully connected Gmail account: ${result.email}`);

      // Enable automatic email syncing every hour
      if (contractorId) {
        const { syncScheduler } = await import('./sync-scheduler');
        await syncScheduler.onIntegrationEnabled(contractorId, 'gmail');
        console.log(`[Gmail OAuth] Enabled automatic email syncing for contractor ${contractorId}`);
      }

      // Redirect back to the original host's settings page with success message
      const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
      res.redirect(`${protocol}://${redirectHost}/settings?gmail=connected`);
    } catch (error) {
      console.error('[Gmail OAuth] Error in callback:', error);
      // Try to redirect to original host if possible, otherwise just /settings
      const redirectHost = req.get('host') || '';
      const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
      if (redirectHost) {
        res.redirect(`${protocol}://${redirectHost}/settings?gmail=error`);
      } else {
        res.redirect('/settings?gmail=error');
      }
    }
  });

  app.post("/api/oauth/gmail/disconnect", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Not authenticated" });
        return;
      }

      // Disconnect Gmail for this user
      await db.update(users)
        .set({
          gmailConnected: false,
          gmailRefreshToken: null,
          gmailEmail: null,
          gmailLastSyncAt: null,
          gmailSyncHistoryId: null,
        })
        .where(eq(users.id, req.user.userId));

      console.log(`[Gmail OAuth] User ${req.user.userId} disconnected Gmail`);

      res.json({ message: "Gmail disconnected successfully" });
    } catch (error) {
      console.error('[Gmail OAuth] Error disconnecting Gmail:', error);
      res.status(500).json({ message: "Failed to disconnect Gmail" });
    }
  });

  // User management routes (admin/manager only)
  app.get("/api/users", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Join with user_contractors to get all users associated with this contractor
      // This supports multi-contractor users who may have a different primary contractorId
      const contractorUsers = await db
        .select({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          role: userContractors.role, // Use role from junction table (per-contractor)
          contractorId: userContractors.contractorId,
          dialpadDefaultNumber: userContractors.dialpadDefaultNumber, // Use per-contractor default number
          canManageIntegrations: userContractors.canManageIntegrations,
          createdAt: users.createdAt
        })
        .from(userContractors)
        .innerJoin(users, eq(userContractors.userId, users.id))
        .where(eq(userContractors.contractorId, req.user!.contractorId));
      
      res.json(contractorUsers);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Create new user (admin only)
  app.post("/api/users", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, email, password, role, username } = req.body;

      if (!name || !email || !password || !username) {
        res.status(400).json({ message: "Name, email, username, and password are required" });
        return;
      }

      // Check if this email already exists for THIS contractor
      const existingUserForContractor = await storage.getUserByEmailAndContractor(email, req.user!.contractorId);
      if (existingUserForContractor) {
        res.status(400).json({ message: "User with this email already exists in your organization" });
        return;
      }

      // Check if username exists globally
      const existingUsername = await storage.getUserByUsername(username);
      
      // Check if user with this email already exists globally
      const existingGlobalUser = await storage.getUserByEmail(email);
      
      // Multi-contractor scenario: Username and email both exist and match the same user
      if (existingUsername && existingGlobalUser && existingUsername.id === existingGlobalUser.id) {
        // This is an existing user trying to join a second company - add them
        const newUser = existingGlobalUser;
        
        // Verify the password matches (security)
        const isPasswordValid = await bcrypt.compare(password, newUser.password);
        if (!isPasswordValid) {
          res.status(401).json({ message: "Invalid password for existing account" });
          return;
        }
        
        // Add user to contractor
        await storage.addUserToContractor({
          userId: newUser.id,
          contractorId: req.user!.contractorId,
          role: role || 'user',
          canManageIntegrations: role === 'admin',
        });
        
        res.status(201).json({
          id: newUser.id,
          username: newUser.username,
          name: newUser.name,
          email: newUser.email,
          role: role || 'user',
          contractorId: req.user!.contractorId,
          createdAt: newUser.createdAt,
          message: "Existing user added to organization"
        });
        return;
      }
      
      // Username exists but with different email - true conflict
      if (existingUsername && (!existingGlobalUser || existingUsername.id !== existingGlobalUser.id)) {
        res.status(400).json({ message: "Username already taken" });
        return;
      }
      
      // Email exists but username doesn't match - shouldn't happen but handle gracefully
      if (existingGlobalUser && !existingUsername) {
        res.status(400).json({ message: "User with this email exists but username doesn't match" });
        return;
      }
      
      // Neither username nor email exist - create new user
      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await db.insert(users).values({
        name,
        email,
        username,
        password: hashedPassword,
        role: role || 'user',
        contractorId: req.user!.contractorId
      }).returning().then(result => result[0]);
      
      // Add user to contractor in user_contractors table
      await storage.addUserToContractor({
        userId: newUser.id,
        contractorId: req.user!.contractorId,
        role: role || 'user',
        canManageIntegrations: role === 'admin',
      });

      res.status(201).json({
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        email: newUser.email,
        role: role || 'user',
        contractorId: req.user!.contractorId,
        createdAt: newUser.createdAt
      });
    } catch (error) {
      console.error('Failed to create user:', error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user role (admin only; only super_admin can assign admin role)
  app.patch("/api/users/:userId/role", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      const isSuperAdmin = req.user!.role === 'super_admin';
      const allowedRoles = isSuperAdmin ? ['user', 'manager', 'admin'] : ['user', 'manager'];

      if (!role || !allowedRoles.includes(role)) {
        const rolesDescription = isSuperAdmin ? 'user, manager, or admin' : 'user or manager';
        res.status(400).json({ message: `Invalid role. Must be ${rolesDescription}` });
        return;
      }

      // Verify user belongs to same contractor via junction table (supports multi-contractor users)
      const userContractor = await db.select().from(userContractors)
        .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, req.user!.contractorId)))
        .limit(1);

      if (userContractor.length === 0) {
        res.status(404).json({ message: "User not found in your organization" });
        return;
      }

      // Update the user's role in the junction table (per-contractor role)
      const updated = await db.update(userContractors)
        .set({ role })
        .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, req.user!.contractorId)))
        .returning();

      res.json({
        userId: updated[0].userId,
        role: updated[0].role,
        contractorId: updated[0].contractorId,
        message: "User role updated successfully"
      });
    } catch (error) {
      console.error('Failed to update user role:', error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Update user's Dialpad phone number (admin only)
  app.patch("/api/users/:userId/dialpad-number", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { dialpadDefaultNumber } = req.body;

      // Verify the user belongs to the same contractor
      const targetUser = await db.select().from(users)
        .where(and(eq(users.id, userId), eq(users.contractorId, req.user!.contractorId)))
        .limit(1);

      if (!targetUser[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      // Update the Dialpad phone number
      const updated = await db.update(users)
        .set({ dialpadDefaultNumber })
        .where(eq(users.id, userId))
        .returning();

      // If a phone number was set, automatically grant permissions for non-admin users
      if (dialpadDefaultNumber && targetUser[0].role !== 'admin' && targetUser[0].role !== 'manager') {
        // Find the phone number in the database
        const phoneNumber = await storage.getDialpadPhoneNumberByNumber(req.user!.contractorId, dialpadDefaultNumber);
        
        if (phoneNumber) {
          // Check if permission already exists
          const existingPermission = await storage.getUserPhoneNumberPermission(userId, phoneNumber.id);
          
          if (existingPermission) {
            // Update existing permission to ensure both SMS and call are enabled
            await storage.updateUserPhoneNumberPermission(existingPermission.id, {
              canSendSms: true,
              canMakeCalls: true,
              isActive: true
            });
          } else {
            // Create new permission with both SMS and call enabled
            await storage.createUserPhoneNumberPermission({
              contractorId: req.user!.contractorId,
              userId: userId,
              phoneNumberId: phoneNumber.id,
              canSendSms: true,
              canMakeCalls: true,
              isActive: true
            });
          }
        }
      }

      res.json({
        id: updated[0].id,
        username: updated[0].username,
        name: updated[0].name,
        email: updated[0].email,
        role: updated[0].role,
        contractorId: updated[0].contractorId,
        dialpadDefaultNumber: updated[0].dialpadDefaultNumber,
        message: "Dialpad phone number updated successfully"
      });
    } catch (error) {
      console.error('Update Dialpad number error:', error);
      res.status(500).json({ message: "Failed to update Dialpad phone number" });
    }
  });

  // Get single user by ID
  app.get("/api/users/:userId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const contractorId = req.user!.contractorId;
      
      // Get user if they belong to the same contractor
      const user = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
        .from(users)
        .where(and(
          eq(users.id, userId),
          eq(users.contractorId, contractorId)
        ))
        .limit(1);
      
      if (user.length === 0) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      
      res.json(user[0]);
    } catch (error) {
      console.error('Failed to fetch user:', error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get users with Gmail connected (for workflow sender selection)
  app.get("/api/users/gmail-connected", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      // Get all users for this contractor who have Gmail connected
      const gmailUsers = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
        .from(users)
        .where(and(
          eq(users.contractorId, contractorId),
          isNotNull(users.gmailRefreshToken)
        ));
      
      res.json(gmailUsers);
    } catch (error) {
      console.error('Failed to fetch Gmail-connected users:', error);
      res.status(500).json({ message: "Failed to fetch Gmail-connected users" });
    }
  });

  // Update user's integration permission (admin only)
  app.patch("/api/users/:userId/integration-permission", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { canManageIntegrations } = req.body;

      if (typeof canManageIntegrations !== 'boolean') {
        res.status(400).json({ message: "canManageIntegrations must be a boolean" });
        return;
      }

      // Verify the user belongs to the same contractor
      const targetUser = await db.select().from(users)
        .where(and(eq(users.id, userId), eq(users.contractorId, req.user!.contractorId)))
        .limit(1);

      if (!targetUser[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      // Update the integration permission
      const updated = await db.update(users)
        .set({ canManageIntegrations })
        .where(eq(users.id, userId))
        .returning();

      res.json({
        id: updated[0].id,
        username: updated[0].username,
        name: updated[0].name,
        email: updated[0].email,
        role: updated[0].role,
        contractorId: updated[0].contractorId,
        canManageIntegrations: updated[0].canManageIntegrations,
        message: "Integration permission updated successfully"
      });
    } catch (error) {
      console.error('Update integration permission error:', error);
      res.status(500).json({ message: "Failed to update integration permission" });
    }
  });

  // Add build version endpoint for cache-busting
  const BUILD_VERSION = process.env.REPLIT_DEPLOYMENT_ID || process.env.REPL_ID || Date.now().toString();
  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ 
      version: BUILD_VERSION,
      timestamp: Date.now()
    });
  });

  // Google Places API proxy — server-side calls bypass browser referrer/domain restrictions
  app.get('/api/places/autocomplete', async (req: AuthenticatedRequest, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      return res.json({ suggestions: [] });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'Referer': appUrl,
        },
        body: JSON.stringify({
          input: input.trim(),
          includedRegionCodes: ['us'],
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Autocomplete] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json({ suggestions: data.suggestions || [] });
    } catch (e) {
      console.error('[Places Autocomplete] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  app.get('/api/places/details', async (req: AuthenticatedRequest, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,addressComponents`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'Referer': appUrl,
          },
        }
      );
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Details] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json(data);
    } catch (e) {
      console.error('[Places Details] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  // Dashboard metrics route
  app.get("/api/dashboard/metrics", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { timeframe, startDate, endDate } = req.query;
      
      let start: Date | undefined;
      let end: Date | undefined;
      
      const now = new Date();
      now.setHours(23, 59, 59, 999);
      
      if (timeframe === 'this_week') {
        start = new Date(now);
        const dayOfWeek = start.getDay();
        start.setDate(start.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'this_year') {
        start = new Date(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        end = now;
      } else if (timeframe === 'custom' && startDate && endDate) {
        start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
      }
      
      const metrics = await storage.getDashboardMetrics(
        req.user!.contractorId, 
        req.user!.userId, 
        req.user!.role, 
        start, 
        end
      );
      res.json(metrics);
    } catch (error) {
      console.error('Dashboard metrics error:', error);
      res.status(500).json({ message: "Failed to fetch dashboard metrics" });
    }
  });

  // Unified Contacts routes (replaces separate Customer and Lead routes)
  app.get("/api/contacts", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type } = req.query;
      const contactType = type as 'lead' | 'customer' | 'inactive' | undefined;
      
      const contacts = await storage.getContacts(req.user!.contractorId, contactType);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  // Paginated contacts endpoint
  app.get("/api/contacts/paginated", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { cursor, limit, type, status, search } = req.query;
      
      const options = {
        cursor: cursor as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        type: type as 'lead' | 'customer' | 'inactive' | undefined,
        status: status as string | undefined,
        search: search as string | undefined,
      };

      const paginatedContacts = await storage.getContactsPaginated(req.user!.contractorId, options);
      
      res.json(paginatedContacts);
    } catch (error) {
      console.error('Paginated contacts error:', error);
      res.status(500).json({ message: "Failed to fetch paginated contacts" });
    }
  });

  // Contacts status counts endpoint
  app.get("/api/contacts/status-counts", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { search, type } = req.query;
      const counts = await storage.getContactsStatusCounts(req.user!.contractorId, {
        search: search as string | undefined,
        type: type as 'lead' | 'customer' | 'inactive' | undefined
      });
      res.json(counts);
    } catch (error) {
      console.error("Error fetching contact status counts:", error);
      res.status(500).json({ message: "Failed to fetch contact status counts" });
    }
  });

  // Contact deduplication endpoint (admin only)
  app.post("/api/contacts/deduplicate", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can trigger deduplication
      if (req.user!.role !== 'admin') {
        res.status(403).json({ message: "Only administrators can deduplicate contacts" });
        return;
      }
      
      const result = await storage.deduplicateContacts(req.user!.contractorId);
      res.json(result);
    } catch (error) {
      console.error("Error deduplicating contacts:", error);
      res.status(500).json({ message: "Failed to deduplicate contacts" });
    }
  });

  // CSV Template Download Endpoint - Must be before :id route to avoid conflicts
  app.get("/api/leads/csv-template", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const csvHeaders = [
        'name',           // Required
        'email',          // Optional
        'phone',          // Optional  
        'address',        // Optional
        'source',         // Optional
        'notes',          // Optional
        'followUpDate'    // Optional (YYYY-MM-DD format)
      ];
      
      const csvTemplate = csvHeaders.join(',') + '\n' +
        'John Smith,john@example.com,555-123-4567,"123 Main St, City, State 12345",Website Contact Form,"Interested in HVAC installation",2024-01-15\n' +
        'Jane Doe,jane@example.com,555-987-6543,"456 Oak Ave, City, State 12345",Referral,"Needs AC repair",2024-01-20';
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="leads_template.csv"');
      res.send(csvTemplate);
    } catch (error) {
      console.error('CSV template error:', error);
      res.status(500).json({ error: "Failed to generate CSV template" });
    }
  });

  app.get("/api/contacts/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contact = await storage.getContact(req.params.id, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  });

  app.get("/api/contacts/:contactId/leads", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const leads = await storage.getLeadsByContact(req.params.contactId, req.user!.contractorId);
      res.json(leads);
    } catch (error) {
      console.error('Failed to fetch leads for contact:', error);
      res.status(500).json({ message: "Failed to fetch lead submissions" });
    }
  });

  app.post("/api/contacts", async (req: AuthenticatedRequest, res: Response) => {
    try {
      console.log("[CONTACT DEBUG] Received contact data:", JSON.stringify(req.body, null, 2));
      const contactData = insertContactSchema.omit({ contractorId: true }).parse(req.body);
      console.log("[CONTACT DEBUG] Validated contact data:", JSON.stringify(contactData, null, 2));
      
      // Check for existing contact with overlapping phone numbers
      if (contactData.phones && contactData.phones.length > 0) {
        const existingContacts = await storage.getContacts(req.user!.contractorId);
        const duplicate = existingContacts.find(existingContact => 
          existingContact.phones && existingContact.phones.some(existingPhone => 
            contactData.phones!.includes(existingPhone)
          )
        );
        if (duplicate) {
          const duplicatePhone = duplicate.phones?.find(p => contactData.phones!.includes(p));
          res.status(409).json({ 
            message: `A contact with phone number ${duplicatePhone} already exists`,
            duplicateContactId: duplicate.id,
            duplicateContactName: duplicate.name,
            isDuplicate: true
          });
          return;
        }
      }
      
      const contact = await storage.createContact(contactData, req.user!.contractorId);
      
      // Sync to Housecall Pro if integration is enabled
      const hcpIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (hcpIntegrationEnabled) {
        try {
          // Parse name into first/last
          const nameParts = contact.name.split(' ');
          const firstName = nameParts[0] || '';
          const lastName = nameParts.slice(1).join(' ') || '';
          
          // Create customer in HCP
          const hcpResult = await housecallProService.createCustomer(req.user!.contractorId, {
            first_name: firstName,
            last_name: lastName,
            email: contact.emails?.[0],
            mobile_number: contact.phones?.[0],
            lead_source: contact.source || 'CRM',
            notes: contact.notes || undefined,
            addresses: contact.address ? [{
              street: contact.address,
              type: 'service'
            }] : undefined
          });
          
          if (hcpResult.success && hcpResult.data?.id) {
            // Update contact with HCP customer ID
            await storage.updateContact(contact.id, { 
              housecallProCustomerId: hcpResult.data.id 
            }, req.user!.contractorId);
            console.log('[HCP Sync] Created HCP customer:', hcpResult.data.id, 'for contact:', contact.id);
          } else {
            console.warn('[HCP Sync] Failed to create HCP customer:', hcpResult.error);
          }
        } catch (hcpError) {
          console.error('[HCP Sync] Error creating customer in HCP:', hcpError);
          // Don't fail the request if HCP sync fails
        }
      }
      
      // Broadcast contact creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_created',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact creation (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_created', contact, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact creation:', error);
        });
      }
      
      res.status(201).json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.log("[CONTACT DEBUG] Validation errors:", JSON.stringify(error.errors, null, 2));
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        res.status(400).json({ 
          message: `Invalid contact data: ${errorMessages}`, 
          errors: error.errors 
        });
        return;
      }
      
      console.error("[CONTACT DEBUG] Server error:", error);
      res.status(500).json({ message: "Failed to create contact" });
    }
  });

  app.put("/api/contacts/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contactUpdateSchema = insertContactSchema.omit({ contractorId: true }).partial().extend({
        followUpDate: z.coerce.date().nullable().optional(),
      });
      const updateData = contactUpdateSchema.parse(req.body);
      
      // Track who scheduled the contact
      if (updateData.status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }

      // If emails are being updated, re-evaluate gmail activity links after saving
      const emailsChanging = Array.isArray(updateData.emails);

      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      // Unlink email activities whose matched address was removed from this contact
      if (emailsChanging) {
        storage.unlinkOrphanedEmailActivities(contact.id, contact.emails || [], req.user!.contractorId).catch(err => {
          console.error('[contacts] Error unlinking orphaned email activities:', err);
        });
      }
      
      // Broadcast contact update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact update (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_updated', contact, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact update:', error);
        });
      }
      
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        res.status(400).json({ 
          message: `Invalid contact data: ${errorMessages}`, 
          errors: error.errors 
        });
        return;
      }
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  // PATCH endpoint for partial contact updates (including tags)
  app.patch("/api/contacts/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData = insertContactSchema.omit({ contractorId: true }).partial().parse(req.body);
      
      // Track who scheduled the contact
      if (updateData.status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }
      
      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Broadcast contact update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });

      // Trigger workflows for contact update (if contact is a lead)
      if (contact.type === 'lead') {
        workflowEngine.triggerWorkflowsForEvent('contact_updated', contact, req.user!.contractorId).catch(error => {
          console.error('[Workflow] Error triggering workflows for contact update:', error);
        });
      }
      
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
        res.status(400).json({ 
          message: `Invalid contact data: ${errorMessages}`, 
          errors: error.errors 
        });
        return;
      }
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  app.patch("/api/contacts/:id/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['new', 'contacted', 'scheduled', 'active', 'disqualified', 'inactive'])
      });
      const { status } = statusSchema.parse(req.body);
      
      // Track who scheduled the contact
      const updateData: any = { status };
      if (status === 'scheduled') {
        updateData.scheduledByUserId = req.user!.userId;
      }
      
      const contact = await storage.updateContact(req.params.id, updateData, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Log activity for status change
      try {
        const statusLabels = {
          'new': 'New',
          'contacted': 'Contacted',
          'scheduled': 'Scheduled',
          'active': 'Active',
          'disqualified': 'Disqualified',
          'inactive': 'Inactive'
        };
        const activityContent = `Contact status changed to ${statusLabels[status]}`;
        
        console.log('[Status Change] req.user:', JSON.stringify(req.user));
        console.log('[Status Change] Creating activity:', { contactId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'status_change',
          title: 'Status Changed',
          content: activityContent,
          contactId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Status Change] Activity created:', activity.id);
        
        // Broadcast WebSocket message for real-time updates
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          contactId: req.params.id,
        });
        
        console.log('[Status Change] WebSocket broadcast sent');
      } catch (activityError) {
        console.error('[Status Change] Failed to create activity:', activityError);
        // Don't fail the request if activity creation fails
      }
      
      // Broadcast contact update to all connected clients for real-time lead list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });
      
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid status", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update contact status" });
    }
  });

  app.patch("/api/contacts/:id/follow-up", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const followUpSchema = z.object({
        followUpDate: z.string().nullable().optional().transform((val, ctx) => {
          if (!val) return null;
          const date = new Date(val);
          if (isNaN(date.getTime())) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid date format",
            });
            return z.NEVER;
          }
          return date;
        })
      });
      const { followUpDate } = followUpSchema.parse(req.body);
      const contact = await storage.updateContact(req.params.id, { followUpDate }, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Log activity for follow-up date change
      try {
        const activityContent = followUpDate 
          ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          : 'Follow-up date cleared';
        
        console.log('[Follow-up] Creating activity:', { contactId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'follow_up',
          title: 'Follow-up Date Updated',
          content: activityContent,
          contactId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Follow-up] Activity created:', activity.id);
        
        // Broadcast real-time update via WebSocket
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          contactId: req.params.id,
        });
        
        console.log('[Follow-up] WebSocket broadcast sent');
      } catch (activityError) {
        console.error('[Follow-up] Error creating activity:', activityError);
      }
      
      // Broadcast contact update to all connected clients for real-time lead list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_updated',
        contactId: contact.id,
        contactType: contact.type
      });
      
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid follow-up date", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update follow-up date" });
    }
  });

  app.delete("/api/contacts/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteContact(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }
      
      // Broadcast contact deletion to all connected clients for real-time lead list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'contact_deleted',
        contactId: req.params.id
      });
      
      res.status(200).json({ message: "Contact deleted successfully" });
    } catch (error) {
      console.error('Error deleting contact:', error);
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // Job routes
  app.get("/api/jobs", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const jobs = await storage.getJobs(req.user!.contractorId);
      res.json(jobs);
    } catch (error) {
      console.error('Jobs fetch error:', error);
      res.status(500).json({ message: "Failed to fetch jobs" });
    }
  });

  // Paginated jobs endpoint
  app.get("/api/jobs/paginated", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query parameters with schema
      const validatedQuery = jobsPaginationQuerySchema.parse(req.query);
      
      const paginatedJobs = await storage.getJobsPaginated(req.user!.contractorId, validatedQuery);
      
      res.json(paginatedJobs);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid query parameters", errors: error.errors });
        return;
      }
      console.error('Paginated jobs error:', error);
      res.status(500).json({ message: "Failed to fetch paginated jobs" });
    }
  });

  // Jobs status counts endpoint
  app.get("/api/jobs/status-counts", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const search = req.query.search as string;
      const counts = await storage.getJobsStatusCounts(req.user!.contractorId, { search });
      res.json(counts);
    } catch (error) {
      console.error("Error fetching job status counts:", error);
      res.status(500).json({ message: "Failed to fetch job status counts" });
    }
  });

  app.get("/api/jobs/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const job = await storage.getJob(req.params.id, req.user!.contractorId);
      if (!job) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch job" });
    }
  });

  app.post("/api/jobs", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const jobData = insertJobSchema.omit({ contractorId: true }).parse(req.body);
      const job = await storage.createJob(jobData, req.user!.contractorId);
      
      // Automatically add "Customer" tag to the contact
      try {
        const contact = await storage.getContact(job.contactId, req.user!.contractorId);
        if (contact && !contact.tags?.includes('Customer')) {
          const updatedTags = [...(contact.tags || []), 'Customer'];
          await storage.updateContact(contact.id, { tags: updatedTags }, req.user!.contractorId);
          
          // Broadcast contact update for real-time tag display
          broadcastToContractor(req.user!.contractorId, {
            type: 'contact_updated',
            contactId: contact.id,
            contactType: contact.type
          });
        }
      } catch (tagError) {
        console.error('[Job Creation] Failed to add Customer tag:', tagError);
        // Don't fail the job creation if tagging fails
      }
      
      // Broadcast job creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'job_created',
        jobId: job.id
      });

      // Trigger workflows for job creation
      workflowEngine.triggerWorkflowsForEvent('job_created', job, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for job creation:', error);
      });
      
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid job data", errors: error.errors });
        return;
      }
      if (error instanceof Error && error.message.includes('Customer not found')) {
        res.status(400).json({ message: error.message });
        return;
      }
      res.status(500).json({ message: "Failed to create job" });
    }
  });

  app.put("/api/jobs/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro job (read-only for tracking purposes)
      const existingJob = await storage.getJob(req.params.id, req.user!.contractorId);
      if (!existingJob) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro jobs - they're read-only for tracking only
      if (existingJob.externalSource === 'housecall-pro') {
        res.status(403).json({ 
          message: "Cannot edit Housecall Pro jobs - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
        });
        return;
      }

      const updateData = insertJobSchema.omit({ contractorId: true, contactId: true }).partial().parse(req.body);
      const job = await storage.updateJob(req.params.id, updateData, req.user!.contractorId);
      if (!job) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      // Broadcast job update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'job_updated',
        jobId: job.id
      });

      // Trigger workflows for job update
      workflowEngine.triggerWorkflowsForEvent('job_updated', job, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for job update:', error);
      });
      
      res.json(job);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid job data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update job" });
    }
  });

  app.delete("/api/jobs/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const job = await storage.getJob(req.params.id, req.user!.contractorId);
      if (!job) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      const deleted = await storage.deleteJob(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ message: "Job not found or already deleted" });
        return;
      }
      
      // Broadcast job deletion to all connected clients for real-time updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'job_deleted',
        jobId: req.params.id
      });
      
      res.status(200).json({ message: "Job deleted successfully" });
    } catch (error) {
      console.error('Error deleting job:', error);
      res.status(500).json({ message: "Failed to delete job" });
    }
  });

  // Estimate routes
  app.get("/api/estimates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const estimates = await storage.getEstimates(req.user!.contractorId);
      res.json(estimates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  // Paginated estimates endpoint
  app.get("/api/estimates/paginated", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cursor = req.query.cursor as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const status = req.query.status as string;
      const search = req.query.search as string;

      const result = await storage.getEstimatesPaginated(req.user!.contractorId, {
        cursor,
        limit,
        status,
        search,
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching paginated estimates:', error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  // Estimates status counts endpoint
  app.get("/api/estimates/status-counts", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const search = req.query.search as string;
      const counts = await storage.getEstimatesStatusCounts(req.user!.contractorId, { search });
      res.json(counts);
    } catch (error) {
      console.error("Error fetching estimate status counts:", error);
      res.status(500).json({ message: "Failed to fetch estimate status counts" });
    }
  });

  app.get("/api/estimates/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const estimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      res.json(estimate);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  app.post("/api/estimates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const estimateData = insertEstimateSchema.omit({ contractorId: true }).parse(req.body);
      const estimate = await storage.createEstimate(estimateData, req.user!.contractorId);
      
      // Broadcast estimate creation to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_created',
        estimateId: estimate.id
      });

      // Trigger workflows for estimate creation
      workflowEngine.triggerWorkflowsForEvent('estimate_created', estimate, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for estimate creation:', error);
      });
      
      res.status(201).json(estimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
        return;
      }
      if (error instanceof Error && error.message.includes('Customer not found')) {
        res.status(400).json({ message: error.message });
        return;
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  app.put("/api/estimates/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro estimate (read-only for tracking purposes)
      const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!existingEstimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro estimates - they're read-only for tracking only
      if (existingEstimate.externalSource === 'housecall-pro') {
        res.status(403).json({ 
          message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value. Status updates are managed in Housecall Pro." 
        });
        return;
      }

      const updateData = insertEstimateSchema.omit({ contractorId: true, contactId: true }).partial().parse(req.body);
      const estimate = await storage.updateEstimate(req.params.id, updateData, req.user!.contractorId);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Broadcast estimate update to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_updated',
        estimateId: estimate.id
      });

      // Trigger workflows for estimate update
      workflowEngine.triggerWorkflowsForEvent('estimate_updated', estimate, req.user!.contractorId).catch(error => {
        console.error('[Workflow] Error triggering workflows for estimate update:', error);
      });
      
      res.json(estimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid estimate data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update estimate" });
    }
  });

  app.patch("/api/estimates/:id/follow-up", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First, check if this is a Housecall Pro estimate (read-only for tracking purposes)
      const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!existingEstimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Prevent editing of Housecall Pro estimates - they're read-only for tracking only
      if (existingEstimate.externalSource === 'housecall-pro') {
        res.status(403).json({ 
          message: "Cannot edit Housecall Pro estimates - they are read-only for tracking lead value." 
        });
        return;
      }

      const followUpSchema = z.object({
        followUpDate: z.string().nullable().optional().transform((val, ctx) => {
          if (!val) return null;
          const date = new Date(val);
          if (isNaN(date.getTime())) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid date format",
            });
            return z.NEVER;
          }
          return date;
        })
      });
      const { followUpDate } = followUpSchema.parse(req.body);
      const estimate = await storage.updateEstimate(req.params.id, { followUpDate }, req.user!.contractorId);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Log activity for follow-up date change
      try {
        const activityContent = followUpDate 
          ? `Follow-up date set to ${new Date(followUpDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          : 'Follow-up date cleared';
        
        console.log('[Follow-up] Creating activity for estimate:', { estimateId: req.params.id, activityContent });
        
        const activity = await storage.createActivity({
          type: 'follow_up',
          title: 'Follow-up Date Updated',
          content: activityContent,
          estimateId: req.params.id,
          userId: req.user!.userId,
        }, req.user!.contractorId);
        
        console.log('[Follow-up] Activity created for estimate:', activity.id);
        
        // Broadcast real-time update via WebSocket
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_activity',
          estimateId: req.params.id,
        });
        
        console.log('[Follow-up] WebSocket broadcast sent for estimate');
      } catch (activityError) {
        console.error('[Follow-up] Error creating activity for estimate:', activityError);
      }
      
      // Broadcast estimate update to all connected clients for real-time estimate list updates
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_updated',
        estimateId: estimate.id
      });
      
      res.json(estimate);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid follow-up date", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update follow-up date" });
    }
  });

  app.delete("/api/estimates/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if estimate exists and belongs to this contractor
      const existingEstimate = await storage.getEstimate(req.params.id, req.user!.contractorId);
      if (!existingEstimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      const deleted = await storage.deleteEstimate(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      
      // Broadcast estimate deletion to all connected clients
      broadcastToContractor(req.user!.contractorId, {
        type: 'estimate_deleted',
        estimateId: req.params.id
      });
      
      res.json({ message: "Estimate deleted successfully" });
    } catch (error) {
      console.error('Failed to delete estimate:', error);
      res.status(500).json({ message: "Failed to delete estimate" });
    }
  });

  // Activity routes for tracking timestamped notes and interactions
  app.get("/api/activities", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contactId, leadId, customerId, estimateId, jobId, type, limit, offset } = req.query;
      // Support both old (leadId, customerId) and new (contactId) parameter names for backward compatibility
      const resolvedContactId = contactId || leadId || customerId;
      const activities = await storage.getActivities(req.user!.contractorId, {
        contactId: resolvedContactId as string,
        estimateId: estimateId as string,
        jobId: jobId as string,
        type: type as any,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  app.get("/api/activities/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activity = await storage.getActivity(req.params.id, req.user!.contractorId);
      if (!activity) {
        res.status(404).json({ message: "Activity not found" });
        return;
      }
      res.json(activity);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activity" });
    }
  });

  app.post("/api/activities", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const activityData = insertActivitySchema.omit({ contractorId: true }).parse({
        ...req.body,
        userId: req.user!.userId // Automatically set the current user as the creator
      });
      const activity = await storage.createActivity(activityData, req.user!.contractorId);
      
      // Automatically mark contact as contacted for communication activities
      const contactId = activity.contactId;
      if (contactId && ['call', 'email', 'sms'].includes(activity.type)) {
        await storage.markContactContacted(contactId, req.user!.contractorId, req.user!.userId);
      }
      
      res.status(201).json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid activity data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  app.put("/api/activities/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData = insertActivitySchema.omit({ contractorId: true, userId: true }).partial().parse(req.body);
      const activity = await storage.updateActivity(req.params.id, updateData, req.user!.contractorId);
      if (!activity) {
        res.status(404).json({ message: "Activity not found" });
        return;
      }
      res.json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid activity data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update activity" });
    }
  });

  app.delete("/api/activities/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteActivity(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ message: "Activity not found" });
        return;
      }
      res.json({ message: "Activity deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete activity" });
    }
  });

  // Employee management routes
  app.get("/api/employees", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employees = await storage.getEmployees(req.user!.contractorId);
      res.json(employees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  app.patch("/api/employees/:id/roles", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      // Validate request body
      const validation = updateEmployeeRolesSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: validation.error.issues.map(issue => ({ 
            path: issue.path.join('.'), 
            message: issue.message 
          }))
        });
        return;
      }

      const { roles } = validation.data;
      
      // Update employee roles
      const updatedEmployee = await storage.updateEmployeeRoles(id, roles, req.user!.contractorId);
      if (!updatedEmployee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      res.json(updatedEmployee);
    } catch (error) {
      console.error('Error updating employee roles:', error);
      res.status(500).json({ message: "Failed to update employee roles" });
    }
  });

  // Message routes for texting functionality
  app.get("/api/messages", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Support both legacy leadId/customerId params and new contactId for backward compatibility
      const contactId = (req.query.contactId || req.query.leadId || req.query.customerId) as string | undefined;
      const estimateId = req.query.estimateId as string | undefined;
      const messages = await storage.getMessages(req.user!.contractorId, contactId, estimateId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages/send-text", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const messageData = insertMessageSchema.omit({ contractorId: true, status: true }).parse(req.body);
      
      if (messageData.type !== 'text') {
        res.status(400).json({ message: "This endpoint is only for text messages" });
        return;
      }

      if (!messageData.toNumber) {
        res.status(400).json({ message: "Phone number is required" });
        return;
      }

      // Send text via Dialpad service directly (with fixed phone formatting)
      const { DialpadService } = await import('./dialpad-service');
      const dialpadService = new DialpadService();
      const smsResponse = await dialpadService.sendText(
        messageData.toNumber,
        messageData.content,
        messageData.fromNumber || undefined,
        req.user!.contractorId
      );

      // Save message to database with external message ID from Dialpad
      // Use contactId directly (schema no longer has leadId/customerId)
      const contactId = messageData.contactId || null;
      const message = await storage.createMessage({
        ...messageData,
        contactId: contactId,
        userId: req.user!.userId,
        status: smsResponse.success ? 'sent' : 'failed',
        externalMessageId: smsResponse.messageId || null,
      }, req.user!.contractorId);

      // Automatically mark contact as contacted if this is a text to a contact
      if (contactId && smsResponse.success) {
        await storage.markContactContacted(contactId, req.user!.contractorId, req.user!.userId);
      }

      // Log activity for the SMS
      if (smsResponse.success) {
        await storage.createActivity({
          type: 'sms',
          title: 'Text message sent',
          content: messageData.content,
          contactId: message.contactId || null,
          estimateId: message.estimateId || null,
          userId: req.user!.userId
        }, req.user!.contractorId);
        
        // Broadcast new message to WebSocket clients
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_message',
          message: message,
          contactId: message.contactId || message.estimateId,
          contactType: message.estimateId ? 'estimate' : 'contact'
        });
      }

      if (smsResponse.success) {
        res.json({ message, success: true });
      } else {
        res.status(500).json({ 
          message, 
          success: false, 
          error: smsResponse.error 
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid message data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to send text message" });
    }
  });

  app.post("/api/messages/send-email", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { subject, toEmail, ...messageData } = req.body;
      const parsedData = insertMessageSchema.omit({ contractorId: true, status: true }).parse({
        ...messageData,
        type: 'email',
        toNumber: toEmail, // Store email in toNumber field for consistency
      });
      
      if (!toEmail) {
        res.status(400).json({ message: "Email address is required" });
        return;
      }

      if (!subject) {
        res.status(400).json({ message: "Email subject is required" });
        return;
      }

      // Send email via tenant's preferred email provider
      const emailResponse = await providerService.sendEmail({
        to: toEmail,
        subject: subject,
        content: parsedData.content,
        contractorId: req.user!.contractorId
      });

      // Save message to database
      // Use contactId directly (schema no longer has leadId/customerId)
      const contactIdForEmail = parsedData.contactId || null;
      const message = await storage.createMessage({
        ...parsedData,
        contactId: contactIdForEmail,
        status: emailResponse.success ? 'sent' : 'failed',
      }, req.user!.contractorId);

      // Automatically mark contact as contacted if this is an email to a contact
      if (contactIdForEmail && emailResponse.success) {
        await storage.markContactContacted(contactIdForEmail, req.user!.contractorId, req.user!.userId);
      }

      // Log activity for the email
      if (emailResponse.success) {
        await storage.createActivity({
          type: 'email',
          title: `Email: ${subject}`,
          content: parsedData.content,
          contactId: message.contactId || null,
          estimateId: message.estimateId || null,
          userId: req.user!.userId
        }, req.user!.contractorId);
        
        // Broadcast new message to WebSocket clients
        const { broadcastToContractor } = await import('./websocket');
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_message',
          message: message,
          contactId: message.contactId || message.estimateId,
          contactType: message.estimateId ? 'estimate' : 'contact'
        });
      }

      if (emailResponse.success) {
        res.json({ 
          message, 
          success: true, 
          statusMessage: `Email sent successfully`,
          messageId: emailResponse.messageId 
        });
      } else {
        res.status(500).json({ 
          message, 
          success: false, 
          error: emailResponse.error 
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid email data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  // Validation schema for sending Gmail
  const sendGmailSchema = z.object({
    to: z.string().email("Invalid email address"),
    subject: z.string().min(1, "Subject is required"),
    content: z.string().min(1, "Content is required"),
    contactId: z.string().optional(),
    leadId: z.string().optional(), // Legacy - mapped to contactId
    estimateId: z.string().optional(),
    customerId: z.string().optional(), // Legacy - mapped to contactId
  });

  // Send email via user's connected Gmail account (per-user OAuth)
  app.post("/api/emails/send-gmail", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const validatedData = sendGmailSchema.parse(req.body);
      const { to, subject, content, contactId, leadId, estimateId, customerId } = validatedData;
      // Support both new (contactId) and legacy (leadId, customerId) parameters
      const resolvedContactId = contactId || leadId || customerId;

      // Get user's Gmail credentials
      const userResult = await db.select().from(users).where(and(
        eq(users.id, req.user!.userId),
        eq(users.contractorId, req.user!.contractorId)
      ));
      const user = userResult[0];
      if (!user || !user.gmailConnected || !user.gmailRefreshToken) {
        res.status(400).json({ message: "Gmail not connected. Please connect your Gmail account in settings." });
        return;
      }

      // Get contractor information for company name
      const contractorResult = await db.select().from(contractors).where(
        eq(contractors.id, req.user!.contractorId)
      );
      const contractor = contractorResult[0];

      // Format sender name as "User Name @ Company Name"
      const fromName = contractor?.name 
        ? `${user.name} @ ${contractor.name}`
        : user.name;

      // Send email via Gmail API
      const emailResponse = await gmailService.sendEmail({
        to,
        subject,
        content,
        fromEmail: user.gmailEmail || undefined,
        fromName: fromName,
        refreshToken: user.gmailRefreshToken,
      });

      if (emailResponse.success) {
        // Create activity record with email metadata including direction
        const emailMetadata = {
          subject,
          to: [to],
          from: user.gmailEmail || '',
          messageId: emailResponse.messageId,
          direction: 'outbound',
        };

        const activity = await storage.createActivity({
          type: 'email',
          title: `Email: ${subject}`,
          content,
          metadata: JSON.stringify(emailMetadata),
          contactId: resolvedContactId || null,
          estimateId: estimateId || null,
          userId: req.user!.userId,
          externalId: emailResponse.messageId || null,
          externalSource: 'gmail',
        }, req.user!.contractorId);

        // Mark contact as contacted if this is an email to a contact
        const contactIdToMark = resolvedContactId || estimateId;
        if (contactIdToMark) {
          await storage.markContactContacted(contactIdToMark, req.user!.contractorId, req.user!.userId);
        }

        // Broadcast new message to WebSocket clients
        // Transform activity to Message format matching getConversationMessages
        // Preserve legacy field semantics: determine leadId/customerId based on contact type
        const { broadcastToContractor } = await import('./websocket');
        
        // Determine legacy fields based on contact type for backward compatibility
        let broadcastLeadId: string | null = leadId || null;
        let broadcastCustomerId: string | null = customerId || null;
        let broadcastContactType: 'estimate' | 'customer' | 'lead' = 'lead';
        
        if (estimateId) {
          broadcastContactType = 'estimate';
        } else if (customerId) {
          broadcastCustomerId = customerId;
          broadcastContactType = 'customer';
        } else if (leadId) {
          broadcastLeadId = leadId;
          broadcastContactType = 'lead';
        } else if (contactId && resolvedContactId) {
          // When only new contactId is provided, look up contact type
          const resolvedContact = await storage.getContact(resolvedContactId, req.user!.contractorId);
          if (resolvedContact?.type === 'customer') {
            broadcastCustomerId = resolvedContactId;
            broadcastContactType = 'customer';
          } else {
            broadcastLeadId = resolvedContactId;
            broadcastContactType = 'lead';
          }
        }
        
        broadcastToContractor(req.user!.contractorId, {
          type: 'new_message',
          message: {
            id: activity.id,
            type: 'email' as const,
            status: 'sent' as const,
            direction: emailMetadata.direction as 'outbound',
            content: activity.content || content,
            toNumber: emailMetadata.to[0],
            fromNumber: emailMetadata.from,
            contactId: activity.contactId || null,
            leadId: broadcastLeadId,
            customerId: broadcastCustomerId,
            estimateId: activity.estimateId || null,
            userId: activity.userId || null,
            externalMessageId: emailMetadata.messageId || null,
            contractorId: activity.contractorId,
            createdAt: activity.createdAt,
            userName: user.name,
          },
          contactId: resolvedContactId || estimateId || null,
          contactType: broadcastContactType
        });

        res.json({
          success: true,
          messageId: emailResponse.messageId,
          message: "Email sent successfully"
        });
      } else {
        res.status(500).json({
          success: false,
          error: emailResponse.error,
          message: "Failed to send email"
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid email data", errors: error.errors });
        return;
      }
      console.error('[Email] Error sending Gmail:', error);
      res.status(500).json({ message: "Failed to send email via Gmail" });
    }
  });

  // Validation schema for fetching Gmail
  const fetchGmailSchema = z.object({
    sinceDate: z.string().optional(),
  });

  // Fetch new emails from user's connected Gmail account
  app.post("/api/emails/fetch-gmail", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const validatedData = fetchGmailSchema.parse(req.body);
      const { sinceDate } = validatedData;

      // Get user's Gmail credentials
      const userResult = await db.select().from(users).where(and(
        eq(users.id, req.user!.userId),
        eq(users.contractorId, req.user!.contractorId)
      ));
      const user = userResult[0];
      if (!user || !user.gmailConnected || !user.gmailRefreshToken) {
        res.status(400).json({ message: "Gmail not connected. Please connect your Gmail account in settings." });
        return;
      }

      // Fetch emails from Gmail
      const since = sinceDate ? new Date(sinceDate) : (user.gmailLastSyncAt || undefined);
      const result = await gmailService.fetchNewEmails(user.gmailRefreshToken, since);
      
      // Handle potential errors or expired tokens
      if (result.error) {
        console.error('[Email] Gmail fetch error:', result.error);
        res.status(500).json({ message: result.error });
        return;
      }
      
      if (result.tokenExpired) {
        res.status(401).json({ message: "Gmail token expired. Please reconnect your Gmail account." });
        return;
      }
      
      const emails = result.emails || [];

      // Process each email and create activities
      let processedCount = 0;
      for (const email of emails) {
        // Check if we already have an activity for this email to avoid duplicates
        const existingActivity = await db.select().from(activities).where(and(
          eq(activities.externalId, email.id),
          eq(activities.externalSource, 'gmail'),
          eq(activities.contractorId, req.user!.contractorId)
        )).limit(1);

        if (existingActivity.length > 0) {
          console.log('[Email Sync] Skipping duplicate email:', email.id);
          continue;
        }

        // Try to match email to existing lead/customer/estimate by email address
        const fromEmail = email.from;
        const toEmail = email.to;
        
        // Determine if email is inbound (from customer/lead) or outbound (sent by us)
        // If the "from" email matches user's Gmail, it's outbound; otherwise it's inbound
        const isOutbound = fromEmail?.toLowerCase() === user.gmailEmail?.toLowerCase();
        const direction = isOutbound ? 'outbound' : 'inbound';
        
        // For outbound emails, match on 'to', for inbound emails, match on 'from'
        const emailToMatch = isOutbound ? toEmail : fromEmail;
        
        let matchingLead = null;
        let matchingCustomer = null;
        
        // Only search for matches if we have a valid email to match
        if (emailToMatch && typeof emailToMatch === 'string') {
          const emailToMatchLower = emailToMatch.toLowerCase();
          
          // Search for leads (contacts with type='lead') with this email
          const leadsData = await storage.getContacts(req.user!.contractorId, 'lead');
          matchingLead = leadsData.find((lead: any) => 
            lead.emails && Array.isArray(lead.emails) && lead.emails.some((e: any) => 
              typeof e === 'string' && e.toLowerCase() === emailToMatchLower
            )
          );

          // Search for customers (contacts with type='customer') with this email
          const customers = await storage.getContacts(req.user!.contractorId, 'customer');
          matchingCustomer = customers.find((customer: any) => 
            customer.emails && Array.isArray(customer.emails) && customer.emails.some((e: any) => 
              typeof e === 'string' && e.toLowerCase() === emailToMatchLower
            )
          );
        }

        // Create activity record with email metadata including direction
        const emailMetadata = {
          subject: email.subject,
          to: email.to,
          from: email.from,
          messageId: email.id,
          direction: direction,
        };

        const activity = await storage.createActivity({
          type: 'email',
          title: direction === 'inbound' ? `Email received: ${email.subject}` : `Email sent: ${email.subject}`,
          content: email.body || email.snippet,
          metadata: JSON.stringify(emailMetadata),
          contactId: matchingLead?.id || matchingCustomer?.id || null,
          userId: req.user!.userId,
          externalId: email.id,
          externalSource: 'gmail',
        }, req.user!.contractorId);

        // Broadcast activity update via WebSocket
        if (matchingLead) {
          broadcastToContractor(req.user!.contractorId, {
            type: 'activity',
            contactId: matchingLead.id,
            leadId: matchingLead.id,
            activity: activity,
          });
        } else if (matchingCustomer) {
          broadcastToContractor(req.user!.contractorId, {
            type: 'activity',
            contactId: matchingCustomer.id,
            customerId: matchingCustomer.id,
            activity: activity,
          });
        }

        processedCount++;
      }

      // Update user's last sync timestamp
      await db.update(users)
        .set({ gmailLastSyncAt: new Date() })
        .where(and(
          eq(users.id, req.user!.userId),
          eq(users.contractorId, req.user!.contractorId)
        ));

      res.json({
        success: true,
        count: processedCount,
        message: `Fetched ${processedCount} new emails`
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid fetch data", errors: error.errors });
        return;
      }
      console.error('[Email] Error fetching Gmail:', error);
      res.status(500).json({ message: "Failed to fetch emails from Gmail" });
    }
  });

  // Call initiation route
  app.post("/api/calls/initiate", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { toNumber, fromNumber, autoRecord, contactId, customerId, leadId } = req.body;
      // Support both new (contactId) and legacy (leadId, customerId) parameters
      const resolvedContactId = contactId || leadId || customerId;
      
      if (!toNumber) {
        res.status(400).json({ message: "Phone number is required" });
        return;
      }

      // Initiate call via tenant's preferred calling provider
      const callResponse = await providerService.initiateCall({
        to: toNumber,
        fromNumber: fromNumber || undefined,
        autoRecord: autoRecord || false,
        contractorId: req.user!.contractorId,
        userId: req.user!.userId
      });

      console.log('Call response:', callResponse);
      
      if (callResponse.success && callResponse.callId) {
        // Store call metadata for tenant isolation
        const callData = {
          externalCallId: callResponse.callId,
          toNumber,
          fromNumber: fromNumber || null,
          status: 'initiated' as const,
          customerId: customerId || null,
          leadId: leadId || null,
          userId: req.user!.userId,
          callUrl: callResponse.callUrl || null,
          metadata: JSON.stringify({
            autoRecord,
            callResponse: {
              success: callResponse.success,
              timestamp: new Date().toISOString()
            }
          })
        };

        await storage.createCall(callData, req.user!.contractorId);

        // Automatically mark contact as contacted if this is a call to a contact
        if (resolvedContactId) {
          await storage.markContactContacted(resolvedContactId, req.user!.contractorId, req.user!.userId);
        }

        // Log activity for the call
        await storage.createActivity({
          type: 'call',
          title: 'Phone call initiated',
          content: `Call initiated to ${toNumber}${fromNumber ? ` from ${fromNumber}` : ''}`,
          contactId: resolvedContactId || null,
          userId: req.user!.userId
        }, req.user!.contractorId);

        res.json({ 
          success: true, 
          callId: callResponse.callId,
          callUrl: callResponse.callUrl
        });
      } else {
        console.error('Call initiation failed:', callResponse.error);
        res.status(500).json({ 
          success: false, 
          error: callResponse.error 
        });
      }
    } catch (error) {
      console.error('Call initiation error:', error);
      res.status(500).json({ 
        success: false,
        error: error instanceof Error ? error.message : "Failed to initiate call" 
      });
    }
  });

  // Get call details route with tenant isolation
  app.get("/api/calls/:callId", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { callId } = req.params;
      
      // SECURITY: First verify this call belongs to the user's tenant
      const callRecord = await storage.getCallByExternalId(callId, req.user!.contractorId);
      if (!callRecord) {
        res.status(404).json({ 
          success: false, 
          error: "Call not found or access denied" 
        });
        return;
      }

      // Now safely fetch details from Dialpad since we've verified tenant ownership
      const dialpadResponse = await dialpadService.getCallDetails(callId);

      if (dialpadResponse.success) {
        // Look up contact type for legacy field population
        let legacyLeadId: string | null = null;
        let legacyCustomerId: string | null = null;
        if (callRecord.contactId) {
          const callContact = await storage.getContact(callRecord.contactId, req.user!.contractorId);
          if (callContact?.type === 'customer') {
            legacyCustomerId = callRecord.contactId;
          } else {
            legacyLeadId = callRecord.contactId;
          }
        }
        
        res.json({
          success: true,
          callDetails: dialpadResponse.callDetails,
          localCallInfo: {
            id: callRecord.id,
            toNumber: callRecord.toNumber,
            fromNumber: callRecord.fromNumber,
            status: callRecord.status,
            contactId: callRecord.contactId,
            customerId: legacyCustomerId,
            leadId: legacyLeadId,
            createdAt: callRecord.createdAt
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: dialpadResponse.error
        });
      }
    } catch (error) {
      console.error('Get call details error:', error);
      res.status(500).json({ message: "Failed to get call details" });
    }
  });

  // Enhanced message routes for unified communications
  app.get("/api/messages/all", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { type, status, search, limit, offset } = req.query;
      const options = {
        type: type as 'text' | 'email' | undefined,
        status: status as 'sent' | 'delivered' | 'failed' | undefined,
        search: search as string | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      };
      
      const messages = await storage.getAllMessages(req.user!.contractorId, options);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.get("/api/conversations", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { search, type, status } = req.query;
      const options = {
        search: search as string | undefined,
        type: type as 'text' | 'email' | undefined,
        status: status as 'sent' | 'delivered' | 'failed' | undefined,
      };
      
      const conversations = await storage.getConversations(req.user!.contractorId, options);
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Unified endpoint for fetching conversation messages by contactId (no contactType needed)
  app.get("/api/conversations/:contactId", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contactId } = req.params;
      
      const messages = await storage.getConversationMessages(
        req.user!.contractorId, 
        contactId
      );
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversation messages" });
    }
  });

  // Legacy endpoint for backwards compatibility (deprecated - use /api/conversations/:contactId instead)
  app.get("/api/conversations/:contactId/:contactType", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contactId, contactType } = req.params;
      
      if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
        res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
        return;
      }
      
      // contactType parameter is deprecated - getConversationMessages now works with unified contacts table
      const messages = await storage.getConversationMessages(
        req.user!.contractorId, 
        contactId
      );
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversation messages" });
    }
  });

  // Lightweight endpoint to check for new messages (returns count only)
  app.get("/api/conversations/:contactId/:contactType/count", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contactId, contactType } = req.params;
      
      if (contactType !== 'lead' && contactType !== 'customer' && contactType !== 'estimate') {
        res.status(400).json({ message: "Contact type must be 'lead', 'customer', or 'estimate'" });
        return;
      }
      
      // contactType parameter is deprecated - getConversationMessageCount now works with unified contacts table
      const count = await storage.getConversationMessageCount(
        req.user!.contractorId, 
        contactId
      );
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch conversation message count" });
    }
  });

  // Template routes for text and email templates
  app.get("/api/templates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const type = req.query.type as 'text' | 'email' | undefined;
      const isAdmin = req.user!.role === 'admin' || req.user!.role === 'super_admin';
      const userId = req.user!.userId;
      
      // Build query to filter templates
      // Admins see all templates, others see only approved templates OR templates they created
      let query = db.select().from(templates).where(eq(templates.contractorId, req.user!.contractorId));
      
      if (type) {
        query = (query as any).where(and(
          eq(templates.contractorId, req.user!.contractorId),
          eq(templates.type, type)
        ));
      }
      
      const allTemplates = await query;
      
      // Filter based on user role and template status
      const filteredTemplates = allTemplates.filter(template => {
        if (isAdmin) {
          return true; // Admins see all templates
        }
        if (template.status === 'approved') {
          return true; // Everyone sees approved templates
        }
        if (template.createdBy === userId) {
          return true; // Users see their own templates regardless of status
        }
        return false; // Hide non-approved templates from other users
      });
      
      res.json(filteredTemplates);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/templates/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const template = await storage.getTemplate(req.params.id, req.user!.contractorId);
      if (!template) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  app.post("/api/templates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const templateData = insertTemplateSchema.omit({ contractorId: true }).parse(req.body);
      
      // Automatically set createdBy to current user
      const dataWithUser = {
        ...templateData,
        createdBy: req.user!.userId,
      };
      
      // Admins can create approved templates directly, others need approval
      const template = await storage.createTemplate(dataWithUser, req.user!.contractorId);
      res.status(201).json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid template data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  app.put("/api/templates/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const updateData = insertTemplateSchema.omit({ contractorId: true }).partial().parse(req.body);
      const template = await storage.updateTemplate(req.params.id, updateData, req.user!.contractorId);
      if (!template) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid template data", errors: error.errors });
        return;
      }
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  app.delete("/api/templates/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const success = await storage.deleteTemplate(req.params.id, req.user!.contractorId);
      if (!success) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json({ message: "Template deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // Approve template (admin only)
  app.post("/api/templates/:id/approve", requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      // Update template status to approved
      const updated = await db.update(templates)
        .set({ 
          status: 'approved',
          approvedBy: req.user!.userId,
          approvedAt: new Date()
        })
        .where(and(
          eq(templates.id, id),
          eq(templates.contractorId, req.user!.contractorId)
        ))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ message: "Template not found" });
        return;
      }

      res.json({ 
        ...updated[0], 
        message: "Template approved successfully" 
      });
    } catch (error) {
      console.error('Failed to approve template:', error);
      res.status(500).json({ message: "Failed to approve template" });
    }
  });

  // Reject template (admin only)
  app.post("/api/templates/:id/reject", requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      
      // Update template status to rejected
      const updated = await db.update(templates)
        .set({ 
          status: 'rejected',
          rejectionReason: rejectionReason || 'No reason provided',
          approvedBy: req.user!.userId,
          approvedAt: new Date()
        })
        .where(and(
          eq(templates.id, id),
          eq(templates.contractorId, req.user!.contractorId)
        ))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ message: "Template not found" });
        return;
      }

      res.json({ 
        ...updated[0], 
        message: "Template rejected" 
      });
    } catch (error) {
      console.error('Failed to reject template:', error);
      res.status(500).json({ message: "Failed to reject template" });
    }
  });

  // Provider management routes
  app.get("/api/providers", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantProviders = await storage.getTenantProviders(req.user!.contractorId);
      const availableProviders = {
        email: providerService.getAvailableProviders('email'),
        sms: providerService.getAvailableProviders('sms'),
        calling: providerService.getAvailableProviders('calling')
      };
      res.json({ available: availableProviders, configured: tenantProviders });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider information" });
    }
  });

  app.post("/api/providers", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { providerType, providerName } = req.body;
      if (!providerType || !providerName) {
        res.status(400).json({ message: "Provider type and name are required" });
        return;
      }
      if (!['email', 'sms', 'calling'].includes(providerType)) {
        res.status(400).json({ message: "Invalid provider type" });
        return;
      }
      const result = await providerService.setTenantProvider(req.user!.contractorId, providerType as 'email' | 'sms' | 'calling', providerName);
      if (result.success) {
        res.json({ success: true, message: `${providerType} provider set to ${providerName}` });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to set provider preference" });
    }
  });

  // Integration enablement routes
  app.get("/api/integrations", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user has permission to manage integrations
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to view integrations" });
        return;
      }

      const tenantIntegrations = await storage.getTenantIntegrations(req.user!.contractorId);
      const enabledIntegrations = await storage.getEnabledIntegrations(req.user!.contractorId);
      
      // Get available providers for each integration that has credentials
      const integrationStatus = [];
      
      for (const integrationName of INTEGRATION_NAMES) {
        const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
        const isEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, integrationName);
        
        integrationStatus.push({
          name: integrationName,
          hasCredentials,
          isEnabled,
          canEnable: hasCredentials && !isEnabled
        });
      }
      
      res.json({ 
        integrations: integrationStatus,
        configured: tenantIntegrations,
        enabled: enabledIntegrations 
      });
    } catch (error) {
      console.error('Failed to fetch integration status:', error);
      res.status(500).json({ message: "Failed to fetch integration information" });
    }
  });

  app.post("/api/integrations/:integrationName/enable", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user has permission to manage integrations
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to enable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Check if tenant has required credentials
      const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
      if (!hasCredentials) {
        res.status(400).json({ 
          message: `Cannot enable ${integrationName} integration. Please configure credentials first.`,
          missingCredentials: true
        });
        return;
      }
      
      // Enable the integration
      const integration = await storage.enableTenantIntegration(
        req.user!.contractorId, 
        integrationName, 
        req.user!.userId
      );
      
      // If this is the Housecall Pro integration, schedule daily syncs
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('./sync-scheduler');
          await syncScheduler.onIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to schedule sync for Housecall Pro integration:', error);
          // Don't fail the request if scheduling fails
        }
      }
      
      // If this is the Dialpad integration, automatically create SMS webhook
      let webhookCreated = false;
      let webhookError: string | undefined;
      
      if (integrationName === 'dialpad') {
        try {
          // Build the base webhook URL from the request
          const protocol = req.get('x-forwarded-proto') || req.protocol;
          const host = req.get('x-forwarded-host') || req.get('host');
          const baseWebhookUrl = `${protocol}://${host}`;
          
          const result = await dialpadEnhancedService.createWebhookWithSubscription(
            req.user!.contractorId,
            'inbound',
            baseWebhookUrl
          );
          if (result.success) {
            webhookCreated = true;
          } else {
            webhookError = result.error || 'Failed to create webhook';
            console.error('Failed to auto-create Dialpad webhook:', result.error);
          }
        } catch (error) {
          webhookError = error instanceof Error ? error.message : 'Unknown error occurred';
          console.error('Failed to auto-create Dialpad webhook:', error);
        }
      }
      
      res.json({ 
        success: true, 
        message: `${integrationName} integration enabled successfully`,
        integration,
        webhookCreated: integrationName === 'dialpad' ? webhookCreated : undefined,
        webhookError: integrationName === 'dialpad' ? webhookError : undefined
      });
    } catch (error) {
      console.error('Failed to enable integration:', error);
      res.status(500).json({ message: "Failed to enable integration" });
    }
  });

  app.post("/api/integrations/:integrationName/disable", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user has permission to manage integrations
      const canManageIntegrations = req.user!.role === 'admin' 
        || req.user!.role === 'super_admin' 
        || req.user!.role === 'manager'
        || req.user!.canManageIntegrations === true;
      
      if (!canManageIntegrations) {
        res.status(403).json({ message: "You do not have permission to disable integrations" });
        return;
      }

      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Disable the integration
      await storage.disableTenantIntegration(req.user!.contractorId, integrationName);
      
      // If this is the Housecall Pro integration, cancel scheduled syncs
      if (integrationName === 'housecall-pro') {
        try {
          const { syncScheduler } = await import('./sync-scheduler');
          await syncScheduler.onIntegrationDisabled(req.user!.contractorId, 'housecall-pro');
        } catch (error) {
          console.error('Failed to cancel scheduled sync for Housecall Pro integration:', error);
          // Don't fail the request if cancellation fails
        }
      }
      
      res.json({ 
        success: true, 
        message: `${integrationName} integration disabled successfully` 
      });
    } catch (error) {
      console.error('Failed to disable integration:', error);
      res.status(500).json({ message: "Failed to disable integration" });
    }
  });

  app.get("/api/integrations/:integrationName/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      const hasCredentials = await providerService.hasRequiredCredentials(req.user!.contractorId, integrationName);
      const isEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, integrationName);
      const integration = await storage.getTenantIntegration(req.user!.contractorId, integrationName);
      
      res.json({
        integrationName,
        hasCredentials,
        isEnabled,
        canEnable: hasCredentials && !isEnabled,
        canDisable: isEnabled,
        enabledAt: integration?.enabledAt,
        disabledAt: integration?.disabledAt
      });
    } catch (error) {
      console.error('Failed to get integration status:', error);
      res.status(500).json({ message: "Failed to get integration status" });
    }
  });

  app.post("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      const { credentials } = req.body;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Validate credentials are provided
      if (!credentials || Object.keys(credentials).length === 0) {
        res.status(400).json({ message: "Credentials are required" });
        return;
      }
      
      // Save credentials using the credential service
      const result = await providerService.saveCredentials(req.user!.contractorId, integrationName, credentials);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `${integrationName} credentials saved successfully` 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error || "Failed to save credentials" 
        });
      }
    } catch (error) {
      console.error('Failed to save integration credentials:', error);
      res.status(500).json({ message: "Failed to save integration credentials" });
    }
  });

  app.get("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Get masked credentials for display
      const credentials = await CredentialService.getMaskedCredentials(req.user!.contractorId, integrationName);
      
      res.json({ credentials });
    } catch (error) {
      console.error('Failed to get integration credentials:', error);
      res.status(500).json({ message: "Failed to get integration credentials" });
    }
  });

  app.delete("/api/integrations/:integrationName/credentials", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { integrationName } = req.params;
      
      // Validate integration name
      if (!INTEGRATION_NAMES.includes(integrationName as any)) {
        res.status(400).json({ message: "Invalid integration name" });
        return;
      }
      
      // Delete all credentials for this integration
      await CredentialService.deleteIntegrationCredentials(req.user!.contractorId, integrationName);
      
      res.json({ 
        success: true, 
        message: `${integrationName} credentials deleted successfully` 
      });
    } catch (error) {
      console.error('Failed to delete integration credentials:', error);
      res.status(500).json({ message: "Failed to delete integration credentials" });
    }
  });

  // Enhanced Dialpad integration routes
  app.post("/api/dialpad/sync-phone-numbers", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.syncPhoneNumbers(req.user!.contractorId);
      
      res.json({
        success: true,
        message: `Synced ${result.synced} phone numbers`,
        synced: result.synced,
        phoneNumbers: result.phoneNumbers,
        errors: result.errors
      });
    } catch (error) {
      console.error('Failed to sync Dialpad phone numbers:', error);
      res.status(500).json({ 
        message: "Failed to sync Dialpad phone numbers",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/dialpad/phone-numbers", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const phoneNumbers = await storage.getDialpadPhoneNumbers(req.user!.contractorId);
      res.json(phoneNumbers);
    } catch (error) {
      console.error('Failed to fetch Dialpad phone numbers:', error);
      res.status(500).json({ message: "Failed to fetch Dialpad phone numbers" });
    }
  });

  app.get("/api/dialpad/users/available-phone-numbers", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const action = req.query.action as 'sms' | 'call' || 'sms';
      const availableNumbers = await dialpadEnhancedService.getUserAvailablePhoneNumbers(
        req.user!.userId,
        req.user!.contractorId,
        action
      );
      res.json(availableNumbers);
    } catch (error) {
      console.error('Failed to fetch available phone numbers for user:', error);
      res.status(500).json({ message: "Failed to fetch available phone numbers" });
    }
  });

  // Get user's default Dialpad phone number
  app.get("/api/users/me/dialpad-default-number", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
      if (!user[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json({ dialpadDefaultNumber: user[0].dialpadDefaultNumber || null });
    } catch (error) {
      console.error('Failed to fetch user default Dialpad number:', error);
      res.status(500).json({ message: "Failed to fetch user default Dialpad number" });
    }
  });

  // Update user's default Dialpad phone number
  app.put("/api/users/me/dialpad-default-number", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dialpadDefaultNumber } = req.body;
      
      // Validate that it's either null or a valid phone number string
      if (dialpadDefaultNumber !== null && typeof dialpadDefaultNumber !== 'string') {
        res.status(400).json({ message: "Invalid phone number format" });
        return;
      }

      const result = await db
        .update(users)
        .set({ dialpadDefaultNumber: dialpadDefaultNumber || null })
        .where(eq(users.id, req.user!.userId))
        .returning();
      
      if (!result[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      res.json({ 
        dialpadDefaultNumber: result[0].dialpadDefaultNumber,
        message: dialpadDefaultNumber ? "Default number updated successfully" : "Default number cleared successfully"
      });
    } catch (error) {
      console.error('Failed to update user default Dialpad number:', error);
      res.status(500).json({ message: "Failed to update user default Dialpad number" });
    }
  });

  // Update any user's default Dialpad phone number (admin/manager only)
  app.put("/api/users/:userId/dialpad-default-number", requireAuth, requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { dialpadDefaultNumber } = req.body;
      
      // Validate that it's either null or a valid phone number string
      if (dialpadDefaultNumber !== null && typeof dialpadDefaultNumber !== 'string') {
        res.status(400).json({ message: "Invalid phone number format" });
        return;
      }

      // Verify the user belongs to the same contractor
      const targetUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!targetUser[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      if (targetUser[0].contractorId !== req.user!.contractorId) {
        res.status(403).json({ message: "Cannot modify users from other contractors" });
        return;
      }

      const result = await db
        .update(users)
        .set({ dialpadDefaultNumber: dialpadDefaultNumber || null })
        .where(eq(users.id, userId))
        .returning();
      
      res.json({ 
        dialpadDefaultNumber: result[0].dialpadDefaultNumber,
        message: dialpadDefaultNumber ? "Default number updated successfully" : "Default number cleared successfully"
      });
    } catch (error) {
      console.error('Failed to update user default Dialpad number:', error);
      res.status(500).json({ message: "Failed to update user default Dialpad number" });
    }
  });

  // Get contractor's default Dialpad phone number (accessible to all authenticated users)
  app.get("/api/contractor/dialpad-default-number", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractor = await db.select().from(contractors)
        .where(eq(contractors.id, req.user!.contractorId))
        .limit(1);
      
      if (!contractor[0]) {
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      res.json({ defaultDialpadNumber: contractor[0].defaultDialpadNumber || null });
    } catch (error) {
      console.error('Failed to fetch contractor default Dialpad number:', error);
      res.status(500).json({ message: "Failed to fetch contractor default Dialpad number" });
    }
  });

  // Update contractor's default Dialpad phone number (admin only)
  app.put("/api/contractor/dialpad-default-number", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { defaultDialpadNumber } = req.body;
      
      // Validate that it's either null or a valid phone number string
      if (defaultDialpadNumber !== null && typeof defaultDialpadNumber !== 'string') {
        res.status(400).json({ message: "Invalid phone number format" });
        return;
      }

      const result = await db
        .update(contractors)
        .set({ defaultDialpadNumber: defaultDialpadNumber || null })
        .where(eq(contractors.id, req.user!.contractorId))
        .returning();
      
      if (!result[0]) {
        res.status(404).json({ message: "Contractor not found" });
        return;
      }

      res.json({ 
        defaultDialpadNumber: result[0].defaultDialpadNumber,
        message: defaultDialpadNumber ? "Organization default number updated successfully" : "Organization default number cleared successfully"
      });
    } catch (error) {
      console.error('Failed to update contractor default Dialpad number:', error);
      res.status(500).json({ message: "Failed to update contractor default Dialpad number" });
    }
  });
  
  // Multi-tenant user operations
  // Get all contractors a user belongs to
  app.get("/api/user/contractors", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userContractors = await storage.getUserContractors(req.user!.userId);
      
      // Get contractor details for each relationship
      const contractorsWithDetails = await Promise.all(
        userContractors.map(async (uc) => {
          const contractor = await storage.getContractor(uc.contractorId);
          return {
            ...uc,
            contractor
          };
        })
      );
      
      res.json(contractorsWithDetails);
    } catch (error: any) {
      console.error("Error getting user contractors:", error);
      res.status(500).json({ message: "Failed to get contractors" });
    }
  });
  
  // Switch to a different contractor
  app.post("/api/user/switch-contractor", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contractorId } = req.body;
      
      if (!contractorId) {
        res.status(400).json({ message: "Contractor ID is required" });
        return;
      }
      
      // Switch the contractor
      const updatedUser = await storage.switchContractor(req.user!.userId, contractorId);
      
      if (!updatedUser) {
        res.status(404).json({ message: "User or contractor not found" });
        return;
      }
      
      // Get the user-contractor relationship to check permissions
      const userContractor = await storage.getUserContractor(req.user!.userId, contractorId);
      if (!userContractor) {
        res.status(403).json({ message: "Access denied to this contractor" });
        return;
      }
      
      // Generate new JWT token with updated contractor context
      const newToken = AuthService.generateToken({
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        email: updatedUser.email,
        role: userContractor.role, // Use role from the contractor relationship
        contractorId: contractorId,
        canManageIntegrations: userContractor.canManageIntegrations || false
      });
      
      // Update the auth cookie with new token
      res.cookie('auth_token', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (sliding expiration)
        path: '/', // Explicit path for better cookie persistence
      });
      
      res.json({ 
        message: "Contractor switched successfully",
        contractorId: updatedUser.contractorId,
        token: newToken // Return token for API clients
      });
    } catch (error: any) {
      console.error("Error switching contractor:", error);
      res.status(400).json({ message: error.message || "Failed to switch contractor" });
    }
  });

  // Get user phone number permissions
  app.get("/api/users/:userId/phone-permissions", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      
      // Verify user belongs to same contractor
      const targetUser = await db.select().from(users)
        .where(and(eq(users.id, userId), eq(users.contractorId, req.user!.contractorId)))
        .limit(1);
      
      if (!targetUser[0]) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const permissions = await storage.getUserPhoneNumberPermissions(userId);
      
      // Join with phone number details
      const permissionsWithDetails = await Promise.all(
        permissions.map(async (perm) => {
          const phoneNumber = await storage.getDialpadPhoneNumber(perm.phoneNumberId, req.user!.contractorId);
          return {
            ...perm,
            phoneNumber: phoneNumber?.phoneNumber,
            displayName: phoneNumber?.displayName
          };
        })
      );
      
      res.json(permissionsWithDetails);
    } catch (error) {
      console.error('Failed to fetch user phone permissions:', error);
      res.status(500).json({ message: "Failed to fetch user phone permissions" });
    }
  });

  app.post("/api/dialpad/phone-numbers/:phoneNumberId/permissions", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumberId } = req.params;
      const { userId, canSendSms, canMakeCalls } = req.body;
      
      if (!userId) {
        res.status(400).json({ message: "User ID is required" });
        return;
      }

      // Check if permission already exists
      const existingPermission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);
      
      if (existingPermission) {
        // Update existing permission
        const updatedPermission = await storage.updateUserPhoneNumberPermission(existingPermission.id, {
          canSendSms: canSendSms ?? false,
          canMakeCalls: canMakeCalls ?? false,
          isActive: true
        });
        res.json(updatedPermission);
      } else {
        // Create new permission
        const newPermission = await storage.createUserPhoneNumberPermission({
          userId,
          phoneNumberId,
          contractorId: req.user!.contractorId,
          canSendSms: canSendSms ?? false,
          canMakeCalls: canMakeCalls ?? false,
          assignedBy: req.user!.userId
        });
        res.json(newPermission);
      }
    } catch (error) {
      console.error('Failed to manage phone number permission:', error);
      res.status(500).json({ message: "Failed to manage phone number permission" });
    }
  });

  app.delete("/api/dialpad/phone-numbers/:phoneNumberId/permissions/:userId", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumberId, userId } = req.params;
      
      const permission = await storage.getUserPhoneNumberPermission(userId, phoneNumberId);
      if (!permission) {
        res.status(404).json({ message: "Permission not found" });
        return;
      }

      const deleted = await storage.deleteUserPhoneNumberPermission(permission.id);
      if (deleted) {
        res.json({ success: true, message: "Permission removed successfully" });
      } else {
        res.status(500).json({ message: "Failed to remove permission" });
      }
    } catch (error) {
      console.error('Failed to remove phone number permission:', error);
      res.status(500).json({ message: "Failed to remove phone number permission" });
    }
  });

  app.put("/api/dialpad/phone-numbers/:id", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { displayName, department } = req.body;
      
      const updatedPhoneNumber = await storage.updateDialpadPhoneNumber(id, {
        displayName,
        department
      });
      
      res.json(updatedPhoneNumber);
    } catch (error) {
      console.error('Failed to update Dialpad phone number:', error);
      res.status(500).json({ message: "Failed to update phone number" });
    }
  });

  app.get("/api/dialpad/users", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const dialpadUsers = await dialpadEnhancedService.fetchDialpadUsers(req.user!.contractorId);
      res.json(dialpadUsers);
    } catch (error) {
      console.error('Failed to fetch Dialpad users:', error);
      res.status(500).json({ 
        message: "Failed to fetch Dialpad users",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dialpad webhook management routes (requires manager/admin or canManageIntegrations)
  app.post("/api/dialpad/webhooks/create", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Build the base webhook URL from the request
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const baseWebhookUrl = `${protocol}://${host}`;
      
      // Create webhook and SMS subscription using the helper method
      // The service will build the tenant-specific URL
      const result = await dialpadEnhancedService.createWebhookWithSubscription(
        req.user!.contractorId,
        'inbound',
        baseWebhookUrl
      );

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to create webhook",
          error: result.error 
        });
        return;
      }

      res.json({
        success: true,
        webhookId: result.webhookId,
        subscriptionId: result.subscriptionId,
        webhookUrl: result.hookUrl
      });
    } catch (error) {
      console.error('Failed to create Dialpad webhook:', error);
      res.status(500).json({ 
        message: "Failed to create Dialpad webhook",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/dialpad/webhooks/list", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.listWebhooks(req.user!.contractorId);

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to list webhooks",
          error: result.error 
        });
        return;
      }

      res.json({ webhooks: result.webhooks || [] });
    } catch (error) {
      console.error('Failed to list Dialpad webhooks:', error);
      res.status(500).json({ 
        message: "Failed to list Dialpad webhooks",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.delete("/api/dialpad/webhooks/:webhookId", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { webhookId } = req.params;
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'dialpad');
      
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await dialpadEnhancedService.deleteWebhook(req.user!.contractorId, webhookId);

      if (!result.success) {
        res.status(500).json({ 
          message: "Failed to delete webhook",
          error: result.error 
        });
        return;
      }

      res.json({ success: true, message: "Webhook deleted successfully" });
    } catch (error) {
      console.error('Failed to delete Dialpad webhook:', error);
      res.status(500).json({ 
        message: "Failed to delete Dialpad webhook",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Housecall Pro integration routes
  app.get("/api/housecall-pro/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const isConfigured = await housecallProService.isConfigured(req.user!.contractorId);
      if (!isConfigured) {
        res.json({ configured: false, connected: false });
        return;
      }
      
      const connection = await housecallProService.checkConnection(req.user!.contractorId);
      res.json({ 
        configured: true, 
        connected: connection.connected,
        error: connection.error 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to check Housecall Pro status" });
    }
  });

  app.get("/api/housecall-pro/employees", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const result = await housecallProService.getEmployees(req.user!.contractorId);
      if (!result.success) {
        res.status(400).json({ message: result.error });
        return;
      }
      res.json(result.data);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Housecall Pro employees" });
    }
  });

  app.get("/api/housecall-pro/availability", async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if Housecall Pro integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      const { date, estimatorIds } = req.query;
      
      if (!date || typeof date !== 'string') {
        res.status(400).json({ message: "Date parameter is required (YYYY-MM-DD format)" });
        return;
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
        return;
      }

      // Parse estimatorIds if provided
      let estimatorIdArray: string[] | undefined;
      if (estimatorIds) {
        if (typeof estimatorIds === 'string') {
          estimatorIdArray = estimatorIds.split(',').filter(id => id.trim());
        } else if (Array.isArray(estimatorIds)) {
          estimatorIdArray = (estimatorIds as string[]).filter(id => typeof id === 'string' && id.trim());
        }
      }

      const result = await housecallProService.getEstimatorAvailability(
        req.user!.contractorId, 
        date, 
        estimatorIdArray
      );
      
      if (!result.success) {
        res.status(400).json({ message: result.error });
        return;
      }
      
      res.json(result.data);
    } catch (error) {
      console.error('Error fetching estimator availability:', error);
      res.status(500).json({ message: "Failed to fetch estimator availability" });
    }
  });

  // Get HCP estimates for a specific employee on a specific date
  app.get("/api/housecall/employee-estimates", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { employeeId, date } = req.query;
      
      if (!employeeId || !date) {
        res.status(400).json({ message: "employeeId and date are required" });
        return;
      }
      
      // Create start and end of day for the given date
      const startOfDay = new Date(`${date}T00:00:00`);
      const endOfDay = new Date(`${date}T23:59:59`);
      
      // Fetch estimates from HCP for this employee and date range
      const result = await housecallProService.getEmployeeScheduledEstimates(
        req.user!.contractorId, 
        employeeId as string, 
        startOfDay, 
        endOfDay
      );
      
      if (!result.success) {
        console.error('[HCP] Failed to fetch employee estimates:', result.error);
        res.json([]);
        return;
      }
      
      // Extract schedule times from estimates (handles both direct and options formats)
      const scheduledEstimates: Array<{id: string, scheduled_start: string, scheduled_end: string}> = [];
      
      for (const est of (result.data || [])) {
        // Check direct schedule on estimate
        if (est.scheduled_start && est.scheduled_end) {
          scheduledEstimates.push({
            id: est.id,
            scheduled_start: est.scheduled_start,
            scheduled_end: est.scheduled_end,
          });
        }
        // Check schedule object on estimate (HCP format: schedule.scheduled_start/scheduled_end)
        if (est.schedule?.scheduled_start && est.schedule?.scheduled_end) {
          scheduledEstimates.push({
            id: est.id,
            scheduled_start: est.schedule.scheduled_start,
            scheduled_end: est.schedule.scheduled_end,
          });
        }
        // Check options array for schedule (current HCP format)
        if (est.options && Array.isArray(est.options)) {
          for (const opt of est.options) {
            if (opt.schedule?.start_time && opt.schedule?.end_time) {
              scheduledEstimates.push({
                id: est.id,
                scheduled_start: opt.schedule.start_time,
                scheduled_end: opt.schedule.end_time,
              });
            }
            if (opt.scheduled_start && opt.scheduled_end) {
              scheduledEstimates.push({
                id: est.id,
                scheduled_start: opt.scheduled_start,
                scheduled_end: opt.scheduled_end,
              });
            }
          }
        }
      }
      
      res.json(scheduledEstimates);
    } catch (error) {
      console.error('[HCP] Error fetching employee estimates:', error);
      res.json([]);
    }
  });

  app.post("/api/housecall-pro/sync", async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    
    try {
      // Check if Housecall Pro integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Set sync status to running
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Starting sync...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[housecall-pro-sync] Starting manual sync for tenant ${contractorId}`);
      
      // Get sync start date for filtering
      const syncStartDate = await storage.getHousecallProSyncStartDate(req.user!.contractorId);
      console.log(`[housecall-pro-sync] Using sync start date filter: ${syncStartDate ? syncStartDate.toISOString() : 'none'}`);
      
      // Sync estimates with embedded customer data (following working App Script pattern)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing estimates...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });
      
      // Fetch ALL estimates from Housecall Pro with pagination (like the working Google Apps Script)
      const baseEstimatesParams = syncStartDate ? {
        modified_since: syncStartDate.toISOString(),
        sort_by: 'created_at',
        sort_direction: 'desc',
        page_size: 100
      } : {
        sort_by: 'created_at',
        sort_direction: 'desc',
        page_size: 100
      };
      
      let allHousecallProEstimates: any[] = [];
      let page = 1;
      let keepGoing = true;
      const maxRunTime = 5 * 60 * 1000; // 5-minute guard like Google Apps Script
      const startTime = Date.now();
      
      while (keepGoing) {
        // Check time limit (like Google Apps Script)
        if (Date.now() - startTime > maxRunTime) {
          console.log(`[housecall-pro-sync] Time limit reached at page ${page}, aborting pagination`);
          break;
        }
        
        const estimatesParams = { ...baseEstimatesParams, page };
        console.log(`[housecall-pro-sync] Fetching estimates page ${page}...`);
        
        // Update progress status for UI
        syncStatus.set(contractorId, {
          isRunning: true,
          progress: `Fetching estimates page ${page}...`,
          error: null,
          lastSync: null,
          startTime: new Date()
        });
        
        const estimatesResult = await housecallProService.getEstimates(req.user!.contractorId, estimatesParams);
        if (!estimatesResult.success) {
          console.error(`[housecall-pro-sync] Failed to fetch estimates page ${page}: ${estimatesResult.error}`);
          res.status(400).json({ message: estimatesResult.error });
          return;
        }

        const pageEstimates = estimatesResult.data || [];
        console.log(`[housecall-pro-sync] Page ${page}: fetched ${pageEstimates.length} estimates`);

        if (!pageEstimates.length) {
          console.log(`[housecall-pro-sync] No more estimates found, stopping pagination`);
          break;
        }
        
        // Add estimates from this page to our collection
        allHousecallProEstimates = allHousecallProEstimates.concat(pageEstimates);
        
        // If we got less than page_size, we've reached the end
        if (pageEstimates.length < baseEstimatesParams.page_size) {
          console.log(`[housecall-pro-sync] Page ${page} returned ${pageEstimates.length} estimates (< ${baseEstimatesParams.page_size}), stopping pagination`);
          keepGoing = false;
        } else {
          page++;
        }
      }
      
      const housecallProEstimates = allHousecallProEstimates;
      console.log(`[housecall-pro-sync] Fetched ${housecallProEstimates.length} total estimates from Housecall Pro across ${page} pages`);

      let newEstimates = 0;
      let updatedEstimates = 0;

      // Helper function to extract phone number (following App Script pattern)
      const extractPhone = (customer?: any) => {
        if (!customer) return '';
        
        // Try multiple possible phone field names from Housecall Pro
        return customer.phone_numbers?.[0]?.phone_number || 
               customer.mobile_number || 
               customer.home_number || 
               customer.work_number || 
               customer.phone || 
               customer.primary_phone || 
               customer.contact_phone || 
               customer.phone_number || 
               '';
      };

      // Helper function to extract address (following App Script pattern)  
      const extractAddress = (location?: any) => {
        if (!location) return '';
        const addr = location.service_location || location.address || location;
        if (!addr) return '';
        return `${addr.street || ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`.replace(/^,\s*/, '').trim();
      };

      for (const hcpEstimate of housecallProEstimates) {
        try {
          // Check if estimate already exists in our system
          const existingEstimate = await storage.getEstimateByHousecallProEstimateId(hcpEstimate.id, req.user!.contractorId);
          
          if (existingEstimate) {
            // Update existing estimate with latest data
            const updateData = {
              status: hcpEstimate.work_status === 'completed' ? 'approved' as const :
                     hcpEstimate.work_status === 'canceled' ? 'rejected' as const : 'pending' as const,
              amount: (Math.round((hcpEstimate.total_amount || hcpEstimate.total || hcpEstimate.total_price || hcpEstimate.amount || 0) / 100 * 100) / 100).toFixed(2), // Convert cents to dollars
              description: hcpEstimate.description || '',
              scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
            };
            
            await storage.updateEstimate(existingEstimate.id, updateData, req.user!.contractorId);
            updatedEstimates++;
            console.log(`[housecall-pro-sync] Updated estimate ${existingEstimate.id} from HCP ${hcpEstimate.id}`);
          } else {
            // Extract embedded customer data (following App Script pattern)
            const customerData = hcpEstimate.customer;
            if (!customerData) {
              console.warn(`[housecall-pro-sync] Skipping estimate ${hcpEstimate.id} - no customer data`);
              continue;
            }

            // Create or find customer inline (following App Script pattern)
            let localCustomer = await storage.getContactByExternalId(customerData.id, 'housecall-pro', req.user!.contractorId);
            
            if (!localCustomer) {
              // Create customer from embedded data
              // Extract email with multiple possible field names
              const extractEmail = (customer?: any) => {
                if (!customer) return '';
                return customer.email || 
                       customer.email_address || 
                       customer.primary_email || 
                       customer.contact_email || 
                       '';
              };

              const newCustomerData = {
                id: crypto.randomUUID(),
                name: `${customerData.first_name || ''} ${customerData.last_name || ''}`.trim() || 'Unknown Customer',
                type: 'customer' as const,
                email: extractEmail(customerData),
                phone: extractPhone(customerData),
                address: extractAddress(hcpEstimate),
                externalId: customerData.id,
                externalSource: 'housecall-pro' as const,
                createdAt: hcpEstimate.created_at ? new Date(hcpEstimate.created_at) : new Date(),
                updatedAt: hcpEstimate.modified_at ? new Date(hcpEstimate.modified_at) : new Date(),
              };
              
              localCustomer = await storage.createContact(newCustomerData, req.user!.contractorId);
              console.log(`[housecall-pro-sync] Created customer ${localCustomer.id} from embedded data in estimate ${hcpEstimate.id}`);
            }
            
            // Calculate amount (following App Script cents->dollars pattern)
            let amount = hcpEstimate.total_amount ?? hcpEstimate.total ?? hcpEstimate.total_price ?? hcpEstimate.amount ?? null;
            if (amount === null && Array.isArray(hcpEstimate.options)) {
              amount = hcpEstimate.options.reduce((max: number, option: any) => Math.max(max, Number(option.total_amount || 0)), 0);
            }
            const amountInDollars = typeof amount === 'number' ? (amount / 100).toFixed(2) : '0.00';
            
            // Create a proper estimate title from available fields
            let estimateTitle = 'Estimate from Housecall Pro'; // Fallback
            
            if (hcpEstimate.number) {
              estimateTitle = `Estimate #${hcpEstimate.number}`;
            } else if (hcpEstimate.estimate_number) {
              estimateTitle = `Estimate #${hcpEstimate.estimate_number}`;
            } else if (hcpEstimate.name) {
              estimateTitle = hcpEstimate.name;
            } else if (hcpEstimate.id) {
              // Use the Housecall Pro ID as a last resort before generic title
              estimateTitle = `Estimate #${hcpEstimate.id}`;
            }

            const estimateData = {
              id: crypto.randomUUID(),
              contactId: localCustomer.id,
              title: estimateTitle,
              description: hcpEstimate.description || '',
              amount: amountInDollars,
              status: hcpEstimate.work_status === 'completed' ? 'approved' as const :
                     hcpEstimate.work_status === 'canceled' ? 'rejected' as const : 'pending' as const,
              createdAt: hcpEstimate.created_at ? new Date(hcpEstimate.created_at) : new Date(),
              updatedAt: hcpEstimate.modified_at ? new Date(hcpEstimate.modified_at) : new Date(),
              validUntil: hcpEstimate.expires_at ? new Date(hcpEstimate.expires_at) : 
                         hcpEstimate.expiry_date ? new Date(hcpEstimate.expiry_date) :
                         hcpEstimate.valid_until ? new Date(hcpEstimate.valid_until) : null,
              scheduledStart: hcpEstimate.scheduled_start ? new Date(hcpEstimate.scheduled_start) : null,
              externalId: hcpEstimate.id,
              externalSource: 'housecall-pro' as const,
            };

            await storage.createEstimate(estimateData, req.user!.contractorId);
            newEstimates++;
            console.log(`[housecall-pro-sync] Created estimate ${estimateData.id} from HCP ${hcpEstimate.id}`);
          }
        } catch (itemError) {
          console.error(`[housecall-pro-sync] Failed to process estimate ${hcpEstimate.id}:`, itemError);
          // Continue processing other estimates
        }
      }

      const summary = {
        totalFetched: housecallProEstimates.length,
        newEstimates,
        updatedEstimates,
        syncedAt: new Date().toISOString(),
      };

      console.log(`[housecall-pro-sync] Sync completed:`, summary);
      
      // Update sync status to completed
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: null,
        lastSync: new Date().toISOString(),
        startTime: null
      });
      
      res.json({
        message: "Sync completed successfully",
        summary
      });
    } catch (error) {
      console.error('[housecall-pro-sync] Sync failed:', error);
      
      // Update sync status to error
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: error instanceof Error ? error.message : 'Sync failed',
        lastSync: null,
        startTime: null
      });
      
      res.status(500).json({ message: "Failed to sync with Housecall Pro" });
    }
  });

  // Dialpad sync endpoint
  app.post("/api/dialpad/sync", async (req: AuthenticatedRequest, res: Response) => {
    const contractorId = req.user!.contractorId;
    
    try {
      // Check if Dialpad integration is enabled
      const isIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'dialpad');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Dialpad integration is not enabled for this tenant. Please enable it first.",
          integrationDisabled: true 
        });
        return;
      }

      // Set sync status to running
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Starting Dialpad sync...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Starting manual sync for tenant ${contractorId}`);
      
      // Initialize summary counters
      const summary = {
        users: { fetched: 0, cached: 0 },
        departments: { fetched: 0, cached: 0 },
        phoneNumbers: { fetched: 0, cached: 0 }
      };

      // Sync users (persist to database)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad users...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing users...`);
      const usersResult = await dialpadEnhancedService.syncUsers(contractorId);
      summary.users.fetched = usersResult.fetched;
      summary.users.cached = usersResult.synced;
      console.log(`[dialpad-sync] Fetched ${usersResult.fetched} users, synced ${usersResult.synced} to database`);

      if (usersResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${usersResult.errors.length} errors during user sync:`, usersResult.errors);
      }

      // Sync departments (limited functionality for now)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad departments...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing departments...`);
      const departmentsResult = await dialpadEnhancedService.syncDepartments(contractorId);
      summary.departments.fetched = departmentsResult.fetched;
      summary.departments.cached = departmentsResult.synced;
      console.log(`[dialpad-sync] Fetched ${departmentsResult.fetched} departments, synced ${departmentsResult.synced} to database`);

      if (departmentsResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${departmentsResult.errors.length} errors during department sync:`, departmentsResult.errors);
      }

      // Sync phone numbers (this actually caches to database)
      syncStatus.set(contractorId, {
        isRunning: true,
        progress: 'Syncing Dialpad phone numbers...',
        error: null,
        lastSync: null,
        startTime: new Date()
      });

      console.log(`[dialpad-sync] Syncing phone numbers...`);
      const numbersResult = await dialpadEnhancedService.syncPhoneNumbers(contractorId);
      summary.phoneNumbers.fetched = numbersResult.fetched;
      summary.phoneNumbers.cached = numbersResult.synced;
      console.log(`[dialpad-sync] Fetched ${numbersResult.fetched} phone numbers, synced ${numbersResult.synced} to database`);

      if (numbersResult.errors.length > 0) {
        console.warn(`[dialpad-sync] Encountered ${numbersResult.errors.length} errors during phone number sync:`, numbersResult.errors);
      }

      console.log(`[dialpad-sync] Sync completed:`, summary);
      
      // Update sync status to completed
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: null,
        lastSync: new Date().toISOString(),
        startTime: null
      });
      
      res.json({
        message: "Dialpad sync completed successfully",
        summary
      });
    } catch (error) {
      console.error('[dialpad-sync] Sync failed:', error);
      
      // Update sync status to error
      syncStatus.set(contractorId, {
        isRunning: false,
        progress: null,
        error: error instanceof Error ? error.message : 'Dialpad sync failed',
        lastSync: null,
        startTime: null
      });
      
      res.status(500).json({ message: "Failed to sync with Dialpad" });
    }
  });

  // In-memory sync status tracking per contractor
  const syncStatus = new Map<string, {
    isRunning: boolean;
    progress: string | null;
    error: string | null;
    lastSync: string | null;
    startTime: Date | null;
  }>();

  // Sync status API endpoint
  app.get("/api/sync-status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const status = syncStatus.get(contractorId) || {
        isRunning: false,
        progress: null,
        error: null,
        lastSync: null,
        startTime: null
      };
      
      res.json({
        isRunning: status.isRunning,
        progress: status.progress,
        error: status.error,
        lastSync: status.lastSync
      });
    } catch (error) {
      console.error('[api] Failed to get sync status:', error);
      res.status(500).json({ message: "Failed to get sync status" });
    }
  });

  // Housecall Pro sync start date management
  app.get("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const syncStartDate = await storage.getHousecallProSyncStartDate(req.user!.contractorId);
      res.json({ syncStartDate: syncStartDate ? syncStartDate.toISOString() : null });
    } catch (error) {
      console.error('[housecall-pro-sync-settings] Failed to get sync start date:', error);
      res.status(500).json({ message: "Failed to get sync start date" });
    }
  });

  app.post("/api/housecall-pro/sync-start-date", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { syncStartDate } = req.body;
      const parsedDate = syncStartDate ? new Date(syncStartDate) : null;

      await storage.setHousecallProSyncStartDate(req.user!.contractorId, parsedDate);
      res.json({ 
        message: "Sync start date updated successfully",
        syncStartDate: parsedDate ? parsedDate.toISOString() : null
      });
    } catch (error) {
      console.error('[housecall-pro-sync-settings] Failed to set sync start date:', error);
      res.status(500).json({ message: "Failed to set sync start date" });
    }
  });

  // ========== Unified Scheduling API ==========
  // These routes provide a unified calendar view across all salespeople
  
  // Sync Housecall Pro users as salespeople
  app.post("/api/scheduling/sync-users", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const result = await housecallSchedulingService.syncHousecallUsers(req.user!.contractorId);
      res.json(result);
    } catch (error: any) {
      console.error('[scheduling] Failed to sync users:', error);
      res.status(500).json({ message: "Failed to sync Housecall Pro users", error: error.message });
    }
  });

  // Get all team members for the contractor (for management UI - shows isSalesperson toggle)
  app.get("/api/scheduling/salespeople", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const teamMembers = await housecallSchedulingService.getTeamMembers(req.user!.contractorId);
      res.json(teamMembers);
    } catch (error: any) {
      console.error('[scheduling] Failed to get team members:', error);
      res.status(500).json({ message: "Failed to get team members", error: error.message });
    }
  });

  // Get unified availability across all salespeople (1-hour slots, 30-min buffer)
  app.get("/api/scheduling/availability", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate, days } = req.query;
      
      let start: Date;
      let end: Date;
      
      if (startDate && endDate) {
        start = new Date(startDate as string);
        end = new Date(endDate as string);
      } else {
        // Default: next 14 days
        start = new Date();
        const daysToFetch = days ? parseInt(days as string) : 14;
        end = new Date();
        end.setDate(end.getDate() + daysToFetch);
      }
      
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      
      // Get contractor timezone for proper availability calculation
      const contractor = await storage.getContractor(req.user!.contractorId);
      const timezone = (contractor as any)?.timezone || 'America/New_York';
      
      const slots = await housecallSchedulingService.getUnifiedAvailability(req.user!.contractorId, start, end, timezone);
      
      res.json({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        slotDurationMinutes: 60,
        bufferMinutes: 30,
        slots: slots.map(slot => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          availableCount: slot.availableSalespersonIds.length,
        }))
      });
    } catch (error: any) {
      console.error('[scheduling] Failed to get availability:', error);
      res.status(500).json({ message: "Failed to get availability", error: error.message });
    }
  });

  // Book an appointment (auto-assigns or uses specified salesperson)
  app.post("/api/scheduling/book", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startTime, title, customerName, customerEmail, customerPhone, customerAddress, customerAddressComponents, notes, contactId, salespersonId, housecallProEmployeeId } = req.body;
      
      if (!startTime || !title || !customerName) {
        res.status(400).json({ message: "startTime, title, and customerName are required" });
        return;
      }
      
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const result = await housecallSchedulingService.bookAppointment(req.user!.contractorId, {
        startTime: new Date(startTime),
        title,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerAddressComponents,
        notes,
        contactId,
        salespersonId,
        housecallProEmployeeId,
      });
      
      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json({ message: result.error });
      }
    } catch (error: any) {
      console.error('[scheduling] Failed to book appointment:', error);
      res.status(500).json({ message: "Failed to book appointment", error: error.message });
    }
  });

  // Get scheduled bookings
  app.get("/api/scheduling/bookings", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate } = req.query;
      
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const bookings = await housecallSchedulingService.getBookings(
        req.user!.contractorId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      
      res.json(bookings);
    } catch (error: any) {
      console.error('[scheduling] Failed to get bookings:', error);
      res.status(500).json({ message: "Failed to get bookings", error: error.message });
    }
  });

  // Mark a user as salesperson (admin only)
  app.patch("/api/scheduling/salespeople/:userId", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const { isSalesperson, calendarColor, workingDays, workingHoursStart, workingHoursEnd, hasCustomSchedule } = req.body;
      
      const updateData: any = {};
      
      if (isSalesperson !== undefined) updateData.isSalesperson = isSalesperson;
      if (calendarColor !== undefined) updateData.calendarColor = calendarColor;
      if (workingDays !== undefined) updateData.workingDays = workingDays;
      if (workingHoursStart !== undefined) updateData.workingHoursStart = workingHoursStart;
      if (workingHoursEnd !== undefined) updateData.workingHoursEnd = workingHoursEnd;
      if (hasCustomSchedule !== undefined) updateData.hasCustomSchedule = hasCustomSchedule;
      
      await db.update(userContractors)
        .set(updateData)
        .where(and(
          eq(userContractors.userId, userId),
          eq(userContractors.contractorId, req.user!.contractorId)
        ));
      
      res.json({ message: "Salesperson updated successfully" });
    } catch (error: any) {
      console.error('[scheduling] Failed to update salesperson:', error);
      res.status(500).json({ message: "Failed to update salesperson", error: error.message });
    }
  });

  app.get("/api/contacts/scheduled", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const scheduledContacts = await storage.getScheduledContacts(req.user!.contractorId);
      res.json(scheduledContacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scheduled contacts" });
    }
  });

  app.get("/api/contacts/unscheduled", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unscheduledContacts = await storage.getUnscheduledContacts(req.user!.contractorId);
      res.json(unscheduledContacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch unscheduled contacts" });
    }
  });

  app.post("/api/contacts/:id/schedule", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: contactId } = req.params;
      
      // Check if Housecall Pro integration is enabled (required for scheduling)
      const isIntegrationEnabled = await storage.isIntegrationEnabled(req.user!.contractorId, 'housecall-pro');
      if (!isIntegrationEnabled) {
        res.status(403).json({ 
          message: "Housecall Pro integration is not enabled for this tenant. Please enable it to schedule contacts.",
          integrationDisabled: true 
        });
        return;
      }
      
      // Validate request body with Zod
      const validation = scheduleContactSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ 
          message: "Invalid request data", 
          errors: validation.error.issues.map(issue => ({ 
            path: issue.path.join('.'), 
            message: issue.message 
          }))
        });
        return;
      }
      
      const { employeeId, scheduledStart, scheduledEnd, description } = validation.data;
      const startDate = new Date(scheduledStart);
      const endDate = new Date(scheduledEnd);

      // Get the contact to schedule
      const contact = await storage.getContact(contactId, req.user!.contractorId);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      // Check if contact is already scheduled
      if (contact.isScheduled) {
        res.status(400).json({ message: "Contact is already scheduled" });
        return;
      }

      // Step 1: Find or create customer in Housecall Pro (prevent duplicates)
      let housecallProCustomerId = contact.housecallProCustomerId;
      
      // Get first email and phone from arrays
      const contactEmail = contact.emails?.[0];
      const contactPhone = contact.phones?.[0];
      
      if (!housecallProCustomerId) {
        // First try to find existing customer by email/phone
        if (contactEmail || contactPhone) {
          const searchResult = await housecallProService.searchCustomers(req.user!.contractorId, {
            email: contactEmail || undefined,
            phone: contactPhone || undefined
          });
          
          if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
            // Found existing customer, use it
            housecallProCustomerId = searchResult.data[0].id;
          }
        }
        
        // If no existing customer found, create a new one
        if (!housecallProCustomerId) {
          const customerResult = await housecallProService.createCustomer(req.user!.contractorId, {
            first_name: contact.name.split(' ')[0] || contact.name,
            last_name: contact.name.split(' ').slice(1).join(' ') || '',
            email: contactEmail || '',
            mobile_number: contactPhone || '',
            addresses: contact.address ? [{
              street: contact.address,
              city: '',
              state: '',
              zip: '',
              country: 'US'
            }] : undefined
          });

          if (!customerResult.success) {
            res.status(400).json({ message: `Failed to create customer in Housecall Pro: ${customerResult.error}` });
            return;
          }

          housecallProCustomerId = customerResult.data!.id;
        }
      }

      // Step 2: Create estimate in Housecall Pro
      const estimateResult = await housecallProService.createEstimate(req.user!.contractorId, {
        customer_id: housecallProCustomerId,
        employee_id: employeeId,
        message: description || `Estimate for ${contact.name}`,
        options: [{
          name: 'Option 1',
          schedule: {
            scheduled_start: startDate.toISOString(),
            scheduled_end: endDate.toISOString(),
          },
        }],
        address: contact.address ? {
          street: contact.address,
          city: '',
          state: '',
          zip: '',
          country: 'US'
        } : undefined
      });

      if (!estimateResult.success) {
        res.status(400).json({ message: `Failed to create estimate in Housecall Pro: ${estimateResult.error}` });
        return;
      }

      // Step 3: Atomic contact-to-estimate conversion (updates contact AND creates local estimate)
      const result = await storage.scheduleContactAsEstimate(contactId, {
        housecallProCustomerId,
        housecallProEstimateId: estimateResult.data!.id,
        scheduledAt: startDate,
        scheduledEmployeeId: employeeId,
        scheduledStart: startDate,
        scheduledEnd: endDate,
        description: description || `Estimate for ${contact.name}`
      }, req.user!.contractorId);

      if (!result) {
        res.status(500).json({ message: "Failed to complete contact-to-estimate conversion" });
        return;
      }

      res.json({
        message: "Contact scheduled and converted to estimate successfully",
        contact: result.contact,
        estimate: result.estimate,
        housecallProEstimateId: estimateResult.data!.id
      });
    } catch (error) {
      console.error('Contact scheduling error:', error);
      res.status(500).json({ message: "Failed to schedule contact" });
    }
  });

  // Contractor-specific webhook endpoint for Housecall Pro estimate updates
  app.post("/api/webhooks/:contractorId/housecall-pro", 
    webhookRateLimiter,
    express.raw({ type: 'application/json' }), // Route-specific raw body middleware
    async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('Invalid contractor ID in webhook:', contractorId);
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      // Verify webhook signature for security using raw body
      // Try both possible header names defensively
      const signature = (req.headers['x-housecall-pro-signature'] || req.headers['x-housecall-signature']) as string;
      
      // Try to get contractor-specific webhook secret first, fall back to global secret
      let webhookSecret: string | undefined;
      try {
        const contractorSecret = await CredentialService.getCredential(contractorId, 'housecallpro', 'webhook_secret');
        webhookSecret = contractorSecret || process.env.HOUSECALL_PRO_WEBHOOK_SECRET;
      } catch {
        webhookSecret = process.env.HOUSECALL_PRO_WEBHOOK_SECRET;
      }
      
      if (!webhookSecret) {
        console.error('HOUSECALL_PRO_WEBHOOK_SECRET not configured');
        res.status(500).json({ message: "Webhook secret not configured" });
        return;
      }
      
      if (!signature) {
        console.error('Missing webhook signature');
        res.status(401).json({ message: "Missing signature" });
        return;
      }
      
      // Get raw body for signature verification
      const rawBody = req.body as Buffer;
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      
      const providedSignature = signature.replace('sha256=', '');
      
      if (!crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(providedSignature, 'hex'))) {
        console.error('Invalid webhook signature');
        res.status(401).json({ message: "Invalid signature" });
        return;
      }
      
      // Parse the JSON from raw body
      const payload = JSON.parse(rawBody.toString('utf8'));
      const { event_type, data } = payload;
      
      if (event_type === 'estimate.updated' || event_type === 'estimate.completed') {
        const estimateId = data.id;
        
        // Find the lead associated with this estimate within the specific tenant
        const leadResult = await storage.getEstimateByHousecallProEstimateId(estimateId, contractorId);
        
        if (leadResult) {
          // Also find and update the local estimate record
          const estimateResult = await storage.getEstimateByHousecallProEstimateId(estimateId, contractorId);
          
          if (estimateResult) {
            let estimateStatus = 'draft';
            if (data.work_status === 'completed') {
              estimateStatus = 'approved';
            } else if (data.work_status === 'canceled') {
              estimateStatus = 'rejected';
            }
            
            // Update our estimate record
            await storage.updateEstimate(estimateResult.id, {
              status: estimateStatus as any,
              syncedAt: new Date()
            }, contractorId);
          }
        }
      }
      
      // Always respond quickly with 200 to acknowledge receipt
      res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      // Still return 200 to prevent webhook retries for processing errors
      res.status(200).json({ received: true, error: 'Processing failed' });
    }
  });

  // Get Webhook Configuration for Authenticated Contractor
  app.get("/api/webhook-config", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      // Get or generate API key for this contractor
      let apiKey: string;
      try {
        const storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        
        // If no key exists (null, undefined, or empty/whitespace string), generate a new one
        if (!storedApiKey || storedApiKey.trim().length === 0) {
          apiKey = crypto.randomBytes(32).toString('hex');
          await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
        } else {
          apiKey = storedApiKey.trim();
        }
      } catch {
        // Generate new API key if there's an error accessing credentials
        apiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
      }
      
      // Build webhook URLs - handle proxy headers for HTTPS deployments
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const leadsWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/leads`;
      const estimatesWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/estimates`;
      const jobsWebhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/jobs`;
      
      res.status(200).json({
        apiKey,
        webhooks: {
          leads: {
            url: leadsWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["name"],
              optionalFields: [
                "email", "emails", "phone", "phones",
                "address",
                "source",
                "notes",
                "followUpDate",
                "utmSource",
                "utmMedium",
                "utmCampaign",
                "utmTerm",
                "utmContent",
                "pageUrl"
              ],
              phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
              multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
              example: {
                name: "John Smith",
                email: "john@example.com",
                phone: "555-123-4567",
                address: "123 Main St, City, State 12345",
                source: "Website Contact Form",
                notes: "Interested in HVAC installation",
                followUpDate: "2024-01-15T10:00:00Z",
                utmSource: "google",
                utmMedium: "cpc",
                utmCampaign: "summer-hvac",
                pageUrl: "https://example.com/contact"
              }
            }
          },
          estimates: {
            url: estimatesWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["title", "amount", "customerName"],
              optionalFields: ["description", "status", "validUntil", "followUpDate", "leadId", "customerEmail", "customerPhone", "customerAddress"],
              example: {
                title: "HVAC Installation Quote",
                amount: 5500.00,
                description: "Complete HVAC system installation for 2000 sq ft home",
                customerName: "John Smith",
                customerEmail: "john@example.com",
                customerPhone: "(555) 123-4567",
                customerAddress: "123 Main St, City, State 12345",
                status: "sent",
                validUntil: "2024-02-15",
                followUpDate: "2024-01-20T10:00:00Z",
                leadId: "optional-lead-uuid"
              }
            }
          },
          jobs: {
            url: jobsWebhookUrl,
            documentation: {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey
              },
              requiredFields: ["title", "scheduledDate", "customerName"],
              optionalFields: ["description", "status", "estimateId", "amount", "customerEmail", "customerPhone", "customerAddress", "notes"],
              example: {
                title: "HVAC Installation",
                scheduledDate: "2024-02-15T09:00:00Z",
                description: "Complete HVAC system installation for 2000 sq ft home",
                customerName: "John Smith",
                customerEmail: "john@example.com",
                customerPhone: "(555) 123-4567",
                customerAddress: "123 Main St, City, State 12345",
                status: "scheduled",
                amount: 5500.00,
                estimateId: "optional-estimate-uuid",
                notes: "Customer prefers morning installation"
              }
            }
          }
        },
        // Legacy support - keep webhookUrl for backwards compatibility
        webhookUrl: leadsWebhookUrl,
        documentation: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey
          },
          requiredFields: ["name"],
          optionalFields: [
            "email", "emails", "phone", "phones",
            "address",
            "source",
            "notes",
            "followUpDate",
            "utmSource",
            "utmMedium",
            "utmCampaign",
            "utmTerm",
            "utmContent",
            "pageUrl"
          ],
          phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
          multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
          example: {
            name: "John Smith",
            email: "john@example.com",
            phone: "555-123-4567",
            address: "123 Main St, City, State 12345",
            source: "Website Contact Form",
            notes: "Interested in HVAC installation",
            followUpDate: "2024-01-15T10:00:00Z",
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "summer-hvac",
            pageUrl: "https://example.com/contact"
          }
        }
      });
    } catch (error) {
      console.error('Error getting webhook config:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to get webhook configuration"
      });
    }
  });

  // Dynamic Lead Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/leads
  app.post("/api/webhooks/:contractorId/leads", webhookRateLimiter, async (req: Request, res: Response) => {
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
        body: JSON.stringify(req.body, null, 2)
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Verify API key against contractor's stored credentials
      let isValidKey = false;
      try {
        const storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        isValidKey = storedApiKey === apiKey;
      } catch {
        // If no API key is stored, generate one for this contractor
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
        // For first-time setup, accept any key and return the generated one
        res.status(200).json({
          message: "API key generated for contractor",
          apiKey: newApiKey,
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/leads`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
            },
            requiredFields: ["name"],
            optionalFields: ["email", "emails", "phone", "phones", "address", "source", "notes", "followUpDate", "tags"],
            phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
            multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
            tags: "Optional array of strings for segmentation and workflow targeting. Example: ['Ductless', 'Residential', 'Emergency']",
            example: {
              name: "John Smith",
              phone: "(555) 123-4567",
              email: "john@example.com",
              address: "123 Main St, City, State 12345",
              source: "Website Contact Form",
              notes: "Interested in HVAC installation",
              followUpDate: "2024-01-15T10:00:00Z",
              tags: ["Ductless", "Residential", "High-Priority"]
            },
            exampleWithArrays: {
              name: "Jane Doe",
              phones: ["(555) 123-4567", "555-987-6543", "+1 555 111 2222"],
              emails: ["jane@example.com", "jane.doe@work.com"],
              address: "456 Oak Ave",
              source: "Referral",
              tags: ["Commercial", "Emergency"]
            }
          }
        });
        return;
      }
      
      if (!isValidKey) {
        res.status(401).json({ 
          error: "Invalid API key",
          message: "The provided API key is not valid for this contractor"
        });
        return;
      }
      
      // Extract lead data - support both direct format and Zapier's nested format
      // Zapier sends: { data: { name, email, ... } }
      // Direct API sends: { name, email, ... }
      
      // Log the raw body to debug
      console.log('[webhook] Raw req.body:', JSON.stringify(req.body, null, 2));
      console.log('[webhook] req.body.data:', JSON.stringify(req.body.data, null, 2));
      
      // Handle different Zapier formats:
      // 1. { data: { name, email, ... } } - wrapped in data property
      // 2. { name, email, ... } - direct object
      // 3. [{ name, email, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook] Extracted data:', JSON.stringify(requestData, null, 2));
      
      const { 
        name, 
        email, emails, // Support both single email and emails array
        phone, phones, // Support both single phone and phones array
        address, source, notes, followUpDate, pageUrl, utmSource, utmMedium, utmCampaign, utmTerm, utmContent,
        tags // Optional array of strings for segmentation
      } = requestData;
      
      // Detailed validation with specific error messages
      const validationErrors: string[] = [];
      
      // Validate name (required)
      if (!name) {
        validationErrors.push("'name' field is required but was not provided");
      } else if (typeof name !== 'string') {
        validationErrors.push(`'name' must be a string, received: ${typeof name}`);
      } else if (name.trim().length === 0) {
        validationErrors.push("'name' cannot be empty");
      }
      
      // Validate email (optional, but must be valid if provided)
      if (email !== undefined && email !== null && email !== '') {
        if (typeof email !== 'string') {
          validationErrors.push(`'email' must be a string, received: ${typeof email}`);
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          validationErrors.push(`'email' format is invalid: "${email}"`);
        }
      }
      
      // Validate phone (optional, but must be valid if provided)
      if (phone !== undefined && phone !== null && phone !== '') {
        if (typeof phone !== 'string' && typeof phone !== 'number') {
          validationErrors.push(`'phone' must be a string or number, received: ${typeof phone}`);
        }
      }
      
      // Validate address (optional)
      if (address !== undefined && address !== null && address !== '') {
        if (typeof address !== 'string') {
          validationErrors.push(`'address' must be a string, received: ${typeof address}`);
        }
      }
      
      // Validate source (optional)
      if (source !== undefined && source !== null && source !== '') {
        if (typeof source !== 'string') {
          validationErrors.push(`'source' must be a string, received: ${typeof source}`);
        }
      }
      
      // Validate notes (optional)
      if (notes !== undefined && notes !== null && notes !== '') {
        if (typeof notes !== 'string') {
          validationErrors.push(`'notes' must be a string, received: ${typeof notes}`);
        }
      }
      
      // Validate tags (optional array of strings)
      if (tags !== undefined && tags !== null) {
        if (!Array.isArray(tags)) {
          validationErrors.push(`'tags' must be an array, received: ${typeof tags}`);
        } else {
          // Validate each tag is a string
          const invalidTags = tags.filter((tag: any) => typeof tag !== 'string');
          if (invalidTags.length > 0) {
            validationErrors.push(`'tags' array must contain only strings, found invalid values: ${JSON.stringify(invalidTags)}`);
          }
        }
      }
      
      if (validationErrors.length > 0) {
        console.error('[webhook] Validation errors:', validationErrors);
        
        // Create a detailed error message that includes all specific errors
        const detailedMessage = `Validation failed: ${validationErrors.join('; ')}`;
        
        res.status(400).json({ 
          error: "Validation failed",
          message: detailedMessage,
          validationErrors,
          receivedData: {
            name: name,
            email: email,
            phone: phone,
            address: address,
            source: source,
            notes: notes,
            followUpDate: followUpDate
          },
          fix: "Review the validation errors above and ensure all required fields are provided with correct data types"
        });
        return;
      }
      
      // Parse followUpDate with flexible format support using date-fns
      let parsedFollowUpDate: Date | undefined = undefined;
      if (followUpDate && followUpDate !== '') {
        const dateStr = String(followUpDate).trim();
        
        try {
          // Import date-fns parse function
          const { parse, parseISO, isValid } = await import('date-fns');
          
          // Try ISO format first (most common for APIs)
          let parsedDate = parseISO(dateStr);
          
          // If ISO fails, try common formats
          if (!isValid(parsedDate)) {
            const formats = [
              'MMMM dd, yyyy',           // October 16, 2025
              'MMM dd, yyyy',            // Oct 16, 2025
              'MM/dd/yyyy',              // 10/16/2025
              'MM-dd-yyyy',              // 10-16-2025
              'yyyy-MM-dd',              // 2025-10-16
              'EEEE MMMM dd, yyyy',      // Thursday October 16, 2025
            ];
            
            // Try parsing the full string first
            for (const format of formats) {
              try {
                parsedDate = parse(dateStr, format, new Date());
                if (isValid(parsedDate)) {
                  break;
                }
              } catch {
                continue;
              }
            }
            
            // If still not valid, try extracting date patterns from text with extra content
            // Example: "Thursday October 16, 2025 arriving between 10:00am - 12:00pm" -> "Thursday October 16, 2025"
            if (!isValid(parsedDate)) {
              // Try to extract common date patterns using regex
              const datePatterns = [
                // Match: Thursday October 16, 2025 (or any day/month combo)
                /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
                // Match: Oct 16, 2025
                /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i,
                // Match: 10/16/2025 or 10-16-2025
                /\d{1,2}[-/]\d{1,2}[-/]\d{4}/,
                // Match: 2025-10-16
                /\d{4}-\d{1,2}-\d{1,2}/
              ];
              
              for (const pattern of datePatterns) {
                const match = dateStr.match(pattern);
                if (match) {
                  const extractedDate = match[0];
                  console.log(`[webhook] Extracted date pattern: "${extractedDate}" from "${dateStr}"`);
                  
                  // Try parsing the extracted portion
                  for (const format of formats) {
                    try {
                      parsedDate = parse(extractedDate, format, new Date());
                      if (isValid(parsedDate)) {
                        break;
                      }
                    } catch {
                      continue;
                    }
                  }
                  
                  if (isValid(parsedDate)) {
                    break;
                  }
                }
              }
            }
          }
          
          if (isValid(parsedDate)) {
            parsedFollowUpDate = parsedDate;
            console.log(`[webhook] Successfully parsed date: "${dateStr}" -> ${parsedDate.toISOString()}`);
          } else {
            // Date parsing failed
            console.error(`[webhook] Failed to parse date: "${dateStr}"`);
            res.status(400).json({ 
              error: "Invalid date format",
              message: `Could not parse followUpDate: "${dateStr}". Please use ISO format (2025-10-16T10:00:00Z) or common formats like "October 16, 2025" or "10/16/2025"`,
              receivedValue: dateStr
            });
            return;
          }
        } catch (dateError) {
          console.error('[webhook] Date parsing error:', dateError);
          res.status(400).json({ 
            error: "Date parsing failed",
            message: `Error parsing followUpDate: "${dateStr}"`,
            receivedValue: dateStr
          });
          return;
        }
      }
      
      // Normalize phone numbers to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage, normalizePhoneArrayForStorage } = await import('./utils/phone-normalizer');
      
      // Build emails array from either single email or emails array
      let emailsArray: string[] = [];
      if (emails && Array.isArray(emails)) {
        emailsArray = emails.map((e: any) => String(e).trim()).filter((e: string) => e !== '');
      } else if (email) {
        emailsArray = [String(email).trim()];
      }
      
      // Build phones array from either single phone or phones array, with normalization
      let phonesArray: string[] = [];
      if (phones && Array.isArray(phones)) {
        phonesArray = normalizePhoneArrayForStorage(phones);
      } else if (phone) {
        const normalized = normalizePhoneForStorage(String(phone).trim());
        if (normalized) phonesArray = [normalized];
      }
      
      // Step 1: Find or create contact (deduplicate by email/phone)
      let contactId: string;
      let isNewContact = false;
      
      const existingContactId = await storage.findMatchingContact(contractorId, emailsArray, phonesArray);
      
      if (existingContactId) {
        // Contact already exists - use the existing one
        contactId = existingContactId;
        console.log(`[webhook-lead] Found existing contact: ${contactId}`);
      } else {
        // No matching contact - create new one
        const contactData = {
          name: name.trim(),
          type: 'lead' as const,
          emails: emailsArray,
          phones: phonesArray,
          address: address ? String(address).trim() : undefined,
          source: source ? String(source).trim() : 'External API',
          notes: notes ? String(notes).trim() : undefined,
          tags: tags && Array.isArray(tags) ? tags.map((t: any) => String(t).trim()).filter((t: string) => t !== '') : undefined,
          followUpDate: parsedFollowUpDate,
          pageUrl: pageUrl ? String(pageUrl).trim() : undefined,
          utmSource: utmSource ? String(utmSource).trim() : undefined,
          utmMedium: utmMedium ? String(utmMedium).trim() : undefined,
          utmCampaign: utmCampaign ? String(utmCampaign).trim() : undefined,
          utmTerm: utmTerm ? String(utmTerm).trim() : undefined,
          utmContent: utmContent ? String(utmContent).trim() : undefined,
        };
        
        console.log('[webhook-lead] Creating new contact with data:', contactData);
        const newContact = await storage.createContact(contactData, contractorId);
        contactId = newContact.id;
        isNewContact = true;
        console.log(`[webhook-lead] ✓ New contact created: ${contactId}`);
      }
      
      // Step 2: Always create a new lead record (even if contact exists)
      const leadData = {
        contactId,
        status: 'new' as const,
        source: source ? String(source).trim() : 'External API',
        message: notes ? String(notes).trim() : undefined,
        utmSource: utmSource ? String(utmSource).trim() : undefined,
        utmMedium: utmMedium ? String(utmMedium).trim() : undefined,
        utmCampaign: utmCampaign ? String(utmCampaign).trim() : undefined,
        utmTerm: utmTerm ? String(utmTerm).trim() : undefined,
        utmContent: utmContent ? String(utmContent).trim() : undefined,
        pageUrl: pageUrl ? String(pageUrl).trim() : undefined,
        rawPayload: JSON.stringify(requestData),
        followUpDate: parsedFollowUpDate,
      };
      
      console.log('[webhook-lead] Creating new lead record with data:', leadData);
      const newLead = await storage.createLead(leadData, contractorId);
      console.log(`[webhook-lead] ✓ Lead created successfully for contractor ${contractor.name}: ${newLead.id} (${isNewContact ? 'new contact' : 'existing contact'})`);
      
      // Sync to Housecall Pro if integration is enabled
      const hcpIntegrationEnabled = await storage.isIntegrationEnabled(contractorId, 'housecall-pro');
      if (hcpIntegrationEnabled) {
        try {
          // Get contact details for HCP sync
          const contact = await storage.getContact(contactId, contractorId);
          if (contact && !contact.housecallProCustomerId) {
            // Parse name into first/last
            const nameParts = contact.name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            // First, search for existing HCP customer by email or phone
            let hcpCustomerId: string | undefined;
            const searchEmail = contact.emails?.[0];
            const searchPhone = contact.phones?.[0];
            
            if (searchEmail || searchPhone) {
              console.log('[HCP Sync] Searching for existing HCP customer:', { email: searchEmail, phone: searchPhone });
              const searchResult = await housecallProService.searchCustomers(contractorId, {
                email: searchEmail,
                phone: searchPhone
              });
              
              if (searchResult.success && searchResult.data && searchResult.data.length > 0) {
                hcpCustomerId = searchResult.data[0].id;
                console.log('[HCP Sync] Found existing HCP customer:', hcpCustomerId);
              }
            }
            
            // If no existing customer found, create one
            if (!hcpCustomerId) {
              console.log('[HCP Sync] No existing customer found, creating new one');
              const hcpCustomerResult = await housecallProService.createCustomer(contractorId, {
                first_name: firstName,
                last_name: lastName,
                email: searchEmail,
                mobile_number: searchPhone,
                lead_source: source || 'Webhook',
                notes: notes || undefined,
                addresses: address ? [{
                  street: address,
                  type: 'service'
                }] : undefined
              });
              
              if (hcpCustomerResult.success && hcpCustomerResult.data?.id) {
                hcpCustomerId = hcpCustomerResult.data.id;
                console.log('[HCP Sync] Created HCP customer:', hcpCustomerId);
              } else {
                console.warn('[HCP Sync] Failed to create HCP customer:', hcpCustomerResult.error);
              }
            }
            
            // Store the HCP customer ID in the contact
            if (hcpCustomerId) {
              await storage.updateContact(contact.id, { 
                housecallProCustomerId: hcpCustomerId 
              }, contractorId);
              console.log('[HCP Sync] Stored HCP customer ID:', hcpCustomerId, 'for contact:', contact.id);
              
              // Now create lead in HCP (requires customer_id)
              const hcpLeadResult = await housecallProService.createLead(contractorId, {
                customer_id: hcpCustomerId,
                lead_source: source || 'Webhook',
                note: notes || undefined
              });
              
              if (hcpLeadResult.success && hcpLeadResult.data?.id) {
                await storage.updateLead(newLead.id, { 
                  housecallProLeadId: hcpLeadResult.data.id 
                }, contractorId);
                console.log('[HCP Sync] Created HCP lead:', hcpLeadResult.data.id, 'for CRM lead:', newLead.id);
              } else {
                console.warn('[HCP Sync] Failed to create HCP lead:', hcpLeadResult.error);
              }
            }
          } else if (contact?.housecallProCustomerId) {
            // Customer already exists in HCP, just create the lead
            const hcpLeadResult = await housecallProService.createLead(contractorId, {
              customer_id: contact.housecallProCustomerId,
              lead_source: source || 'Webhook',
              note: notes || undefined
            });
            
            if (hcpLeadResult.success && hcpLeadResult.data?.id) {
              await storage.updateLead(newLead.id, { 
                housecallProLeadId: hcpLeadResult.data.id 
              }, contractorId);
              console.log('[HCP Sync] Created HCP lead:', hcpLeadResult.data.id, 'for CRM lead:', newLead.id);
            } else {
              console.warn('[HCP Sync] Failed to create HCP lead:', hcpLeadResult.error);
            }
          }
        } catch (hcpError) {
          console.error('[HCP Sync] Error syncing to HCP:', hcpError);
          // Don't fail the webhook if HCP sync fails
        }
      }
      
      // Return success response with lead ID
      res.status(201).json({
        success: true,
        message: isNewContact ? "Lead created with new contact" : "Lead created for existing contact",
        leadId: newLead.id,
        contactId: contactId,
        isNewContact: isNewContact,
        lead: {
          id: newLead.id,
          contactId: newLead.contactId,
          status: newLead.status,
          source: newLead.source,
          createdAt: newLead.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process lead webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dynamic Estimate Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/estimates
  app.post("/api/webhooks/:contractorId/estimates", webhookRateLimiter, async (req: Request, res: Response) => {
    console.log('[webhook-estimate] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook-estimate] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
        body: JSON.stringify(req.body, null, 2)
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-estimate] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Retrieve stored API key for this contractor
      let storedApiKey: string | null;
      try {
        storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
      } catch {
        storedApiKey = null;
      }
      
      // If no API key exists, generate one and return setup instructions
      if (!storedApiKey) {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
        res.status(401).json({ 
          error: "First-time setup",
          message: "API key generated for contractor",
          apiKey: newApiKey,
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/estimates`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
            },
            requiredFields: ["title", "amount", "customerName"],
            optionalFields: ["description", "status", "validUntil", "followUpDate", "leadId", "customerEmail", "customerPhone", "customerAddress"],
            example: {
              title: "HVAC Installation Quote",
              amount: 5500.00,
              description: "Complete HVAC system installation for 2000 sq ft home",
              customerName: "John Smith",
              customerEmail: "john@example.com",
              customerPhone: "(555) 123-4567",
              customerAddress: "123 Main St, City, State 12345",
              status: "sent",
              validUntil: "2024-02-15",
              followUpDate: "2024-01-20T10:00:00Z",
              leadId: "optional-lead-uuid"
            }
          }
        });
        return;
      }
      
      // Validate API key
      if (apiKey !== storedApiKey) {
        res.status(403).json({ 
          error: "Invalid API key",
          message: "The provided API key is incorrect"
        });
        return;
      }
      
      // Parse the request body to handle Zapier's array and nested data formats
      // Handle different Zapier formats:
      // 1. { data: { title, amount, ... } } - wrapped in data property
      // 2. { title, amount, ... } - direct object
      // 3. [{ title, amount, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook-estimate] Extracted data:', JSON.stringify(requestData, null, 2));
      
      // Extract fields - handle both direct properties and Zapier-style nested objects
      const extractField = (fieldName: string): any => {
        // Direct property access
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        // Zapier nested format (e.g., { title: { title: "value" } })
        if (requestData[fieldName] && typeof requestData[fieldName] === 'object' && requestData[fieldName][fieldName]) {
          return requestData[fieldName][fieldName];
        }
        return undefined;
      };
      
      const title = extractField('title');
      const amount = extractField('amount');
      const description = extractField('description');
      const status = extractField('status');
      const validUntil = extractField('validUntil');
      const followUpDate = extractField('followUpDate');
      const leadId = extractField('leadId');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      
      // Validate required fields
      if (!title || !amount || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'amount', and 'customerName' are required",
          received: { title, amount, customerName }
        });
        return;
      }
      
      // Normalize and validate amount
      const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(amountNum) || amountNum < 0) {
        res.status(400).json({ 
          error: "Invalid amount",
          message: "Amount must be a valid positive number"
        });
        return;
      }
      
      // Find or create customer
      let customerId: string;
      
      // First, try to find existing customer by email or phone
      const customers = await storage.getContacts(contractorId, 'customer');
      let existingCustomer = customers.find((c: any) => 
        (customerEmail && c.emails?.some((e: string) => e.toLowerCase() === customerEmail.toLowerCase())) ||
        (customerPhone && c.phones?.includes(customerPhone))
      );
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[webhook-estimate] Using existing customer:', customerId);
      } else {
        // Create new contact as customer
        const newCustomer = await storage.createContact({
          name: String(customerName).trim(),
          type: 'customer' as const,
          emails: customerEmail ? [String(customerEmail).trim()] : [],
          phones: customerPhone ? [String(customerPhone).trim()] : [],
          address: customerAddress ? String(customerAddress).trim() : undefined,
        }, contractorId);
        customerId = newCustomer.id;
        console.log('[webhook-estimate] Created new customer:', customerId);
      }
      
      // Helper function to parse dates (handles ISO strings, Unix timestamps, etc.)
      const parseDate = (value: any): Date | null => {
        if (!value) return null;
        
        // Handle "none" or empty strings
        if (typeof value === 'string' && (value.toLowerCase() === 'none' || value.trim() === '')) {
          return null;
        }
        
        // Check if it's a Unix timestamp (numeric string or number)
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        if (!isNaN(numValue)) {
          // Unix timestamps are typically 10 digits (seconds since epoch)
          // JavaScript Date expects milliseconds, so multiply by 1000
          if (numValue < 10000000000) { // Less than 10 digits = seconds
            return new Date(numValue * 1000);
          } else { // Already in milliseconds
            return new Date(numValue);
          }
        }
        
        // Try parsing as ISO string or other date format
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
      };
      
      // Normalize status values
      const normalizeStatus = (value: any): string => {
        if (!value) return 'draft';
        const val = String(value).toLowerCase().trim();
        
        // Map common values to valid statuses
        const statusMap: Record<string, string> = {
          'open': 'draft',
          'draft': 'draft',
          'sent': 'sent',
          'pending': 'pending',
          'approved': 'approved',
          'accepted': 'approved',
          'rejected': 'rejected',
          'declined': 'rejected'
        };
        
        return statusMap[val] || 'draft';
      };
      
      // Normalize phone number to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage } = await import('./utils/phone-normalizer');
      const normalizedPhone = customerPhone ? normalizePhoneForStorage(String(customerPhone).trim()) : null;
      
      // Prepare estimate data
      const estimateData: any = {
        title: String(title).trim(),
        amount: amountNum.toString(),
        description: description ? String(description).trim() : null,
        status: normalizeStatus(status),
        validUntil: parseDate(validUntil),
        followUpDate: parseDate(followUpDate),
        contactId: customerId,
        emails: customerEmail ? [String(customerEmail).trim()] : [],
        phones: normalizedPhone ? [normalizedPhone] : [],
      };
      
      console.log('[webhook-estimate] Creating estimate with data:', estimateData);
      
      // Create the estimate in the database
      const newEstimate = await storage.createEstimate(estimateData, contractorId);
      
      console.log(`[webhook-estimate] ✓ Estimate created successfully for contractor ${contractor.name}:`, newEstimate.title);
      
      // Broadcast WebSocket update to notify connected clients
      broadcastToContractor(contractorId, {
        type: 'new_estimate',
        estimate: newEstimate,
      });
      
      // Return success response with estimate ID
      res.status(201).json({
        success: true,
        message: "Estimate created successfully",
        estimateId: newEstimate.id,
        customerId: customerId,
        estimate: {
          id: newEstimate.id,
          title: newEstimate.title,
          amount: newEstimate.amount,
          status: newEstimate.status,
          customerId: customerId,
          createdAt: newEstimate.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook-estimate] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process estimate webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dynamic Job Webhook Endpoint for External Integrations
  // Each contractor gets their own secure endpoint: /api/webhooks/{contractorId}/jobs
  app.post("/api/webhooks/:contractorId/jobs", webhookRateLimiter, async (req: Request, res: Response) => {
    console.log('[webhook-job] === WEBHOOK CALLED ===');
    try {
      const { contractorId } = req.params;
      
      // DEBUG: Log complete request for troubleshooting
      console.log('[webhook-job] Incoming request:', {
        contractorId,
        headers: {
          'content-type': req.headers['content-type'],
          'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : 'missing'
        },
        body: JSON.stringify(req.body, null, 2)
      });
      
      // Verify contractor exists
      const contractor = await storage.getContractor(contractorId);
      if (!contractor) {
        console.error('[webhook-job] Invalid contractor ID:', contractorId);
        res.status(404).json({ 
          error: "Contractor not found",
          message: "The specified contractor ID does not exist"
        });
        return;
      }
      
      // Check for API key authentication
      const apiKey = req.headers['x-api-key'] as string;
      if (!apiKey) {
        res.status(401).json({ 
          error: "Missing API key",
          message: "Include your API key in the 'X-API-Key' header"
        });
        return;
      }
      
      // Retrieve stored API key for this contractor
      let storedApiKey: string | null;
      try {
        storedApiKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
      } catch {
        storedApiKey = null;
      }
      
      // If no API key exists, generate one and return setup instructions
      if (!storedApiKey) {
        const newApiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', newApiKey);
        
        res.status(401).json({ 
          error: "First-time setup",
          message: "API key generated for contractor",
          apiKey: newApiKey,
          webhookUrl: `${req.protocol}://${req.get('host')}/api/webhooks/${contractorId}/jobs`,
          documentation: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": newApiKey
            },
            requiredFields: ["title", "scheduledDate", "customerName"],
            optionalFields: ["type", "description", "status", "estimateId", "amount", "customerEmail", "customerPhone", "customerAddress", "notes"],
            example: {
              title: "HVAC Installation",
              type: "service", // Optional: service, installation, repair, maintenance (defaults to 'service')
              scheduledDate: "2024-02-15T09:00:00Z", // Accepts ISO format, MM/DD/YYYY, or Unix timestamp
              description: "Complete HVAC system installation for 2000 sq ft home",
              customerName: "John Smith",
              customerEmail: "john@example.com", // Optional: creates/links to customer
              customerPhone: "(555) 123-4567", // Optional: creates/links to customer
              customerAddress: "123 Main St, City, State 12345",
              status: "scheduled",
              amount: 5500.00,
              estimateId: "optional-estimate-uuid",
              notes: "Customer prefers morning installation"
            }
          }
        });
        return;
      }
      
      // Validate API key
      if (apiKey !== storedApiKey) {
        res.status(403).json({ 
          error: "Invalid API key",
          message: "The provided API key is incorrect"
        });
        return;
      }
      
      // Parse the request body to handle Zapier's array and nested data formats
      // Handle different Zapier formats:
      // 1. { data: { title, scheduledDate, ... } } - wrapped in data property
      // 2. { title, scheduledDate, ... } - direct object
      // 3. [{ title, scheduledDate, ... }] - array with single object (common in Zapier)
      let requestData = req.body.data || req.body;
      
      // If Zapier sends an array, extract the first element
      if (Array.isArray(requestData) && requestData.length > 0) {
        requestData = requestData[0];
      }
      
      console.log('[webhook-job] Extracted data:', JSON.stringify(requestData, null, 2));
      
      // Extract fields - handle both direct properties and Zapier-style nested objects
      const extractField = (fieldName: string): any => {
        // Direct property access
        if (requestData[fieldName] !== undefined) return requestData[fieldName];
        // Zapier nested format (e.g., { title: { title: "value" } })
        if (requestData[fieldName] && typeof requestData[fieldName] === 'object' && requestData[fieldName][fieldName]) {
          return requestData[fieldName][fieldName];
        }
        return undefined;
      };
      
      const title = extractField('title');
      const scheduledDate = extractField('scheduledDate');
      const description = extractField('description');
      const status = extractField('status');
      const type = extractField('type'); // Job type: service, installation, repair, etc.
      const estimateId = extractField('estimateId');
      const amount = extractField('amount');
      const customerName = extractField('customerName');
      const customerEmail = extractField('customerEmail');
      const customerPhone = extractField('customerPhone');
      const customerAddress = extractField('customerAddress');
      const notes = extractField('notes');
      
      // Validate required fields
      if (!title || !scheduledDate || !customerName) {
        res.status(400).json({ 
          error: "Missing required fields",
          message: "The fields 'title', 'scheduledDate', and 'customerName' are required",
          received: { title, scheduledDate, customerName }
        });
        return;
      }
      
      // Find or create customer
      let customerId: string;
      
      // First, try to find existing customer by email or phone
      const customers = await storage.getContacts(contractorId, 'customer');
      let existingCustomer = customers.find((c: any) => 
        (customerEmail && c.emails?.some((e: string) => e.toLowerCase() === customerEmail.toLowerCase())) ||
        (customerPhone && c.phones?.includes(customerPhone))
      );
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log('[webhook-job] Using existing customer:', customerId);
      } else {
        // Create new contact as customer
        const newCustomer = await storage.createContact({
          name: String(customerName).trim(),
          type: 'customer' as const,
          emails: customerEmail ? [String(customerEmail).trim()] : [],
          phones: customerPhone ? [String(customerPhone).trim()] : [],
          address: customerAddress ? String(customerAddress).trim() : undefined,
        }, contractorId);
        customerId = newCustomer.id;
        console.log('[webhook-job] Created new customer:', customerId);
      }
      
      // Helper function to parse dates (handles ISO strings, Unix timestamps, MM/DD/YYYY, etc.)
      const parseDate = (value: any): Date | null => {
        if (!value) return null;
        
        // Handle "none" or empty strings
        if (typeof value === 'string' && (value.toLowerCase() === 'none' || value.trim() === '')) {
          return null;
        }
        
        // If it's a string, try parsing as date first (handles MM/DD/YYYY, ISO, etc.)
        if (typeof value === 'string') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
        
        // Check if it's a Unix timestamp (pure number or numeric string without slashes/dashes)
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (!isNaN(numValue) && (typeof value !== 'string' || /^\d+$/.test(value))) {
          // Unix timestamps are typically 10 digits (seconds since epoch)
          // JavaScript Date expects milliseconds, so multiply by 1000
          if (numValue < 10000000000) { // Less than 10 digits = seconds
            return new Date(numValue * 1000);
          } else { // Already in milliseconds
            return new Date(numValue);
          }
        }
        
        return null;
      };
      
      // Normalize status values for jobs
      const normalizeJobStatus = (value: any): string => {
        if (!value) return 'scheduled';
        const val = String(value).toLowerCase().trim();
        
        // Map common values to valid statuses
        const statusMap: Record<string, string> = {
          'scheduled': 'scheduled',
          'pending': 'scheduled',
          'in_progress': 'in_progress',
          'in progress': 'in_progress',
          'active': 'in_progress',
          'working': 'in_progress',
          'completed': 'completed',
          'complete': 'completed',
          'done': 'completed',
          'finished': 'completed',
          'cancelled': 'cancelled',
          'canceled': 'cancelled'
        };
        
        return statusMap[val] || 'scheduled';
      };
      
      // Normalize phone number to (xxx) xxx-xxxx format for consistency
      const { normalizePhoneForStorage } = await import('./utils/phone-normalizer');
      const normalizedPhone = customerPhone ? normalizePhoneForStorage(String(customerPhone).trim()) : null;
      
      // Parse scheduled date
      const parsedScheduledDate = parseDate(scheduledDate);
      if (!parsedScheduledDate) {
        res.status(400).json({ 
          error: "Invalid scheduled date",
          message: "The scheduledDate must be a valid date"
        });
        return;
      }
      
      // Prepare job data
      const jobData: any = {
        title: String(title).trim(),
        type: type ? String(type).trim() : 'service', // Default to 'service' if not provided
        scheduledDate: parsedScheduledDate,
        description: description ? String(description).trim() : null,
        status: normalizeJobStatus(status),
        contactId: customerId,
        estimateId: (estimateId && String(estimateId).toLowerCase() !== 'none') ? estimateId : null,
        value: amount ? (typeof amount === 'string' ? parseFloat(amount) : amount).toString() : '0', // Map amount to value for database
        notes: notes ? String(notes).trim() : null,
      };
      
      console.log('[webhook-job] Creating job with data:', jobData);
      
      // Create the job in the database
      const newJob = await storage.createJob(jobData, contractorId);
      
      console.log(`[webhook-job] ✓ Job created successfully for contractor ${contractor.name}:`, newJob.title);
      
      // Broadcast WebSocket update to notify connected clients
      broadcastToContractor(contractorId, {
        type: 'new_job',
        job: newJob,
      });
      
      // Return success response with job ID
      res.status(201).json({
        success: true,
        message: "Job created successfully",
        jobId: newJob.id,
        customerId: customerId,
        job: {
          id: newJob.id,
          title: newJob.title,
          scheduledDate: newJob.scheduledDate,
          status: newJob.status,
          customerId: customerId,
          createdAt: newJob.createdAt
        }
      });
      
    } catch (error) {
      console.error('[webhook-job] Processing error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process job webhook",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // CSV Upload Endpoint for Leads Import
  app.post("/api/leads/csv-upload", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { csvData } = req.body;
      
      if (!csvData || typeof csvData !== 'string') {
        res.status(400).json({ 
          error: "Missing CSV data",
          message: "Please provide CSV data in the request body"
        });
        return;
      }

      // Enforce tenant isolation - always use the authenticated user's contractor ID
      const contractorId = req.user!.contractorId;
      
      // Limit CSV size to prevent abuse (max ~1MB)
      if (csvData.length > 1024 * 1024) {
        res.status(400).json({ 
          error: "CSV file too large",
          message: "CSV data must be less than 1MB"
        });
        return;
      }
      
      // Parse CSV data
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        res.status(400).json({ 
          error: "Invalid CSV format",
          message: "CSV must contain at least a header row and one data row"
        });
        return;
      }
      
      // Limit number of rows to prevent abuse
      if (lines.length > 1001) { // 1 header + 1000 data rows
        res.status(400).json({ 
          error: "Too many rows",
          message: "CSV cannot contain more than 1000 leads"
        });
        return;
      }
      
      // Parse header row
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      
      // Validate required headers
      if (!headers.includes('name')) {
        res.status(400).json({ 
          error: "Missing required column",
          message: "CSV must include 'name' column"
        });
        return;
      }
      
      const results = {
        total: lines.length - 1, // Exclude header row
        imported: 0,
        errors: [] as Array<{row: number, error: string, data: any}>
      };
      
      // Process each data row
      for (let i = 1; i < lines.length; i++) {
        try {
          // Robust CSV parsing (handles escaped quotes and CSV injection prevention)
          const values: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
              // Handle escaped quotes ("" represents a single ")
              if (inQuotes && lines[i][j + 1] === '"') {
                current += '"';
                j++; // Skip the next quote
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());
          
          // CSV injection prevention: sanitize values starting with formula characters
          const sanitizedValues = values.map(val => {
            if (val && /^[=+\-@\t\r]/.test(val)) {
              return "'" + val; // Prefix with single quote to prevent formula execution
            }
            return val;
          });
          
          // Create lead object from CSV row (using sanitized values)
          const leadData: any = {};
          headers.forEach((header, index) => {
            if (sanitizedValues[index] && sanitizedValues[index] !== '') {
              leadData[header] = sanitizedValues[index];
            }
          });
          
          // Parse followUpDate if provided
          if (leadData.followUpDate) {
            const date = new Date(leadData.followUpDate);
            if (isNaN(date.getTime())) {
              results.errors.push({
                row: i + 1,
                error: "Invalid date format (use YYYY-MM-DD)",
                data: leadData
              });
              continue;
            }
            leadData.followUpDate = date;
          }
          
          // Use Zod validation with insertContactSchema (CSV imports create leads)
          const validationResult = insertContactSchema.omit({ contractorId: true }).safeParse({
            name: leadData.name?.trim(),
            type: 'lead' as const,
            email: leadData.email?.trim() || undefined,
            phone: leadData.phone?.trim() || undefined,
            address: leadData.address?.trim() || undefined,
            source: leadData.source?.trim() || 'CSV Import',
            notes: leadData.notes?.trim() || undefined,
            followUpDate: leadData.followUpDate
          });
          
          if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({
              row: i + 1,
              error: `Validation failed: ${errorMessages}`,
              data: leadData
            });
            continue;
          }
          
          // Create the contact as a lead with proper tenant isolation
          const newContact = await storage.createContact(validationResult.data, contractorId);
          results.imported++;
          
        } catch (error) {
          results.errors.push({
            row: i + 1,
            error: error instanceof Error ? error.message : "Unknown error",
            data: lines[i]
          });
        }
      }
      
      console.log(`CSV import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported`);
      
      // Return 207 Multi-Status if some imports failed, 200 if all succeeded
      const statusCode = results.errors.length > 0 ? 207 : 200;
      
      res.status(statusCode).json({
        success: true,
        message: `Successfully imported ${results.imported} out of ${results.total} leads`,
        total: results.total,
        imported: results.imported,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10) // Limit error reporting to first 10 errors
      });
      
    } catch (error) {
      console.error('CSV upload error:', error);
      res.status(500).json({ 
        error: "Internal server error",
        message: "Failed to process CSV upload"
      });
    }
  });

  // ================================
  // GOOGLE SHEETS SECURE IMPORT ROUTES
  // ================================

  // Validation schemas for secure Google Sheets import
  const googleSheetsCredentialSchema = z.object({
    serviceAccountEmail: z.string().email("Valid service account email is required"),
    privateKey: z.string().min(1, "Private key is required")
  });

  const googleSheetsOperationSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional()
  });

  const googleSheetsImportSchema = z.object({
    spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
    sheetName: z.string().optional(),
    columnMapping: z.record(z.string(), z.string()),
    startRow: z.number().int().min(1).optional().default(2)
  });

  // Store Google Sheets credentials securely
  app.post("/api/leads/google-sheets/credentials", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const credentials = googleSheetsCredentialSchema.parse(req.body);
      
      // Validate credentials by testing authentication
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: '', // Not needed for credential validation
        sheetName: ''
      });

      // Test authentication with a minimal operation
      try {
        await service.validateCredentials();
      } catch (error) {
        return res.status(400).json({ 
          message: 'Invalid Google Sheets credentials. Please verify your service account email and private key.',
          error: error instanceof Error ? error.message : 'Authentication failed'
        });
      }

      // Store credentials securely using CredentialService
      await Promise.all([
        CredentialService.setCredential(contractorId, 'google-sheets', 'serviceAccountEmail', credentials.serviceAccountEmail),
        CredentialService.setCredential(contractorId, 'google-sheets', 'privateKey', credentials.privateKey)
      ]);
      
      res.json({ 
        success: true,
        message: 'Google Sheets credentials stored securely',
        configured: true
      });
    } catch (error) {
      console.error('Error storing Google Sheets credentials:', error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid credential format", errors: error.errors });
        return;
      }
      res.status(500).json({ 
        message: 'Failed to store credentials. Please try again.' 
      });
    }
  });

  // Check Google Sheets credential status
  app.get("/api/leads/google-sheets/credentials/status", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      const hasCredentials = await CredentialService.hasRequiredCredentials(
        contractorId, 
        'google-sheets'
      );
      
      res.json({ configured: hasCredentials });
    } catch (error) {
      console.error('Error checking Google Sheets credentials:', error);
      res.status(500).json({ message: 'Failed to check credential status' });
    }
  });

  // Validate Google Sheets connection with stored credentials
  app.post("/api/leads/google-sheets/validate", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          valid: false,
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const isValid = await service.validateConnection(config.spreadsheetId);
      
      if (isValid) {
        res.json({ valid: true, message: "Connection successful" });
      } else {
        res.status(400).json({ valid: false, message: "Failed to connect to Google Sheets" });
      }
    } catch (error) {
      console.error('Google Sheets validation error:', error);
      const message = error instanceof Error ? error.message : 'Validation failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ valid: false, message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          valid: false,
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          valid: false,
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ valid: false, message: `Validation failed: ${message}` });
    }
  });

  // Get Google Sheets info and headers with stored credentials
  app.post("/api/leads/google-sheets/info", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const [sheetInfo, headers] = await Promise.all([
        service.getSheetInfo(config.spreadsheetId),
        service.getSheetHeaders(config.spreadsheetId, config.sheetName)
      ]);

      // Suggest column mappings based on header names
      const suggestedMappings = suggestColumnMappings(headers);

      res.json({
        sheetInfo,
        headers,
        suggestedMappings
      });
    } catch (error) {
      console.error('Google Sheets info error:', error);
      const message = error instanceof Error ? error.message : 'Failed to get sheet information';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Failed to get Google Sheets information: ${message}` });
    }
  });

  // Preview Google Sheets data with stored credentials
  app.post("/api/leads/google-sheets/preview", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const config = googleSheetsOperationSchema.extend({
        maxRows: z.number().int().min(1).max(50).optional().default(10)
      }).parse(req.body);
      
      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }

      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName
      });

      const previewData = await service.previewSheetData(
        config.spreadsheetId, 
        config.sheetName, 
        config.maxRows
      );

      res.json(previewData);
    } catch (error) {
      console.error('Google Sheets preview error:', error);
      const message = error instanceof Error ? error.message : 'Preview failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      
      res.status(500).json({ message: `Preview failed: ${message}` });
    }
  });

  // Import leads from Google Sheets with stored credentials
  app.post("/api/leads/google-sheets/import", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      const importConfig = googleSheetsImportSchema.parse(req.body);
      
      // Validate column mapping
      if (!Object.values(importConfig.columnMapping).includes('name')) {
        return res.status(400).json({ 
          message: 'Column mapping must include a "name" field mapping' 
        });
      }

      // Get credentials from secure storage
      const credentials = await CredentialService.getServiceCredentials(contractorId, 'google-sheets');
      if (!credentials.serviceAccountEmail || !credentials.privateKey) {
        return res.status(400).json({ 
          message: 'Google Sheets credentials not configured. Please set up your credentials first.' 
        });
      }
      
      const service = new GoogleSheetsService({
        serviceAccountEmail: credentials.serviceAccountEmail,
        privateKey: credentials.privateKey,
        spreadsheetId: importConfig.spreadsheetId,
        sheetName: importConfig.sheetName
      });

      // Import raw data from the sheet
      const rawLeads = await service.importLeadsFromSheet(
        importConfig.spreadsheetId,
        importConfig.columnMapping,
        importConfig.sheetName,
        importConfig.startRow
      );

      console.log(`Starting Google Sheets import for contractor ${contractorId}: ${rawLeads.length} leads to process`);

      const results = {
        total: rawLeads.length,
        imported: 0,
        skipped: 0,
        errors: [] as Array<{ row: number; error: string; data: any }>
      };

      // Process each lead
      for (let i = 0; i < rawLeads.length; i++) {
        try {
          const leadData = rawLeads[i];
          
          // Skip empty rows
          if (!leadData.name && !leadData.email) {
            continue;
          }
          
          // Convert single values to arrays for new schema format
          const emails = leadData.email?.trim() ? [leadData.email.trim()] : [];
          const phones = leadData.phone?.trim() ? [leadData.phone.trim()] : [];
          
          // Use Zod validation with insertContactSchema (Google Sheets imports create leads)
          const validationResult = insertContactSchema.omit({ contractorId: true }).safeParse({
            name: leadData.name?.trim(),
            type: 'lead' as const,
            emails,
            phones,
            address: leadData.address?.trim() || undefined,
            source: leadData.source?.trim() || 'Google Sheets Import',
            notes: leadData.notes?.trim() || undefined,
            followUpDate: leadData.followUpDate || undefined,
            utmSource: leadData.utmSource?.trim() || undefined,
            utmMedium: leadData.utmMedium?.trim() || undefined,
            utmCampaign: leadData.utmCampaign?.trim() || undefined,
            utmTerm: leadData.utmTerm?.trim() || undefined,
            utmContent: leadData.utmContent?.trim() || undefined,
            pageUrl: leadData.pageUrl?.trim() || undefined
          });
          
          if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            results.errors.push({
              row: importConfig.startRow + i,
              error: `Validation failed: ${errorMessages}`,
              data: leadData
            });
            continue;
          }
          
          // Check for duplicate phone numbers before creating
          if (validationResult.data.phones && validationResult.data.phones.length > 0) {
            const existingContacts = await storage.getContacts(contractorId, 'lead');
            const duplicate = existingContacts.find(existingContact =>
              existingContact.phones && existingContact.phones.some(existingPhone =>
                validationResult.data.phones!.includes(existingPhone)
              )
            );
            if (duplicate) {
              const duplicatePhone = duplicate.phones?.find(p => validationResult.data.phones!.includes(p));
              results.skipped++;
              results.errors.push({
                row: importConfig.startRow + i,
                error: `Skipped - Duplicate phone number ${duplicatePhone} (already exists for contact: ${duplicate.name})`,
                data: leadData
              });
              continue;
            }
          }
          
          // Create the contact as a lead with proper tenant isolation
          const newContact = await storage.createContact(validationResult.data, contractorId);
          results.imported++;
          
        } catch (error) {
          results.errors.push({
            row: importConfig.startRow + i,
            error: error instanceof Error ? error.message : "Unknown error",
            data: rawLeads[i]
          });
        }
      }
      
      console.log(`Google Sheets import completed for contractor ${contractorId}: ${results.imported}/${results.total} leads imported, ${results.skipped} skipped (duplicates)`);
      
      // Return 207 Multi-Status if some imports failed, 200 if all succeeded
      const statusCode = results.errors.length > 0 ? 207 : 200;
      
      const message = results.skipped > 0
        ? `Successfully imported ${results.imported} out of ${results.total} leads (${results.skipped} skipped as duplicates)`
        : `Successfully imported ${results.imported} out of ${results.total} leads from Google Sheets`;
      
      res.status(statusCode).json({
        success: true,
        message,
        total: results.total,
        imported: results.imported,
        skipped: results.skipped,
        failedCount: results.errors.length,
        errors: results.errors.slice(0, 10) // Limit error reporting to first 10 errors
      });
      
    } catch (error) {
      console.error('Google Sheets import error:', error);
      const message = error instanceof Error ? error.message : 'Import failed';
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid import configuration", errors: error.errors });
      }
      if (message.includes('permission') || message.includes('access')) {
        return res.status(403).json({ 
          message: 'Access denied. Please ensure the service account has permission to access this spreadsheet.' 
        });
      }
      if (message.includes('not found')) {
        return res.status(404).json({ 
          message: 'Spreadsheet not found. Please check the spreadsheet ID.' 
        });
      }
      if (message.includes('mapping')) {
        return res.status(400).json({ 
          message: `Column mapping error: ${message}` 
        });
      }
      
      res.status(500).json({ 
        message: `Failed to import leads from Google Sheets: ${message}`
      });
    }
  });

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

  // Business targets for contractors
  app.get("/api/business-targets", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can view business targets
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can view business targets" });
        return;
      }

      // Get current targets for the contractor
      const targets = await storage.getBusinessTargets(req.user!.contractorId);
      
      // If no targets exist, return default values
      if (!targets) {
        const defaultTargets = {
          speedToLeadMinutes: 60,
          followUpRatePercent: "80.00",
          setRatePercent: "40.00", 
          closeRatePercent: "25.00"
        };
        res.json(defaultTargets);
        return;
      }
      
      res.json(targets);
    } catch (error) {
      console.error('Failed to get business targets:', error);
      res.status(500).json({ message: "Failed to get business targets" });
    }
  });

  app.post("/api/business-targets", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can set business targets
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can set business targets" });
        return;
      }

      const targets = req.body;
      
      // Check if targets already exist for this contractor
      const existingTargets = await storage.getBusinessTargets(req.user!.contractorId);
      
      let result;
      if (existingTargets) {
        // Update existing targets
        result = await storage.updateBusinessTargets(targets, req.user!.contractorId);
      } else {
        // Create new targets
        result = await storage.createBusinessTargets(targets, req.user!.contractorId);
      }
      
      res.json(result);
    } catch (error) {
      console.error('Failed to set business targets:', error);
      res.status(500).json({ message: "Failed to set business targets" });
    }
  });

  // Terminology settings endpoints
  app.get("/api/terminology", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Get current terminology settings for the contractor
      const settings = await storage.getTerminologySettings(req.user!.contractorId);
      
      // If no settings exist, return default values
      if (!settings) {
        const defaultSettings = {
          leadLabel: 'Lead',
          leadsLabel: 'Leads',
          estimateLabel: 'Estimate',
          estimatesLabel: 'Estimates',
          jobLabel: 'Job',
          jobsLabel: 'Jobs',
          messageLabel: 'Message',
          messagesLabel: 'Messages',
          templateLabel: 'Template',
          templatesLabel: 'Templates'
        };
        res.json(defaultSettings);
        return;
      }
      
      res.json(settings);
    } catch (error) {
      console.error('Failed to get terminology settings:', error);
      res.status(500).json({ message: "Failed to get terminology settings" });
    }
  });

  app.post("/api/terminology", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can update terminology settings
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can update terminology settings" });
        return;
      }

      const settings = req.body;
      
      // Check if settings already exist for this contractor
      const existingSettings = await storage.getTerminologySettings(req.user!.contractorId);
      
      let result;
      if (existingSettings) {
        // Update existing settings
        result = await storage.updateTerminologySettings(settings, req.user!.contractorId);
      } else {
        // Create new settings
        result = await storage.createTerminologySettings(settings, req.user!.contractorId);
      }
      
      // Invalidate terminology cache so changes take effect immediately
      const { cacheInvalidation } = await import('./services/cache');
      cacheInvalidation.invalidateTerminologySettings(req.user!.contractorId);
      
      res.json(result);
    } catch (error) {
      console.error('Failed to update terminology settings:', error);
      res.status(500).json({ message: "Failed to update terminology settings" });
    }
  });

  // Booking slug configuration endpoints
  app.get("/api/booking-slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractor = await storage.getContractor(req.user!.contractorId);
      if (!contractor) {
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      // Build the public booking URL
      const protocol = req.protocol;
      const host = req.get('host');
      const bookingUrl = contractor.bookingSlug 
        ? `${protocol}://${host}/book/${contractor.bookingSlug}`
        : null;
      
      res.json({ 
        bookingSlug: contractor.bookingSlug || null,
        bookingUrl 
      });
    } catch (error) {
      console.error('Failed to get booking slug:', error);
      res.status(500).json({ message: "Failed to get booking slug" });
    }
  });

  app.post("/api/booking-slug", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Only admins can update booking slug
      if (req.user!.role !== 'admin' && req.user!.role !== 'super_admin') {
        res.status(403).json({ message: "Only administrators can update booking settings" });
        return;
      }

      const { bookingSlug } = req.body;
      
      // Validate slug format (alphanumeric, hyphens, lowercase)
      if (bookingSlug) {
        const slugRegex = /^[a-z0-9-]+$/;
        if (!slugRegex.test(bookingSlug)) {
          res.status(400).json({ message: "Booking slug can only contain lowercase letters, numbers, and hyphens" });
          return;
        }
        if (bookingSlug.length < 3 || bookingSlug.length > 50) {
          res.status(400).json({ message: "Booking slug must be between 3 and 50 characters" });
          return;
        }
        
        // Check if slug is already taken by another contractor
        const existingContractor = await storage.getContractorBySlug(bookingSlug);
        if (existingContractor && existingContractor.id !== req.user!.contractorId) {
          res.status(400).json({ message: "This booking slug is already taken" });
          return;
        }
      }
      
      // Update the contractor's booking slug
      const updated = await storage.updateContractor(req.user!.contractorId, { 
        bookingSlug: bookingSlug || null 
      });
      
      if (!updated) {
        res.status(404).json({ message: "Contractor not found" });
        return;
      }
      
      // Build the public booking URL
      const protocol = req.protocol;
      const host = req.get('host');
      const bookingUrl = bookingSlug 
        ? `${protocol}://${host}/book/${bookingSlug}`
        : null;
      
      res.json({ 
        bookingSlug: updated.bookingSlug || null,
        bookingUrl,
        message: bookingSlug ? "Booking slug updated successfully" : "Booking slug removed"
      });
    } catch (error) {
      console.error('Failed to update booking slug:', error);
      res.status(500).json({ message: "Failed to update booking slug" });
    }
  });

  // Webhook configuration endpoint
  app.get("/api/webhook-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const contractorId = req.user!.contractorId;
      
      // Get or generate API key for this contractor
      let apiKey: string;
      try {
        const existingKey = await CredentialService.getCredential(contractorId, 'webhook', 'api_key');
        if (!existingKey) {
          throw new Error('No API key found');
        }
        apiKey = existingKey;
      } catch {
        // Generate a new API key if none exists
        apiKey = crypto.randomBytes(32).toString('hex');
        await CredentialService.setCredential(contractorId, 'webhook', 'api_key', apiKey);
      }

      // Build the webhook URL
      const protocol = req.protocol;
      const host = req.get('host');
      const webhookUrl = `${protocol}://${host}/api/webhooks/${contractorId}/leads`;

      // Return the webhook configuration with documentation
      res.json({
        webhookUrl,
        apiKey,
        documentation: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey
          },
          requiredFields: ["name"],
          optionalFields: ["email", "emails", "phone", "phones", "address", "source", "notes", "followUpDate"],
          phoneNormalization: "All phone numbers are automatically normalized to E.164 format (+1XXXXXXXXXX for US). Supports any format: (xxx)xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, xxxxxxxxxx, +1(xxx)xxx-xxxx, etc.",
          multipleContacts: "Send single values (email/phone) OR arrays (emails/phones). Arrays allow multiple contact methods per lead.",
          example: {
            name: "John Smith",
            phone: "(555) 123-4567",
            email: "john@example.com",
            address: "123 Main St, City, State 12345",
            source: "Website Contact Form",
            notes: "Interested in HVAC installation",
            followUpDate: "2024-01-15T10:00:00Z"
          },
          exampleWithArrays: {
            name: "Jane Doe",
            phones: ["(555) 123-4567", "555-987-6543", "+1 555 111 2222"],
            emails: ["jane@example.com", "jane.doe@work.com"],
            address: "456 Oak Ave",
            source: "Referral"
          }
        }
      });
    } catch (error) {
      console.error('Failed to get webhook config:', error);
      res.status(500).json({ message: "Failed to get webhook configuration" });
    }
  });

  // Dialpad SMS webhook configuration endpoint
  app.get("/api/dialpad-webhook-config", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Build the Dialpad SMS webhook URL with tenant ID
      const protocol = req.get('x-forwarded-proto') || req.protocol;
      const host = req.get('x-forwarded-host') || req.get('host');
      const tenantId = req.user!.contractorId;
      const webhookUrl = `${protocol}://${host}/api/webhooks/dialpad/sms/${tenantId}`;

      // Get contractor's webhook API key
      const contractor = await db.select()
        .from(contractors)
        .where(eq(contractors.id, tenantId))
        .limit(1);

      const apiKey = contractor && contractor.length > 0 ? contractor[0].webhookApiKey : null;

      res.json({
        webhookUrl,
        apiKey,
        service: "dialpad",
        documentation: {
          title: "Dialpad SMS Webhook Configuration",
          description: "Configure this webhook URL in your Dialpad account or Zapier to receive incoming text messages in your CRM",
          setupInstructions: [
            "1. Copy the Webhook URL above",
            "2. Copy the API Key above",
            "3. In Zapier, create a Webhook POST action:",
            "   - URL: Paste the webhook URL",
            "   - Headers: Add 'x-api-key' with the API Key value",
            "   - Data: Map your SMS fields (text, from_number, to_number)",
            "2. Navigate to Settings → Integrations → Webhooks",
            "3. Create a new webhook or edit an existing one",
            "4. Set the webhook URL to the URL provided below",
            "5. Select 'SMS Received' as the event type",
            "6. Save the webhook configuration",
            "7. Test by sending a text message to one of your Dialpad numbers"
          ],
          webhookUrl,
          expectedPayload: {
            text: "Message content",
            from_number: "+14155551234",
            to_number: "+14155555678",
            contact_name: "John Doe",
            message_id: "msg_123456",
            timestamp: "2024-01-15T10:00:00Z"
          },
          requiredFields: ["text", "from_number", "to_number"],
          optionalFields: {
            contact_name: "Name of the contact (optional)",
            message_id: "External message ID for deduplication (optional)",
            timestamp: "Message timestamp (optional)"
          },
          automaticBehavior: {
            direction: "Automatically detected - if from_number matches one of your Dialpad numbers, it's marked as outbound (and skipped). Otherwise, it's marked as inbound and processed."
          }
        }
      });
    } catch (error) {
      console.error('Failed to get Dialpad webhook config:', error);
      res.status(500).json({ message: "Failed to get Dialpad webhook configuration" });
    }
  });

  // Helper function to normalize phone numbers to E.164 format
  const normalizePhoneNumber = (phone: string): string => {
    if (!phone) return '';
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');
    // Add +1 if it's a 10-digit US number
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    // Add + if it's an 11-digit number starting with 1
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    // Already in E.164 format or other format
    return phone.startsWith('+') ? phone : `+${digits}`;
  };

  // Dialpad SMS Webhook endpoint (tenant-specific)
  app.post("/api/webhooks/dialpad/sms/:tenantId", webhookRateLimiter, express.json(), async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      console.log(`[Dialpad Webhook] Received SMS webhook for tenant ${tenantId}:`, JSON.stringify(req.body, null, 2));
      
      const payload = req.body;
      
      // Validate API key
      const apiKey = req.headers['x-api-key'] as string;
      
      if (!apiKey) {
        console.log('[Dialpad Webhook] Missing x-api-key header');
        res.status(401).json({ success: false, error: 'Missing x-api-key header' });
        return;
      }
      
      // Verify tenant exists and validate API key
      const contractor = await db.select()
        .from(contractors)
        .where(eq(contractors.id, tenantId))
        .limit(1);
      
      if (!contractor || contractor.length === 0) {
        console.error(`[Dialpad Webhook] Invalid tenant ID: ${tenantId}`);
        res.status(404).json({ success: false, error: 'Invalid tenant ID' });
        return;
      }
      
      if (contractor[0].webhookApiKey !== apiKey) {
        console.log('[Dialpad Webhook] Invalid API key');
        res.status(403).json({ success: false, error: 'Invalid API key' });
        return;
      }
      
      const contractorId = tenantId;
      
      // Store the webhook event for logging
      const webhookEvent = await db.insert(webhookEvents).values({
        contractorId,
        service: 'dialpad',
        eventType: 'sms.received',
        payload: JSON.stringify(payload),
        processed: false,
      }).returning();
      
      // Extract SMS details from Dialpad payload
      // Dialpad sends: { text, from_number, to_number (array), direction, timestamp, message_id, etc. }
      // Zapier can send: { text, from_number, to_number, sms_id, timestamp }
      // NOTE: 'text' field requires message_content_export OAuth scope
      const {
        text: webhookText,
        from_number: fromNumber,
        to_number: toNumberRaw,
        message_id: messageId,
        sms_id: smsId,
        id: dialpadMessageId,
      } = payload;
      
      // Use sms_id from Zapier, or message_id from Dialpad, or dialpad message id as fallback
      const externalMessageId = smsId || messageId || dialpadMessageId;
      
      // Handle to_number as either array or string
      const toNumber = Array.isArray(toNumberRaw) ? toNumberRaw[0] : toNumberRaw;
      
      // Normalize phone numbers for consistent matching
      const normalizedFromNumber = normalizePhoneNumber(fromNumber);
      const normalizedToNumber = normalizePhoneNumber(toNumber);
      
      // Auto-detect direction: if from_number is one of our Dialpad numbers, it's outbound
      // Otherwise it's inbound (someone texting us)
      const dialpadNumbers = await db.select()
        .from(dialpadPhoneNumbers)
        .where(eq(dialpadPhoneNumbers.contractorId, contractorId));
      
      const isFromOurNumber = dialpadNumbers.some(dpn => {
        const normalizedDialpadNumber = normalizePhoneNumber(dpn.phoneNumber);
        return normalizedDialpadNumber === normalizedFromNumber || dpn.phoneNumber === fromNumber;
      });
      
      const direction = isFromOurNumber ? 'outbound' : 'inbound';
      
      // Check for duplicate messages based on external message ID or timestamp + phone numbers + content
      // This prevents duplicates when the same message comes through multiple webhooks
      const { timestamp } = payload;
      
      // First check: external message ID (most reliable)
      if (externalMessageId) {
        const existingMessage = await db.select()
          .from(messages)
          .where(and(
            eq(messages.externalMessageId, externalMessageId),
            eq(messages.contractorId, contractorId)
          ))
          .limit(1);
        
        if (existingMessage && existingMessage.length > 0) {
          await db.update(webhookEvents)
            .set({ 
              processed: true, 
              processedAt: new Date(),
              errorMessage: 'Skipped: Duplicate message (external_message_id already exists)' 
            })
            .where(eq(webhookEvents.id, webhookEvent[0].id));
          
          console.log('[Dialpad Webhook] Skipping duplicate message with external_message_id:', externalMessageId);
          res.status(200).json({ success: true, message: 'Duplicate message skipped' });
          return;
        }
      }
      
      // Second check: timestamp + phone numbers + content (fallback for Zapier/webhooks without message_id)
      if (timestamp && webhookText) {
        // Look for messages with same timestamp, phone numbers, and content
        // Parse timestamp to compare (allow 1-second tolerance for timing differences)
        const messageTimestamp = new Date(timestamp);
        const oneSecondBefore = new Date(messageTimestamp.getTime() - 1000);
        const oneSecondAfter = new Date(messageTimestamp.getTime() + 1000);
        
        const duplicateByContent = await db.select()
          .from(messages)
          .where(and(
            eq(messages.contractorId, contractorId),
            eq(messages.fromNumber, fromNumber),
            eq(messages.toNumber, toNumber),
            eq(messages.content, webhookText),
            sql`${messages.createdAt} >= ${oneSecondBefore}`,
            sql`${messages.createdAt} <= ${oneSecondAfter}`
          ))
          .limit(1);
        
        if (duplicateByContent && duplicateByContent.length > 0) {
          await db.update(webhookEvents)
            .set({ 
              processed: true, 
              processedAt: new Date(),
              errorMessage: 'Skipped: Duplicate message (same timestamp, numbers, and content)' 
            })
            .where(eq(webhookEvents.id, webhookEvent[0].id));
          
          console.log('[Dialpad Webhook] Skipping duplicate message based on timestamp+content match');
          res.status(200).json({ success: true, message: 'Duplicate message skipped' });
          return;
        }
      }
      
      // Handle missing message text (requires message_content_export OAuth scope)
      // Note: Dialpad webhooks don't include message text by default, even with the scope enabled
      const placeholderText = direction === 'inbound' ? '[Inbound text]' : '[Outbound text]';
      let messageText = webhookText || placeholderText;
      const needsContentFetch = !webhookText && externalMessageId;
      
      // Find contact by phone number - try normalized and original formats
      // For inbound: match from_number (sender), for outbound: match to_number (recipient)
      let contactId: string | null = null;
      
      const contactPhoneNormalized = direction === 'inbound' ? normalizedFromNumber : normalizePhoneNumber(toNumber);
      const contactPhoneOriginal = direction === 'inbound' ? fromNumber : toNumber;
      
      console.log(`[Dialpad Webhook] Looking for contact - Direction: ${direction}, From: ${fromNumber}, To: ${toNumber}`);
      console.log(`[Dialpad Webhook] Contact phone normalized: ${contactPhoneNormalized}, original: ${contactPhoneOriginal}`);
      
      // Try to find contact using unified contacts table
      let contact = await storage.getContactByPhone(contactPhoneNormalized, contractorId);
      if (!contact) {
        contact = await storage.getContactByPhone(contactPhoneOriginal, contractorId);
      }
      
      if (contact) {
        contactId = contact.id;
        console.log(`[Dialpad Webhook] Found contact: ${contact.id} (${contact.name}) - Type: ${contact.type}`);
      } else {
        console.log(`[Dialpad Webhook] No contact match found`);
      }
      
      // Store the message with auto-detected direction
      // Use normalizePhoneForStorage to ensure consistent format
      const { normalizePhoneForStorage } = await import('./utils/phone-normalizer');
      const newMessage = await storage.createMessage({
        type: 'text',
        status: 'delivered',
        direction,  // Use auto-detected direction
        content: messageText,
        toNumber: normalizePhoneForStorage(toNumber),
        fromNumber: normalizePhoneForStorage(fromNumber),
        contactId: contactId,
        externalMessageId,
      }, contractorId);
      
      // Broadcast new message to all connected WebSocket clients for this contractor
      // Include legacy fields for backward compatibility
      const { broadcastToContractor } = await import('./websocket');
      broadcastToContractor(contractorId, {
        type: 'new_message',
        message: newMessage,
        contactId: contactId,
        leadId: contact?.type === 'lead' ? contactId : null,
        customerId: contact?.type === 'customer' ? contactId : null,
        contactType: contact?.type === 'customer' ? 'customer' : 'lead'
      });
      
      // Mark webhook as processed
      await db.update(webhookEvents)
        .set({ 
          processed: true, 
          processedAt: new Date() 
        })
        .where(eq(webhookEvents.id, webhookEvent[0].id));
      
      console.log('[Dialpad Webhook] Successfully processed SMS webhook');
      res.status(200).json({ success: true, message: 'Webhook processed successfully' });
      
      // If message text is missing, fetch it from Dialpad API after a delay
      if (needsContentFetch) {
        const messageId = newMessage.id;
        console.log(`[Dialpad Webhook] Scheduling content fetch for message ${messageId} (SMS ID: ${externalMessageId})`);
        
        setTimeout(async () => {
          try {
            console.log(`[Dialpad Webhook] Fetching content for SMS ID: ${externalMessageId}`);
            const result = await dialpadEnhancedService.getSmsById(contractorId, externalMessageId!);
            
            if (result.text) {
              console.log(`[Dialpad Webhook] Fetched message content, updating database`);
              
              // Update message in database
              await db.update(messages)
                .set({ content: result.text })
                .where(eq(messages.id, messageId));
              
              // Get updated message
              const updatedMessage = await storage.getMessage(messageId, contractorId);
              
              if (updatedMessage) {
                // Broadcast update to WebSocket clients
                // Include legacy fields for backward compatibility
                broadcastToContractor(contractorId, {
                  type: 'message_updated',
                  message: updatedMessage,
                  contactId: contactId,
                  leadId: contact?.type === 'lead' ? contactId : null,
                  customerId: contact?.type === 'customer' ? contactId : null,
                  contactType: contact?.type === 'customer' ? 'customer' : 'lead'
                });
                
                console.log(`[Dialpad Webhook] Successfully updated message content`);
              }
            } else {
              console.error(`[Dialpad Webhook] Failed to fetch SMS content:`, result.error);
            }
          } catch (error) {
            console.error(`[Dialpad Webhook] Error fetching SMS content:`, error);
          }
        }, 5000); // 5 second delay as per documentation
      }
    } catch (error) {
      console.error('[Dialpad Webhook] Error processing webhook:', error);
      res.status(500).json({ success: false, error: 'Failed to process webhook' });
    }
  });

  // Notification API endpoints
  app.get("/api/notifications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getNotifications(req.user!.userId, req.user!.contractorId, limit);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.get("/api/notifications/unread", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notifications = await storage.getUnreadNotifications(req.user!.userId, req.user!.contractorId);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
      res.status(500).json({ error: 'Failed to fetch unread notifications' });
    }
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const notification = await storage.markNotificationAsRead(req.params.id, req.user!.userId);
      if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.json(notification);
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await storage.markAllNotificationsAsRead(req.user!.userId, req.user!.contractorId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  app.delete("/api/notifications/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteNotification(req.params.id, req.user!.userId);
      if (!deleted) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting notification:', error);
      res.status(500).json({ error: 'Failed to delete notification' });
    }
  });

  // Workflow API endpoints
  app.get("/api/workflows", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const approvalStatus = req.query.approvalStatus as string | undefined;
      const workflows = await storage.getWorkflows(req.user!.contractorId, approvalStatus);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching workflows:', error);
      res.status(500).json({ error: 'Failed to fetch workflows' });
    }
  });

  app.get("/api/workflows/active", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflows = await storage.getActiveWorkflows(req.user!.contractorId);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching active workflows:', error);
      res.status(500).json({ error: 'Failed to fetch active workflows' });
    }
  });

  app.get("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json(workflow);
    } catch (error) {
      console.error('Error fetching workflow:', error);
      res.status(500).json({ error: 'Failed to fetch workflow' });
    }
  });

  app.post("/api/workflows", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const validation = insertWorkflowSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
        return;
      }

      // Admins, managers, and super_admins auto-approve their own workflows
      const userContractor = await storage.getUserContractor(req.user!.userId, req.user!.contractorId);
      const isElevatedRole = userContractor && ['admin', 'manager', 'super_admin'].includes(userContractor.role);
      const workflowData = isElevatedRole
        ? { ...validation.data, approvalStatus: 'approved' as const }
        : validation.data;

      const workflow = await storage.createWorkflow(
        workflowData,
        req.user!.contractorId,
        req.user!.userId
      );
      res.status(201).json(workflow);
    } catch (error) {
      console.error('Error creating workflow:', error);
      res.status(500).json({ error: 'Failed to create workflow' });
    }
  });

  app.patch("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const validation = insertWorkflowSchema.partial().safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow data', details: validation.error });
        return;
      }
      
      // If trying to activate workflow, check approval status
      if (validation.data.isActive === true) {
        const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
        if (!existingWorkflow) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        
        if (existingWorkflow.approvalStatus !== 'approved') {
          res.status(403).json({ 
            error: 'Cannot activate workflow', 
            message: existingWorkflow.approvalStatus === 'pending_approval' 
              ? 'This workflow requires admin approval before it can be activated'
              : 'This workflow has been rejected and cannot be activated'
          });
          return;
        }
      }
      
      const workflow = await storage.updateWorkflow(
        req.params.id,
        validation.data,
        req.user!.contractorId
      );
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json(workflow);
    } catch (error) {
      console.error('Error updating workflow:', error);
      res.status(500).json({ error: 'Failed to update workflow' });
    }
  });

  app.delete("/api/workflows/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const deleted = await storage.deleteWorkflow(req.params.id, req.user!.contractorId);
      if (!deleted) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      res.status(500).json({ error: 'Failed to delete workflow' });
    }
  });

  // Workflow approval endpoints
  app.get("/api/workflows/pending-approval", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user is admin or manager
      const userContractor = await storage.getUserContractor(req.user!.userId, req.user!.contractorId);
      if (!userContractor || (userContractor.role !== 'admin' && userContractor.role !== 'manager' && userContractor.role !== 'super_admin')) {
        res.status(403).json({ error: 'Only admins and managers can view pending approvals' });
        return;
      }
      
      const workflows = await storage.getWorkflowsPendingApproval(req.user!.contractorId);
      res.json(workflows);
    } catch (error) {
      console.error('Error fetching pending approval workflows:', error);
      res.status(500).json({ error: 'Failed to fetch pending approval workflows' });
    }
  });

  app.post("/api/workflows/:id/approve", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user is admin or manager
      const userContractor = await storage.getUserContractor(req.user!.userId, req.user!.contractorId);
      if (!userContractor || (userContractor.role !== 'admin' && userContractor.role !== 'manager' && userContractor.role !== 'super_admin')) {
        res.status(403).json({ error: 'Only admins and managers can approve workflows' });
        return;
      }
      
      // Verify workflow belongs to contractor
      const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
      if (!existingWorkflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const workflow = await storage.approveWorkflow(req.params.id, req.user!.contractorId, req.user!.userId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      res.json(workflow);
    } catch (error) {
      console.error('Error approving workflow:', error);
      res.status(500).json({ error: 'Failed to approve workflow' });
    }
  });

  app.post("/api/workflows/:id/reject", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Check if user is admin or manager
      const userContractor = await storage.getUserContractor(req.user!.userId, req.user!.contractorId);
      if (!userContractor || (userContractor.role !== 'admin' && userContractor.role !== 'manager' && userContractor.role !== 'super_admin')) {
        res.status(403).json({ error: 'Only admins and managers can reject workflows' });
        return;
      }
      
      // Verify workflow belongs to contractor
      const existingWorkflow = await storage.getWorkflow(req.params.id, req.user!.contractorId);
      if (!existingWorkflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const { rejectionReason } = req.body;
      const workflow = await storage.rejectWorkflow(req.params.id, req.user!.contractorId, req.user!.userId, rejectionReason);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      res.json(workflow);
    } catch (error) {
      console.error('Error rejecting workflow:', error);
      res.status(500).json({ error: 'Failed to reject workflow' });
    }
  });

  // Workflow step endpoints
  app.get("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Verify workflow belongs to contractor
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const steps = await storage.getWorkflowSteps(req.params.workflowId);
      res.json(steps);
    } catch (error) {
      console.error('Error fetching workflow steps:', error);
      res.status(500).json({ error: 'Failed to fetch workflow steps' });
    }
  });

  app.post("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Verify workflow belongs to contractor
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const validation = insertWorkflowStepSchema.safeParse({ ...req.body, workflowId: req.params.workflowId });
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
        return;
      }
      
      const step = await storage.createWorkflowStep(validation.data);
      res.status(201).json(step);
    } catch (error) {
      console.error('Error creating workflow step:', error);
      res.status(500).json({ error: 'Failed to create workflow step' });
    }
  });

  app.put("/api/workflows/:workflowId/steps", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }

      const { steps } = req.body;
      if (!Array.isArray(steps)) {
        res.status(400).json({ error: 'steps must be an array' });
        return;
      }

      // Atomically replace all steps: delete existing, then create new ones
      await storage.deleteWorkflowSteps(req.params.workflowId);

      const createdSteps = [];
      for (const stepData of steps) {
        const validation = insertWorkflowStepSchema.safeParse({ ...stepData, workflowId: req.params.workflowId });
        if (!validation.success) {
          res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
          return;
        }
        const step = await storage.createWorkflowStep(validation.data);
        createdSteps.push(step);
      }

      res.json(createdSteps);
    } catch (error) {
      console.error('Error replacing workflow steps:', error);
      res.status(500).json({ error: 'Failed to replace workflow steps' });
    }
  });

  app.patch("/api/workflow-steps/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First get the step to find its workflow
      const existingStep = await storage.getWorkflowStep(req.params.id);
      if (!existingStep) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      
      // Verify the workflow belongs to the contractor
      const workflow = await storage.getWorkflow(existingStep.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      
      // Validate request body
      const validation = insertWorkflowStepSchema.omit({ workflowId: true }).partial().safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({ error: 'Invalid workflow step data', details: validation.error });
        return;
      }
      
      const step = await storage.updateWorkflowStep(req.params.id, validation.data);
      if (!step) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      res.json(step);
    } catch (error) {
      console.error('Error updating workflow step:', error);
      res.status(500).json({ error: 'Failed to update workflow step' });
    }
  });

  app.delete("/api/workflow-steps/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // First get the step to find its workflow
      const existingStep = await storage.getWorkflowStep(req.params.id);
      if (!existingStep) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      
      // Verify the workflow belongs to the contractor
      const workflow = await storage.getWorkflow(existingStep.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      
      const deleted = await storage.deleteWorkflowStep(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Workflow step not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting workflow step:', error);
      res.status(500).json({ error: 'Failed to delete workflow step' });
    }
  });

  // Workflow execution endpoints
  app.get("/api/workflows/:workflowId/executions", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Verify workflow belongs to contractor
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const executions = await storage.getWorkflowExecutions(req.params.workflowId, req.user!.contractorId, limit);
      res.json(executions);
    } catch (error) {
      console.error('Error fetching workflow executions:', error);
      res.status(500).json({ error: 'Failed to fetch workflow executions' });
    }
  });

  app.get("/api/workflow-executions/recent", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const executions = await storage.getRecentWorkflowExecutions(req.user!.contractorId, limit);
      res.json(executions);
    } catch (error) {
      console.error('Error fetching recent workflow executions:', error);
      res.status(500).json({ error: 'Failed to fetch recent workflow executions' });
    }
  });

  app.get("/api/workflow-executions/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Direct tenant-isolated fetch - no need for secondary workflow check
      const execution = await storage.getWorkflowExecution(req.params.id, req.user!.contractorId);
      if (!execution) {
        res.status(404).json({ error: 'Workflow execution not found' });
        return;
      }
      
      res.json(execution);
    } catch (error) {
      console.error('Error fetching workflow execution:', error);
      res.status(500).json({ error: 'Failed to fetch workflow execution' });
    }
  });

  app.post("/api/workflows/:workflowId/execute", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Verify workflow belongs to contractor
      const workflow = await storage.getWorkflow(req.params.workflowId, req.user!.contractorId);
      if (!workflow) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      
      // Check if workflow is approved
      if (workflow.approvalStatus !== 'approved') {
        res.status(403).json({ 
          error: 'Cannot execute workflow', 
          message: workflow.approvalStatus === 'pending_approval' 
            ? 'This workflow requires admin approval before it can be executed'
            : 'This workflow has been rejected and cannot be executed'
        });
        return;
      }
      
      // Validate triggerData - ensure it's a valid object
      let triggerData = req.body.triggerData || {};
      if (typeof triggerData !== 'object' || triggerData === null || Array.isArray(triggerData)) {
        res.status(400).json({ error: 'Invalid triggerData - must be a valid object' });
        return;
      }
      
      // Validate that triggerData can be safely serialized to JSON
      let triggerDataStr: string;
      try {
        triggerDataStr = JSON.stringify(triggerData);
        // Verify it can be parsed back
        JSON.parse(triggerDataStr);
      } catch (e) {
        res.status(400).json({ error: 'Invalid triggerData - contains non-serializable values' });
        return;
      }
      
      // Create execution record
      const execution = await storage.createWorkflowExecution(
        {
          workflowId: req.params.workflowId,
          status: 'pending',
          triggerData: triggerDataStr,
        },
        req.user!.contractorId
      );
      
      // Execute workflow asynchronously (don't wait for completion)
      workflowEngine.executeWorkflow(execution.id, req.user!.contractorId).catch(error => {
        console.error(`[Workflow API] Error executing workflow ${execution.id}:`, error);
      });
      
      res.status(201).json(execution);
    } catch (error) {
      console.error('Error triggering workflow execution:', error);
      res.status(500).json({ error: 'Failed to trigger workflow execution' });
    }
  });

  // Service worker unregistration endpoint for cache busting
  app.get('/sw-unregister', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Cache Clear</title>
          <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
          <meta http-equiv="Pragma" content="no-cache">
          <meta http-equiv="Expires" content="0">
      </head>
      <body>
          <h1>Clearing Browser Cache...</h1>
          <p id="status">Unregistering service workers...</p>
          <script>
              async function clearCache() {
                  const status = document.getElementById('status');
                  
                  try {
                      // Unregister all service workers
                      if ('serviceWorker' in navigator) {
                          const registrations = await navigator.serviceWorker.getRegistrations();
                          for (const registration of registrations) {
                              await registration.unregister();
                              console.log('Unregistered service worker:', registration);
                          }
                          status.innerHTML += '<br>✅ Service workers unregistered';
                      }
                      
                      // Clear all caches
                      if ('caches' in window) {
                          const cacheNames = await caches.keys();
                          await Promise.all(
                              cacheNames.map(cacheName => caches.delete(cacheName))
                          );
                          status.innerHTML += '<br>✅ All caches cleared';
                      }
                      
                      // Clear localStorage and sessionStorage
                      if (typeof Storage !== 'undefined') {
                          localStorage.clear();
                          sessionStorage.clear();
                          status.innerHTML += '<br>✅ Storage cleared';
                      }
                      
                      status.innerHTML += '<br><br><strong>✅ Cache clearing complete!</strong>';
                      status.innerHTML += '<br><a href="/">Return to Application</a>';
                      status.innerHTML += '<br><br><em>Note: You may need to hard refresh (Ctrl+Shift+R) after returning to the app.</em>';
                      
                  } catch (error) {
                      console.error('Cache clearing failed:', error);
                      status.innerHTML += '<br>❌ Error: ' + error.message;
                  }
              }
              
              clearCache();
          </script>
      </body>
      </html>
    `);
  });

  // =============================================
  // Public Booking API Routes (no authentication required)
  // =============================================

  // Public Google Places proxy — no auth required (used by public booking page)
  app.get('/api/public/places/autocomplete', publicBookingRateLimiter, async (req: Request, res: Response) => {
    const { input } = req.query as { input?: string };
    if (!input || input.trim().length < 3) {
      return res.json({ suggestions: [] });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'Referer': appUrl,
        },
        body: JSON.stringify({
          input: input.trim(),
          includedRegionCodes: ['us'],
        }),
      });
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Autocomplete Public] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json({ suggestions: data.suggestions || [] });
    } catch (e) {
      console.error('[Places Autocomplete Public] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  app.get('/api/public/places/details', publicBookingRateLimiter, async (req: Request, res: Response) => {
    const { placeId } = req.query as { placeId?: string };
    if (!placeId) {
      return res.status(400).json({ error: 'placeId is required' });
    }
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Google Maps API key not configured' });
    }
    const appUrl = process.env.APP_URL || 'https://hcpcrm.replit.app';
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?fields=formattedAddress,addressComponents`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'Referer': appUrl,
          },
        }
      );
      const data = await response.json() as any;
      if (!response.ok) {
        console.error('[Places Details Public] API error:', data);
        return res.status(502).json({ error: 'Places API error', details: data });
      }
      return res.json(data);
    } catch (e) {
      console.error('[Places Details Public] Fetch error:', e);
      return res.status(502).json({ error: 'Failed to reach Places API' });
    }
  });

  // Get contractor info and available slots for public booking page
  app.get("/api/public/book/:slug", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Return public contractor info (limited fields for security)
      res.json({
        contractor: {
          id: contractor.id,
          name: contractor.name,
          bookingSlug: contractor.bookingSlug,
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error fetching contractor:', error);
      res.status(500).json({ message: "Failed to load booking page" });
    }
  });

  // Get available time slots for public booking
  app.get("/api/public/book/:slug/availability", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { startDate, endDate } = req.query;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Parse date range (default to next 14 days)
      const start = startDate ? new Date(startDate as string) : new Date();
      const end = endDate ? new Date(endDate as string) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      
      // Ensure start is not in the past
      const now = new Date();
      if (start < now) {
        start.setTime(now.getTime());
      }

      // Get available slots using the scheduling service with contractor's timezone
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const timezone = (contractor as any).timezone || 'America/New_York';
      const slots = await housecallSchedulingService.getUnifiedAvailability(contractor.id, start, end, timezone);
      
      // Return slots without revealing salesperson details (for privacy)
      const publicSlots = slots.map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        available: slot.availableSalespersonIds.length > 0,
      }));

      res.json({ slots: publicSlots });
    } catch (error) {
      console.error('[Public Booking] Error fetching availability:', error);
      res.status(500).json({ message: "Failed to load availability" });
    }
  });

  // Get contact info for prefilling public booking form
  app.get("/api/public/book/:slug/contact/:contactId", publicBookingRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug, contactId } = req.params;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Get the contact directly
      const contact = await storage.getContact(contactId, contractor.id);
      if (!contact) {
        res.status(404).json({ message: "Contact not found" });
        return;
      }

      // Return only the fields needed for prefilling (no sensitive data)
      res.json({
        prefill: {
          name: contact.name,
          email: contact.emails?.[0] || '',
          phone: contact.phones?.[0] || '',
          address: contact.address || '',
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error fetching contact for prefill:', error);
      res.status(500).json({ message: "Failed to load contact info" });
    }
  });

  // Create a booking from public page (stricter rate limit for submissions)
  app.post("/api/public/book/:slug", publicBookingSubmitRateLimiter, async (req: Request, res: Response) => {
    try {
      const { slug } = req.params;
      const { name, email, phone, address, customerAddressComponents, startTime, notes, source } = req.body;
      
      // Find contractor by booking slug
      const contractor = await storage.getContractorBySlug(slug);
      if (!contractor) {
        res.status(404).json({ message: "Booking page not found" });
        return;
      }

      // Validate required fields
      if (!name || !startTime) {
        res.status(400).json({ message: "Name and appointment time are required" });
        return;
      }

      if (!email && !phone) {
        res.status(400).json({ message: "Email or phone number is required" });
        return;
      }

      // Parse and validate start time
      const appointmentStart = new Date(startTime);
      if (isNaN(appointmentStart.getTime())) {
        res.status(400).json({ message: "Invalid appointment time" });
        return;
      }

      // Ensure appointment is in the future
      if (appointmentStart < new Date()) {
        res.status(400).json({ message: "Appointment time must be in the future" });
        return;
      }

      // Create or find existing contact
      const emails = email ? [email] : [];
      const phones = phone ? [phone] : [];
      
      // Check for existing contact by email or phone
      let existingContactId = await storage.findMatchingContact(contractor.id, emails, phones);
      
      let contactId: string;
      if (existingContactId) {
        // Update existing contact
        contactId = existingContactId;
        await storage.updateContact(existingContactId, {
          name,
          emails,
          phones,
          address,
        }, contractor.id);
      } else {
        // Create new contact
        const newContact = await storage.createContact({
          name,
          emails,
          phones,
          address,
          type: 'lead',
          status: 'scheduled',
          source: source || 'public_booking',
        }, contractor.id);
        contactId = newContact.id;
      }

      // Book the appointment using the scheduling service
      const { housecallSchedulingService } = await import('./housecall-scheduling-service');
      const result = await housecallSchedulingService.bookAppointment(contractor.id, {
        startTime: appointmentStart,
        title: `Estimate Appointment - ${name}`,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        notes: notes || `Booked via public booking page`,
        contactId,
        customerAddressComponents: customerAddressComponents || undefined,
      });

      if (!result.success) {
        res.status(400).json({ message: result.error || "Failed to book appointment" });
        return;
      }

      // Update contact status
      await storage.updateContact(contactId, { status: 'scheduled', isScheduled: true }, contractor.id);

      res.json({ 
        success: true,
        message: "Appointment booked successfully",
        booking: {
          id: result.bookingId,
          startTime: appointmentStart.toISOString(),
          contactId,
        }
      });
    } catch (error) {
      console.error('[Public Booking] Error creating booking:', error);
      res.status(500).json({ message: "Failed to create booking" });
    }
  });

  // Add AI error handler middleware (should be last middleware)
  app.use(aiErrorHandler);

  const httpServer = createServer(app);
  
  // Setup WebSocket server for real-time messaging
  setupWebSocket(httpServer);
  
  return httpServer;
}
