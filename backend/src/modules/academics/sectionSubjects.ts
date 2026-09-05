import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createSectionSubjectSchema, updateSectionSubjectSchema, setElectiveStudentsSchema } from './validation';

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

async function assertTeacherRole(
  tx: import('@prisma/client').Prisma.TransactionClient,
  teacherId: string | undefined,
) {
  if (!teacherId) return;
  const teacher = await tx.user.findUnique({ where: { id: teacherId } });
  if (!teacher || teacher.role !== 'TEACHER') {
    throw AppError.badRequest('teacherId must belong to an active TEACHER user');
  }
}

/** Mounted at /api/sections/:sectionId/subjects (mergeParams). */
export const sectionSubjectsRouter = Router({ mergeParams: true });
sectionSubjectsRouter.use(requireAuth);

sectionSubjectsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const sectionId = uuidParam(req, 'sectionId');
  const rows = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.sectionSubject.findMany({
      where: { sectionId },
      include: {
        subject: true,
        teacher: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { subject: { name: 'asc' } },
    }),
  );
  res.json({ data: rows });
});

sectionSubjectsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createSectionSubjectSchema.parse(req.body);
  const sectionId = uuidParam(req, 'sectionId');
  const tenantId = req.auth!.tenantId!;

  const created = await runWithTenant(tenantId, async (tx) => {
    const section = await tx.section.findUnique({ where: { id: sectionId } });
    if (!section) throw AppError.notFound('Section not found');

    const subject = await tx.subject.findUnique({ where: { id: input.subjectId } });
    if (!subject) throw AppError.badRequest('Unknown subjectId');

    await assertTeacherRole(tx, input.teacherId);

    const existing = await tx.sectionSubject.findUnique({
      where: { sectionId_subjectId: { sectionId, subjectId: input.subjectId } },
    });
    if (existing) throw AppError.conflict('This subject is already assigned to this section');

    return tx.sectionSubject.create({
      data: {
        id: randomUUID(),
        tenantId,
        sectionId,
        subjectId: input.subjectId,
        teacherId: input.teacherId,
        isElective: input.isElective ?? false,
      },
    });
  });

  res.status(201).json({ data: created });
});

/** Mounted standalone at /api/section-subjects/:id for updates/removal. */
export const sectionSubjectAdminRouter = Router();
sectionSubjectAdminRouter.use(requireAuth);

/**
 * A TEACHER's own course list — every section-subject they're assigned to
 * teach, across every section, with its weekly timetable slots included so
 * the teacher dashboard's course cards can show timing without a second
 * round trip. Registered before PATCH/DELETE '/:id' (different HTTP
 * methods, so no real collision risk, but kept here for the same reason as
 * GET /api/staff/me above — "/me" should never depend on route order
 * working out).
 */
sectionSubjectAdminRouter.get('/me', requireRole('TEACHER'), async (req: Request, res: Response) => {
  const rows = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.sectionSubject.findMany({
      where: { teacherId: req.auth!.userId },
      include: {
        subject: true,
        section: { select: { id: true, name: true, schoolClass: { select: { id: true, name: true } } } },
        timetableSlots: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
      orderBy: [{ section: { schoolClass: { order: 'asc' } } }, { subject: { name: 'asc' } }],
    }),
  );
  res.json({ data: rows });
});

sectionSubjectAdminRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateSectionSubjectSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.sectionSubject.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Section-subject assignment not found');

    if (input.teacherId) await assertTeacherRole(tx, input.teacherId);

    return tx.sectionSubject.update({ where: { id: uuidParam(req, 'id') }, data: input });
  });

  res.json({ data: updated });
});

sectionSubjectAdminRouter.delete('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.sectionSubject.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Section-subject assignment not found');
    await tx.sectionSubject.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});

// ────────────────────────────────────────────────────────────────
// Elective roster — which of the section's students actually take this
// subject. Meaningless (ignored by marks/report-card logic) unless the
// section-subject itself is marked isElective: true, but readable either
// way so the admin UI can show "not an elective" without a separate call.
// ────────────────────────────────────────────────────────────────

sectionSubjectAdminRouter.get(
  '/:id/elective-students',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const id = uuidParam(req, 'id');

    const rows = await runWithTenant(tenantId, async (tx) => {
      const sectionSubject = await tx.sectionSubject.findUnique({ where: { id } });
      if (!sectionSubject) throw AppError.notFound('Section-subject assignment not found');

      const [sectionStudents, enrollments] = await Promise.all([
        tx.student.findMany({
          where: { currentSectionId: sectionSubject.sectionId, status: 'ACTIVE' },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true, studentCode: true },
        }),
        tx.studentElectiveEnrollment.findMany({ where: { sectionSubjectId: id } }),
      ]);

      const enrolledIds = new Set(enrollments.map((e) => e.studentId));
      return sectionStudents.map((s) => ({ ...s, enrolled: enrolledIds.has(s.id) }));
    });

    res.json({ data: rows });
  },
);

sectionSubjectAdminRouter.put(
  '/:id/elective-students',
  requireRole(...WRITE_ROLES),
  async (req: Request, res: Response) => {
    const input = setElectiveStudentsSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;
    const id = uuidParam(req, 'id');

    await runWithTenant(tenantId, async (tx) => {
      const sectionSubject = await tx.sectionSubject.findUnique({ where: { id } });
      if (!sectionSubject) throw AppError.notFound('Section-subject assignment not found');
      if (!sectionSubject.isElective) {
        throw AppError.badRequest('Mark this subject as elective before assigning a student roster to it');
      }

      const validStudents = await tx.student.findMany({
        where: { id: { in: input.studentIds }, currentSectionId: sectionSubject.sectionId },
        select: { id: true },
      });
      const validIds = new Set(validStudents.map((s) => s.id));
      const invalid = input.studentIds.filter((sid) => !validIds.has(sid));
      if (invalid.length > 0) {
        throw AppError.badRequest('Some students are not currently enrolled in this section', { invalid });
      }

      // Whole-list replace, same pattern as re-saving a section's roster —
      // simplest correct semantics for a small per-subject student list.
      await tx.studentElectiveEnrollment.deleteMany({ where: { sectionSubjectId: id } });
      if (input.studentIds.length > 0) {
        await tx.studentElectiveEnrollment.createMany({
          data: input.studentIds.map((studentId) => ({
            id: randomUUID(),
            tenantId,
            studentId,
            sectionSubjectId: id,
          })),
        });
      }
    });

    res.status(204).send();
  },
);
