import type { Request, Response, NextFunction } from 'express';
import type { ApiKey, ApiPermission } from '../../shared/src/index.ts';
import { keyStore } from './key-store.ts';
import { rateLimiter } from './rate-limiter.ts';

// Extend Express Request to include API key
declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
    }
  }
}

/**
 * Authenticate requests via Bearer token.
 * Attaches `req.apiKey` on success. Returns 401 on failure.
 */
export function authenticateApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const apiKey = keyStore.verify(token);
  if (!apiKey) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid API key' });
    return;
  }

  req.apiKey = apiKey;
  next();
}

/**
 * Rate limit middleware factory. Use per-route to enforce category-specific limits.
 */
export function rateLimit(category: ApiPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({ error: 'unauthorized', message: 'No API key' });
      return;
    }

    const limitKey = `${category}PerMinute` as keyof typeof req.apiKey.rateLimit;
    const limit = req.apiKey.rateLimit[limitKey] ?? 60;
    const result = rateLimiter.consume(req.apiKey.id, category, limit);

    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    res.set('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'rate_limited',
        message: `Rate limit exceeded for ${category}. Retry after ${retryAfter}s.`,
      });
      return;
    }

    next();
  };
}

/**
 * Check if the API key has a specific permission.
 */
export function requirePermission(permission: ApiPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({ error: 'unauthorized', message: 'No API key' });
      return;
    }

    if (!req.apiKey.permissions.includes(permission)) {
      res.status(403).json({
        error: 'forbidden',
        message: `API key lacks '${permission}' permission`,
      });
      return;
    }

    next();
  };
}
