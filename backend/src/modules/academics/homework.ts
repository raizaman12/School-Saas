import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { createHomeworkSchema, updateHomeworkSchema, listHomeworkQuerySchema } from './validation';

export const homeworkRouter = Router();
homeworkRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

const homeworkInclude = {
  subject: { select: { id: true, name: true } },
  section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
  assignedByUser: { select: { id: true, fullName: true } },
} as const;

homeworkRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listHomeworkQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);

  const result = await runWithTenant(req.auth!.tenantId, async (tx) => {
    const where = query.sectionId ? { sectionId: query.sectionId } : {};
    const [data, total] = await Promise.all([
      tx.homework.findMany({ where, include: homeworkInclude, orderBy: { dueDate: 'desc' }, skip, take }),
      tx.homework.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

/** Assigns a new homework item to a section+subject. A TEACHER must be the assigned teacher for that section-subject. */
homeworkRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createHomeworkSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const homework = await runWithTenant(tenantId, async (tx) => {
    const sectionSubject = await tx.sectionSubject.findUnique({
      where: { sectionId_subjectId: { sectionId: input.sectionId, subjectId: input.subjectId } },
    });
    if (!sectionSubject) {
      throw AppError.badRequest('This subject is not assigned to that section');
    }
    if (auth.role === 'TEACHER' && sectionSubject.teacherId !== auth.userId) {
      throw AppError.forbidden('You are not the assigned teacher for this section-subject');
    }

    return tx.homework.create({
      data: {
        id: randomUUID(),
        tenantId,
        sectionId: input.sectionId,
        subjectId: input.subjectId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        assignedByUserId: auth.userId,
        attachmentUrl: input.attachmentUrl,
      },
      include: homeworkInclude,
    });
  });

  res.status(201).json({ data: homework });
});

homeworkRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateHomeworkSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.homework.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Homework not found');
    if (auth.role === 'TEACHER' && existing.assignedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only edit homework you assigned');
    }

    return tx.homework.update({ where: { id: uuidParam(req, 'id') }, data: input, include: homeworkInclude });
  });

  res.json({ data: updated });
});

homeworkRouter.delete('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.homework.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Homework not found');
    if (auth.role === 'TEACHER' && existing.assignedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only delete homework you assigned');
    }
    await tx.homework.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});
