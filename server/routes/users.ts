import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { insertUserSchema, users, userContractors, dialpadPhoneNumbers, contractors } from "@shared/schema";
import { db } from "../db";
import { eq, and, isNotNull } from "drizzle-orm";
import { dialpadService } from "../dialpad-service";
import { AuthService, requireAuth, requireManagerOrAdmin, requireAdmin, type AuthenticatedRequest } from "../auth-service";
import { CredentialService } from "../credential-service";
import bcrypt from "bcrypt";

export function registerUserRoutes(app: Express): void {
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
}
