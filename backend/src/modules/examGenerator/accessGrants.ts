import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createAccessGrantSchema } from './validation';

/**
 * Admin-managed grants of "this TEACHER may generate exam papers for this
 * (SchoolClass, Subject)". SCHOOL_ADMIN always bypasses this check (see
 * generate.ts's assertGenerateAccess) — these rows only ever gate a
 * TEACHER. Contributing to the question bank itself is deliberately NOT
 * gated by this at all (see questionBank.ts).
 */
export const accessGrantsRouter = Router();
accessGrantsRouter.use(requireAuth);

const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;

/**
 * A TEACHER's own list of granted class/subject combinations — powers the
 * Generate tab's picker for a TEACHER caller. Registered before GET '/'
 * (which is SCHOOL_ADMIN-only) and before any '/:id' route, same ordering
 * reasoning as sectionSubjectAdminRouter's GET /me.
 */
accessGrantsRouter.get('/me', requireRole('TEACHER'), async (req: Request, res: Response) => {
  const rows = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.examPaperAccessGrant.findMany({
      where: { teacherId: req.auth!.userId },
      include: {
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
      orderBy: [{ schoolClass: { order: 'asc' } }, { subject: { name: 'asc' } }],
    }),
  );
  res.json({ data: rows });
});

accessGrantsRouter.get('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const rows = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.examPaperAccessGrant.findMany({
      include: {
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
  res.json({ data: rows });
});

accessGrantsRouter.post('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = createAccessGrantSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const created = await runWithTenant(tenantId, async (tx) => {
    const schoolClass = await tx.schoolClass.findUnique({ where: { id: input.schoolClassId } });
    if (!schoolClass) throw AppError.badRequest('Unknown schoolClassId');

    const subject = await tx.subject.findUnique({ where: { id: input.subjectId } });
    if (!subject) throw AppError.badRequest('Unknown subjectId');

    const teacher = await tx.user.findUnique({ where: { id: input.teacherId } });
    if (!teacher || teacher.role !== 'TEACHER') {
      throw AppError.badRequest('teacherId must belong to an active TEACHER user');
    }

    const existing = await tx.examPaperAccessGrant.findUnique({
      where: {
        schoolClassId_subjectId_teacherId: {
          schoolClassId: input.schoolClassId,
          subjectId: input.subjectId,
          teacherId: input.teacherId,
        },
      },
    });
    if (existing) throw AppError.conflict('This teacher already has a grant for this class and subject');

    return tx.examPaperAccessGrant.create({
      data: {
        id: randomUUID(),
        tenantId,
        schoolClassId: input.schoolClassId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        grantedByUserId: auth.userId,
      },
      include: {
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true, email: true } },
      },
    });
  });

  res.status(201).json({ data: created });
});

accessGrantsRouter.delete('/:id', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const id = uuidParam(req, 'id');
  await runWithTenant(req.auth!.tenantId, async (tx) => {
    const existing = await tx.examPaperAccessGrant.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Access grant not found');
    await tx.examPaperAccessGrant.delete({ where: { id } });
  });
  res.status(204).send();
});
