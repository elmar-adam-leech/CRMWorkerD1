import type { Express, Response } from "express";
import { storage } from "../storage";
import { updateEmployeeRolesSchema } from "@shared/schema";
import { requireAuth, requireManagerOrAdmin, type AuthenticatedRequest } from "../auth-service";

export function registerEmployeeRoutes(app: Express): void {
  app.get("/api/employees", async (req: AuthenticatedRequest, res: Response) => {
    try {
      const employees = await storage.getEmployees(req.user!.contractorId);
      res.json(employees);
    } catch (error) {
      console.error('Error fetching employees:', error);
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  app.patch("/api/employees/:id/roles", requireManagerOrAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
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
      const updatedEmployee = await storage.updateEmployeeRoles(id, roles, req.user!.contractorId);
      if (!updatedEmployee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      res.json(updatedEmployee);
    } catch (error) {
      console.error('Error updating employee roles:', error);
      res.status(500).json({ message: "Failed to update employee roles" });
    }
  });

  // Message routes for texting functionality
}
