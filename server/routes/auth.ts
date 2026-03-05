import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { insertUserSchema, users, passwordResetTokens } from "@shared/schema";
import { db } from "../db";
import { eq, sql, desc } from "drizzle-orm";
import { AuthService, requireAuth, type AuthenticatedRequest } from "../auth-service";
import { z } from "zod";
import nodeCrypto from "crypto";
import bcrypt from "bcrypt";
import { sendGridService } from "../sendgrid-service";
import { authLoginRateLimiter, authRegisterRateLimiter, authForgotPasswordRateLimiter } from "../middleware/rate-limiter";
import { asyncHandler } from "../utils/async-handler";

export function registerAuthRoutes(app: Express): void {
  app.post("/api/auth/login", authLoginRateLimiter, asyncHandler(async (req: Request, res: Response) => {
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

    await storage.ensureUserContractorEntry(
      user.id,
      user.contractorId,
      user.role,
      user.canManageIntegrations || false
    );

    const token = AuthService.generateToken({
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      contractorId: user.contractorId,
      canManageIntegrations: user.canManageIntegrations || false
    });

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        contractorId: user.contractorId!
      },
      message: "Login successful"
    });
  }));

  app.post("/api/auth/register", authRegisterRateLimiter, async (req: Request, res: Response) => {
    try {
      const { contractorName, ...userData } = req.body;

      delete userData.role;

      if (userData.contractorId) {
        res.status(400).json({
          message: "Direct contractor assignment not allowed. Please request an invitation from your administrator."
        });
        return;
      }

      if (!contractorName) {
        res.status(400).json({ message: "Company name is required" });
        return;
      }

      const domain = contractorName.toLowerCase().replace(/[^a-z0-9]/g, '-');

      const existingContractor = await storage.getContractorByDomain(domain);
      if (existingContractor) {
        res.status(400).json({
          message: "Company already exists. Please contact your administrator for an invitation."
        });
        return;
      }

      const userByUsername = await storage.getUserByUsername(userData.username);
      const userByEmail = userData.email ? await storage.getUserByEmail(userData.email) : undefined;

      if (userByUsername && (!userByEmail || userByUsername.id !== userByEmail.id)) {
        res.status(400).json({
          message: "Username already taken. Please choose a different username."
        });
        return;
      }

      const existingUser = userByEmail || null;
      const userRole: 'user' = 'user';

      if (existingUser) {
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
        try {
          insertUserSchema.parse({
            ...userData,
            contractorId: 'validation-only',
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

      const newContractor = await storage.createContractor({ name: contractorName, domain });
      const contractorId = newContractor.id;

      let user: any;

      if (existingUser) {
        user = existingUser;

        const existingMembership = await storage.getUserContractor(user.id, contractorId);
        if (existingMembership) {
          res.status(400).json({ message: "You are already a member of this company." });
          return;
        }

        await storage.addUserToContractor({
          userId: user.id,
          contractorId,
          role: userRole,
          canManageIntegrations: (userRole as string) === 'admin',
        });

        console.log(`[Registration] Existing user ${user.email} added to new contractor ${contractorName}`);
      } else {
        const parsedUserData = insertUserSchema.parse({
          ...userData,
          contractorId,
          role: userRole,
        });

        user = await storage.createUser(parsedUserData);

        if (!user.contractorId) {
          res.status(500).json({ message: "User registration failed - no contractor assigned" });
          return;
        }

        await storage.addUserToContractor({
          userId: user.id,
          contractorId: user.contractorId,
          role: userRole,
          canManageIntegrations: (userRole as string) === 'admin',
        });

        try {
          await sendGridService.sendWelcomeEmail(user.email, user.name);
        } catch (emailError) {
          console.error('Failed to send welcome email:', emailError);
        }

        console.log(`[Registration] New user ${user.email} created and added to contractor ${contractorName}`);
      }

      const token = AuthService.generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: userRole,
        contractorId
      });

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
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

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie('auth_token');
    res.json({ message: "Logged out successfully" });
  });

  app.post("/api/auth/forgot-password", authForgotPasswordRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const userResult = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .orderBy(desc(users.createdAt))
      .limit(1);

    if (userResult.length === 0) {
      res.json({ message: "If an account exists with that email, you will receive a password reset link" });
      return;
    }

    const user = userResult[0];
    const resetToken = nodeCrypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.insert(passwordResetTokens).values({ userId: user.id, token: resetToken, expiresAt });
    await sendGridService.sendPasswordResetEmail(user.email, user.name, resetToken);

    res.json({ message: "If an account exists with that email, you will receive a password reset link" });
  }));

  app.post("/api/auth/reset-password", authForgotPasswordRateLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ message: "Token and new password are required" });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ message: "Password must be at least 8 characters long" });
      return;
    }

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

    if (new Date() > resetTokenRecord.expiresAt) {
      res.status(400).json({ message: "Reset token has expired" });
      return;
    }

    if (resetTokenRecord.usedAt) {
      res.status(400).json({ message: "Reset token has already been used" });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, resetTokenRecord.userId));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, resetTokenRecord.id));

    const userResult = await db.select().from(users).where(eq(users.id, resetTokenRecord.userId)).limit(1);
    if (userResult.length > 0) {
      await sendGridService.sendPasswordChangedEmail(userResult[0].email, userResult[0].name);
    }

    res.json({ message: "Password reset successful" });
  }));

  app.get("/api/auth/me", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    const fullUser = await storage.getUser(req.user.userId);
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
  }));
}
