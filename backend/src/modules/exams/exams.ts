import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import {
  createExamSchema,
  updateExamSchema,
  createExamSubjectSchema,
  bulkSetDatesheetSchema,
  enterMarksSchema,
} from './validation';
import { gradeForPercentage } from './grading';
import { renderReportCardPdf } from './reportCardPdf';

export const examsRouter = Router();
examsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;
const MARKS_ENTRY_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

examsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const { academicYearId } = req.query as Record<string, string | undefined>;
  const exams = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.exam.findMany({
      where: academicYearId ? { academicYearId } : {},
      orderBy: { createdAt: 'desc' },
    }),
  );
  res.json({ data: exams });
});

examsRouter.post('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = createExamSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const exam = await runWithTenant(tenantId, async (tx) => {
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId } });
    if (!year) throw AppError.badRequest('Unknown academicYearId');

    const existing = await tx.exam.findFirst({
      where: { academicYearId: input.academicYearId, name: input.name },
    });
    if (existing) throw AppError.conflict('An exam with that name already exists for this academic year');

    return tx.exam.create({ data: { id: randomUUID(), tenantId, ...input } });
  });

  res.status(201).json({ data: exam });
});

/**
 * Admin-only follow-up edit — currently just the marks-submission deadline
 * (see Exam.resultsDeadline's doc comment in schema.prisma). Separate from
 * exam creation since the deadline is typically set/adjusted after the
 * exam and its subjects already exist.
 */
examsRouter.patch('/:examId', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = updateExamSchema.parse(req.body);
  const examId = uuidParam(req, 'examId');
  const tenantId = req.auth!.tenantId!;

  const exam = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.exam.findUnique({ where: { id: examId } });
    if (!existing) throw AppError.notFound('Exam not found');

    return tx.exam.update({
      where: { id: examId },
      data: 'resultsDeadline' in input ? { resultsDeadline: input.resultsDeadline ?? null } : {},
    });
  });

  res.json({ data: exam });
});

/** Add a section-subject offering to an exam, with its max/passing marks. */
examsRouter.post(
  '/:examId/subjects',
  requireRole(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const input = createExamSubjectSchema.parse(req.body);
    const examId = uuidParam(req, 'examId');
    const tenantId = req.auth!.tenantId!;

    const examSubject = await runWithTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) throw AppError.notFound('Exam not found');

      const sectionSubject = await tx.sectionSubject.findUnique({
        where: { id: input.sectionSubjectId },
      });
      if (!sectionSubject) throw AppError.badRequest('Unknown sectionSubjectId');

      const existing = await tx.examSubject.findUnique({
        where: { examId_sectionSubjectId: { examId, sectionSubjectId: input.sectionSubjectId } },
      });
      if (existing) throw AppError.conflict('This subject is already added to this exam');

      return tx.examSubject.create({
        data: { id: randomUUID(), tenantId, examId, ...input },
      });
    });

    res.status(201).json({ data: examSubject });
  },
);

/**
 * Builds (or edits) a whole class's exam datesheet in one call — the real
 * gap the single-subject route above left open: an admin had no way to lay
 * out "this class's Mid Term runs Monday Urdu, Tuesday Math, ..." except by
 * adding one subject at a time with no date on it at all. Every entry is
 * upserted (see bulkSetDatesheetSchema's doc comment), so calling this
 * again with adjusted dates is also how an already-built datesheet gets
 * edited — not just a one-time creation flow.
 */
examsRouter.post(
  '/:examId/subjects/bulk',
  requireRole(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const input = bulkSetDatesheetSchema.parse(req.body);
    const examId = uuidParam(req, 'examId');
    const tenantId = req.auth!.tenantId!;

    const rows = await runWithTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) throw AppError.notFound('Exam not found');

      const sectionSubjectIds = input.subjects.map((s) => s.sectionSubjectId);
      const validSectionSubjects = await tx.sectionSubject.findMany({
        where: { id: { in: sectionSubjectIds }, sectionId: input.sectionId },
      });
      const validIds = new Set(validSectionSubjects.map((ss) => ss.id));
      const invalid = sectionSubjectIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw AppError.badRequest('Some subjects do not belong to this section', { invalid });
      }

      const results = [];
      for (const s of input.subjects) {
        const row = await tx.examSubject.upsert({
          where: { examId_sectionSubjectId: { examId, sectionSubjectId: s.sectionSubjectId } },
          update: {
            maxMarks: s.maxMarks,
            passingMarks: s.passingMarks,
            examDate: s.examDate,
            startTime: s.startTime ?? null,
          },
          create: {
            id: randomUUID(),
            tenantId,
            examId,
            sectionSubjectId: s.sectionSubjectId,
            maxMarks: s.maxMarks,
            passingMarks: s.passingMarks,
            examDate: s.examDate,
            startTime: s.startTime ?? null,
          },
        });
        results.push(row);
      }
      return results;
    });

    res.status(200).json({ data: rows });
  },
);

examsRouter.get('/:examId/subjects', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const examId = uuidParam(req, 'examId');
  const { sectionId } = req.query as Record<string, string | undefined>;

  const rows = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.examSubject.findMany({
      where: {
        examId,
        ...(sectionId ? { sectionSubject: { sectionId } } : {}),
      },
      include: {
        sectionSubject: {
          include: {
            subject: true,
            section: { select: { id: true, name: true } },
            teacher: { select: { id: true, fullName: true } },
          },
        },
      },
      // Datesheet order — earliest paper first; subjects with no date yet
      // (added via the old single-subject route, not yet through the
      // datesheet builder) sort after everything that has one.
      orderBy: [{ examDate: { sort: 'asc', nulls: 'last' } }],
    }),
  );
  res.json({ data: rows });
});

/** Throws 403 if a TEACHER caller isn't the assigned subject teacher. */
async function assertMarksAccess(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  examSubjectId: string,
) {
  const examSubject = await tx.examSubject.findUnique({
    where: { id: examSubjectId },
    include: { sectionSubject: true },
  });
  if (!examSubject) throw AppError.notFound('Exam subject not found');
  if (auth.role === 'TEACHER' && examSubject.sectionSubject.teacherId !== auth.userId) {
    throw AppError.forbidden('You are not the assigned teacher for this subject');
  }
  return examSubject;
}

/** Bulk marks entry/edit for one exam-subject (one class's one paper). */
examsRouter.post(
  '/subjects/:examSubjectId/marks',
  requireRole(...MARKS_ENTRY_ROLES),
  async (req: Request, res: Response) => {
    const input = enterMarksSchema.parse(req.body);
    const examSubjectId = uuidParam(req, 'examSubjectId');
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;

    const result = await runWithTenant(tenantId, async (tx) => {
      const examSubject = await assertMarksAccess(tx, auth, examSubjectId);

      const studentIds = input.records.map((r) => r.studentId);
      const students = await tx.student.findMany({ where: { id: { in: studentIds } } });
      let validIds = new Set(
        students.filter((s) => s.currentSectionId === examSubject.sectionSubject.sectionId).map((s) => s.id),
      );
      // For an elective subject, being in the section isn't enough — the
      // student also has to actually be enrolled in this particular
      // elective (see StudentElectiveEnrollment's doc comment).
      if (examSubject.sectionSubject.isElective) {
        const enrollments = await tx.studentElectiveEnrollment.findMany({
          where: { sectionSubjectId: examSubject.sectionSubjectId, studentId: { in: [...validIds] } },
        });
        const enrolledIds = new Set(enrollments.map((e) => e.studentId));
        validIds = new Set([...validIds].filter((sid) => enrolledIds.has(sid)));
      }
      const invalid = studentIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        throw AppError.badRequest(
          examSubject.sectionSubject.isElective
            ? 'Some students are not enrolled in this elective subject'
            : 'Some students are not currently enrolled in this section',
          { invalid },
        );
      }

      const exceeded = input.records.filter(
        (r) => r.marksObtained !== null && r.marksObtained > examSubject.maxMarks,
      );
      if (exceeded.length > 0) {
        throw AppError.badRequest(`marksObtained cannot exceed maxMarks (${examSubject.maxMarks})`, {
          exceeded: exceeded.map((r) => r.studentId),
        });
      }

      const marks = [];
      for (const r of input.records) {
        const mark = await tx.mark.upsert({
          where: { examSubjectId_studentId: { examSubjectId, studentId: r.studentId } },
          update: { marksObtained: r.marksObtained, remarks: r.remarks, enteredByUserId: auth.userId },
          create: {
            id: randomUUID(),
            tenantId,
            examSubjectId,
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
  },
);

/** Roster + marks (null if not yet entered) for one exam-subject. */
examsRouter.get(
  '/subjects/:examSubjectId/marks',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const examSubjectId = uuidParam(req, 'examSubjectId');
    const auth = req.auth!;

    const roster = await runWithTenant(auth.tenantId, async (tx) => {
      const examSubject = await assertMarksAccess(tx, auth, examSubjectId);

      const [sectionStudents, marks, electiveEnrollments] = await Promise.all([
        tx.student.findMany({
          where: { currentSectionId: examSubject.sectionSubject.sectionId, status: 'ACTIVE' },
          orderBy: { fullName: 'asc' },
        }),
        tx.mark.findMany({ where: { examSubjectId } }),
        // Only meaningful for an elective subject — see
        // StudentElectiveEnrollment's doc comment in schema.prisma.
        examSubject.sectionSubject.isElective
          ? tx.studentElectiveEnrollment.findMany({ where: { sectionSubjectId: examSubject.sectionSubjectId } })
          : Promise.resolve(null),
      ]);

      const students = electiveEnrollments
        ? sectionStudents.filter((s) => electiveEnrollments.some((e) => e.studentId === s.id))
        : sectionStudents;

      const byStudent = new Map(marks.map((m) => [m.studentId, m]));
      return students.map((s) => ({
        studentId: s.id,
        studentCode: s.studentCode,
        fullName: s.fullName,
        marksObtained: byStudent.get(s.id)?.marksObtained ?? null,
        remarks: byStudent.get(s.id)?.remarks ?? null,
        maxMarks: examSubject.maxMarks,
        passingMarks: examSubject.passingMarks,
      }));
    });

    res.json({ data: roster });
  },
);

/**
 * Explicit "I'm done entering marks" signal from the subject teacher (or
 * an admin on their behalf) — see ExamSubject.marksSubmittedAt's doc
 * comment in schema.prisma. Not a lock: marks can still be edited (and
 * re-submitted, or un-submitted) afterward.
 */
examsRouter.post(
  '/subjects/:examSubjectId/submit',
  requireRole(...MARKS_ENTRY_ROLES),
  async (req: Request, res: Response) => {
    const examSubjectId = uuidParam(req, 'examSubjectId');
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;

    const examSubject = await runWithTenant(tenantId, async (tx) => {
      await assertMarksAccess(tx, auth, examSubjectId);
      return tx.examSubject.update({
        where: { id: examSubjectId },
        data: { marksSubmittedAt: new Date(), marksSubmittedByUserId: auth.userId },
      });
    });

    res.json({ data: examSubject });
  },
);

/** Reopens a subject's marks for further editing — clears the submitted signal set above. */
examsRouter.post(
  '/subjects/:examSubjectId/unsubmit',
  requireRole(...MARKS_ENTRY_ROLES),
  async (req: Request, res: Response) => {
    const examSubjectId = uuidParam(req, 'examSubjectId');
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;

    const examSubject = await runWithTenant(tenantId, async (tx) => {
      await assertMarksAccess(tx, auth, examSubjectId);
      return tx.examSubject.update({
        where: { id: examSubjectId },
        data: { marksSubmittedAt: null, marksSubmittedByUserId: null },
      });
    });

    res.json({ data: examSubject });
  },
);

/**
 * Every exam-subject a TEACHER's own subject (one sectionSubject) has been
 * added to, with its submission state — powers the "Grades" shortcut on
 * the teacher's subject page (academics/courses/[sectionSubjectId]), so a
 * teacher can jump straight to marks entry for whichever exam is current
 * without going through the exam list first. SCHOOL_ADMIN may also call
 * this for any sectionSubjectId (e.g. from an admin view of a course).
 */
examsRouter.get(
  '/for-section-subject/:sectionSubjectId',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');
    const auth = req.auth!;

    const rows = await runWithTenant(auth.tenantId, async (tx) => {
      const sectionSubject = await tx.sectionSubject.findUnique({ where: { id: sectionSubjectId } });
      if (!sectionSubject) throw AppError.notFound('Section subject not found');
      if (auth.role === 'TEACHER' && sectionSubject.teacherId !== auth.userId) {
        throw AppError.forbidden('You are not the assigned teacher for this subject');
      }

      return tx.examSubject.findMany({
        where: { sectionSubjectId },
        include: {
          exam: true,
          marksSubmittedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { exam: { createdAt: 'desc' } },
      });
    });

    res.json({ data: rows });
  },
);

/**
 * Ranked whole-section results for one exam — every active student in the
 * section with their aggregate percentage across all subjects examined in
 * this section for this exam, sorted best-to-worst with standard
 * competition ranking (ties share a rank; the next distinct score skips
 * the tied count, e.g. 1, 1, 3). A student with no marks entered anywhere
 * yet sorts last with rank: null — there's nothing to rank them on, which
 * is different from ranking last with a score of zero. Shared by the
 * admin's per-section results list below and buildReportCard's own
 * "Position: X of Y" summary field, so both always agree.
 */
async function computeSectionExamResults(tx: Prisma.TransactionClient, examId: string, sectionId: string) {
  const [examSubjects, students, gradingBands] = await Promise.all([
    tx.examSubject.findMany({
      where: { examId, sectionSubject: { sectionId } },
      include: { sectionSubject: true },
    }),
    tx.student.findMany({ where: { currentSectionId: sectionId, status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
    tx.gradingBand.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  const bands = gradingBands.length
    ? gradingBands.map((b) => ({ grade: b.grade, minPercentage: Number(b.minPercentage) }))
    : undefined;

  const electiveExamSubjects = examSubjects.filter((es) => es.sectionSubject.isElective);
  const electiveEnrollments = electiveExamSubjects.length
    ? await tx.studentElectiveEnrollment.findMany({
        where: { sectionSubjectId: { in: electiveExamSubjects.map((es) => es.sectionSubjectId) } },
      })
    : [];
  const enrolledSet = new Set(electiveEnrollments.map((e) => `${e.sectionSubjectId}:${e.studentId}`));

  const marks = examSubjects.length
    ? await tx.mark.findMany({ where: { examSubjectId: { in: examSubjects.map((es) => es.id) } } })
    : [];
  const marksByExamSubject = new Map<string, Map<string, number | null>>();
  for (const m of marks) {
    if (!marksByExamSubject.has(m.examSubjectId)) marksByExamSubject.set(m.examSubjectId, new Map());
    marksByExamSubject.get(m.examSubjectId)!.set(m.studentId, m.marksObtained);
  }

  const rows = students.map((student) => {
    const relevant = examSubjects.filter(
      (es) => !es.sectionSubject.isElective || enrolledSet.has(`${es.sectionSubjectId}:${student.id}`),
    );
    let totalObtained = 0;
    let totalMax = 0;
    let subjectsGraded = 0;
    for (const es of relevant) {
      const obtained = marksByExamSubject.get(es.id)?.get(student.id);
      if (obtained !== null && obtained !== undefined) {
        totalObtained += obtained;
        totalMax += es.maxMarks;
        subjectsGraded += 1;
      }
    }
    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 10000) / 100 : null;
    return {
      studentId: student.id,
      studentCode: student.studentCode,
      fullName: student.fullName,
      totalObtained,
      totalMax,
      percentage,
      grade: percentage !== null ? gradeForPercentage(percentage, bands) : null,
      subjectsGraded,
      subjectsTotal: relevant.length,
    };
  });

  const ranked = [...rows].filter((r) => r.percentage !== null).sort((a, b) => b.percentage! - a.percentage!);
  const rankByStudent = new Map<string, number>();
  let lastPercentage: number | null = null;
  let lastRank = 0;
  ranked.forEach((r, idx) => {
    if (r.percentage !== lastPercentage) {
      lastRank = idx + 1;
      lastPercentage = r.percentage;
    }
    rankByStudent.set(r.studentId, lastRank);
  });

  return rows
    .map((r) => ({ ...r, rank: rankByStudent.get(r.studentId) ?? null, totalRanked: ranked.length }))
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.fullName.localeCompare(b.fullName);
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });
}

/**
 * Powers the admin's "Generate Result" flow: pick a Class + Section and
 * get every student's ranked result inline (see computeSectionExamResults)
 * instead of the old zip-of-PDFs-only path (still available below via
 * report-card-batches, for when a printable set is actually needed).
 */
examsRouter.get('/:examId/results', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const examId = uuidParam(req, 'examId');
  const { sectionId } = req.query as Record<string, string | undefined>;
  if (!sectionId) throw AppError.badRequest('sectionId is required');

  const rows = await runWithTenant(req.auth!.tenantId, async (tx) => {
    const exam = await tx.exam.findUnique({ where: { id: examId } });
    if (!exam) throw AppError.notFound('Exam not found');
    return computeSectionExamResults(tx, examId, sectionId);
  });

  res.json({ data: rows });
});

/**
 * Admin visibility into which subject teachers have (and haven't) finished
 * entering/submitting marks for this exam — so an admin approaching the
 * results deadline (Exam.resultsDeadline) knows exactly who to follow up
 * with, instead of clicking into every subject to check.
 */
examsRouter.get(
  '/:examId/submission-status',
  requireRole(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const examId = uuidParam(req, 'examId');

    const rows = await runWithTenant(req.auth!.tenantId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) throw AppError.notFound('Exam not found');

      const examSubjects = await tx.examSubject.findMany({
        where: { examId },
        include: {
          sectionSubject: {
            include: {
              subject: true,
              section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
              teacher: { select: { id: true, fullName: true } },
            },
          },
          marksSubmittedBy: { select: { id: true, fullName: true } },
        },
      });

      const marksCounts = examSubjects.length
        ? await tx.mark.groupBy({
            by: ['examSubjectId'],
            where: { examSubjectId: { in: examSubjects.map((es) => es.id) }, marksObtained: { not: null } },
            _count: true,
          })
        : [];
      const enteredCountByExamSubject = new Map(marksCounts.map((c) => [c.examSubjectId, c._count]));

      // Total roster size per section-subject — mirrors the roster GET's
      // elective handling above so "X/Y entered" always matches what the
      // teacher actually sees on their own marks entry page.
      const sectionIds = [...new Set(examSubjects.map((es) => es.sectionSubject.sectionId))];
      const activeCountBySection = new Map(
        await Promise.all(
          sectionIds.map(async (sectionId) => {
            const count = await tx.student.count({ where: { currentSectionId: sectionId, status: 'ACTIVE' } });
            return [sectionId, count] as const;
          }),
        ),
      );
      const electiveExamSubjects = examSubjects.filter((es) => es.sectionSubject.isElective);
      const electiveCounts = new Map(
        await Promise.all(
          electiveExamSubjects.map(async (es) => {
            const count = await tx.studentElectiveEnrollment.count({
              where: { sectionSubjectId: es.sectionSubjectId },
            });
            return [es.id, count] as const;
          }),
        ),
      );

      return examSubjects.map((es) => ({
        examSubjectId: es.id,
        subject: es.sectionSubject.subject.name,
        section: `${es.sectionSubject.section.schoolClass.name} - ${es.sectionSubject.section.name}`,
        teacher: es.sectionSubject.teacher,
        totalStudents: es.sectionSubject.isElective
          ? (electiveCounts.get(es.id) ?? 0)
          : (activeCountBySection.get(es.sectionSubject.sectionId) ?? 0),
        marksEnteredCount: enteredCountByExamSubject.get(es.id) ?? 0,
        submitted: es.marksSubmittedAt !== null,
        submittedAt: es.marksSubmittedAt,
        submittedBy: es.marksSubmittedBy,
      }));
    });

    res.json({ data: rows });
  },
);

export async function buildReportCard(
  tx: Prisma.TransactionClient,
  examId: string,
  studentId: string,
) {
  const [exam, student, examSubjects, gradingBands] = await Promise.all([
    tx.exam.findUnique({ where: { id: examId }, include: { academicYear: true } }),
    tx.student.findUnique({
      where: { id: studentId },
      include: { currentSection: { select: { name: true, schoolClass: { select: { name: true } } } } },
    }),
    tx.examSubject.findMany({
      where: { examId },
      include: { sectionSubject: { include: { subject: true } } },
    }),
    // Tenant-scoped by RLS — no explicit tenantId filter needed. Empty for
    // tenants created before this field existed; gradeForPercentage()
    // falls back to the historical hardcoded scale in that case.
    tx.gradingBand.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  // Prisma's Decimal deliberately throws on implicit numeric coercion
  // (valueOf), so convert once here rather than at every comparison site.
  const bands = gradingBands.length
    ? gradingBands.map((b) => ({ grade: b.grade, minPercentage: Number(b.minPercentage) }))
    : undefined;

  if (!exam) throw AppError.notFound('Exam not found');
  if (!student) throw AppError.notFound('Student not found');

  const [tenant, attendanceCounts] = await Promise.all([
    tx.tenant.findUnique({ where: { id: exam.tenantId } }),
    tx.attendanceRecord.groupBy({
      by: ['status'],
      where: {
        studentId,
        date: { gte: exam.academicYear.startDate, lte: exam.academicYear.endDate },
      },
      _count: true,
    }),
  ]);

  const inSection = examSubjects.filter(
    (es) => es.sectionSubject.sectionId === student.currentSectionId,
  );
  // Drop elective subjects this particular student never opted into —
  // otherwise every student in the section would see every elective on
  // their report card, graded or not (see StudentElectiveEnrollment's
  // doc comment in schema.prisma).
  const electiveSectionSubjectIds = inSection
    .filter((es) => es.sectionSubject.isElective)
    .map((es) => es.sectionSubjectId);
  const enrolledSectionSubjectIds = electiveSectionSubjectIds.length
    ? new Set(
        (
          await tx.studentElectiveEnrollment.findMany({
            where: { studentId, sectionSubjectId: { in: electiveSectionSubjectIds } },
          })
        ).map((e) => e.sectionSubjectId),
      )
    : new Set<string>();
  const relevant = inSection.filter(
    (es) => !es.sectionSubject.isElective || enrolledSectionSubjectIds.has(es.sectionSubjectId),
  );
  const marks = await tx.mark.findMany({
    where: { studentId, examSubjectId: { in: relevant.map((es) => es.id) } },
  });
  const marksByExamSubject = new Map(marks.map((m) => [m.examSubjectId, m]));

  const subjects = relevant.map((es) => {
    const mark = marksByExamSubject.get(es.id);
    const obtained = mark?.marksObtained ?? null;
    const percentage = obtained !== null ? (obtained / es.maxMarks) * 100 : null;
    return {
      // Included so an "Edit" view (see exams-results frontend page) can
      // call the existing saveMarks(examSubjectId, ...) endpoint directly
      // for this one subject without a separate lookup.
      examSubjectId: es.id,
      subject: es.sectionSubject.subject.name,
      maxMarks: es.maxMarks,
      passingMarks: es.passingMarks,
      marksObtained: obtained,
      percentage: percentage !== null ? Math.round(percentage * 100) / 100 : null,
      grade: percentage !== null ? gradeForPercentage(percentage, bands) : null,
      passed: obtained !== null ? obtained >= es.passingMarks : null,
    };
  });

  const graded = subjects.filter((s) => s.marksObtained !== null);
  const totalObtained = graded.reduce((sum, s) => sum + (s.marksObtained ?? 0), 0);
  const totalMax = graded.reduce((sum, s) => sum + s.maxMarks, 0);
  const overallPercentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : null;

  const countFor = (status: string) =>
    attendanceCounts.find((c) => c.status === status)?._count ?? 0;
  const present = countFor('PRESENT');
  const absent = countFor('ABSENT');
  const leave = countFor('LEAVE');
  const totalMarked = attendanceCounts.reduce((sum, c) => sum + c._count, 0);

  // Class position — computed the same way as the admin's whole-section
  // results list (computeSectionExamResults) so a student's report card
  // and the admin's list never disagree on the number. Only meaningful
  // for a student currently enrolled in a section; a student with no
  // current section (e.g. left the school) simply has no rank.
  const rankInfo = student.currentSectionId
    ? await computeSectionExamResults(tx, examId, student.currentSectionId).then((rows) =>
        rows.find((r) => r.studentId === studentId),
      )
    : undefined;

  return {
    school: tenant ? { name: tenant.name, logoUrl: tenant.logoUrl } : null,
    exam: { id: exam.id, name: exam.name, academicYear: exam.academicYear.name },
    student: {
      id: student.id,
      studentCode: student.studentCode,
      fullName: student.fullName,
      section: student.currentSection
        ? `${student.currentSection.schoolClass.name} - ${student.currentSection.name}`
        : null,
    },
    subjects,
    summary: {
      totalObtained,
      totalMax,
      percentage: overallPercentage !== null ? Math.round(overallPercentage * 100) / 100 : null,
      grade: overallPercentage !== null ? gradeForPercentage(overallPercentage, bands) : null,
      subjectsGraded: graded.length,
      subjectsTotal: subjects.length,
      rank: rankInfo?.rank ?? null,
      totalRanked: rankInfo?.totalRanked ?? 0,
    },
    attendance: totalMarked > 0 ? { present, absent, leave, totalMarked } : null,
  };
}

examsRouter.get(
  '/:examId/report-card/:studentId',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const examId = uuidParam(req, 'examId');
    const studentId = uuidParam(req, 'studentId');

    const reportCard = await runWithTenant(req.auth!.tenantId, (tx) => buildReportCard(tx, examId, studentId));
    res.json({ data: reportCard });
  },
);

examsRouter.get(
  '/:examId/report-card/:studentId/pdf',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const examId = uuidParam(req, 'examId');
    const studentId = uuidParam(req, 'studentId');

    const reportCard = await runWithTenant(req.auth!.tenantId, (tx) => buildReportCard(tx, examId, studentId));
    const pdfBuffer = await renderReportCardPdf(reportCard);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-card-${reportCard.student.studentCode}.pdf"`,
    );
    res.send(pdfBuffer);
  },
);
