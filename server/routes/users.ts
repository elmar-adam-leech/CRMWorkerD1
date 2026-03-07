import type { Express } from "express";
import { asyncHandler } from "../utils/async-handler";
import { storage } from "../storage";
import { users, userContractors, contractors } from "@shared/schema";
import { db } from "../db";
import { eq, and, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireManagerOrAdmin, requireAdmin } from "../auth-service";
import bcrypt from "bcrypt";

const createUserBodySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email format").max(500),
  username: z.string().min(2, "Username must be at least 2 characters").max(100),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  role: z.enum(['user', 'manager', 'admin']).optional(),
});

export function registerUserRoutes(app: Express): void {
  app.get("/api/users", requireAuth, requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const contractorUsers = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: userContractors.role,
        contractorId: userContractors.contractorId,
        dialpadDefaultNumber: userContractors.dialpadDefaultNumber,
        canManageIntegrations: userContractors.canManageIntegrations,
        createdAt: users.createdAt
      })
      .from(userContractors)
      .innerJoin(users, eq(userContractors.userId, users.id))
      .where(eq(userContractors.contractorId, req.user.contractorId));

    res.json(contractorUsers);
  }));

  app.post("/api/users", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const parseResult = createUserBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      res.status(400).json({ message: `Validation failed: ${errors}` });
      return;
    }
    const { name, email, password, role, username } = parseResult.data;

    const existingUserForContractor = await storage.getUserByEmailAndContractor(email, req.user.contractorId);
    if (existingUserForContractor) {
      res.status(400).json({ message: "User with this email already exists in your organization" });
      return;
    }

    const [existingUsername, existingGlobalUser] = await Promise.all([
      storage.getUserByUsername(username),
      storage.getUserByEmail(email),
    ]);

    if (existingUsername && existingGlobalUser && existingUsername.id === existingGlobalUser.id) {
      const newUser = existingGlobalUser;
      const isPasswordValid = await bcrypt.compare(password, newUser.password);
      if (!isPasswordValid) {
        res.status(401).json({ message: "Invalid password for existing account" });
        return;
      }
      await storage.addUserToContractor({
        userId: newUser.id,
        contractorId: req.user.contractorId,
        role: role || 'user',
        canManageIntegrations: role === 'admin',
      });
      res.status(201).json({
        id: newUser.id,
        username: newUser.username,
        name: newUser.name,
        email: newUser.email,
        role: role || 'user',
        contractorId: req.user.contractorId,
        createdAt: newUser.createdAt,
        message: "Existing user added to organization"
      });
      return;
    }

    if (existingUsername && (!existingGlobalUser || existingUsername.id !== existingGlobalUser.id)) {
      res.status(400).json({ message: "Username already taken" });
      return;
    }

    if (existingGlobalUser && !existingUsername) {
      res.status(400).json({ message: "User with this email exists but username doesn't match" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.insert(users).values({
      name,
      email,
      username,
      password: hashedPassword,
      role: role || 'user',
      contractorId: req.user.contractorId
    }).returning().then(result => result[0]);

    await storage.addUserToContractor({
      userId: newUser.id,
      contractorId: req.user.contractorId,
      role: role || 'user',
      canManageIntegrations: role === 'admin',
    });

    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      email: newUser.email,
      role: role || 'user',
      contractorId: req.user.contractorId,
      createdAt: newUser.createdAt
    });
  }));

  app.patch("/api/users/:userId/role", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;

    const isSuperAdmin = req.user.role === 'super_admin';
    const allowedRoles = isSuperAdmin ? ['user', 'manager', 'admin'] : ['user', 'manager'];

    if (!role || !allowedRoles.includes(role)) {
      const rolesDescription = isSuperAdmin ? 'user, manager, or admin' : 'user or manager';
      res.status(400).json({ message: `Invalid role. Must be ${rolesDescription}` });
      return;
    }

    const userContractor = await db.select().from(userContractors)
      .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, req.user.contractorId)))
      .limit(1);

    if (userContractor.length === 0) {
      res.status(404).json({ message: "User not found in your organization" });
      return;
    }

    const updated = await db.update(userContractors)
      .set({ role })
      .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, req.user.contractorId)))
      .returning();

    res.json({
      userId: updated[0].userId,
      role: updated[0].role,
      contractorId: updated[0].contractorId,
      message: "User role updated successfully"
    });
  }));

  app.patch("/api/users/:userId/dialpad-number", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { dialpadDefaultNumber } = req.body;

    const targetUser = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.contractorId, req.user.contractorId)))
      .limit(1);

    if (!targetUser[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const updated = await db.update(users)
      .set({ dialpadDefaultNumber })
      .where(eq(users.id, userId))
      .returning();

    if (dialpadDefaultNumber && targetUser[0].role !== 'admin' && targetUser[0].role !== 'manager') {
      const phoneNumber = await storage.getDialpadPhoneNumberByNumber(req.user.contractorId, dialpadDefaultNumber);
      if (phoneNumber) {
        const existingPermission = await storage.getUserPhoneNumberPermission(userId, phoneNumber.id);
        if (existingPermission) {
          await storage.updateUserPhoneNumberPermission(existingPermission.id, {
            canSendSms: true,
            canMakeCalls: true,
            isActive: true
          });
        } else {
          await storage.createUserPhoneNumberPermission({
            contractorId: req.user.contractorId,
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
  }));

  app.get("/api/users/:userId", requireAuth, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const contractorId = req.user.contractorId;

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
  }));

  app.get("/api/users/gmail-connected", requireAuth, asyncHandler(async (req, res) => {
    const contractorId = req.user.contractorId;

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
  }));

  app.patch("/api/users/:userId/integration-permission", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { canManageIntegrations } = req.body;

    if (typeof canManageIntegrations !== 'boolean') {
      res.status(400).json({ message: "canManageIntegrations must be a boolean" });
      return;
    }

    const targetUser = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.contractorId, req.user.contractorId)))
      .limit(1);

    if (!targetUser[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }

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
  }));

  app.get("/api/users/me/dialpad-default-number", requireAuth, asyncHandler(async (req, res) => {
    const user = await db.select().from(users).where(eq(users.id, req.user.userId)).limit(1);
    if (!user[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json({ dialpadDefaultNumber: user[0].dialpadDefaultNumber || null });
  }));

  app.put("/api/users/me/dialpad-default-number", requireAuth, asyncHandler(async (req, res) => {
    const { dialpadDefaultNumber } = req.body;

    if (dialpadDefaultNumber !== null && typeof dialpadDefaultNumber !== 'string') {
      res.status(400).json({ message: "Invalid phone number format" });
      return;
    }

    const result = await db
      .update(users)
      .set({ dialpadDefaultNumber: dialpadDefaultNumber || null })
      .where(eq(users.id, req.user.userId))
      .returning();

    if (!result[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json({
      dialpadDefaultNumber: result[0].dialpadDefaultNumber,
      message: dialpadDefaultNumber ? "Default number updated successfully" : "Default number cleared successfully"
    });
  }));

  app.put("/api/users/:userId/dialpad-default-number", requireAuth, requireManagerOrAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { dialpadDefaultNumber } = req.body;

    if (dialpadDefaultNumber !== null && typeof dialpadDefaultNumber !== 'string') {
      res.status(400).json({ message: "Invalid phone number format" });
      return;
    }

    const targetUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!targetUser[0]) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (targetUser[0].contractorId !== req.user.contractorId) {
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
  }));

  app.get("/api/contractor/dialpad-default-number", requireAuth, asyncHandler(async (req, res) => {
    const contractor = await db.select().from(contractors)
      .where(eq(contractors.id, req.user.contractorId))
      .limit(1);

    if (!contractor[0]) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }

    res.json({ defaultDialpadNumber: contractor[0].defaultDialpadNumber || null });
  }));

  app.put("/api/contractor/dialpad-default-number", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const { defaultDialpadNumber } = req.body;

    if (defaultDialpadNumber !== null && typeof defaultDialpadNumber !== 'string') {
      res.status(400).json({ message: "Invalid phone number format" });
      return;
    }

    const result = await db
      .update(contractors)
      .set({ defaultDialpadNumber: defaultDialpadNumber || null })
      .where(eq(contractors.id, req.user.contractorId))
      .returning();

    if (!result[0]) {
      res.status(404).json({ message: "Contractor not found" });
      return;
    }

    res.json({
      defaultDialpadNumber: result[0].defaultDialpadNumber,
      message: defaultDialpadNumber ? "Organization default number updated successfully" : "Organization default number cleared successfully"
    });
  }));

  app.patch("/api/user/call-preference", requireAuth, asyncHandler(async (req, res) => {
    const { callPreference } = req.body;
    if (callPreference !== 'integration' && callPreference !== 'personal') {
      res.status(400).json({ message: "callPreference must be 'integration' or 'personal'" });
      return;
    }

    const result = await db
      .update(userContractors)
      .set({ callPreference })
      .where(and(
        eq(userContractors.userId, req.user.userId),
        eq(userContractors.contractorId, req.user.contractorId)
      ))
      .returning();

    if (!result[0]) {
      res.status(404).json({ message: "User contractor record not found" });
      return;
    }

    res.json({ callPreference: result[0].callPreference, message: "Call preference updated" });
  }));
}
