import { z } from "zod";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../auth-service";

export function parseBody<T>(
  schema: z.ZodType<T, any, any>,
  req: AuthenticatedRequest,
  res: Response
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ message: "Invalid request data", errors: result.error.errors });
    return null;
  }
  return result.data;
}
