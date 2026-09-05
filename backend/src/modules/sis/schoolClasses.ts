import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createSchoolClassSchema, updateSchoolClassSchema } from './validation';

export const schoolClassesRouter = Router();
schoolClassesRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

schoolClassesRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const classes = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.schoolClass.findMany({ orderBy: { order: 'asc' } }),
  );
  res.json({ data: classes });
});

schoolClassesRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSchoolClassSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const existing = await runWithTenant(tenantId, (tx) => tx.schoolClass.findFirst({ where: { name: input.name } }));
  if (existing) throw AppError.conflict('A class with that name already exists', { field: 'name' });

  const schoolClass = await runWithTenant(tenantId, (tx) =>
    tx.schoolClass.create({ data: { id: randomUUID(), tenantId, ...input } }),
  );
  res.status(201).json({ data: schoolClass });
});

schoolClassesRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateSchoolClassSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.schoolClass.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Class not found');
    return tx.schoolClass.update({ where: { id: uuidParam(req, 'id') }, data: input });
  });

  res.json({ data: updated });
});
