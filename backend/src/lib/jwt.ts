import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
import type { UserRole } from '@prisma/client';

export interface AccessTokenClaims {
  sub: string; // userId
  tenantId: string | null;
  role: UserRole;
}

export interface RefreshTokenClaims {
  sub: string; // userId
  tenantId: string | null;
  jti: string; // unique token id, used to look up/revoke the stored hash
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
}

export function signRefreshToken(claims: Omit<RefreshTokenClaims, 'jti'>): {
  token: string;
  jti: string;
} {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ ...claims, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  } as SignOptions);
  return { token, jti };
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenClaims;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Milliseconds until a JWT expiry claim (`exp`, seconds since epoch). */
export function decodeExpiryMs(token: string): number {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) throw new Error('Token has no exp claim');
  return decoded.exp * 1000;
}
