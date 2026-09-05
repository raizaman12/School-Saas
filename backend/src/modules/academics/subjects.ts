import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createSubjectSchema, updateSubjectSchema } from './validation';

export const subjectsRouter = Router();
subjectsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

subjectsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const subjects = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.subject.findMany({ orderBy: { name: 'asc' } }),
  );
  res.json({ data: subjects });
});

subjectsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSubjectSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const existing = await runWithTenant(tenantId, (tx) => tx.subject.findFirst({ where: { name: input.name } }));
  if (existing) throw AppError.conflict('A subject with that name already exists', { field: 'name' });

  const subject = await runWithTenant(tenantId, (tx) =>
    tx.subject.create({ data: { id: randomUUID(), tenantId, ...input } }),
  );
  res.status(201).json({ data: subject });
});

subjectsRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateSubjectSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.subject.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Subject not found');
    return tx.subject.update({ where: { id: uuidParam(req, 'id') }, data: input });
  });

  res.json({ data: updated });
});
