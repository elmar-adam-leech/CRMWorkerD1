import {
  type Contact, type InsertContact,
  type Estimate, type InsertEstimate,
  type ContractorCredential, type InsertContractorCredential,
  type ContractorProvider,
  type ContractorIntegration,
  type Employee, type InsertEmployee, type UpdateEmployeeRoles,
  type BusinessTargets, type InsertBusinessTargets,
  contractorCredentials, contractorProviders, contractorIntegrations,
  contacts, estimates, employees, businessTargets, contractors, jobs,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import type { UpdateEmployee, UpdateBusinessTargets } from "../storage-types";

function mapExternalRoleToInternalRoles(externalRole: string): string[] {
  const role = externalRole.toLowerCase();
  if (role.includes('field') || role.includes('technician')) return ['technician'];
  else if (role.includes('estimator')) return ['estimator'];
  else if (role.includes('sales')) return ['sales'];
  else if (role.includes('dispatch')) return ['dispatcher'];
  else if (role.includes('admin') || role.includes('manager')) return ['manager'];
  return ['technician'];
}

// Contractor credential operations
async function getContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<ContractorCredential | undefined> {
  const result = await db.select().from(contractorCredentials).where(and(
    eq(contractorCredentials.contractorId, contractorId),
    eq(contractorCredentials.service, service),
    eq(contractorCredentials.credentialKey, credentialKey)
  )).limit(1);
  return result[0];
}

async function getContractorServiceCredentials(contractorId: string, service: string): Promise<ContractorCredential[]> {
  return await db.select().from(contractorCredentials).where(and(
    eq(contractorCredentials.contractorId, contractorId),
    eq(contractorCredentials.service, service)
  ));
}

async function setContractorCredential(contractorId: string, service: string, credentialKey: string, encryptedValue: string): Promise<ContractorCredential> {
  const existing = await getContractorCredential(contractorId, service, credentialKey);
  if (existing) {
    const result = await db.update(contractorCredentials).set({ encryptedValue, isActive: true, updatedAt: new Date() }).where(and(
      eq(contractorCredentials.contractorId, contractorId),
      eq(contractorCredentials.service, service),
      eq(contractorCredentials.credentialKey, credentialKey)
    )).returning();
    return result[0];
  } else {
    const result = await db.insert(contractorCredentials).values({ contractorId, service, credentialKey, encryptedValue, isActive: true }).returning();
    return result[0];
  }
}

async function disableContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<void> {
  await db.update(contractorCredentials).set({ isActive: false, updatedAt: new Date() }).where(and(
    eq(contractorCredentials.contractorId, contractorId),
    eq(contractorCredentials.service, service),
    eq(contractorCredentials.credentialKey, credentialKey)
  ));
}

// Tenant provider operations
async function getTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined> {
  const result = await db.select().from(contractorProviders).where(and(
    eq(contractorProviders.contractorId, contractorId),
    eq(contractorProviders.providerType, providerType),
    eq(contractorProviders.isActive, true)
  )).limit(1);
  return result[0];
}

async function setTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider> {
  const existingResult = await db.select().from(contractorProviders).where(and(
    eq(contractorProviders.contractorId, contractorId),
    eq(contractorProviders.providerType, providerType)
  )).limit(1);
  const existing = existingResult[0];

  if (existing) {
    const updateData: any = { isActive: true, updatedAt: new Date() };
    if (providerType === 'email') updateData.emailProvider = providerName;
    else if (providerType === 'sms') updateData.smsProvider = providerName;
    else if (providerType === 'calling') updateData.callingProvider = providerName;
    const result = await db.update(contractorProviders).set(updateData).where(and(
      eq(contractorProviders.contractorId, contractorId),
      eq(contractorProviders.providerType, providerType)
    )).returning();
    return result[0];
  } else {
    const insertData: any = { contractorId, providerType, isActive: true };
    if (providerType === 'email') insertData.emailProvider = providerName;
    else if (providerType === 'sms') insertData.smsProvider = providerName;
    else if (providerType === 'calling') insertData.callingProvider = providerName;
    const result = await db.insert(contractorProviders).values(insertData).returning();
    return result[0];
  }
}

async function getTenantProviders(contractorId: string): Promise<ContractorProvider[]> {
  return await db.select().from(contractorProviders).where(and(
    eq(contractorProviders.contractorId, contractorId),
    eq(contractorProviders.isActive, true)
  ));
}

async function disableTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void> {
  await db.update(contractorProviders).set({ isActive: false, updatedAt: new Date() }).where(and(
    eq(contractorProviders.contractorId, contractorId),
    eq(contractorProviders.providerType, providerType)
  ));
}

// Tenant integration enablement operations
async function getTenantIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined> {
  const result = await db.select().from(contractorIntegrations).where(and(
    eq(contractorIntegrations.contractorId, contractorId),
    eq(contractorIntegrations.integrationName, integrationName)
  )).limit(1);
  return result[0];
}

async function getTenantIntegrations(contractorId: string): Promise<ContractorIntegration[]> {
  return await db.select().from(contractorIntegrations).where(eq(contractorIntegrations.contractorId, contractorId)).orderBy(asc(contractorIntegrations.integrationName));
}

async function getEnabledIntegrations(contractorId: string): Promise<ContractorIntegration[]> {
  return await db.select().from(contractorIntegrations).where(and(
    eq(contractorIntegrations.contractorId, contractorId),
    eq(contractorIntegrations.isEnabled, true)
  )).orderBy(asc(contractorIntegrations.integrationName));
}

async function enableTenantIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration> {
  const now = new Date();
  const existing = await getTenantIntegration(contractorId, integrationName);
  if (existing) {
    const result = await db.update(contractorIntegrations).set({ isEnabled: true, enabledAt: now, disabledAt: null, enabledBy, updatedAt: now }).where(and(
      eq(contractorIntegrations.contractorId, contractorId),
      eq(contractorIntegrations.integrationName, integrationName)
    )).returning();
    return result[0];
  } else {
    const result = await db.insert(contractorIntegrations).values({ contractorId, integrationName, isEnabled: true, enabledAt: now, enabledBy, createdAt: now, updatedAt: now }).returning();
    return result[0];
  }
}

async function disableTenantIntegration(contractorId: string, integrationName: string): Promise<void> {
  const now = new Date();
  await db.update(contractorIntegrations).set({ isEnabled: false, disabledAt: now, updatedAt: now }).where(and(
    eq(contractorIntegrations.contractorId, contractorId),
    eq(contractorIntegrations.integrationName, integrationName)
  ));
}

async function isIntegrationEnabled(contractorId: string, integrationName: string): Promise<boolean> {
  const result = await db.select({ isEnabled: contractorIntegrations.isEnabled }).from(contractorIntegrations).where(and(
    eq(contractorIntegrations.contractorId, contractorId),
    eq(contractorIntegrations.integrationName, integrationName)
  )).limit(1);
  return result[0]?.isEnabled ?? false;
}

// Housecall Pro integration operations
async function getContactByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Contact | undefined> {
  const result = await db.select().from(contacts).where(and(
    eq(contacts.housecallProEstimateId, housecallProEstimateId),
    eq(contacts.contractorId, contractorId),
    eq(contacts.type, 'lead')
  )).limit(1);
  return result[0];
}

async function getEstimateByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Estimate | undefined> {
  const result = await db.select().from(estimates).where(and(
    eq(estimates.externalId, housecallProEstimateId),
    eq(estimates.externalSource, 'housecall-pro'),
    eq(estimates.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function getEstimatesByHousecallProIds(housecallProEstimateIds: string[], contractorId: string): Promise<Map<string, Estimate>> {
  if (housecallProEstimateIds.length === 0) return new Map();
  const result = await db.select().from(estimates).where(and(
    inArray(estimates.externalId, housecallProEstimateIds),
    eq(estimates.externalSource, 'housecall-pro'),
    eq(estimates.contractorId, contractorId)
  ));
  const estimateMap = new Map<string, Estimate>();
  for (const estimate of result) {
    if (estimate.externalId) estimateMap.set(estimate.externalId, estimate);
  }
  return estimateMap;
}

async function getScheduledContacts(contractorId: string): Promise<Contact[]> {
  return await db.select().from(contacts).where(and(
    eq(contacts.contractorId, contractorId),
    eq(contacts.isScheduled, true),
    eq(contacts.type, 'lead')
  )).orderBy(desc(contacts.scheduledAt));
}

async function getUnscheduledContacts(contractorId: string): Promise<Contact[]> {
  return await db.select().from(contacts).where(and(
    eq(contacts.contractorId, contractorId),
    eq(contacts.isScheduled, false),
    eq(contacts.type, 'lead')
  )).orderBy(desc(contacts.createdAt));
}

async function scheduleContactAsEstimate(contactId: string, housecallProData: {
  housecallProCustomerId: string;
  housecallProEstimateId: string;
  scheduledAt: Date;
  scheduledEmployeeId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  description?: string;
}, contractorId: string): Promise<{ contact: Contact; estimate: Estimate } | undefined> {
  const originalContact = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.contractorId, contractorId))).limit(1);
  if (!originalContact[0]) return undefined;

  return await db.transaction(async (tx) => {
    const [updatedContact] = await tx.update(contacts).set({
      housecallProCustomerId: housecallProData.housecallProCustomerId,
      housecallProEstimateId: housecallProData.housecallProEstimateId,
      scheduledAt: housecallProData.scheduledAt,
      scheduledEmployeeId: housecallProData.scheduledEmployeeId,
      isScheduled: true,
      updatedAt: new Date()
    }).where(and(eq(contacts.id, contactId), eq(contacts.contractorId, contractorId))).returning();

    const [newEstimate] = await tx.insert(estimates).values({
      title: `Estimate for ${originalContact[0].name}`,
      contactId: contactId,
      description: housecallProData.description || `Estimate for ${originalContact[0].name}`,
      amount: '0.00',
      status: 'draft',
      contractorId: contractorId,
      externalId: housecallProData.housecallProEstimateId,
      externalSource: 'housecall-pro',
      scheduledStart: housecallProData.scheduledStart,
      scheduledEnd: housecallProData.scheduledEnd,
      syncedAt: new Date()
    }).returning();

    return { contact: updatedContact, estimate: newEstimate };
  });
}

// Employee operations
async function getEmployees(contractorId: string): Promise<Employee[]> {
  return await db.select().from(employees).where(eq(employees.contractorId, contractorId)).orderBy(asc(employees.lastName), asc(employees.firstName));
}

async function getEmployee(id: string, contractorId: string): Promise<Employee | undefined> {
  const result = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.contractorId, contractorId))).limit(1);
  return result[0];
}

async function getEmployeeByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Employee | undefined> {
  const result = await db.select().from(employees).where(and(
    eq(employees.externalId, externalId),
    eq(employees.externalSource, externalSource),
    eq(employees.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function upsertEmployees(employeeData: Omit<InsertEmployee, 'contractorId'>[], contractorId: string): Promise<Employee[]> {
  const results: Employee[] = [];
  for (const empData of employeeData) {
    let existingEmployee: Employee | undefined;
    if (empData.externalId && empData.externalSource) {
      existingEmployee = await getEmployeeByExternalId(empData.externalId, empData.externalSource, contractorId);
    }
    if (existingEmployee) {
      const updateData: UpdateEmployee = {
        firstName: empData.firstName,
        lastName: empData.lastName,
        email: empData.email,
        isActive: empData.isActive,
        externalRole: empData.externalRole,
        ...(existingEmployee.roles.length === 0 && empData.externalRole ? {
          roles: mapExternalRoleToInternalRoles(empData.externalRole)
        } : {})
      };
      const result = await db.update(employees).set(updateData).where(eq(employees.id, existingEmployee.id)).returning();
      results.push(result[0]);
    } else {
      const newEmployee = await db.insert(employees).values({
        ...empData,
        contractorId,
        roles: empData.externalRole ? mapExternalRoleToInternalRoles(empData.externalRole) : [],
        createdAt: new Date(),
        updatedAt: new Date()
      }).returning();
      results.push(newEmployee[0]);
    }
  }
  return results;
}

async function updateEmployeeRoles(id: string, roles: string[], contractorId: string): Promise<Employee | undefined> {
  const result = await db.update(employees).set({ roles, updatedAt: new Date() }).where(and(eq(employees.id, id), eq(employees.contractorId, contractorId))).returning();
  return result[0];
}

// Housecall Pro sync start date operations
async function getHousecallProSyncStartDate(contractorId: string): Promise<Date | null> {
  const result = await db.select({ housecallProSyncStartDate: contractors.housecallProSyncStartDate }).from(contractors).where(eq(contractors.id, contractorId)).limit(1);
  return result[0]?.housecallProSyncStartDate || null;
}

async function setHousecallProSyncStartDate(contractorId: string, syncStartDate: Date | null): Promise<void> {
  await db.update(contractors).set({ housecallProSyncStartDate: syncStartDate }).where(eq(contractors.id, contractorId));
}

// Business targets operations
async function getBusinessTargets(contractorId: string): Promise<BusinessTargets | undefined> {
  const result = await db.select().from(businessTargets).where(eq(businessTargets.contractorId, contractorId)).limit(1);
  return result[0];
}

async function createBusinessTargets(targets: Omit<InsertBusinessTargets, 'contractorId'>, contractorId: string): Promise<BusinessTargets> {
  const result = await db.insert(businessTargets).values({ ...targets, contractorId }).returning();
  return result[0];
}

async function updateBusinessTargets(targets: UpdateBusinessTargets, contractorId: string): Promise<BusinessTargets | undefined> {
  const result = await db.update(businessTargets).set({ ...targets, updatedAt: new Date() }).where(eq(businessTargets.contractorId, contractorId)).returning();
  return result[0];
}

// IStorage interface aliases
async function getContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined> {
  return getTenantProvider(contractorId, providerType);
}
async function setContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider> {
  return setTenantProvider(contractorId, providerType, providerName);
}
async function getContractorProviders(contractorId: string): Promise<ContractorProvider[]> {
  return getTenantProviders(contractorId);
}
async function disableContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void> {
  return disableTenantProvider(contractorId, providerType);
}
async function getContractorIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined> {
  return getTenantIntegration(contractorId, integrationName);
}
async function getContractorIntegrations(contractorId: string): Promise<ContractorIntegration[]> {
  return getTenantIntegrations(contractorId);
}
async function enableContractorIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration> {
  return enableTenantIntegration(contractorId, integrationName, enabledBy);
}
async function disableContractorIntegration(contractorId: string, integrationName: string): Promise<void> {
  return disableTenantIntegration(contractorId, integrationName);
}

export const integrationMethods = {
  getContractorCredential,
  getContractorServiceCredentials,
  setContractorCredential,
  disableContractorCredential,
  getTenantProvider,
  setTenantProvider,
  getTenantProviders,
  disableTenantProvider,
  getTenantIntegration,
  getTenantIntegrations,
  getEnabledIntegrations,
  enableTenantIntegration,
  disableTenantIntegration,
  isIntegrationEnabled,
  getContactByHousecallProEstimateId,
  getEstimateByHousecallProEstimateId,
  getEstimatesByHousecallProIds,
  getScheduledContacts,
  getUnscheduledContacts,
  scheduleContactAsEstimate,
  getEmployees,
  getEmployee,
  getEmployeeByExternalId,
  upsertEmployees,
  updateEmployeeRoles,
  getHousecallProSyncStartDate,
  setHousecallProSyncStartDate,
  getBusinessTargets,
  createBusinessTargets,
  updateBusinessTargets,
  getContractorProvider,
  setContractorProvider,
  getContractorProviders,
  disableContractorProvider,
  getContractorIntegration,
  getContractorIntegrations,
  enableContractorIntegration,
  disableContractorIntegration,
};
