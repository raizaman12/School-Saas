import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type TenantTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Runs `fn` inside a Postgres transaction with `app.tenant_id` set via
 * `SET LOCAL`, so Row-Level Security policies scope every query in `fn`
 * to that tenant. `SET LOCAL` is transaction-scoped by Postgres itself,
 * so this is safe under Prisma's connection pooling — the setting can
 * never "leak" onto a later request that happens to reuse the same
 * physical connection.
 *
 * Pass `tenantId = null` for platform-level access (SUPER_ADMIN), which
 * maps to rows where `tenantId IS NULL` per the RLS policies.
 *
 * IMPORTANT: every read/write of `users`, `refresh_tokens`, or
 * `audit_logs` must go through this helper. Querying `prisma` directly
 * for those tables will see zero rows (RLS defaults to the platform-only
 * scope when no tenant context is set) rather than leaking data — but it
 * means "silently broken", not "insecure", which is why we still keep
 * this as the single required entry point in code review.
 */
export async function runWithTenant<T>(
  tenantId: string | null,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Parameterized via set_config to avoid any SQL injection risk from
    // a malformed tenantId ever reaching raw SQL string interpolation.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId ?? ''}, true)`;
    return fn(tx as unknown as TenantTx);
  }) as Promise<T>;
}

export type { Prisma };
