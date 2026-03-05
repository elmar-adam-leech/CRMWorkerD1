import {
  type TerminologySettings, type InsertTerminologySettings,
  terminologySettings,
} from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import type { UpdateTerminologySettings } from "../storage-types";

async function getTerminologySettings(contractorId: string): Promise<TerminologySettings | undefined> {
  const result = await db.select().from(terminologySettings).where(eq(terminologySettings.contractorId, contractorId)).limit(1);
  return result[0];
}

async function createTerminologySettings(settings: Omit<InsertTerminologySettings, 'contractorId'>, contractorId: string): Promise<TerminologySettings> {
  const result = await db.insert(terminologySettings).values({ ...settings, contractorId }).returning();
  return result[0]!;
}

async function updateTerminologySettings(settings: UpdateTerminologySettings, contractorId: string): Promise<TerminologySettings | undefined> {
  const result = await db.update(terminologySettings).set({ ...settings, updatedAt: new Date() }).where(eq(terminologySettings.contractorId, contractorId)).returning();
  return result[0];
}

export const settingsMethods = {
  getTerminologySettings,
  createTerminologySettings,
  updateTerminologySettings,
};
