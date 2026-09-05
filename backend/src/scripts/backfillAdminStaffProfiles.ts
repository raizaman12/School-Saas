/**
 * One-off backfill: gives every existing tenant-founding SCHOOL_ADMIN (the
 * user created by POST /api/auth/signup, before this fix) a StaffProfile,
 * matching what a *fresh* signup now does automatically (see
 * modules/auth/auth.service.ts's signup()).
 *
 * Without this, any tenant that signed up before the fix has an admin
 * with no StaffProfile row, so every staff-only feature (filing their own
 * leave request, showing up in the staff directory/payroll, etc.) rejects
 * them with "No staff profile is linked to your account, so leave cannot
 * be requested" — this backfill closes that gap for pre-existing tenants.
 *
 * Safe to run more than once: only SCHOOL_ADMIN users with no StaffProfile
 * are touched, and each run only processes whatever is still missing.
 *
 * Usage (against the app DB role, same as normal app traffic — no
 * elevated privileges needed, this only ever inserts within a tenant it
 * already has RLS access to):
 *   npx ts-node src/scripts/backfillAdminStaffProfiles.ts
 */
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { runWithTenant } from '../lib/tenantContext';
import { logger } from '../lib/logger';

async function main() {
  // The `users` table's RLS policy scopes reads to whatever app.tenant_id
  // is set on the connection (see createSuperAdmin.ts's comment on the
  // one carve-out, tenantId IS NULL rows, which doesn't apply here) — so
  // there's no single cross-tenant query for "every SCHOOL_ADMIN missing a
  // profile". Instead: list tenants (their own RLS policy does allow an
  // unscoped read — see platform/tenants.ts), then check each one from
  // inside its own runWithTenant() context.
  const tenants = await prisma.tenant.findMany({ select: { id: true, code: true, name: true } });

  let created = 0;
  let checked = 0;
  for (const tenant of tenants) {
    await runWithTenant(tenant.id, async (tx) => {
      const admins = await tx.user.findMany({
        where: { role: 'SCHOOL_ADMIN', staffProfile: null },
        select: { id: true, email: true, createdAt: true },
      });
      checked += admins.length;

      for (const admin of admins) {
        // Re-check inside the same transaction in case of a concurrent
        // run — cheap insurance against a duplicate-key error mid-loop.
        const existing = await tx.staffProfile.findUnique({ where: { userId: admin.id } });
        if (existing) continue;

        await tx.staffProfile.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            userId: admin.id,
            employeeCode: `${tenant.code || 'SCH'}-ADMIN`,
            designation: 'Principal',
            employmentType: 'FULL_TIME',
            // Best information we have for when they actually joined —
            // their account's own creation date.
            joiningDate: admin.createdAt,
            monthlySalary: 0,
          },
        });
        created++;
        console.log(`  ✅ ${admin.email} (${tenant.name})`);
      }
    });
  }

  if (checked === 0) {
    console.log('✅ Every SCHOOL_ADMIN already has a StaffProfile — nothing to backfill.');
  } else {
    logger.info('Backfilled admin StaffProfiles', { checked, created });
    console.log(`\nDone: ${created}/${checked} StaffProfile(s) created.`);
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
