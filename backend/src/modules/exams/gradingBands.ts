import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { replaceGradingBandsSchema } from './validation';

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;

export const gradingBandsRouter = Router();
gradingBandsRouter.use(requireAuth);

gradingBandsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const bands = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.gradingBand.findMany({ orderBy: { sortOrder: 'asc' } }),
  );
  res.json({ data: bands });
});

/**
 * Replaces the tenant's entire grading scale in one transaction (delete +
 * recreate) — simpler and safer than diffing individual band edits, and
 * matches how schools actually think about this ("switch to scale X").
 * `sortOrder` is derived from array position, purely for stable display
 * order (matching logic itself sorts by minPercentage — see grading.ts).
 */
gradingBandsRouter.put('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = replaceGradingBandsSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const bands = await runWithTenant(tenantId, async (tx) => {
    await tx.gradingBand.deleteMany({});
    await tx.gradingBand.createMany({
      data: input.bands.map((band, index) => ({
        id: randomUUID(),
        tenantId,
        grade: band.grade,
        minPercentage: band.minPercentage,
        sortOrder: index,
      })),
    });
    return tx.gradingBand.findMany({ orderBy: { sortOrder: 'asc' } });
  });

  res.json({ data: bands });
});
