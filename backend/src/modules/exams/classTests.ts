import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createClassTestSchema, enterClassTestMarksSchema } from './validation';

/**
 * A teacher's own quick in-class tests (quizzes, "class tests", etc.) —
 * created directly by the teacher from their subject's Grades tab, with no
 * admin setup required first (unlike Exam/ExamSubject, which an admin must
 * build a datesheet for). Deliberately kept a fully separate model from
 * Exam/ExamSubject/Mark: computeSectionExamResults and buildReportCard
 * (exams.ts) only ever query Exam/ExamSubject/Mark, so a class test's marks
 * structurally cannot end up counted in a report card or class ranking — no
 * exclusion filter needed anywhere, they just never enter that code path.
 * Results ARE still visible to the student/parent portal, via a dedicated
 * portal route (see portal module) that reads ClassTestMark directly.
 */
export const classTestsRouter = Router();
classTestsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

/** Throws 403 if a TEACHER caller isn't the assigned teacher for this section-subject. */
async function assertSectionSubjectAccess(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  sectionSubjectId: string,
) {
  const sectionSubject = await tx.sectionSubject.findUnique({ where: { id: sectionSubjectId } });
  if (!sectionSubject) throw AppError.notFound('Section subject not found');
  if (auth.role === 'TEACHER' && sectionSubject.teacherId !== auth.userId) {
    throw AppError.forbidden('You are not the assigned teacher for this subject');
  }
  return sectionSubject;
}

/** Throws 403 if a TEACHER caller didn't create this class test (nor is the assigned subject teacher). */
async function assertClassTestAccess(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  classTestId: string,
) {
  const classTest = await tx.classTest.findUnique({
    where: { id: classTestId },
    include: { sectionSubject: true },
  });
  if (!classTest) throw AppError.notFound('Class test not found');
  if (auth.role === 'TEACHER' && classTest.sectionSubject.teacherId !== auth.userId) {
    throw AppError.forbidden('You are not the assigned teacher for this subject');
  }
  return classTest;
}

/** Creates a class test for one section-subject — the teacher's own self-serve "+ New class test". */
classTestsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createClassTestSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const classTest = await runWithTenant(tenantId, async (tx) => {
    await assertSectionSubjectAccess(tx, auth, input.sectionSubjectId);

    return tx.classTest.create({
      data: {
        id: randomUUID(),
        tenantId,
        sectionSubjectId: input.sectionSubjectId,
        name: input.name,
        maxMarks: input.maxMarks,
        passingMarks: input.passingMarks,
        createdByUserId: auth.userId,
      },
    });
  });

  res.status(201).json({ data: classTest });
});

/**
 * Every class test created for one section-subject, with how many students
 * have marks entered so far — powers the Grades tab's "Class tests" list,
 * the same way exams.ts's /for-section-subject/:sectionSubjectId powers its
 * formal-exam list.
 */
classTestsRouter.get(
  '/for-section-subject/:sectionSubjectId',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');
    const auth = req.auth!;

    const rows = await runWithTenant(auth.tenantId, async (tx) => {
      await assertSectionSubjectAccess(tx, auth, sectionSubjectId);

      const classTests = await tx.classTest.findMany({
        where: { sectionSubjectId },
        include: { createdBy: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const marksCounts = classTests.length
        ? await tx.classTestMark.groupBy({
            by: ['classTestId'],
            where: { classTestId: { in: classTests.map((c) => c.id) }, marksObtained: { not: null } },
            _count: true,
          })
        : [];
      const enteredCountByClassTest = new Map(marksCounts.map((c) => [c.classTestId, c._count]));

      return classTests.map((c) => ({
        ...c,
        marksEnteredCount: enteredCountByClassTest.get(c.id) ?? 0,
      }));
    });

    res.json({ data: rows });
  },
);

/** Roster + marks (null if not yet entered) for one class test — mirrors exams.ts's exam-subject roster shape. */
classTestsRouter.get('/:classTestId/marks', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const classTestId = uuidParam(req, 'classTestId');
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    const classTest = await assertClassTestAccess(tx, auth, classTestId);
    const sectionSubject = classTest.sectionSubject;

    const [sectionStudents, marks, electiveEnrollments] = await Promise.all([
      tx.student.findMany({
        where: { currentSectionId: sectionSubject.sectionId, status: 'ACTIVE' },
        orderBy: { fullName: 'asc' },
      }),
      tx.classTestMark.findMany({ where: { classTestId } }),
      sectionSubject.isElective
        ? tx.studentElectiveEnrollment.findMany({ where: { sectionSubjectId: sectionSubject.id } })
        : Promise.resolve(null),
    ]);

    const students = electiveEnrollments
      ? sectionStudents.filter((s) => electiveEnrollments.some((e) => e.studentId === s.id))
      : sectionStudents;

    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const roster = students.map((s) => ({
      studentId: s.id,
      studentCode: s.studentCode,
      fullName: s.fullName,
      marksObtained: byStudent.get(s.id)?.marksObtained ?? null,
      remarks: byStudent.get(s.id)?.remarks ?? null,
      maxMarks: classTest.maxMarks,
      passingMarks: classTest.passingMarks,
    }));

    return {
      classTest: {
        id: classTest.id,
        name: classTest.name,
        maxMarks: classTest.maxMarks,
        passingMarks: classTest.passingMarks,
        sectionSubjectId: classTest.sectionSubjectId,
      },
      roster,
    };
  });

  res.json({ data: result });
});

/** Bulk marks entry/edit for one class test (one class's one self-serve test). */
classTestsRouter.post('/:classTestId/marks', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = enterClassTestMarksSchema.parse(req.body);
  const classTestId = uuidParam(req, 'classTestId');
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const classTest = await assertClassTestAccess(tx, auth, classTestId);
    const sectionSubject = classTest.sectionSubject;

    const studentIds = input.records.map((r) => r.studentId);
    const students = await tx.student.findMany({ where: { id: { in: studentIds } } });
    let validIds = new Set(
      students.filter((s) => s.currentSectionId === sectionSubject.sectionId).map((s) => s.id),
    );
    // Elective subject: being in the section isn't enough — the student
    // also has to actually be enrolled in this particular elective (see
    // StudentElectiveEnrollment's doc comment in schema.prisma).
    if (sectionSubject.isElective) {
      const enrollments = await tx.studentElectiveEnrollment.findMany({
        where: { sectionSubjectId: sectionSubject.id, studentId: { in: [...validIds] } },
      });
      const enrolledIds = new Set(enrollments.map((e) => e.studentId));
      validIds = new Set([...validIds].filter((sid) => enrolledIds.has(sid)));
    }
    const invalid = studentIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw AppError.badRequest(
        sectionSubject.isElective
          ? 'Some students are not enrolled in this elective subject'
          : 'Some students are not currently enrolled in this section',
        { invalid },
      );
    }

    const exceeded = input.records.filter(
      (r) => r.marksObtained !== null && r.marksObtained > classTest.maxMarks,
    );
    if (exceeded.length > 0) {
      throw AppError.badRequest(`marksObtained cannot exceed maxMarks (${classTest.maxMarks})`, {
        exceeded: exceeded.map((r) => r.studentId),
      });
    }

    const marks = [];
    for (const r of input.records) {
      const mark = await tx.classTestMark.upsert({
        where: { classTestId_studentId: { classTestId, studentId: r.studentId } },
        update: { marksObtained: r.marksObtained, remarks: r.remarks, enteredByUserId: auth.userId },
        create: {
          id: randomUUID(),
          tenantId,
          classTestId,
          studentId: r.studentId,
          marksObtained: r.marksObtained,
          remarks: r.remarks,
          enteredByUserId: auth.userId,
        },
      });
      marks.push(mark);
    }
    return marks;
  });

  res.status(200).json({ data: result });
});

export { assertSectionSubjectAccess as assertClassTestSectionSubjectAccess };
