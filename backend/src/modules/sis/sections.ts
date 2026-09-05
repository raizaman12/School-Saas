import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createSectionSchema, updateSectionSchema, promoteSectionSchema } from './validation';

export const sectionsRouter = Router();
sectionsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

sectionsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const { academicYearId, schoolClassId } = req.query as Record<string, string | undefined>;

  const sections = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.section.findMany({
      where: {
        ...(academicYearId ? { academicYearId } : {}),
        ...(schoolClassId ? { schoolClassId } : {}),
        // Teachers only see sections they're the class teacher for.
        ...(req.auth!.role === 'TEACHER' ? { classTeacherId: req.auth!.userId } : {}),
      },
      include: {
        schoolClass: { select: { id: true, name: true, order: true } },
        academicYear: { select: { id: true, name: true, isActive: true } },
        classTeacher: { select: { id: true, fullName: true, email: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ schoolClass: { order: 'asc' } }, { name: 'asc' }],
    }),
  );
  res.json({ data: sections });
});

sectionsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSectionSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const section = await runWithTenant(tenantId, async (tx) => {
    const schoolClass = await tx.schoolClass.findUnique({ where: { id: input.schoolClassId } });
    if (!schoolClass) throw AppError.badRequest('Unknown schoolClassId');

    const academicYear = await tx.academicYear.findUnique({ where: { id: input.academicYearId } });
    if (!academicYear) throw AppError.badRequest('Unknown academicYearId');

    if (input.classTeacherId) {
      const teacher = await tx.user.findUnique({ where: { id: input.classTeacherId } });
      if (!teacher || teacher.role !== 'TEACHER') {
        throw AppError.badRequest('classTeacherId must belong to an active TEACHER user');
      }
    }

    const existing = await tx.section.findFirst({
      where: {
        schoolClassId: input.schoolClassId,
        academicYearId: input.academicYearId,
        name: input.name,
      },
    });
    if (existing) throw AppError.conflict('That section already exists for this class and year');

    return tx.section.create({ data: { id: randomUUID(), tenantId, ...input } });
  });

  res.status(201).json({ data: section });
});

sectionsRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateSectionSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.section.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Section not found');

    if (input.classTeacherId) {
      const teacher = await tx.user.findUnique({ where: { id: input.classTeacherId } });
      if (!teacher || teacher.role !== 'TEACHER') {
        throw AppError.badRequest('classTeacherId must belong to an active TEACHER user');
      }
    }

    return tx.section.update({ where: { id: uuidParam(req, 'id') }, data: input });
  });

  res.json({ data: updated });
});

/**
 * Bulk "move to next class" — year-end promotion. Moves every currently-
 * ACTIVE student in this section (or a chosen subset, for holding
 * repeaters back) into `targetSectionId` for `targetAcademicYearId`: same
 * per-student effect as calling POST /students/:id/enroll once per
 * student, batched into one request instead of N. Roll numbers are reset
 * on the new section (the old section's numbering has no bearing on the
 * new class register) — the school reassigns them there.
 */
sectionsRouter.post('/:id/promote', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = promoteSectionSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const sourceSectionId = uuidParam(req, 'id');

  const result = await runWithTenant(tenantId, async (tx) => {
    const sourceSection = await tx.section.findUnique({ where: { id: sourceSectionId } });
    if (!sourceSection) throw AppError.notFound('Section not found');

    const targetSection = await tx.section.findUnique({ where: { id: input.targetSectionId } });
    if (!targetSection) throw AppError.badRequest('Unknown targetSectionId');
    if (targetSection.academicYearId !== input.targetAcademicYearId) {
      throw AppError.badRequest('targetSectionId does not belong to the given targetAcademicYearId');
    }
    if (targetSection.id === sourceSectionId) {
      throw AppError.badRequest('targetSectionId must be different from the source section');
    }

    const candidates = await tx.student.findMany({
      where: {
        currentSectionId: sourceSectionId,
        status: 'ACTIVE',
        ...(input.studentIds ? { id: { in: input.studentIds } } : {}),
      },
    });
    if (input.studentIds && candidates.length !== input.studentIds.length) {
      const foundIds = new Set(candidates.map((s) => s.id));
      const missing = input.studentIds.filter((id) => !foundIds.has(id));
      throw AppError.badRequest('Some studentIds are not active students of this section', { missing });
    }

    const promoted = [];
    for (const student of candidates) {
      const existingEnrollment = await tx.enrollment.findUnique({
        where: { studentId_academicYearId: { studentId: student.id, academicYearId: input.targetAcademicYearId } },
      });
      if (existingEnrollment) {
        await tx.enrollment.update({
          where: { id: existingEnrollment.id },
          data: { sectionId: input.targetSectionId, status: 'ACTIVE' },
        });
      } else {
        await tx.enrollment.create({
          data: {
            id: randomUUID(),
            tenantId,
            studentId: student.id,
            sectionId: input.targetSectionId,
            academicYearId: input.targetAcademicYearId,
          },
        });
      }

      const updatedStudent = await tx.student.update({
        where: { id: student.id },
        data: { currentSectionId: input.targetSectionId, rollNumber: null },
      });
      promoted.push(updatedStudent);
    }

    return promoted;
  });

  res.status(200).json({ data: { promotedCount: result.length, students: result } });
});
