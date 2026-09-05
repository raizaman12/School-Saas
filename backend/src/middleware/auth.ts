import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import { AppError } from '../utils/AppError';

export interface AuthContext {
  userId: string;
  tenantId: string | null;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Verifies the access token and attaches `req.auth`. Rejects if missing/invalid. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or malformed Authorization header');
  }

  const token = header.slice('Bearer '.length);

  try {
    const claims = verifyAccessToken(token);
    req.auth = { userId: claims.sub, tenantId: claims.tenantId, role: claims.role };
    next();
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }
}

/** Restricts a route to one or more roles. Must run after `requireAuth`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw AppError.unauthorized();
    if (!roles.includes(req.auth.role)) {
      throw AppError.forbidden('You do not have permission to perform this action');
    }
    next();
  };
}
