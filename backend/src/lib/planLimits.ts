import type { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { PLAN_CATALOG } from '../config/plans';

/**
 * Enforces a tenant's subscription-plan limits at the point of creation.
 * The Super Admin's tenant-detail view has long been able to *report*
 * whether a tenant is over its student/staff limit (see
 * `platform/tenants.ts`), but nothing ever stopped the actual
 * student/staff-creation endpoints from inserting past it — this closes
 * that gap by checking before the insert, inside the same
 * `runWithTenant` transaction, so the check and the create are atomic
 * (no race where two concurrent requests both pass the check).
 */
async function assertWithinLimit(
  tx: Prisma.TransactionClient,
  tenantId: string,
  limitKey: 'maxStudents' | 'maxStaff',
  countCurrent: () => Promise<number>,
  label: string,
): Promise<void> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
  if (!tenant) return; // unreachable in practice — we're already inside this tenant's transaction

  const plan = PLAN_CATALOG[tenant.plan];
  const limit = plan[limitKey];
  if (limit === null) return; // unlimited on this tier

  const current = await countCurrent();
  if (current >= limit) {
    throw AppError.planLimitExceeded(
      `Your ${plan.name} plan allows up to ${limit} ${label}. Upgrade your plan to add more.`,
      { plan: plan.code, limit, current, limitType: label },
    );
  }
}

export function assertCanAddStudent(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  return assertWithinLimit(
    tx,
    tenantId,
    'maxStudents',
    () => tx.student.count({ where: { status: 'ACTIVE' } }),
    'active students',
  );
}

export function assertCanAddStaff(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  return assertWithinLimit(
    tx,
    tenantId,
    'maxStaff',
    () => tx.staffProfile.count({ where: { status: 'ACTIVE' } }),
    'active staff members',
  );
}

/**
 * Returns whether this tenant still has SMS/WhatsApp send quota left this
 * calendar month, and how many sends they've used. Usage is derived by
 * counting this month's `Notification` rows on the metered channels
 * rather than a stored/decremented counter — consistent with how
 * student/staff usage is computed above, and it needs no month-boundary
 * reset job.
 */
export async function checkSmsCredits(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
  const limit = tenant ? PLAN_CATALOG[tenant.plan].maxSmsCreditsPerMonth : 0;
  if (limit === null) return { allowed: true, used: 0, limit: null };

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const used = await tx.notification.count({
    where: {
      channel: { in: ['SMS', 'WHATSAPP'] },
      createdAt: { gte: startOfMonth },
    },
  });

  return { allowed: used < limit, used, limit };
}
