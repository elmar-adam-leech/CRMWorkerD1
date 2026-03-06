import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { getUserContractorCached } from './services/cache';

// Critical security check for production
const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  
  if (process.env.NODE_ENV === 'production' && (!secret || secret === 'your-default-secret-key-replace-in-production')) {
    console.error('CRITICAL SECURITY ERROR: JWT_SECRET must be set to a secure value in production!');
    console.error('Generate a secure secret with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }
  
  if (!secret) {
    console.warn('WARNING: Using default JWT_SECRET for development. Set JWT_SECRET environment variable for security.');
    return 'your-default-secret-key-replace-in-production';
  }
  
  return secret;
})();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7 days for sliding expiration

export interface JWTPayload {
  userId: string;
  username: string;
  name: string;
  email: string;
  role: string;
  contractorId: string;
  canManageIntegrations: boolean;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  contractorId?: string; // Set by requireContractorAccess middleware for debugging
}

export class AuthService {
  
  /**
   * Generate a JWT token for a user
   */
  static generateToken(user: {
    id: string;
    username: string;
    name: string;
    email: string;
    role: string;
    contractorId: string;
    canManageIntegrations?: boolean;
  }): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      contractorId: user.contractorId,
      canManageIntegrations: user.canManageIntegrations ?? false,
    };

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
  }

  /**
   * Verify and decode a JWT token
   */
  static verifyToken(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      return decoded;
    } catch (error) {
      console.error('JWT verification failed:', error);
      return null;
    }
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    
    // Handle both "Bearer <token>" and just "<token>" formats
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    return authHeader;
  }

  /**
   * Extract token from cookies or Authorization header
   */
  static extractToken(req: Request): string | null {
    // Try cookie first (more secure for web apps)
    const cookieToken = req.cookies?.auth_token;
    if (cookieToken) return cookieToken;

    // Fall back to Authorization header (for API clients)
    const headerToken = this.extractTokenFromHeader(req.headers.authorization);
    if (headerToken) return headerToken;

    return null;
  }

  /**
   * Determines whether the current request should receive a refreshed JWT cookie.
   *
   * Sliding-window expiration strategy:
   *   - All tokens are issued with a `JWT_EXPIRES_IN` lifetime (default 7 days).
   *   - On every authenticated request, `requireAuth` checks whether the token's age
   *     has surpassed 50% of its total lifetime (≥ 3.5 days for the default 7-day config).
   *   - If so, a brand-new 7-day token is issued and written back to the `auth_token`
   *     cookie in the response.
   *   - This keeps active users permanently logged in without requiring a full re-login,
   *     while inactive users whose last activity was >7 days ago are naturally logged out.
   *
   * @param decoded - The verified JWT payload (must contain `iat`).
   * @returns `true` if the token should be silently refreshed this request.
   */
  static shouldRefreshToken(decoded: JWTPayload): boolean {
    if (!decoded.iat) return false;
    
    const tokenAge = Date.now() / 1000 - decoded.iat; // Age in seconds
    const halfLifeSeconds = (7 * 24 * 60 * 60) / 2; // 3.5 days in seconds
    
    return tokenAge > halfLifeSeconds;
  }

  /**
   * Authentication middleware with automatic token refresh (sliding expiration)
   */
  static requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = AuthService.extractToken(req);
      
      if (!token) {
        res.status(401).json({ message: 'No authentication token provided' });
        return;
      }

      const decoded = AuthService.verifyToken(token);
      if (!decoded) {
        res.status(401).json({ message: 'Invalid or expired token' });
        return;
      }

      // Verify user still exists
      const user = await storage.getUser(decoded.userId);
      if (!user) {
        res.status(401).json({ message: 'User no longer exists' });
        return;
      }

      // Verify user has access to the contractor in the token (supports multi-company access)
      // Use cached version to reduce database load
      const userContractor = await getUserContractorCached(decoded.userId, decoded.contractorId);
      if (!userContractor) {
        res.status(401).json({ message: 'Access denied to this company' });
        return;
      }

      // Attach user to request
      req.user = decoded;
      
      // Sliding expiration: Refresh token if it's more than halfway to expiration
      if (AuthService.shouldRefreshToken(decoded)) {
        const newToken = AuthService.generateToken({
          id: decoded.userId,
          username: decoded.username,
          name: decoded.name,
          email: decoded.email,
          role: decoded.role,
          contractorId: decoded.contractorId,
          canManageIntegrations: decoded.canManageIntegrations,
        });
        
        // Update the cookie with fresh token
        res.cookie('auth_token', newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
          path: '/', // Explicit path for better cookie persistence
        });
      }
      
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(401).json({ message: 'Authentication failed' });
    }
  };

  /**
   * Role-based access control (RBAC) middleware factory.
   *
   * Role hierarchy (most to least privileged):
   *   super_admin → admin → manager → user
   *
   * Usage:
   *   ```ts
   *   app.delete('/api/users/:id', requireAuth, requireAdmin, handler);
   *   // OR for multiple roles:
   *   app.patch('/api/...', requireAuth, requireManagerOrAdmin, handler);
   *   ```
   *
   * Pre-built role guards (exported at the bottom of this file):
   *   - `requireAdmin`          — allows 'admin' and 'super_admin'
   *   - `requireManagerOrAdmin` — allows 'manager', 'admin', and 'super_admin'
   *
   * Always place this middleware AFTER `requireAuth` — it assumes `req.user` is set.
   *
   * @param allowedRoles - Array of role strings permitted to proceed.
   */
  static requireRole = (allowedRoles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      if (!allowedRoles.includes(req.user.role)) {
        res.status(403).json({ 
          message: 'Access denied. Insufficient permissions.' 
        });
        return;
      }

      next();
    };
  };

  /**
   * Tenant isolation middleware - ensures user can only access their contractor's data
   */
  static requireContractorAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (!req.user.contractorId) {
      console.error('Security violation: User token missing contractorId', { userId: req.user.userId });
      res.status(403).json({ message: 'Invalid contractor access' });
      return;
    }

    // Add contractor validation to request for debugging
    req.contractorId = req.user.contractorId;
    next();
  };

  /**
   * Validate that a resource belongs to the user's contractor
   */
  static validateContractorAccess = (userContractorId: string, resourceContractorId: string | null | undefined): boolean => {
    if (!resourceContractorId) {
      console.error('Security violation: Resource missing contractorId');
      return false;
    }
    
    if (userContractorId !== resourceContractorId) {
      console.error('Security violation: Tenant ID mismatch', { 
        userContractorId, 
        resourceContractorId 
      });
      return false;
    }
    
    return true;
  };

  /**
   * Generate a secure random string for JWT secret
   */
  static generateSecretKey(): string {
    return require('crypto').randomBytes(64).toString('hex');
  }
}

// Convenience middleware exports
export const requireAuth = AuthService.requireAuth;
export const requireManagerOrAdmin = AuthService.requireRole(['manager', 'admin', 'super_admin']);
export const requireAdmin = AuthService.requireRole(['admin', 'super_admin']);
export const requireContractorAccess = AuthService.requireContractorAccess;
export const validateContractorAccess = AuthService.validateContractorAccess;