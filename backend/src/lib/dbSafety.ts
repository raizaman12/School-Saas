import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export interface RlsSafetyCheck {
  safe: boolean;
  reason?: string;
}

/**
 * Guards against the single scariest misconfiguration in this codebase:
 * the app server accidentally connecting to Postgres as a role that
 * BYPASSES Row-Level Security (school_saas_owner — needed for migrations,
 * see docs/DEPLOYMENT.md and RUN_COMMANDS.md) instead of the normal
 * least-privilege app role (school_saas_app).
 *
 * Most list/read queries in this codebase (see e.g. sis/students.ts's
 * GET '/' handler) rely ENTIRELY on RLS to scope results to the caller's
 * tenant — runWithTenant() sets `app.tenant_id` per-request, and the
 * per-table RLS policy (see prisma/migrations/..._init and
 * ..._student_information_system) does the actual filtering. That's a
 * single point of enforcement by design (see schema.prisma's top
 * comment) — which means if the connection itself has BYPASSRLS, EVERY
 * one of those queries silently returns every tenant's rows at once, with
 * no error, no warning, nothing in the response to hint that anything is
 * wrong. This is exactly what happened when a `$env:DATABASE_URL`
 * override left over from a one-off `prisma migrate deploy` command (see
 * RUN_COMMANDS.md step 2) leaked into a later `npm run dev` in the same
 * terminal session — the server quietly ran the WHOLE deployment with no
 * tenant isolation at all, and it only became visible when a school's
 * admin panel started listing another school's students and staff too.
 *
 * Called once at startup (see server.ts) — this is a property of which
 * role a given connection authenticated as, not something that changes
 * mid-process, so there's no need to recheck on every request.
 */
export async function checkRlsIsEnforced(client: PrismaClient): Promise<RlsSafetyCheck> {
  const [roleRow] = await client.$queryRaw<{ rolname: string; rolbypassrls: boolean }[]>`
    SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;

  if (roleRow?.rolbypassrls) {
    return {
      safe: false,
      reason:
        `Connected to Postgres as role "${roleRow.rolname}", which has BYPASSRLS — ` +
        'every tenant-isolation check in this app is enforced by Row-Level Security ' +
        '(see runWithTenant() in lib/tenantContext.ts), so a connection with BYPASSRLS ' +
        'can read and write every tenant\'s data at once, unfiltered. This role is meant ' +
        'ONLY for running migrations, never for the running app server. Check DATABASE_URL ' +
        '— including any leftover $env:DATABASE_URL override still set in this terminal ' +
        'session from an earlier one-off migrate command (see RUN_COMMANDS.md) — and make ' +
        'sure it points at the least-privilege "school_saas_app" role, then restart in a ' +
        'fresh terminal.',
    };
  }

  // Secondary, independent check: confirm RLS is actually enabled+forced
  // on a canary table, in case someone ran `ALTER TABLE ... DISABLE ROW
  // LEVEL SECURITY` by hand (a different way to reach the same failure
  // mode as the BYPASSRLS role check above).
  const [usersTable] = await client.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'users' AND relkind = 'r'
  `;
  if (usersTable && (!usersTable.relrowsecurity || !usersTable.relforcerowsecurity)) {
    return {
      safe: false,
      reason:
        'Row-Level Security is not both ENABLED and FORCED on the "users" table. ' +
        'It should have been set up by the initial migration — re-run ' +
        '`ALTER TABLE "users" ENABLE ROW LEVEL SECURITY; ALTER TABLE "users" FORCE ROW LEVEL SECURITY;` ' +
        '(as the school_saas_owner role) and check the other tenant-scoped tables the same way.',
    };
  }

  return { safe: true };
}

/**
 * Runs checkRlsIsEnforced() against the given client and, if unsafe, logs
 * a fatal error and returns false so the caller (server.ts) can refuse to
 * bind the HTTP port — starting the server in this state is more
 * dangerous than not starting it at all.
 */
export async function assertRlsIsEnforcedOrLog(client: PrismaClient): Promise<boolean> {
  try {
    const result = await checkRlsIsEnforced(client);
    if (!result.safe) {
      logger.error(`🚨 REFUSING TO START — tenant data isolation is not enforced: ${result.reason}`);
      return false;
    }
    return true;
  } catch (err) {
    // Fails open on an unexpected error here (e.g. a Postgres version
    // without pg_roles.rolbypassrls, or a permissions issue reading
    // pg_catalog) rather than blocking startup over a check that itself
    // couldn't run — but it's logged loudly so it doesn't go unnoticed.
    logger.error('Could not verify Row-Level Security enforcement at startup', {
      err: (err as Error)?.message,
    });
    return true;
  }
}
