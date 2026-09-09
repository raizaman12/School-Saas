import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { listPlans } from '../../config/plans';
import { createPlanSchema, updatePlanSchema } from './validation';

export const platformPlansRouter = Router();
platformPlansRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

// Super Admin sees every tier, including deactivated ones (so they can be
// re-activated) — the public, unauthenticated signup list at GET /api/plans
// (see auth.ts) is the one that filters to active-only.
platformPlansRouter.get('/', async (_req: Request, res: Response) => {
  res.json({ data: await listPlans({ includeInactive: true }) });
});

platformPlansRouter.post('/', async (req: Request, res: Response) => {
  const input = createPlanSchema.parse(req.body);

  const existing = await prisma.plan.findUnique({ where: { code: input.code } });
  if (existing) throw AppError.conflict(`A plan with code "${input.code}" already exists`);

  const plan = await runWithTenant(null, async (tx) => {
    const created = await tx.plan.create({
      data: {
        id: randomUUID(),
        code: input.code,
        name: input.name,
        priceMonthlyPKR: input.priceMonthlyPKR,
        maxStudents: input.maxStudents,
        maxStaff: input.maxStaff,
        maxSmsCreditsPerMonth: input.maxSmsCreditsPerMonth,
        features: input.features,
        active: input.active,
        sortOrder: input.sortOrder,
      },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        actorUserId: req.auth!.userId,
        action: 'platform.plan.create',
        entityType: 'Plan',
        entityId: created.id,
        metadata: { code: created.code, name: created.name },
      },
    });

    return created;
  });

  res.status(201).json({ data: plan });
});

platformPlansRouter.patch('/:id', async (req: Request, res: Response) => {
  const planId = uuidParam(req, 'id');
  const input = updatePlanSchema.parse(req.body);

  const plan = await runWithTenant(null, async (tx) => {
    const existing = await tx.plan.findUnique({ where: { id: planId } });
    if (!existing) throw AppError.notFound('Plan not found');

    const updated = await tx.plan.update({
      where: { id: planId },
      data: input,
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        actorUserId: req.auth!.userId,
        action: 'platform.plan.update',
        entityType: 'Plan',
        entityId: planId,
        metadata: { code: existing.code, changes: input },
      },
    });

    return updated;
  });

  res.json({ data: plan });
});

platformPlansRouter.delete('/:id', async (req: Request, res: Response) => {
  const planId = uuidParam(req, 'id');

  await runWithTenant(null, async (tx) => {
    const existing = await tx.plan.findUnique({ where: { id: planId } });
    if (!existing) throw AppError.notFound('Plan not found');

    // The tenants table is globally readable by design (see its RLS policy
    // comment) — a plain count here needs no tenant context.
    const tenantsOnPlan = await tx.tenant.count({ where: { plan: existing.code } });
    if (tenantsOnPlan > 0) {
      throw AppError.conflict(
        `${tenantsOnPlan} school(s) are currently on the "${existing.name}" plan — it can't be deleted. Deactivate it instead to hide it from new signups.`,
        { tenantsOnPlan },
      );
    }

    await tx.plan.delete({ where: { id: planId } });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        actorUserId: req.auth!.userId,
        action: 'platform.plan.delete',
        entityType: 'Plan',
        entityId: planId,
        metadata: { code: existing.code, name: existing.name },
      },
    });
  });

  res.status(204).send();
});
