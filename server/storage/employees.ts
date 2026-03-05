import {
  type Employee, type InsertEmployee,
  employees,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, asc } from "drizzle-orm";
import type { UpdateEmployee } from "../storage-types";

function mapExternalRoleToInternalRoles(externalRole: string): string[] {
  const role = externalRole.toLowerCase();
  if (role.includes('field') || role.includes('technician')) return ['technician'];
  else if (role.includes('estimator')) return ['estimator'];
  else if (role.includes('sales')) return ['sales'];
  else if (role.includes('dispatch')) return ['dispatcher'];
  else if (role.includes('admin') || role.includes('manager')) return ['manager'];
  return ['technician'];
}

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

export const employeeMethods = {
  getEmployees,
  getEmployee,
  getEmployeeByExternalId,
  upsertEmployees,
  updateEmployeeRoles,
};
