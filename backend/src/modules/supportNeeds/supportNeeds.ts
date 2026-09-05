import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { teacherSectionIds } from '../../lib/teacherScope';
import {
  createSupportNeedSchema,
  updateSupportNeedSchema,
  listSupportNeedsQuerySchema,
  createSupportNeedReviewSchema,
} from './validation';

export const supportNeedsRouter = Router();
supportNeedsRouter.use(requireAuth);

// Tighter than discipline.ts's READ_ROLES: FRONT_DESK has no reason to see
// a student's learning-support plan, and this is more sensitive
// (disability/learning-need-adjacent) than an unresolved fee balance or a
// discipline note.
const READ_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;
const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

const supportNeedInclude = {
  student: { select: { id: true, fullName: true, studentCode: true, currentSectionId: true } },
  coordinatorUser: { select: { id: true, fullName: true } },
  createdByUser: { select: { id: true, fullName: true } },
  reviews: {
    orderBy: { reviewDate: 'desc' as const },
    include: { reviewedByUser: { select: { id: true, fullName: true } } },
  },
} as const;

/** Throws 403 if a TEACHER caller isn't allowed to see/act on this student (not their section). */
async function assertTeacherCanAccessStudent(
  tx: Prisma.TransactionClient,
  teacherId: string,
  studentId: string,
): Promise<void> {
  const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
  if (!student) throw AppError.notFound('Student not found');
  const allowed = await teacherSectionIds(tx, teacherId);
  if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
    throw AppError.forbidden('You do not have access to this student');
  }
}

supportNeedsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listSupportNeedsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    let allowedSectionIds: string[] | null = null;
    if (auth.role === 'TEACHER') {
      allowedSectionIds = await teacherSectionIds(tx, auth.userId);
    }

    const where: Prisma.SupportNeedWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(allowedSectionIds ? { student: { currentSectionId: { in: allowedSectionIds } } } : {}),
    };

    const [data, total] = await Promise.all([
      tx.supportNeed.findMany({
        where,
        include: supportNeedInclude,
        orderBy: { identifiedDate: 'desc' },
        skip,
        take,
      }),
      tx.supportNeed.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

supportNeedsRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;

  const record = await runWithTenant(auth.tenantId, async (tx) => {
    const found = await tx.supportNeed.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: supportNeedInclude,
    });
    if (!found) return null;
    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!found.student.currentSectionId || !allowed.includes(found.student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }
    return found;
  });

  if (!record) throw AppError.notFound('Support need not found');
  res.json({ data: record });
});

supportNeedsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSupportNeedSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const record = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw AppError.badRequest('Unknown studentId');

    if (auth.role === 'TEACHER') {
      await assertTeacherCanAccessStudent(tx, auth.userId, input.studentId);
    }

    if (input.coordinatorUserId) {
      const coordinator = await tx.user.findUnique({ where: { id: input.coordinatorUserId } });
      if (!coordinator) throw AppError.badRequest('Unknown coordinatorUserId');
    }

    return tx.supportNeed.create({
      data: {
        id: randomUUID(),
        tenantId,
        studentId: input.studentId,
        category: input.category,
        description: input.description,
        identifiedDate: input.identifiedDate,
        supportProvided: input.supportProvided,
        examAccommodations: input.examAccommodations,
        coordinatorUserId: input.coordinatorUserId,
        nextReviewDate: input.nextReviewDate,
        createdByUserId: auth.userId,
      },
      include: supportNeedInclude,
    });
  });

  res.status(201).json({ data: record });
});

supportNeedsRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateSupportNeedSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.supportNeed.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Support need not found');

    // A TEACHER may only edit plans they themselves created — same
    // restriction discipline.ts applies to editing a discipline record.
    if (auth.role === 'TEACHER' && existing.createdByUserId !== auth.userId) {
      throw AppError.forbidden('You can only edit learning support plans you created');
    }

    if (input.coordinatorUserId) {
      const coordinator = await tx.user.findUnique({ where: { id: input.coordinatorUserId } });
      if (!coordinator) throw AppError.badRequest('Unknown coordinatorUserId');
    }

    return tx.supportNeed.update({
      where: { id: uuidParam(req, 'id') },
      data: input,
      include: supportNeedInclude,
    });
  });

  res.json({ data: updated });
});

supportNeedsRouter.delete('/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.supportNeed.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Support need not found');
    await tx.supportNeed.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});

/**
 * Adds a periodic review entry — "checked in on this date, here's how it's
 * going" — without necessarily closing the plan out. Any WRITE_ROLES
 * member may add one (unlike editing the plan itself, which is creator-
 * locked for a TEACHER) since a review is additive history, not a change
 * to someone else's original assessment; a TEACHER still can't review a
 * student outside their own sections.
 */
supportNeedsRouter.post('/:id/reviews', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSupportNeedReviewSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const record = await runWithTenant(tenantId, async (tx) => {
    const supportNeed = await tx.supportNeed.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: { student: { select: { currentSectionId: true } } },
    });
    if (!supportNeed) throw AppError.notFound('Support need not found');

    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!supportNeed.student.currentSectionId || !allowed.includes(supportNeed.student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }

    await tx.supportNeedReview.create({
      data: {
        id: randomUUID(),
        tenantId,
        supportNeedId: supportNeed.id,
        reviewDate: input.reviewDate,
        notes: input.notes,
        updatedStatus: input.updatedStatus,
        reviewedByUserId: auth.userId,
      },
    });

    return tx.supportNeed.update({
      where: { id: supportNeed.id },
      data: input.updatedStatus ? { status: input.updatedStatus } : {},
      include: supportNeedInclude,
    });
  });

  res.status(201).json({ data: record });
});
