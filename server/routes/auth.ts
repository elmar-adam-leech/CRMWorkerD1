import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { insertUserSchema, insertContractorSchema, users, passwordResetTokens, userContractors } from "@shared/schema";
import { db } from "../db";
import { eq, and, gt, sql, desc } from "drizzle-orm";
import { gmailService } from "../gmail-service";
import { AuthService, requireAuth, type AuthenticatedRequest } from "../auth-service";
import { CredentialService } from "../credential-service";
import { z } from "zod";
import nodeCrypto from "crypto";
import bcrypt from "bcrypt";
import { sendGridService } from "../sendgrid-service";
import { authLoginRateLimiter, authRegisterRateLimiter, authForgotPasswordRateLimiter } from "../middleware/rate-limiter";

export function registerAuthRoutes(app: Express): void {
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
      const resetToken = nodeCrypto.randomBytes(32).toString('hex');
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
  app.post("/api/auth/reset-password", authForgotPasswordRateLimiter, async (req: Request, res: Response) => {
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
        const { syncScheduler } = await import('../sync-scheduler');
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
}
