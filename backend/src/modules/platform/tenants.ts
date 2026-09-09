import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { listTenantsQuerySchema, updateTenantStatusSchema, updateTenantPlanSchema } from './validation';
import { getPlan } from '../../config/plans';
import { checkSmsCredits } from '../../lib/planLimits';

export const platformTenantsRouter = Router();
platformTenantsRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

platformTenantsRouter.get('/', async (req: Request, res: Response) => {
  const query = listTenantsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);

  // The tenants table is globally readable by design (see its RLS policy
  // comment) — no runWithTenant needed for a plain, unfiltered-by-tenant read.
  const where: Prisma.TenantWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.plan ? { plan: query.plan } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.tenant.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.tenant.count({ where }),
  ]);

  res.json({ data, meta: paginationMeta(query.page, query.limit, total) });
});

platformTenantsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = uuidParam(req, 'id');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw AppError.notFound('Tenant not found');

  const { usage, smsCredits } = await runWithTenant(tenantId, async (tx) => {
    const [userCount, studentCount, staffCount, smsCredits] = await Promise.all([
      tx.user.count(),
      tx.student.count({ where: { status: 'ACTIVE' } }),
      tx.staffProfile.count({ where: { status: 'ACTIVE' } }),
      checkSmsCredits(tx, tenantId),
    ]);
    return { usage: { userCount, studentCount, staffCount }, smsCredits };
  });

  // A tenant's plan code should always resolve to a real Plan row (deleting
  // one while any tenant still uses it is blocked — see platform/plans.ts),
  // but fall back to null-shaped limits rather than crashing this view if
  // it somehow doesn't, since this endpoint is read-only and diagnostic.
  const planDefinition = await getPlan(tenant.plan);

  res.json({
    data: {
      ...tenant,
      usage: { ...usage, smsCreditsUsedThisMonth: smsCredits.used },
      planDefinition,
      limits: {
        withinStudentLimit:
          !planDefinition || planDefinition.maxStudents === null || usage.studentCount <= planDefinition.maxStudents,
        withinStaffLimit:
          !planDefinition || planDefinition.maxStaff === null || usage.staffCount <= planDefinition.maxStaff,
        withinSmsLimit: smsCredits.allowed,
      },
    },
  });
});

platformTenantsRouter.patch('/:id/status', async (req: Request, res: Response) => {
  const input = updateTenantStatusSchema.parse(req.body);
  const tenantId = uuidParam(req, 'id');

  const tenant = await runWithTenant(null, async (tx) => {
    const existing = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw AppError.notFound('Tenant not found');

    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: { status: input.status },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        actorUserId: req.auth!.userId,
        action: 'platform.tenant.status_change',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { from: existing.status, to: input.status, reason: input.reason },
      },
    });

    return updated;
  });

  res.json({ data: tenant });
});

platformTenantsRouter.patch('/:id/plan', async (req: Request, res: Response) => {
  const input = updateTenantPlanSchema.parse(req.body);
  const tenantId = uuidParam(req, 'id');

  const tenant = await runWithTenant(null, async (tx) => {
    const existing = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw AppError.notFound('Tenant not found');

    // input.plan used to be validated against a fixed enum at parse time;
    // now that plans are a DB table, that check moves here. Deliberately
    // NOT checking `active` here — a deactivated plan is only hidden from
    // the public signup picker (see auth.service.ts's signup()); a Super
    // Admin manually assigning a tenant to it (e.g. a grandfathered/custom
    // deal) is still allowed.
    const targetPlan = await getPlan(input.plan, tx);
    if (!targetPlan) throw AppError.badRequest(`Unknown plan "${input.plan}"`);

    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: { plan: input.plan },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        actorUserId: req.auth!.userId,
        action: 'platform.tenant.plan_change',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { from: existing.plan, to: input.plan },
      },
    });

    return updated;
  });

  res.json({ data: tenant });
});
