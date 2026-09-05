import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

// Single pooled Prisma client for the whole process. Never query
// tenant-scoped tables (users, refresh_tokens, audit_logs) through this
// directly — go through `runWithTenant` in ./tenantContext.ts so
// PostgreSQL Row-Level Security has the right `app.tenant_id` set for
// the connection actually used. Reading `tenants` directly (e.g. to
// resolve a slug pre-auth) is fine since that table has an open SELECT
// policy.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// NOTE: previously this logged on the Node 'beforeExit' event. Removed —
// logging there is itself I/O, which keeps the event loop alive just long
// enough for 'beforeExit' to fire again once that write completes, which
// logs again, forever. The long-running server process never hit this
// (its HTTP listener keeps the loop alive independently of 'beforeExit'
// semantics) and Jest force-exits test workers, so it went unnoticed until
// a genuinely short-lived script (src/scripts/createSuperAdmin.ts) hung
// indefinitely instead of exiting. Prisma's client already tears down its
// connections on normal process exit without any help here.
