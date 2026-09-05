import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createAcademicYearSchema, updateAcademicYearSchema } from './validation';

export const academicYearsRouter = Router();
academicYearsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

academicYearsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const years = await runWithTenant(tenantId, (tx) =>
    tx.academicYear.findMany({ orderBy: { startDate: 'desc' } }),
  );
  res.json({ data: years });
});

academicYearsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const input = createAcademicYearSchema.parse(req.body);

  const year = await runWithTenant(tenantId, async (tx) => {
    if (input.isActive) {
      await tx.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.academicYear.create({
      data: {
        id: randomUUID(),
        tenantId: tenantId!,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        isActive: input.isActive ?? false,
      },
    });
  });

  res.status(201).json({ data: year });
});

academicYearsRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const input = updateAcademicYearSchema.parse(req.body);

  const year = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.academicYear.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Academic year not found');

    if (input.isActive) {
      await tx.academicYear.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }

    return tx.academicYear.update({ where: { id: uuidParam(req, 'id') }, data: input });
  });

  res.json({ data: year });
});
