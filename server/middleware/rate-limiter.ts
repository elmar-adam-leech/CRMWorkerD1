import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Hard upper bound on in-memory store size. Without this, a DDoS flood of
// unique IPs would grow the Map unboundedly until the process OOMs.
// When the cap is reached we fail open (pass the request through) rather than
// crash. Operators should scale horizontally or switch to a Redis-backed store
// if this warning fires in production.
const MAX_RATE_LIMIT_STORE_SIZE = 100_000;
let storeCapWarningLogged = false;

const CLEANUP_INTERVAL = 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
  storeCapWarningLogged = false; // Reset warning flag after cleanup
}, CLEANUP_INTERVAL);

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

function getClientIP(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = 'rl' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIP(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      // Fail open when the store is at capacity rather than OOM the process.
      if (!entry && rateLimitStore.size >= MAX_RATE_LIMIT_STORE_SIZE) {
        if (!storeCapWarningLogged) {
          console.warn(`[rate-limiter] Store size cap (${MAX_RATE_LIMIT_STORE_SIZE}) reached. New IPs will bypass rate limiting until next cleanup.`);
          storeCapWarningLogged = true;
        }
        next();
        return;
      }
      entry = {
        count: 1,
        resetAt: now + windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      entry.count++;
    }

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetInSeconds = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetInSeconds.toString());

    if (entry.count > maxRequests) {
      res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later',
        retryAfter: resetInSeconds,
      });
      return;
    }

    next();
  };
}

export const publicBookingRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'public-booking',
});

export const publicBookingSubmitRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'public-booking-submit',
});

export const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  keyPrefix: 'webhook',
});

export const authLoginRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'auth-login',
});

export const authRegisterRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 3,
  keyPrefix: 'auth-register',
});

export const authForgotPasswordRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 3,
  keyPrefix: 'auth-forgot-password',
});

export const aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'ai-endpoint',
});

// General safety-net limiter applied to all authenticated API routes.
// Generous enough to never affect normal usage but blocks runaway scripts
// operating on a stolen/leaked session token.
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 300,
  keyPrefix: 'api',
});
