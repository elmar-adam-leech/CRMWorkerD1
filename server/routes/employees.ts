import type { Express, Response } from "express";
import { storage } from "../storage";
import { updateEmployeeRolesSchema } from "@shared/schema";
import { requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";
import { asyncHandler } from "../utils/async-handler";

export function registerEmployeeRoutes(app: Express): void {
  app.get("/api/employees", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const employees = await storage.getEmployees(req.user.contractorId);
    res.json(employees);
  }));

  app.patch("/api/employees/:id/roles", requireManagerOrAdmin, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    const updatedEmployee = await storage.updateEmployeeRoles(id, roles, req.user.contractorId);
    if (!updatedEmployee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }

    res.json(updatedEmployee);
  }));

  // Message routes for texting functionality
}
