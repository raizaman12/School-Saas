import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import {
  createLeaveRequestSchema,
  reviewLeaveRequestSchema,
  listLeaveRequestsQuerySchema,
  STAFF_ROLES,
} from './validation';

export const leaveRequestsRouter = Router();
leaveRequestsRouter.use(requireAuth);

// Every staff role can file and view their own leave requests. Reviewing
// (approve/reject) someone else's is restricted to SCHOOL_ADMIN below —
// this deliberately does NOT reuse staff.ts's own READ_ROLES/WRITE_ROLES
// (SCHOOL_ADMIN + ACCOUNTANT only), which govern *HR-record* access, not
// a staff member's ability to manage their own leave.
const REVIEW_ROLES = ['SCHOOL_ADMIN'] as const;

const leaveRequestInclude = {
  staffProfile: {
    select: { id: true, employeeCode: true, designation: true, user: { select: { fullName: true } } },
  },
  reviewedByUser: { select: { id: true, fullName: true } },
} satisfies Prisma.LeaveRequestInclude;

async function resolveOwnStaffProfileId(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const staffProfile = await tx.staffProfile.findUnique({ where: { userId } });
  if (!staffProfile) {
    throw AppError.badRequest('No staff profile is linked to your account, so leave cannot be requested');
  }
  return staffProfile.id;
}

/** SCHOOL_ADMIN sees every leave request; anyone else sees only their own. */
leaveRequestsRouter.get('/', requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  const query = listLeaveRequestsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    const scopeStaffProfileId =
      auth.role === 'SCHOOL_ADMIN' ? query.staffProfileId : await resolveOwnStaffProfileId(tx, auth.userId);

    const where: Prisma.LeaveRequestWhereInput = {
      ...(scopeStaffProfileId ? { staffProfileId: scopeStaffProfileId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await Promise.all([
      tx.leaveRequest.findMany({ where, include: leaveRequestInclude, orderBy: { createdAt: 'desc' }, skip, take }),
      tx.leaveRequest.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

leaveRequestsRouter.post('/', requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  const input = createLeaveRequestSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const leaveRequest = await runWithTenant(tenantId, async (tx) => {
    const staffProfileId = await resolveOwnStaffProfileId(tx, auth.userId);

    return tx.leaveRequest.create({
      data: {
        id: randomUUID(),
        tenantId,
        staffProfileId,
        leaveType: input.leaveType,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason,
      },
      include: leaveRequestInclude,
    });
  });

  res.status(201).json({ data: leaveRequest });
});

/** The requester can cancel their own still-pending request. */
leaveRequestsRouter.patch('/:id/cancel', requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.leaveRequest.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Leave request not found');

    if (auth.role !== 'SCHOOL_ADMIN') {
      const staffProfileId = await resolveOwnStaffProfileId(tx, auth.userId);
      if (existing.staffProfileId !== staffProfileId) {
        throw AppError.forbidden('You can only cancel your own leave requests');
      }
    }
    if (existing.status !== 'PENDING') {
      throw AppError.conflict('Only a pending leave request can be cancelled');
    }

    return tx.leaveRequest.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
      include: leaveRequestInclude,
    });
  });

  res.json({ data: updated });
});

async function review(req: Request, res: Response, status: 'APPROVED' | 'REJECTED') {
  const input = reviewLeaveRequestSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.leaveRequest.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Leave request not found');
    if (existing.status !== 'PENDING') {
      throw AppError.conflict(`Only a pending leave request can be ${status === 'APPROVED' ? 'approved' : 'rejected'}`);
    }

    return tx.leaveRequest.update({
      where: { id: existing.id },
      data: { status, reviewNote: input.reviewNote, reviewedAt: new Date(), reviewedByUserId: auth.userId },
      include: leaveRequestInclude,
    });
  });

  res.json({ data: updated });
}

leaveRequestsRouter.patch('/:id/approve', requireRole(...REVIEW_ROLES), (req, res) => review(req, res, 'APPROVED'));
leaveRequestsRouter.patch('/:id/reject', requireRole(...REVIEW_ROLES), (req, res) => review(req, res, 'REJECTED'));
