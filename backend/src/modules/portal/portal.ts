import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { portalAttendanceQuerySchema, portalFeesQuerySchema, portalNoticesQuerySchema } from './validation';
import {
  resolveOwnStudentId,
  resolveGuardianChildIds,
  assertStudentAccess,
  assertAccessibleSectionSubject,
} from './access';
import { isNonWorkingDay } from '../attendance/holidays';
import { buildReportCard } from '../exams/exams';
import { syncMany } from '../fees/invoices';

export const portalRouter = Router();
portalRouter.use(requireAuth);

const PORTAL_ROLES = ['PARENT', 'STUDENT'] as const;
portalRouter.use(requireRole(...PORTAL_ROLES));

/**
 * School-wide "is there class today" state — shown on the portal landing
 * page before a PARENT has even picked a child (a STUDENT gets the same
 * information again on their own attendance card, which is fine — this is
 * cheap and avoids a student-scoped access check for what's ultimately
 * tenant-wide, not per-student, information).
 */
portalRouter.get('/today', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const nonWorking = await runWithTenant(auth.tenantId, (tx) => isNonWorkingDay(tx, auth.tenantId!, todayUtc));

  res.json({
    data: {
      date: todayUtc.toISOString(),
      isNonWorkingDay: nonWorking.isNonWorkingDay,
      reason: nonWorking.reason,
      label: nonWorking.label,
    },
  });
});

const studentSummarySelect = {
  id: true,
  studentCode: true,
  fullName: true,
  status: true,
  photoUrl: true,
  currentSection: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
} as const;

/** The logged-in portal user's own profile — their child(ren) if PARENT, themself if STUDENT. */
portalRouter.get('/me', async (req: Request, res: Response) => {
  const auth = req.auth!;

  const profile = await runWithTenant(auth.tenantId, async (tx) => {
    if (auth.role === 'STUDENT') {
      const student = await tx.student.findUnique({
        where: { userId: auth.userId },
        select: studentSummarySelect,
      });
      if (!student) throw AppError.notFound('No student profile is linked to this account');
      return { role: 'STUDENT' as const, student };
    }

    const guardian = await tx.guardian.findUnique({ where: { userId: auth.userId } });
    if (!guardian) throw AppError.notFound('No guardian profile is linked to this account');

    const links = await tx.studentGuardian.findMany({
      where: { guardianId: guardian.id },
      include: { student: { select: studentSummarySelect } },
    });

    return {
      role: 'PARENT' as const,
      guardian: { id: guardian.id, fullName: guardian.fullName, phone: guardian.phone, email: guardian.email },
      children: links.map((l) => ({ ...l.student, isPrimary: l.isPrimary })),
    };
  });

  res.json({ data: profile });
});

portalRouter.get('/students/:studentId', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const student = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return tx.student.findUnique({
      where: { id: studentId },
      select: {
        ...studentSummarySelect,
        gender: true,
        dateOfBirth: true,
        admissionDate: true,
      },
    });
  });

  if (!student) throw AppError.notFound('Student not found');
  res.json({ data: student });
});

/**
 * The student's weekly timetable for their CURRENT section — every
 * TimetableSlot across all of that section's courses, in the same shape
 * the staff side already uses (GET /api/timetable and a TEACHER's own GET
 * /api/timetable/me — see timetable.ts's SLOT_INCLUDE), so the frontend
 * can share one weekly-grid component across the teacher dashboard and
 * this portal. Real gap this fills: the portal's course cards (GET
 * .../courses below) already embed a timetableSlots array per-course, but
 * there was nowhere that showed the student's actual WEEK — which lecture
 * is when, with which teacher, in which room — laid out the way a real
 * printed school timetable is, rather than one course at a time.
 */
portalRouter.get('/students/:studentId/timetable', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const slots = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
    if (!student?.currentSectionId) return [];

    return tx.timetableSlot.findMany({
      where: { sectionSubject: { sectionId: student.currentSectionId } },
      include: {
        sectionSubject: {
          include: {
            subject: true,
            teacher: { select: { id: true, fullName: true } },
            section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  });

  res.json({ data: slots });
});

portalRouter.get('/students/:studentId/attendance', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');
  const query = portalAttendanceQuerySchema.parse(req.query);

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const records = await tx.attendanceRecord.findMany({
      where: {
        studentId,
        ...(query.from || query.to
          ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
      },
      orderBy: { date: 'desc' },
    });

    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0, HALF_DAY: 0, EARLY_LEAVE: 0 };
    for (const r of records) counts[r.status] += 1;

    // A dedicated lookup (not derived from `records` above, which is
    // range-filtered by query.from/to and may not include today at all) —
    // this is what drives the portal's "No class today" banner.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const [nonWorking, todayRecord] = await Promise.all([
      isNonWorkingDay(tx, auth.tenantId!, todayUtc),
      tx.attendanceRecord.findUnique({ where: { studentId_date: { studentId, date: todayUtc } } }),
    ]);

    return {
      records,
      summary: { totalMarked: records.length, counts },
      today: {
        date: todayUtc.toISOString(),
        isNonWorkingDay: nonWorking.isNonWorkingDay,
        reason: nonWorking.reason,
        label: nonWorking.label,
        status: todayRecord?.status ?? null,
      },
    };
  });

  res.json({ data: result });
});

/**
 * A student's fee ledger — invoices, payments, and running balance.
 * By default only outstanding invoices are returned (a fully-PAID one
 * drops off the list once settled — see portalFeesQuerySchema); pass
 * ?includePaid=true for the full history. The summary totals always
 * reflect every invoice regardless of that filter.
 */
portalRouter.get('/students/:studentId/fees', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');
  const query = portalFeesQuerySchema.parse(req.query);

  const ledger = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const rawInvoices = await tx.invoice.findMany({
      where: { studentId },
      include: { lineItems: true, payments: true },
      // Most-recent-first — a parent opening this page cares about what's
      // currently due, not the oldest invoice on file (the page below
      // shows only the first 10; oldest-first was pushing current/overdue
      // invoices out of view for any family with enough billing history).
      orderBy: { issueDate: 'desc' },
    });
    // Same freshness fix as the staff-facing ledger (invoices.ts) — without
    // this, a fine assessed today wouldn't show up here until something
    // else happened to touch the invoice.
    const invoices = await syncMany(tx, auth.tenantId!, rawInvoices);

    const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);
    const visibleInvoices = query.includePaid ? invoices : invoices.filter((inv) => inv.status !== 'PAID');

    return { invoices: visibleInvoices, summary: { totalBilled, totalPaid, balance: totalBilled - totalPaid } };
  });

  res.json({ data: ledger });
});

/**
 * Read-only conduct/discipline history for a PARENT's own child or a
 * STUDENT's own record — the portal-side counterpart of
 * GET /api/discipline-records on the staff side. Most Pakistani schools
 * already inform a parent by phone/note when something is logged (see
 * discipline.ts's notifyGuardianNow); this is just the same record made
 * visible in the portal too, instead of only living in the office file.
 */
portalRouter.get('/students/:studentId/discipline-records', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const records = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return tx.disciplineRecord.findMany({
      where: { studentId },
      include: { reportedByUser: { select: { id: true, fullName: true } } },
      orderBy: { incidentDate: 'desc' },
    });
  });

  res.json({ data: records });
});

/**
 * Read-only learning-support-plan visibility for a PARENT's own child or a
 * STUDENT's own record — the portal-side counterpart of
 * GET /api/support-needs on the staff side. A support plan is written FOR
 * the student's benefit, so the family that requested or needs to
 * reinforce it at home should be able to see it, same reasoning as
 * discipline records being visible in the portal.
 */
portalRouter.get('/students/:studentId/support-needs', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const records = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return tx.supportNeed.findMany({
      where: { studentId },
      include: {
        coordinatorUser: { select: { id: true, fullName: true } },
        reviews: { orderBy: { reviewDate: 'desc' }, select: { id: true, reviewDate: true, notes: true, updatedStatus: true } },
      },
      orderBy: { identifiedDate: 'desc' },
    });
  });

  res.json({ data: records });
});

/**
 * Read-only health profile visibility for a PARENT's own child or a
 * STUDENT's own record. Most of this data (allergies, blood group,
 * emergency contacts) was originally supplied BY the family in the first
 * place — showing it back lets them confirm it's still accurate, and see
 * exactly what the school has on file in an emergency.
 */
portalRouter.get('/students/:studentId/health-profile', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const profile = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return tx.studentHealthProfile.findUnique({ where: { studentId } });
  });

  res.json({ data: profile });
});

/**
 * Read-only first-aid/clinic-visit history for a PARENT's own child or a
 * STUDENT's own record — the portal-side counterpart of
 * GET /api/health/log-entries on the staff side.
 */
portalRouter.get('/students/:studentId/health-log', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const entries = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return tx.healthLogEntry.findMany({
      where: { studentId },
      orderBy: { visitDate: 'desc' },
    });
  });

  res.json({ data: entries });
});

/** Exams that have subjects mapped for the student's current section. */
portalRouter.get('/students/:studentId/exams', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const exams = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student?.currentSectionId) return [];

    return tx.exam.findMany({
      where: { examSubjects: { some: { sectionSubject: { sectionId: student.currentSectionId } } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  res.json({ data: exams });
});

portalRouter.get('/students/:studentId/exams/:examId/report-card', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');
  const examId = uuidParam(req, 'examId');

  const reportCard = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    return buildReportCard(tx, examId, studentId);
  });

  res.json({ data: reportCard });
});

/**
 * The exam datesheet for one exam, scoped to this student's own section
 * (and elective enrollments) — subject, paper date, and time, earliest
 * first. Only entries an admin has actually placed a date on show up (see
 * exams.ts's /:examId/subjects/bulk, the datesheet builder) — a subject
 * added to the exam but not yet dated simply doesn't appear here yet,
 * rather than showing a parent a blank or misleading date.
 */
portalRouter.get('/students/:studentId/exams/:examId/datesheet', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');
  const examId = uuidParam(req, 'examId');

  const rows = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student?.currentSectionId) return [];

    const examSubjects = await tx.examSubject.findMany({
      where: { examId, examDate: { not: null }, sectionSubject: { sectionId: student.currentSectionId } },
      include: { sectionSubject: { include: { subject: true } } },
      orderBy: [{ examDate: 'asc' }, { startTime: { sort: 'asc', nulls: 'last' } }],
    });

    // Same elective-enrollment narrowing as buildReportCard above — a
    // student shouldn't see a paper date for an elective they never
    // opted into (see StudentElectiveEnrollment's doc comment).
    const electiveSectionSubjectIds = examSubjects
      .filter((es) => es.sectionSubject.isElective)
      .map((es) => es.sectionSubjectId);
    const enrolledIds = electiveSectionSubjectIds.length
      ? new Set(
          (
            await tx.studentElectiveEnrollment.findMany({
              where: { studentId, sectionSubjectId: { in: electiveSectionSubjectIds } },
            })
          ).map((e) => e.sectionSubjectId),
        )
      : new Set<string>();

    return examSubjects
      .filter((es) => !es.sectionSubject.isElective || enrolledIds.has(es.sectionSubjectId))
      .map((es) => ({
        examSubjectId: es.id,
        subject: es.sectionSubject.subject.name,
        examDate: es.examDate,
        startTime: es.startTime,
        maxMarks: es.maxMarks,
      }));
  });

  res.json({ data: rows });
});

// ────────────────────────────────────────────────────────────────
// Course cards — the student/parent portal's course-centric dashboard.
// "Course" here means one SectionSubject: a subject taught to the
// student's current section by one teacher. Each card links out to five
// sub-views (Announcement/Course Material/Assessment/View Grades/
// Attendance) — all implemented below by narrowing data that already
// existed for other reasons (Notice, Homework, Mark, AttendanceRecord) to
// just this one section-subject, rather than inventing parallel per-course
// copies of each.
// ────────────────────────────────────────────────────────────────

/** The student's enrolled courses for their CURRENT section — the card grid on their portal dashboard. */
portalRouter.get('/students/:studentId/courses', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const courses = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);

    const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
    if (!student?.currentSectionId) return [];

    return tx.sectionSubject.findMany({
      where: { sectionId: student.currentSectionId },
      include: {
        subject: { select: { id: true, name: true } },
        teacher: { select: { id: true, fullName: true } },
        section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
      },
      orderBy: { subject: { name: 'asc' } },
    });
  });

  res.json({ data: courses });
});

/**
 * A course's Announcement tab — the SAME Notice model behind the staff
 * `/api/notices` and portal `/notices` routes, narrowed to notices
 * published by THIS course's own teacher for THIS section, rather than a
 * separate per-course announcement model. A section-wide notice from a
 * different teacher, or a school-wide notice, still shows up on the
 * general Notice Board — just not repeated on every one of that student's
 * course cards.
 */
portalRouter.get(
  '/students/:studentId/courses/:sectionSubjectId/announcements',
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');

    const notices = await runWithTenant(auth.tenantId, async (tx) => {
      await assertStudentAccess(tx, auth, studentId);
      const course = await assertAccessibleSectionSubject(tx, studentId, sectionSubjectId);
      if (!course.teacherId) return [];

      return tx.notice.findMany({
        where: {
          sectionId: course.sectionId,
          publishedByUserId: course.teacherId,
          audiences: { has: 'SECTION' },
        },
        include: { publishedByUser: { select: { id: true, fullName: true } } },
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
      });
    });

    res.json({ data: notices });
  },
);

/** A course's Course Material tab — files the teacher has shared for this section-subject. */
portalRouter.get(
  '/students/:studentId/courses/:sectionSubjectId/materials',
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');

    const materials = await runWithTenant(auth.tenantId, async (tx) => {
      await assertStudentAccess(tx, auth, studentId);
      await assertAccessibleSectionSubject(tx, studentId, sectionSubjectId);

      return tx.courseMaterial.findMany({
        where: { sectionSubjectId },
        include: { uploadedByUser: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    res.json({ data: materials });
  },
);

/** A course's Assessment tab — homework assigned for this section-subject. */
portalRouter.get(
  '/students/:studentId/courses/:sectionSubjectId/homework',
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');

    const homework = await runWithTenant(auth.tenantId, async (tx) => {
      await assertStudentAccess(tx, auth, studentId);
      const course = await assertAccessibleSectionSubject(tx, studentId, sectionSubjectId);

      return tx.homework.findMany({
        where: { sectionId: course.sectionId, subjectId: course.subjectId },
        include: { assignedByUser: { select: { id: true, fullName: true } } },
        orderBy: { dueDate: 'desc' },
      });
    });

    res.json({ data: homework });
  },
);

/**
 * A course's View Grades tab — this student's marks across every exam that
 * has graded this section-subject, newest exam first. A lighter, single-
 * course slice of the same Mark data the full report card (see
 * GET .../exams/:examId/report-card above) already exposes per-exam.
 */
portalRouter.get('/students/:studentId/courses/:sectionSubjectId/grades', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');
  const sectionSubjectId = uuidParam(req, 'sectionSubjectId');

  const grades = await runWithTenant(auth.tenantId, async (tx) => {
    await assertStudentAccess(tx, auth, studentId);
    await assertAccessibleSectionSubject(tx, studentId, sectionSubjectId);

    const examSubjects = await tx.examSubject.findMany({
      where: { sectionSubjectId },
      include: {
        exam: { select: { id: true, name: true, startDate: true, endDate: true } },
        marks: { where: { studentId } },
      },
      orderBy: { exam: { createdAt: 'desc' } },
    });

    return examSubjects.map((es) => ({
      exam: es.exam,
      maxMarks: es.maxMarks,
      passingMarks: es.passingMarks,
      marksObtained: es.marks[0]?.marksObtained ?? null,
      remarks: es.marks[0]?.remarks ?? null,
    }));
  });

  res.json({ data: grades });
});

/**
 * A course's Class Tests tab — this student's marks across every class test
 * a teacher has self-created for this section-subject (see
 * exams/classTests.ts's doc comment), newest first. Deliberately a separate
 * route from the formal-exam Grades tab above rather than merged into it:
 * class tests are a distinct concept the parent/teacher told us must never
 * be confused with a formal exam paper — most visibly, they never factor
 * into the report card or section ranking.
 */
portalRouter.get(
  '/students/:studentId/courses/:sectionSubjectId/class-tests',
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');
    const sectionSubjectId = uuidParam(req, 'sectionSubjectId');

    const classTests = await runWithTenant(auth.tenantId, async (tx) => {
      await assertStudentAccess(tx, auth, studentId);
      await assertAccessibleSectionSubject(tx, studentId, sectionSubjectId);

      const rows = await tx.classTest.findMany({
        where: { sectionSubjectId },
        include: { marks: { where: { studentId } } },
        orderBy: { createdAt: 'desc' },
      });

      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        maxMarks: c.maxMarks,
        passingMarks: c.passingMarks,
        marksObtained: c.marks[0]?.marksObtained ?? null,
        remarks: c.marks[0]?.remarks ?? null,
        createdAt: c.createdAt,
      }));
    });

    res.json({ data: classTests });
  },
);

const portalNoticeInclude = {
  section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
  publishedByUser: { select: { id: true, fullName: true } },
} as const;

/**
 * The Notice Board a STUDENT or PARENT portal account can see: school-wide
 * notices for their role (ALL_STUDENTS / ALL_GUARDIANS), any SECTION notice
 * for a section they (or their linked child) currently belong to, and any
 * INDIVIDUAL notice explicitly addressed to them. Never shows ALL_STAFF or
 * an INDIVIDUAL notice addressed to someone else — this is the read side of
 * the same visibility rules enforced on the staff `GET /api/notices`.
 */
portalRouter.get('/notices', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const query = portalNoticesQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    let where: Prisma.NoticeWhereInput;

    if (auth.role === 'STUDENT') {
      const student = await tx.student.findUnique({
        where: { userId: auth.userId },
        select: { currentSectionId: true },
      });
      if (!student) throw AppError.notFound('No student profile is linked to this account');

      where = {
        OR: [
          { audiences: { has: 'ALL_STUDENTS' } },
          ...(student.currentSectionId
            ? [{ audiences: { has: 'SECTION' as const }, sectionId: student.currentSectionId }]
            : []),
          { audiences: { has: 'INDIVIDUAL' }, recipients: { some: { userId: auth.userId } } },
        ],
      };
    } else {
      const guardian = await tx.guardian.findUnique({ where: { userId: auth.userId }, select: { id: true } });
      if (!guardian) throw AppError.notFound('No guardian profile is linked to this account');

      const links = await tx.studentGuardian.findMany({
        where: { guardianId: guardian.id },
        select: { student: { select: { currentSectionId: true } } },
      });
      const sectionIds = Array.from(
        new Set(links.map((l) => l.student.currentSectionId).filter((id): id is string => !!id)),
      );

      where = {
        OR: [
          { audiences: { has: 'ALL_GUARDIANS' } },
          ...(sectionIds.length > 0
            ? [{ audiences: { has: 'SECTION' as const }, sectionId: { in: sectionIds } }]
            : []),
          { audiences: { has: 'INDIVIDUAL' }, recipients: { some: { userId: auth.userId } } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      tx.notice.findMany({
        where,
        include: portalNoticeInclude,
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
        skip,
        take,
      }),
      tx.notice.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

// Kept for symmetry / potential future use by a "switch child" UI — resolves
// just the list of studentIds this portal account can see.
portalRouter.get('/accessible-student-ids', async (req: Request, res: Response) => {
  const auth = req.auth!;
  const ids = await runWithTenant(auth.tenantId, async (tx) => {
    if (auth.role === 'STUDENT') {
      const id = await resolveOwnStudentId(tx, auth);
      return id ? [id] : [];
    }
    return resolveGuardianChildIds(tx, auth);
  });
  res.json({ data: ids });
});
