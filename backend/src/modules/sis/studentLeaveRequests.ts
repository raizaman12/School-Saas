import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { teacherSectionIds } from '../../lib/teacherScope';
import { reviewStudentLeaveRequestSchema, listStudentLeaveRequestsQuerySchema } from './validation';

/**
 * The staff-facing side of a student leave request: SCHOOL_ADMIN sees and
 * may approve/reject every request; a TEACHER sees and may approve/reject
 * only requests for a student currently in a section they teach (class
 * teacher OR subject teacher — see lib/teacherScope.ts), matching "route to
 * every teacher who teaches that student, not just the class teacher."
 * Creation lives on the PARENT-only portal side — see
 * portal/leaveRequests.ts.
 */
export const studentLeaveRequestsRouter = Router();
studentLeaveRequestsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;
const REVIEW_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

const leaveRequestInclude = {
  student: {
    select: {
      id: true,
      fullName: true,
      studentCode: true,
      currentSectionId: true,
      currentSection: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
    },
  },
  requestedByUser: { select: { id: true, fullName: true } },
  reviewedByUser: { select: { id: true, fullName: true } },
} satisfies Prisma.StudentLeaveRequestInclude;

studentLeaveRequestsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listStudentLeaveRequestsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    let allowedSectionIds: string[] | null = null;
    if (auth.role === 'TEACHER') {
      allowedSectionIds = await teacherSectionIds(tx, auth.userId);
    }

    const where: Prisma.StudentLeaveRequestWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(allowedSectionIds ? { student: { currentSectionId: { in: allowedSectionIds } } } : {}),
    };

    const [data, total] = await Promise.all([
      tx.studentLeaveRequest.findMany({
        where,
        include: leaveRequestInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      tx.studentLeaveRequest.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

studentLeaveRequestsRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;

  const leaveRequest = await runWithTenant(auth.tenantId, async (tx) => {
    const found = await tx.studentLeaveRequest.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: leaveRequestInclude,
    });
    if (!found) throw AppError.notFound('Leave request not found');

    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!found.student.currentSectionId || !allowed.includes(found.student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }

    return found;
  });

  res.json({ data: leaveRequest });
});

async function review(req: Request, res: Response, status: 'APPROVED' | 'REJECTED') {
  const input = reviewStudentLeaveRequestSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.studentLeaveRequest.findUnique({
      where: { id: uuidParam(req, 'id') },
      select: { id: true, status: true, student: { select: { currentSectionId: true } } },
    });
    if (!existing) throw AppError.notFound('Leave request not found');

    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!existing.student.currentSectionId || !allowed.includes(existing.student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }

    if (existing.status !== 'PENDING') {
      throw AppError.conflict(`Only a pending leave request can be ${status === 'APPROVED' ? 'approved' : 'rejected'}`);
    }

    return tx.studentLeaveRequest.update({
      where: { id: existing.id },
      data: { status, reviewNote: input.reviewNote, reviewedAt: new Date(), reviewedByUserId: auth.userId },
      include: leaveRequestInclude,
    });
  });

  res.json({ data: updated });
}

studentLeaveRequestsRouter.patch('/:id/approve', requireRole(...REVIEW_ROLES), (req, res) => review(req, res, 'APPROVED'));
studentLeaveRequestsRouter.patch('/:id/reject', requireRole(...REVIEW_ROLES), (req, res) => review(req, res, 'REJECTED'));
