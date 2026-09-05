import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { teacherSectionIds } from '../../lib/teacherScope';
import { renderAttendanceReportPdf } from './attendanceReportPdf';
import { isNonWorkingDay } from './holidays';
import {
  markAttendanceSchema,
  rosterQuerySchema,
  studentHistoryQuerySchema,
  summaryQuerySchema,
} from './validation';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER'] as const;

/**
 * Throws 403 if a TEACHER caller isn't allowed into `sectionId` — either as
 * its class teacher or as a subject teacher assigned to it (see
 * lib/teacherScope.ts), so a Math-only teacher can mark/view attendance for
 * their own periods even in a section they don't class-teach.
 */
async function assertSectionAccess(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  sectionId: string,
) {
  const section = await tx.section.findUnique({ where: { id: sectionId } });
  if (!section) throw AppError.badRequest('Unknown sectionId');
  if (auth.role === 'TEACHER') {
    const allowed = await teacherSectionIds(tx, auth.userId);
    if (!allowed.includes(sectionId)) {
      throw AppError.forbidden('You do not have access to this section');
    }
  }
  return section;
}

// Prisma's @db.Time columns round-trip as a Date with an arbitrary date
// part (1970-01-01) and the real value sitting in the UTC time-of-day
// fields — matching how createTimetableSlotSchema parses the admin's
// "HH:MM" input (see academics/validation.ts's timeStringSchema). Reduce
// to plain minutes-since-midnight so "is it before the lecture's start
// time" is a plain integer comparison with no date-part footguns.
function minutesSinceMidnightUtc(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// Pakistan Standard Time is a fixed UTC+5 offset (no daylight saving) —
// every school on this platform is in Pakistan (see Tenant.timezone's own
// "Asia/Karachi" default), and nothing else in this codebase does
// timezone-aware date math, so this stays a plain constant rather than
// pulling in a general IANA timezone conversion nobody else needs yet.
const PAKISTAN_UTC_OFFSET_MINUTES = 5 * 60;

// A lecture's stored startTime/endTime (see minutesSinceMidnightUtc above)
// are the literal HH:MM an admin typed into the timetable form — always
// meant as Pakistan wall-clock time, never real UTC. `now`, on the other
// hand, IS real UTC (Date's UTC getters are timezone-independent, however
// the server's OS clock is configured) — so "is it currently within the
// lecture's window" has to compare against Pakistan wall-clock "now", not
// real UTC "now", or the window silently drifts a full 5 hours from what
// the school actually experiences (a lecture typed as 8:00 AM would only
// ever "open" at 1:00 PM Pakistan time). Only the "now" side needs this
// shift — the stored slot times are already in the right frame.
function minutesSinceMidnightPakistanNow(d: Date): number {
  return (minutesSinceMidnightUtc(d) + PAKISTAN_UTC_OFFSET_MINUTES) % (24 * 60);
}

// Date#getUTCDay() is 0=Sunday..6=Saturday; DayOfWeek's own values are
// spelled out MONDAY..SUNDAY. Nothing elsewhere in the codebase needed
// this specific mapping yet — every other place either takes dayOfWeek
// as-given (timetable CRUD) or already works in the 0-6 numeric form
// (weeklyOffDays) — so it's defined here rather than reused.
const JS_DAY_TO_DAY_OF_WEEK = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const;

// How many minutes before a lecture's scheduled end its quick-mark
// attendance window closes — see assertLectureAttendanceWindowOpen below.
// A named constant since the user's actual ask ("lec khtm hone se 5 mnt
// phle attendance lock ho jaye") is specifically 5 minutes, not "at the
// end" — keeping it named makes that intentional, not a magic number.
const LOCK_BEFORE_LECTURE_END_MINUTES = 5;

/**
 * Enforces the quick-mark attendance window for one specific lecture
 * (sectionSubjectId) today — the bug this exists for: a teacher opening
 * today's class from the course page could previously hit "Save
 * attendance" minutes before the lecture even started, and could keep
 * reopening and rewriting it long after the lecture ended, since
 * attendance itself has always been a plain per-day fact with no notion
 * of "this specific lecture, right now". Three edges enforced, all only
 * for *today*:
 *  - No timetable slot for this subject today at all → rejected ("not
 *    scheduled today"). This used to be silently allowed ("nothing to
 *    check against"), but that let a teacher mark attendance for a
 *    subject on a day it was never actually taught — a subject's
 *    attendance should only be markable from this shortcut on the exact
 *    day/time its own timetable slot says it runs.
 *  - Before the slot's startTime → rejected ("hasn't started yet").
 *  - From `endTime - LOCK_BEFORE_LECTURE_END_MINUTES` onward → rejected
 *    ("locked") — deliberately locks a few minutes *before* the actual
 *    end, per the user's own ask, so the window closes while the lecture
 *    is still winding down rather than the instant the bell rings.
 * Deliberately narrow, same as before:
 *  - Only runs when `sectionSubjectId` was actually sent — the general
 *    Attendance page (whole-section daily attendance, no single lecture
 *    to check against) never sends it, so that flow is untouched. Once
 *    locked here, an admin/front-desk can still correct the day's record
 *    from that general page — this only locks the teacher's course-page
 *    shortcut for that one lecture.
 *  - Only applies to *today* — correcting an earlier day's attendance
 *    has no "not scheduled"/"hasn't started"/"locked" window to violate;
 *    a teacher backfilling a past date isn't blocked by any of this.
 */
async function assertLectureAttendanceWindowOpen(
  tx: Prisma.TransactionClient,
  sectionId: string,
  sectionSubjectId: string,
  date: Date,
) {
  const now = new Date();
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (date.getTime() !== todayUtc.getTime()) return; // not today — nothing to check

  const sectionSubject = await tx.sectionSubject.findUnique({ where: { id: sectionSubjectId } });
  if (!sectionSubject || sectionSubject.sectionId !== sectionId) {
    throw AppError.badRequest('Unknown sectionSubjectId for this section');
  }

  const todayDayOfWeek = JS_DAY_TO_DAY_OF_WEEK[now.getUTCDay()];
  const slot = await tx.timetableSlot.findFirst({
    where: { sectionSubjectId, dayOfWeek: todayDayOfWeek },
    orderBy: { startTime: 'asc' },
  });
  if (!slot) {
    throw AppError.badRequest(
      'This subject has no timetable slot scheduled for today — attendance can only be marked from here on a day (and during the time) it actually runs.',
    );
  }

  const nowMinutes = minutesSinceMidnightPakistanNow(now);
  const startMinutes = minutesSinceMidnightUtc(slot.startTime);
  const endMinutes = minutesSinceMidnightUtc(slot.endTime);
  const lockMinutes = endMinutes - LOCK_BEFORE_LECTURE_END_MINUTES;

  if (nowMinutes < startMinutes) {
    const hh = String(slot.startTime.getUTCHours()).padStart(2, '0');
    const mm = String(slot.startTime.getUTCMinutes()).padStart(2, '0');
    throw AppError.badRequest(
      `This lecture hasn't started yet — it's scheduled for ${hh}:${mm} today. Attendance can be marked once it starts.`,
    );
  }

  if (nowMinutes >= lockMinutes) {
    const hh = String(slot.endTime.getUTCHours()).padStart(2, '0');
    const mm = String(slot.endTime.getUTCMinutes()).padStart(2, '0');
    throw AppError.badRequest(
      `Attendance for this lecture is locked — it closes ${LOCK_BEFORE_LECTURE_END_MINUTES} minutes before the lecture ends at ${hh}:${mm}. Ask an admin or front desk to correct it from the main Attendance page if needed.`,
    );
  }
}

/** Bulk mark (or re-mark) attendance for a whole section on one date. */
attendanceRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = markAttendanceSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const result = await runWithTenant(tenantId, async (tx) => {
    await assertSectionAccess(tx, auth, input.sectionId);

    if (input.sectionSubjectId) {
      await assertLectureAttendanceWindowOpen(tx, input.sectionId, input.sectionSubjectId, input.date);
    }

    const nonWorking = await isNonWorkingDay(tx, tenantId, input.date);
    if (nonWorking.isNonWorkingDay) {
      throw AppError.badRequest(
        `${input.date.toISOString().slice(0, 10)} is a non-working day (${nonWorking.label}) — attendance cannot be marked.`,
      );
    }

    const studentIds = input.records.map((r) => r.studentId);
    const students = await tx.student.findMany({ where: { id: { in: studentIds } } });
    const validIds = new Set(students.filter((s) => s.currentSectionId === input.sectionId).map((s) => s.id));
    const invalid = studentIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw AppError.badRequest('Some students are not currently enrolled in this section', { invalid });
    }

    // Fetched up front (not inside the loop) so each existing status is
    // known before any upsert runs — needed to tell an actual *edit*
    // (status changing on an already-marked day) apart from an initial
    // mark, which is the whole point of the audit trail below: knowing
    // someone was first marked ABSENT and later corrected to PRESENT is
    // useful; logging every single initial mark for a 300-student class
    // roster every single day is just noise.
    const existing = await tx.attendanceRecord.findMany({
      where: { sectionId: input.sectionId, date: input.date, studentId: { in: studentIds } },
    });
    const existingByStudent = new Map(existing.map((r) => [r.studentId, r]));

    const records = [];
    const edits: Array<{ studentId: string; fromStatus: string; toStatus: string }> = [];
    for (const r of input.records) {
      const prior = existingByStudent.get(r.studentId);
      if (prior && prior.status !== r.status) {
        edits.push({ studentId: r.studentId, fromStatus: prior.status, toStatus: r.status });
      }

      const record = await tx.attendanceRecord.upsert({
        where: { studentId_date: { studentId: r.studentId, date: input.date } },
        update: {
          status: r.status,
          remarks: r.remarks,
          sectionId: input.sectionId,
          markedByUserId: auth.userId,
        },
        create: {
          id: randomUUID(),
          tenantId,
          studentId: r.studentId,
          sectionId: input.sectionId,
          date: input.date,
          status: r.status,
          remarks: r.remarks,
          markedByUserId: auth.userId,
        },
      });
      records.push(record);
    }

    if (edits.length > 0) {
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actorUserId: auth.userId,
          action: 'attendance.records_edited',
          entityType: 'Section',
          entityId: input.sectionId,
          metadata: { date: input.date.toISOString().slice(0, 10), edits },
        },
      });
    }

    return records;
  });

  res.status(200).json({ data: result });
});

/**
 * The full section roster for a date, with each student's status (or null
 * if unmarked), plus whether that date is a non-working day — the
 * marking page uses `holiday` to show a "No class" banner instead of the
 * roster grid rather than letting staff try to mark a day that the POST /
 * route below would reject anyway.
 */
attendanceRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = rosterQuerySchema.parse(req.query);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    await assertSectionAccess(tx, auth, query.sectionId);

    const nonWorking = await isNonWorkingDay(tx, auth.tenantId!, query.date);

    const [students, records] = await Promise.all([
      tx.student.findMany({
        where: { currentSectionId: query.sectionId, status: 'ACTIVE' },
        orderBy: { fullName: 'asc' },
      }),
      tx.attendanceRecord.findMany({ where: { sectionId: query.sectionId, date: query.date } }),
    ]);

    const byStudent = new Map(records.map((r) => [r.studentId, r]));
    const roster = students.map((s) => ({
      studentId: s.id,
      studentCode: s.studentCode,
      fullName: s.fullName,
      status: byStudent.get(s.id)?.status ?? null,
      remarks: byStudent.get(s.id)?.remarks ?? null,
    }));

    return {
      holiday: nonWorking.isNonWorkingDay ? { reason: nonWorking.reason, label: nonWorking.label } : null,
      roster,
    };
  });

  res.json({ data: result });
});

/** A single student's attendance history. */
attendanceRouter.get(
  '/student/:studentId',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const query = studentHistoryQuerySchema.parse(req.query);
    const studentId = uuidParam(req, 'studentId');
    const auth = req.auth!;

    const history = await runWithTenant(auth.tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw AppError.notFound('Student not found');

      if (auth.role === 'TEACHER') {
        if (!student.currentSectionId) throw AppError.forbidden('You do not have access to this student');
        await assertSectionAccess(tx, auth, student.currentSectionId);
      }

      return tx.attendanceRecord.findMany({
        where: {
          studentId,
          ...(query.from || query.to
            ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
            : {}),
        },
        orderBy: { date: 'desc' },
      });
    });

    res.json({ data: history });
  },
);

/**
 * Printable attendance-report PDF for one student over a date range — from
 * a single day up to a full academic year (the same open-ended `from`/`to`
 * filter as the JSON history route above; no extra range cap is imposed
 * here either).
 */
attendanceRouter.get(
  '/student/:studentId/pdf',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const query = studentHistoryQuerySchema.parse(req.query);
    const studentId = uuidParam(req, 'studentId');
    const auth = req.auth!;

    const data = await runWithTenant(auth.tenantId, async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        include: { currentSection: { select: { schoolClass: { select: { name: true } } } } },
      });
      if (!student) throw AppError.notFound('Student not found');

      if (auth.role === 'TEACHER') {
        if (!student.currentSectionId) throw AppError.forbidden('You do not have access to this student');
        await assertSectionAccess(tx, auth, student.currentSectionId);
      }

      const tenant = await tx.tenant.findUnique({ where: { id: student.tenantId } });
      if (!tenant) throw AppError.notFound('Student not found');

      const records = await tx.attendanceRecord.findMany({
        where: {
          studentId,
          ...(query.from || query.to
            ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
            : {}),
        },
        orderBy: { date: 'asc' },
      });

      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0, HALF_DAY: 0, EARLY_LEAVE: 0 };
      for (const r of records) counts[r.status] += 1;

      return {
        school: { name: tenant.name, address: tenant.address, city: tenant.city, logoUrl: tenant.logoUrl },
        student: {
          studentCode: student.studentCode,
          fullName: student.fullName,
          className: student.currentSection?.schoolClass.name ?? null,
        },
        range: { from: query.from?.toISOString() ?? null, to: query.to?.toISOString() ?? null },
        records: records.map((r) => ({ date: r.date.toISOString(), status: r.status, remarks: r.remarks })),
        summary: { totalMarked: records.length, counts },
      };
    });

    const pdfBuffer = await renderAttendanceReportPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendance-${data.student.studentCode}.pdf"`,
    );
    res.send(pdfBuffer);
  },
);

/** Per-student present/absent/late/leave counts for a section over a date range. */
attendanceRouter.get('/summary', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = summaryQuerySchema.parse(req.query);
  const auth = req.auth!;

  const summary = await runWithTenant(auth.tenantId, async (tx) => {
    await assertSectionAccess(tx, auth, query.sectionId);

    const students = await tx.student.findMany({
      where: { currentSectionId: query.sectionId, status: 'ACTIVE' },
      orderBy: { fullName: 'asc' },
    });
    const records = await tx.attendanceRecord.findMany({
      where: { sectionId: query.sectionId, date: { gte: query.from, lte: query.to } },
    });

    return students.map((s) => {
      const studentRecords = records.filter((r) => r.studentId === s.id);
      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0, HALF_DAY: 0, EARLY_LEAVE: 0 };
      for (const r of studentRecords) counts[r.status] += 1;
      return {
        studentId: s.id,
        studentCode: s.studentCode,
        fullName: s.fullName,
        totalMarked: studentRecords.length,
        counts,
      };
    });
  });

  res.json({ data: summary });
});
