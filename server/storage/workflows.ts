import {
  type Workflow, type InsertWorkflow,
  type WorkflowStep, type InsertWorkflowStep,
  type WorkflowExecution, type InsertWorkflowExecution,
  type Contact,
  type Estimate,
  type Job,
  workflows, workflowSteps, workflowExecutions, contacts, estimates, jobs, userContractors,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, asc } from "drizzle-orm";
import type { UpdateWorkflow, UpdateWorkflowStep, UpdateWorkflowExecution } from "../storage-types";

async function getWorkflows(contractorId: string, approvalStatus?: string): Promise<Workflow[]> {
  const conditions = [eq(workflows.contractorId, contractorId)];
  if (approvalStatus && approvalStatus !== 'all') {
    conditions.push(eq(workflows.approvalStatus, approvalStatus as any));
  }
  return await db.select().from(workflows).where(and(...conditions)).orderBy(desc(workflows.createdAt)).limit(500);
}

async function getActiveWorkflows(contractorId: string): Promise<Workflow[]> {
  return await db.select().from(workflows).where(and(
    eq(workflows.contractorId, contractorId),
    eq(workflows.isActive, true)
  )).orderBy(desc(workflows.createdAt)).limit(500);
}

async function getActiveApprovedWorkflows(contractorId: string): Promise<Workflow[]> {
  return await db.select().from(workflows).where(and(
    eq(workflows.contractorId, contractorId),
    eq(workflows.isActive, true),
    eq(workflows.approvalStatus, 'approved')
  )).orderBy(desc(workflows.createdAt)).limit(500);
}

async function getWorkflowsPendingApproval(contractorId: string): Promise<Workflow[]> {
  return await db.select().from(workflows).where(and(
    eq(workflows.contractorId, contractorId),
    eq(workflows.approvalStatus, 'pending_approval')
  )).orderBy(desc(workflows.createdAt)).limit(500);
}

async function getWorkflow(id: string, contractorId: string): Promise<Workflow | undefined> {
  const result = await db.select().from(workflows).where(and(
    eq(workflows.id, id),
    eq(workflows.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function createWorkflow(workflow: Omit<InsertWorkflow, 'contractorId'>, contractorId: string, userId: string): Promise<Workflow> {
  const userContractor = await db.select().from(userContractors).where(and(
    eq(userContractors.userId, userId),
    eq(userContractors.contractorId, contractorId)
  )).limit(1);

  const uc = userContractor[0];
  const isAdminOrManager = uc && (uc.role === 'admin' || uc.role === 'manager' || uc.role === 'super_admin');

  const result = await db.insert(workflows).values({
    ...workflow,
    contractorId,
    createdBy: userId,
    approvalStatus: isAdminOrManager ? 'approved' : 'pending_approval',
    approvedBy: isAdminOrManager ? userId : null,
    approvedAt: isAdminOrManager ? new Date() : null,
  }).returning();
  return result[0];
}

async function updateWorkflow(id: string, workflow: UpdateWorkflow, contractorId: string): Promise<Workflow | undefined> {
  const result = await db.update(workflows)
    .set({ ...workflow, updatedAt: new Date() })
    .where(and(eq(workflows.id, id), eq(workflows.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteWorkflow(id: string, contractorId: string): Promise<boolean> {
  const result = await db.delete(workflows).where(and(
    eq(workflows.id, id),
    eq(workflows.contractorId, contractorId)
  )).returning();
  return result.length > 0;
}

async function approveWorkflow(id: string, contractorId: string, approvedByUserId: string): Promise<Workflow | undefined> {
  const result = await db.update(workflows).set({
    approvalStatus: 'approved',
    approvedBy: approvedByUserId,
    approvedAt: new Date(),
    rejectionReason: null,
    updatedAt: new Date()
  }).where(and(eq(workflows.id, id), eq(workflows.contractorId, contractorId))).returning();
  return result[0];
}

async function rejectWorkflow(id: string, contractorId: string, rejectedByUserId: string, rejectionReason?: string): Promise<Workflow | undefined> {
  const result = await db.update(workflows).set({
    approvalStatus: 'rejected',
    approvedBy: rejectedByUserId,
    approvedAt: new Date(),
    rejectionReason: rejectionReason || null,
    updatedAt: new Date()
  }).where(and(eq(workflows.id, id), eq(workflows.contractorId, contractorId))).returning();
  return result[0];
}

async function getWorkflowSteps(workflowId: string): Promise<WorkflowStep[]> {
  return await db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflowId)).orderBy(asc(workflowSteps.stepOrder)).limit(200);
}

async function getWorkflowStep(id: string): Promise<WorkflowStep | undefined> {
  const result = await db.select().from(workflowSteps).where(eq(workflowSteps.id, id)).limit(1);
  return result[0];
}

async function createWorkflowStep(step: InsertWorkflowStep): Promise<WorkflowStep> {
  const result = await db.insert(workflowSteps).values(step).returning();
  return result[0];
}

async function updateWorkflowStep(id: string, step: UpdateWorkflowStep): Promise<WorkflowStep | undefined> {
  const result = await db.update(workflowSteps).set({ ...step, updatedAt: new Date() }).where(eq(workflowSteps.id, id)).returning();
  return result[0];
}

async function deleteWorkflowStep(id: string): Promise<boolean> {
  const result = await db.delete(workflowSteps).where(eq(workflowSteps.id, id)).returning();
  return result.length > 0;
}

async function deleteWorkflowSteps(workflowId: string): Promise<boolean> {
  const result = await db.delete(workflowSteps).where(eq(workflowSteps.workflowId, workflowId)).returning();
  return result.length > 0;
}

async function bulkCreateWorkflowSteps(steps: InsertWorkflowStep[]): Promise<WorkflowStep[]> {
  if (steps.length === 0) return [];
  return await db.insert(workflowSteps).values(steps).returning();
}

async function getWorkflowExecutions(workflowId: string, contractorId: string, limit: number = 50): Promise<WorkflowExecution[]> {
  return await db.select().from(workflowExecutions).where(and(
    eq(workflowExecutions.workflowId, workflowId),
    eq(workflowExecutions.contractorId, contractorId)
  )).orderBy(desc(workflowExecutions.createdAt)).limit(limit);
}

async function getWorkflowExecution(id: string, contractorId: string): Promise<WorkflowExecution | undefined> {
  const result = await db.select().from(workflowExecutions).where(and(
    eq(workflowExecutions.id, id),
    eq(workflowExecutions.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function getRecentWorkflowExecutions(contractorId: string, limit: number = 50): Promise<WorkflowExecution[]> {
  return await db.select().from(workflowExecutions).where(eq(workflowExecutions.contractorId, contractorId)).orderBy(desc(workflowExecutions.createdAt)).limit(limit);
}

async function createWorkflowExecution(execution: Omit<InsertWorkflowExecution, 'contractorId'>, contractorId: string): Promise<WorkflowExecution> {
  const result = await db.insert(workflowExecutions).values({ ...execution, contractorId }).returning();
  return result[0];
}

async function updateWorkflowExecution(id: string, execution: UpdateWorkflowExecution, contractorId: string): Promise<WorkflowExecution | undefined> {
  const result = await db.update(workflowExecutions).set(execution).where(and(
    eq(workflowExecutions.id, id),
    eq(workflowExecutions.contractorId, contractorId)
  )).returning();
  return result[0];
}

async function getEstimateWithContact(id: string, contractorId: string): Promise<any> {
  const result = await db.select().from(estimates).leftJoin(contacts, eq(estimates.contactId, contacts.id)).where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId))).limit(1);
  if (!result[0]) return undefined;
  const { estimates: estimate, contacts: contact } = result[0];
  return { ...estimate, contact: contact || undefined };
}

async function getJobWithContact(id: string, contractorId: string): Promise<any> {
  const result = await db.select().from(jobs).leftJoin(contacts, eq(jobs.contactId, contacts.id)).where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId))).limit(1);
  if (!result[0]) return undefined;
  const { jobs: job, contacts: contact } = result[0];
  return { ...job, contact: contact || undefined };
}

export const workflowMethods = {
  getWorkflows,
  getActiveWorkflows,
  getActiveApprovedWorkflows,
  getWorkflowsPendingApproval,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  approveWorkflow,
  rejectWorkflow,
  getWorkflowSteps,
  getWorkflowStep,
  createWorkflowStep,
  bulkCreateWorkflowSteps,
  updateWorkflowStep,
  deleteWorkflowStep,
  deleteWorkflowSteps,
  getWorkflowExecutions,
  getWorkflowExecution,
  getRecentWorkflowExecutions,
  createWorkflowExecution,
  updateWorkflowExecution,
  getEstimateWithContact,
  getJobWithContact,
};
