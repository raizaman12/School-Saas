import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { STAFF_ROLES } from '../staff/validation';
import { trendQuerySchema, examPerformanceQuerySchema } from './validation';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// Analytics spans financial, academic, and attendance data all at once —
// the same cross-cutting visibility PowerSchool's Analytics/BI module
// reserves for a school's top administrators. SCHOOL_ADMIN only, same
// reasoning as the fee-defaulter list and platform stats being admin-only
// elsewhere in this codebase.
const READ_ROLES = ['SCHOOL_ADMIN'] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Builds the trailing `months` calendar months ending with the current
 * one, as {key: "YYYY-MM", label, start, end} — used to zero-fill months
 * with no data so a trend chart doesn't just silently skip them.
 */
function buildMonthBuckets(months: number) {
  const now = new Date();
  const buckets: { key: string; label: string; start: Date; end: Date }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    buckets.push({
      key: monthKey(start),
      label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      start,
      end,
    });
  }
  return buckets;
}

/**
 * Top-level KPI cards for the analytics landing page — one number each,
 * cheap enough to compute on every load rather than needing a pre-
 * aggregated summary table.
 */
analyticsRouter.get('/overview', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const overview = await runWithTenant(auth.tenantId, async (tx) => {
    const [activeStudents, totalStaff, activeYear, recentAttendance] = await Promise.all([
      tx.student.count({ where: { status: 'ACTIVE' } }),
      tx.user.count({ where: { role: { in: [...STAFF_ROLES] }, status: 'ACTIVE' } }),
      tx.academicYear.findFirst({ where: { isActive: true } }),
      tx.attendanceRecord.groupBy({
        by: ['status'],
        where: { date: { gte: thirtyDaysAgo } },
        _count: true,
      }),
    ]);

    const totalMarked = recentAttendance.reduce((sum, r) => sum + r._count, 0);
    const presentCount = recentAttendance.find((r) => r.status === 'PRESENT')?._count ?? 0;
    const attendanceRateLast30Days = totalMarked > 0 ? round2((presentCount / totalMarked) * 100) : null;

    let feeCollectionRateActiveYear: number | null = null;
    if (activeYear) {
      const invoiceAgg = await tx.invoice.aggregate({
        where: { academicYearId: activeYear.id, status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true, paidAmount: true },
      });
      const billed = Number(invoiceAgg._sum.totalAmount ?? 0);
      const collected = Number(invoiceAgg._sum.paidAmount ?? 0);
      feeCollectionRateActiveYear = billed > 0 ? round2((collected / billed) * 100) : null;
    }

    const latestExam = await tx.exam.findFirst({
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    let latestExamAveragePercentage: number | null = null;
    let latestExamName: string | null = null;
    if (latestExam) {
      latestExamName = latestExam.name;
      const marks = await tx.mark.findMany({
        where: { examSubject: { examId: latestExam.id }, marksObtained: { not: null } },
        select: { marksObtained: true, examSubject: { select: { maxMarks: true } } },
      });
      if (marks.length > 0) {
        const totalPercentage = marks.reduce(
          (sum, m) => sum + ((m.marksObtained ?? 0) / m.examSubject.maxMarks) * 100,
          0,
        );
        latestExamAveragePercentage = round2(totalPercentage / marks.length);
      }
    }

    return {
      activeStudents,
      totalStaff,
      attendanceRateLast30Days,
      feeCollectionRateActiveYear,
      activeAcademicYear: activeYear?.name ?? null,
      latestExam: latestExamName ? { name: latestExamName, averagePercentage: latestExamAveragePercentage } : null,
    };
  });

  res.json({ data: overview });
});

/** Active-student headcount grouped by class, sorted by SchoolClass.order. */
analyticsRouter.get('/enrollment-by-class', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;

  const data = await runWithTenant(auth.tenantId, async (tx) => {
    const students = await tx.student.findMany({
      where: { status: 'ACTIVE', currentSectionId: { not: null } },
      select: { currentSection: { select: { schoolClass: { select: { id: true, name: true, order: true } } } } },
    });

    const byClass = new Map<string, { classId: string; className: string; order: number; count: number }>();
    for (const s of students) {
      const cls = s.currentSection?.schoolClass;
      if (!cls) continue;
      const existing = byClass.get(cls.id);
      if (existing) {
        existing.count += 1;
      } else {
        byClass.set(cls.id, { classId: cls.id, className: cls.name, order: cls.order, count: 1 });
      }
    }

    return Array.from(byClass.values()).sort((a, b) => a.order - b.order);
  });

  res.json({ data });
});

/** Monthly attendance rate (present / total marked) over the trailing N months. */
analyticsRouter.get('/attendance-trend', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = trendQuerySchema.parse(req.query);
  const auth = req.auth!;
  const buckets = buildMonthBuckets(query.months);
  const rangeStart = buckets[0].start;

  const data = await runWithTenant(auth.tenantId, async (tx) => {
    const records = await tx.attendanceRecord.findMany({
      where: { date: { gte: rangeStart } },
      select: { date: true, status: true },
    });

    return buckets.map((bucket) => {
      const inBucket = records.filter((r) => r.date >= bucket.start && r.date < bucket.end);
      const total = inBucket.length;
      const present = inBucket.filter((r) => r.status === 'PRESENT').length;
      return {
        month: bucket.key,
        label: bucket.label,
        totalMarked: total,
        presentCount: present,
        attendanceRate: total > 0 ? round2((present / total) * 100) : null,
      };
    });
  });

  res.json({ data });
});

/** Monthly billed vs. collected totals (by invoice issue date) over the trailing N months. */
analyticsRouter.get('/fee-collection-trend', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = trendQuerySchema.parse(req.query);
  const auth = req.auth!;
  const buckets = buildMonthBuckets(query.months);
  const rangeStart = buckets[0].start;

  const data = await runWithTenant(auth.tenantId, async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { issueDate: { gte: rangeStart }, status: { not: 'CANCELLED' } },
      select: { issueDate: true, totalAmount: true, paidAmount: true },
    });

    return buckets.map((bucket) => {
      const inBucket = invoices.filter((i) => i.issueDate >= bucket.start && i.issueDate < bucket.end);
      const billed = inBucket.reduce((sum, i) => sum + Number(i.totalAmount), 0);
      const collected = inBucket.reduce((sum, i) => sum + Number(i.paidAmount), 0);
      return {
        month: bucket.key,
        label: bucket.label,
        billed: round2(billed),
        collected: round2(collected),
        collectionRate: billed > 0 ? round2((collected / billed) * 100) : null,
      };
    });
  });

  res.json({ data });
});

/** Average percentage score per exam, most recent exams first. */
analyticsRouter.get('/exam-performance', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = examPerformanceQuerySchema.parse(req.query);
  const auth = req.auth!;

  const data = await runWithTenant(auth.tenantId, async (tx) => {
    const exams = await tx.exam.findMany({
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: query.limit,
      include: { academicYear: { select: { name: true } } },
    });
    if (exams.length === 0) return [];

    const marks = await tx.mark.findMany({
      where: { examSubject: { examId: { in: exams.map((e) => e.id) } }, marksObtained: { not: null } },
      select: { marksObtained: true, examSubject: { select: { examId: true, maxMarks: true } } },
    });

    const byExam = new Map<string, { totalPercentage: number; count: number }>();
    for (const m of marks) {
      const examId = m.examSubject.examId;
      const percentage = ((m.marksObtained ?? 0) / m.examSubject.maxMarks) * 100;
      const agg = byExam.get(examId) ?? { totalPercentage: 0, count: 0 };
      agg.totalPercentage += percentage;
      agg.count += 1;
      byExam.set(examId, agg);
    }

    return exams
      .map((exam) => {
        const agg = byExam.get(exam.id);
        return {
          examId: exam.id,
          examName: exam.name,
          academicYear: exam.academicYear.name,
          marksRecorded: agg?.count ?? 0,
          averagePercentage: agg && agg.count > 0 ? round2(agg.totalPercentage / agg.count) : null,
        };
      })
      .reverse(); // oldest-of-the-selected-window first, so a trend chart reads left-to-right chronologically
  });

  res.json({ data });
});
