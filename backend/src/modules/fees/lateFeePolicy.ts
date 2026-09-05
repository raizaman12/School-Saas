import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { READ_ROLES, ADMIN_ROLES } from './feeCategories';
import { upsertLateFeePolicySchema } from './validation';

export const lateFeePolicyRouter = Router();
lateFeePolicyRouter.use(requireAuth);

/** Returns `data: null` when the tenant hasn't configured a policy yet (no fines applied). */
lateFeePolicyRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const policy = await runWithTenant(tenantId, (tx) => tx.lateFeePolicy.findUnique({ where: { tenantId } }));
  res.json({ data: policy });
});

/** Upsert-style: creates the tenant's one-and-only policy, or replaces it if one exists. */
lateFeePolicyRouter.put('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = upsertLateFeePolicySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const policy = await runWithTenant(tenantId, (tx) =>
    tx.lateFeePolicy.upsert({
      where: { tenantId },
      create: { id: randomUUID(), tenantId, ...input },
      update: { ...input },
    }),
  );
  res.json({ data: policy });
});
