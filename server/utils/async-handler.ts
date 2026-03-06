import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../auth-service";

type AnyRequest = Request | AuthenticatedRequest;

export function asyncHandler<T extends AnyRequest = AuthenticatedRequest>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req as T, res, next).catch(next);
  };
}
