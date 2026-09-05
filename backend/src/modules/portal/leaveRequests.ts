import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { dispatchNotification } from '../notifications/notificationService';
import { teacherIdsForSection } from '../../lib/teacherScope';
import { resolveGuardianChildIds } from './access';
import {
  createStudentLeaveRequestSchema,
  listStudentLeaveRequestsQuerySchema,
} from '../sis/validation';

/**
 * A PARENT requesting leave (an upcoming absence) for their own child —
 * deliberately PARENT-only, unlike staff.ts's LeaveRequest which any staff
 * role can file for themselves. A STUDENT portal account cannot create or
 * even view these; only the parent who requested it (and the staff side —
 * see sis/studentLeaveRequests.ts) can.
 */
export const portalLeaveRequestsRouter = Router();
portalLeaveRequestsRouter.use(requireAuth);
portalLeaveRequestsRouter.use(requireRole('PARENT'));

const leaveRequestInclude = {
  student: { select: { id: true, fullName: true, studentCode: true, currentSectionId: true } },
  reviewedByUser: { select: { id: true, fullName: true } },
} satisfies Prisma.StudentLeaveRequestInclude;

portalLeaveRequestsRouter.get('/', async (req: Request, res: Response) => {
  const query = listStudentLeaveRequestsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    const childIds = await resolveGuardianChildIds(tx, auth);
    if (query.studentId && !childIds.includes(query.studentId)) {
      throw AppError.forbidden('You do not have access to this student');
    }

    const where: Prisma.StudentLeaveRequestWhereInput = {
      studentId: query.studentId ? query.studentId : { in: childIds },
      ...(query.status ? { status: query.status } : {}),
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

portalLeaveRequestsRouter.post('/', async (req: Request, res: Response) => {
  const input = createStudentLeaveRequestSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const leaveRequest = await runWithTenant(tenantId, async (tx) => {
    const childIds = await resolveGuardianChildIds(tx, auth);
    if (!childIds.includes(input.studentId)) {
      throw AppError.forbidden('You do not have access to this student');
    }

    const student = await tx.student.findUnique({
      where: { id: input.studentId },
      select: { id: true, fullName: true, currentSectionId: true },
    });
    if (!student) throw AppError.notFound('Student not found');

    const created = await tx.studentLeaveRequest.create({
      data: {
        id: randomUUID(),
        tenantId,
        studentId: input.studentId,
        requestedByUserId: auth.userId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
      },
      include: leaveRequestInclude,
    });

    // Route to every teacher who teaches this student (class teacher AND
    // any subject teacher — not just the class teacher) plus every
    // SCHOOL_ADMIN, so nobody has to go looking for it.
    const [teacherIds, admins] = await Promise.all([
      student.currentSectionId ? teacherIdsForSection(tx, student.currentSectionId) : Promise.resolve([]),
      tx.user.findMany({ where: { role: 'SCHOOL_ADMIN', status: 'ACTIVE' }, select: { id: true } }),
    ]);
    const recipientUserIds = new Set([...teacherIds, ...admins.map((a) => a.id)]);

    for (const recipientUserId of recipientUserIds) {
      await dispatchNotification(tx, tenantId, {
        channel: 'IN_APP',
        recipientUserId,
        trustedRecipient: true,
        subject: `Leave request from ${student.fullName}`,
        body: `${student.fullName} has a leave request from ${input.fromDate.toISOString().slice(0, 10)} to ${input.toDate.toISOString().slice(0, 10)}: ${input.reason}`,
        relatedEntityType: 'StudentLeaveRequest',
        relatedEntityId: created.id,
        createdByUserId: auth.userId,
      });
    }

    return created;
  });

  res.status(201).json({ data: leaveRequest });
});

/** The requesting parent can cancel their own still-pending request. */
portalLeaveRequestsRouter.patch('/:id/cancel', async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.studentLeaveRequest.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Leave request not found');
    if (existing.requestedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only cancel a leave request you submitted');
    }
    if (existing.status !== 'PENDING') {
      throw AppError.conflict('Only a pending leave request can be cancelled');
    }

    return tx.studentLeaveRequest.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
      include: leaveRequestInclude,
    });
  });

  res.json({ data: updated });
});
