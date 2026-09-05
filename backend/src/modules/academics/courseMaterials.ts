import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createCourseMaterialSchema, listCourseMaterialQuerySchema } from './validation';

// Read side matches homework.ts's READ_ROLES exactly — the same staff
// audience that can already see a section's homework can see its shared
// files. Write is SCHOOL_ADMIN or the TEACHER actually assigned to that
// section-subject (checked below, same as homework.ts's own-section-only
// rule for a TEACHER).
const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

export const courseMaterialsRouter = Router();
courseMaterialsRouter.use(requireAuth);

const courseMaterialInclude = {
  sectionSubject: {
    include: {
      subject: { select: { id: true, name: true } },
      section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
    },
  },
  uploadedByUser: { select: { id: true, fullName: true } },
} as const;

courseMaterialsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listCourseMaterialQuerySchema.parse(req.query);

  const materials = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.courseMaterial.findMany({
      where: query.sectionSubjectId ? { sectionSubjectId: query.sectionSubjectId } : {},
      include: courseMaterialInclude,
      orderBy: { createdAt: 'desc' },
    }),
  );
  res.json({ data: materials });
});

/** Shares a new file against a section-subject. A TEACHER must be the assigned teacher for it. */
courseMaterialsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createCourseMaterialSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const material = await runWithTenant(tenantId, async (tx) => {
    const sectionSubject = await tx.sectionSubject.findUnique({ where: { id: input.sectionSubjectId } });
    if (!sectionSubject) throw AppError.badRequest('Unknown sectionSubjectId');
    if (auth.role === 'TEACHER' && sectionSubject.teacherId !== auth.userId) {
      throw AppError.forbidden('You are not the assigned teacher for this section-subject');
    }

    return tx.courseMaterial.create({
      data: {
        id: randomUUID(),
        tenantId,
        sectionSubjectId: input.sectionSubjectId,
        title: input.title,
        fileUrl: input.fileUrl,
        uploadedByUserId: auth.userId,
      },
      include: courseMaterialInclude,
    });
  });

  res.status(201).json({ data: material });
});

courseMaterialsRouter.delete('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.courseMaterial.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Course material not found');
    if (auth.role === 'TEACHER' && existing.uploadedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only remove material you uploaded');
    }
    await tx.courseMaterial.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});
