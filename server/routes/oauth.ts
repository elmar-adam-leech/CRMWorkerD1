import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { gmailService } from "../gmail-service";
import { AuthService, requireAuth, type AuthenticatedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";

export function registerOAuthRoutes(app: Express): void {
  app.get("/api/oauth/gmail/connect", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    if (!gmailService.isConfigured()) {
      res.status(500).json({
        message: "Gmail integration not configured. Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables."
      });
      return;
    }

    try {
      gmailService.validateEncryptionKey();
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Encryption key not configured"
      });
      return;
    }

    const host = req.get('host');
    if (!host) {
      res.status(400).json({ message: "Unable to determine request host" });
      return;
    }

    if (!gmailService.validateHost(host)) {
      console.error(`[Gmail OAuth] Invalid host: ${host}`);
      res.status(403).json({
        message: `Invalid domain. OAuth is only allowed from approved domains.`
      });
      return;
    }

    console.log(`[Gmail OAuth] Initiating OAuth for user ${req.user.userId} from host ${host}`);

    const authUrl = await gmailService.generateAuthUrl(req.user.userId, host);
    res.json({ authUrl });
  }));

  app.get("/api/oauth/gmail/callback", asyncHandler(async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).send('Missing authorization code or state parameter');
      return;
    }

    const stateData = await gmailService.getStateData(state as string);
    if (!stateData) {
      console.error('[Gmail OAuth] Invalid or expired state token');
      res.status(403).send('Invalid or expired state parameter');
      return;
    }

    const { userId, redirectHost } = stateData;

    const user = await storage.getUser(userId);
    if (!user) {
      res.status(404).send('User not found');
      return;
    }

    console.log(`[Gmail OAuth] Processing callback for user ${userId}, will redirect to ${redirectHost}`);

    const result = await gmailService.exchangeCodeForTokens(code as string, redirectHost);

    if (!result.refreshToken) {
      console.error('[Gmail OAuth] No refresh token received for user:', userId);
      const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
      res.redirect(`${protocol}://${redirectHost}/settings?gmail=error&reason=no_refresh_token`);
      return;
    }

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

    if (contractorId) {
      const { syncScheduler } = await import('../sync-scheduler');
      await syncScheduler.onIntegrationEnabled(contractorId, 'gmail');
      console.log(`[Gmail OAuth] Enabled automatic email syncing for contractor ${contractorId}`);
    }

    const protocol = redirectHost.startsWith('localhost') ? 'http' : 'https';
    res.redirect(`${protocol}://${redirectHost}/settings?gmail=connected`);
  }));

  app.post("/api/oauth/gmail/disconnect", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

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
  }));

  app.get("/api/user/contractors", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userContractors = await storage.getUserContractors(req.user.userId);

    // Batch-fetch all contractors in a single query instead of N individual lookups
    const contractorList = await storage.getContractorsByIds(userContractors.map(uc => uc.contractorId));
    const contractorMap = new Map(contractorList.map(c => [c.id, c]));
    const contractorsWithDetails = userContractors.map(uc => ({ ...uc, contractor: contractorMap.get(uc.contractorId) }));

    res.json(contractorsWithDetails);
  }));

  app.post("/api/user/switch-contractor", requireAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { contractorId } = req.body;

    if (!contractorId) {
      res.status(400).json({ message: "Contractor ID is required" });
      return;
    }

    const updatedUser = await storage.switchContractor(req.user.userId, contractorId);

    if (!updatedUser) {
      res.status(404).json({ message: "User or contractor not found" });
      return;
    }

    const userContractor = await storage.getUserContractor(req.user.userId, contractorId);
    if (!userContractor) {
      res.status(403).json({ message: "Access denied to this contractor" });
      return;
    }

    const newToken = AuthService.generateToken({
      id: updatedUser.id,
      username: updatedUser.username,
      name: updatedUser.name,
      email: updatedUser.email,
      role: userContractor.role,
      contractorId: contractorId,
      canManageIntegrations: userContractor.canManageIntegrations || false,
      tokenVersion: updatedUser.tokenVersion ?? 1,
    });

    res.cookie('auth_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: "Contractor switched successfully",
      contractorId: updatedUser.contractorId,
      token: newToken
    });
  }));
}
