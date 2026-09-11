import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { createGuardianLogin, notifyGuardianOfExistingStudentLogin } from '../portal/provisioning';
import { teacherSectionIds } from '../../lib/teacherScope';
import {
  createGuardianSchema,
  updateGuardianSchema,
  linkGuardianSchema,
  listGuardiansQuerySchema,
} from './validation';

export const guardiansRouter = Router();
guardiansRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;
// Deleting a guardian's login is irreversible and, like a staff member (see
// staff.ts's DELETE handler), a parent can be the AUTHOR of other tenant
// data — most commonly a student leave request they filed themselves via
// the portal — not just a subject of them. Kept to SCHOOL_ADMIN only,
// stricter than WRITE_ROLES, matching students.ts's DELETE_ROLES bar.
const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

/**
 * List/search guardians — used by the individual-notice recipient picker
 * (search a parent by name/phone before targeting them), mirroring the
 * same list+search convention as students.ts/staff.ts. Registered ahead
 * of `/:id` so a literal "/" path isn't swallowed by it.
 *
 * A TEACHER's results are scoped to guardians with at least one child
 * currently in a section they class-teach — otherwise this endpoint would
 * leak every parent's name/phone/email tenant-wide to any teacher, even
 * though the notices *write* path already restricts a TEACHER to
 * messaging only their own students' guardians (see notices.ts). Search
 * should never expose more than a teacher is allowed to act on.
 */
guardiansRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listGuardiansQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const allowedSectionIds = auth.role === 'TEACHER' ? await teacherSectionIds(tx, auth.userId) : null;

    const where: Prisma.GuardianWhereInput = {
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(allowedSectionIds
        ? { students: { some: { student: { currentSectionId: { in: allowedSectionIds } } } } }
        : {}),
    };

    const [data, total] = await Promise.all([
      tx.guardian.findMany({
        where,
        skip,
        take,
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, relationship: true, phone: true, email: true, userId: true },
      }),
      tx.guardian.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

/**
 * Same TEACHER section-scoping as the list route above applies here too —
 * without it, a teacher could bypass the list's privacy scoping entirely
 * just by guessing/enumerating a guardian id and reading their full
 * contact info (phone/email) directly. `findFirst` + the scoping filter
 * (rather than `findUnique` + a post-hoc check) means an out-of-scope
 * guardian 404s exactly like a nonexistent one, revealing nothing about
 * whether that id even exists tenant-wide.
 */
guardiansRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;
  const guardian = await runWithTenant(auth.tenantId, async (tx) => {
    const allowedSectionIds = auth.role === 'TEACHER' ? await teacherSectionIds(tx, auth.userId) : null;
    return tx.guardian.findFirst({
      where: {
        id: uuidParam(req, 'id'),
        ...(allowedSectionIds
          ? { students: { some: { student: { currentSectionId: { in: allowedSectionIds } } } } }
          : {}),
      },
      include: { students: { include: { student: { select: { id: true, fullName: true, studentCode: true } } } } },
    });
  });
  if (!guardian) throw AppError.notFound('Guardian not found');
  res.json({ data: guardian });
});

guardiansRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createGuardianSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const result = await runWithTenant(tenantId, async (tx) => {
    if (input.studentId) {
      const student = await tx.student.findUnique({ where: { id: input.studentId } });
      if (!student) throw AppError.badRequest('Unknown studentId');
    }

    const created = await tx.guardian.create({
      data: {
        id: randomUUID(),
        tenantId,
        fullName: input.fullName,
        relationship: input.relationship,
        cnic: input.cnic,
        phone: input.phone,
        email: input.email,
        occupation: input.occupation,
      },
    });

    if (input.studentId) {
      await tx.studentGuardian.create({
        data: {
          id: randomUUID(),
          tenantId,
          studentId: input.studentId,
          guardianId: created.id,
          isPrimary: input.isPrimary ?? false,
        },
      });

      // If this student already has a portal login (e.g. admitted earlier
      // with a contact email/phone, before this guardian existed), let the
      // new guardian know it exists — see
      // notifyGuardianOfExistingStudentLogin's own doc comment for why
      // this deliberately never touches the password itself.
      await notifyGuardianOfExistingStudentLogin(tx, tenantId, {
        studentId: input.studentId,
        guardian: created,
        createdByUserId: req.auth!.userId,
      });
    }

    // Auto-provision + email a parent portal login when an email was
    // supplied at creation — mirrors how a student gets their university
    // portal ID and password emailed automatically at admission, rather
    // than requiring a separate manual "create login" step. Guardians
    // without an email on file are unaffected; an admin can still create a
    // login for them later via POST /api/portal/guardians/:id/create-login.
    if (input.email) {
      const provisioned = await createGuardianLogin(tx, tenantId, created.id, {
        email: input.email,
        createdByUserId: req.auth!.userId,
      });
      return { guardian: provisioned.guardian, portalLogin: { email: provisioned.email, tempPassword: provisioned.tempPassword } };
    }

    return { guardian: created, portalLogin: null };
  });

  res.status(201).json({
    data: result.guardian,
    ...(result.portalLogin
      ? {
          // Returned once, at creation time — never retrievable again. Also
          // emailed to the guardian directly.
          portalLogin: result.portalLogin,
        }
      : {}),
  });
});

guardiansRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateGuardianSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const guardianId = uuidParam(req, 'id');

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.guardian.findUnique({ where: { id: guardianId } });
    if (!existing) throw AppError.notFound('Guardian not found');

    // `email` on Guardian is contact info, separate from the parent
    // portal LOGIN email (User.email, linked via Guardian.userId) — the
    // two start equal when a login is auto-provisioned, but without this
    // sync they'd silently drift apart the moment an admin edits either
    // one, leaving the parent unable to find out which address they
    // actually log in with.
    if (input.email !== undefined && existing.userId) {
      const emailTaken = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email: input.email } } });
      if (emailTaken && emailTaken.id !== existing.userId) {
        throw AppError.conflict('A user with this email already exists', { field: 'email' });
      }
      await tx.user.update({ where: { id: existing.userId }, data: { email: input.email } });
    }

    return tx.guardian.update({ where: { id: guardianId }, data: input });
  });

  res.json({ data: updated });
});

/**
 * Permanently removes a guardian record and, if one exists, their portal
 * login. Guardian.userId -> User is `onDelete: SetNull` (same as
 * Student.userId — the reverse of StaffProfile's Cascade), so the User row
 * must be deleted explicitly first, exactly like students.ts's DELETE does
 * — deleting the Guardian row alone would leave an orphaned, still-
 * loggable-in portal account behind.
 *
 * A parent's own `StudentLeaveRequest.requestedByUserId` is `onDelete:
 * Cascade` — deleting their User would silently wipe every leave request
 * they ever filed for their child, so that's pre-checked and blocks the
 * delete with a clear message, the same defensive pattern staff.ts uses.
 */
guardiansRouter.delete('/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const guardianId = uuidParam(req, 'id');

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.guardian.findUnique({ where: { id: guardianId } });
    if (!existing) throw AppError.notFound('Guardian not found');

    if (existing.userId) {
      const leaveRequestCount = await tx.studentLeaveRequest.count({
        where: { requestedByUserId: existing.userId },
      });
      if (leaveRequestCount > 0) {
        throw AppError.conflict(
          `This guardian has filed ${leaveRequestCount} student leave request(s) on record and cannot be ` +
            `permanently deleted — remove them from their child(ren) instead if they should no longer have access.`,
          { leaveRequestCount },
        );
      }
      await tx.user.delete({ where: { id: existing.userId } });
    }

    // Cascades to StudentGuardian links (see the onDelete: Cascade FK
    // pointing at Guardian in schema.prisma) — the student record itself
    // is untouched, only this guardian's link to them.
    await tx.guardian.delete({ where: { id: guardianId } });
  });

  res.status(204).send();
});

/** Link an existing guardian to an existing student. */
guardiansRouter.post(
  '/link/:studentId',
  requireRole(...WRITE_ROLES),
  async (req: Request, res: Response) => {
    const input = linkGuardianSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;

    const link = await runWithTenant(tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: uuidParam(req, 'studentId') } });
      if (!student) throw AppError.notFound('Student not found');

      const guardian = await tx.guardian.findUnique({ where: { id: input.guardianId } });
      if (!guardian) throw AppError.notFound('Guardian not found');

      const existing = await tx.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId: uuidParam(req, 'studentId'), guardianId: input.guardianId } },
      });
      if (existing) throw AppError.conflict('This guardian is already linked to this student');

      if (input.isPrimary) {
        await tx.studentGuardian.updateMany({
          where: { studentId: uuidParam(req, 'studentId') },
          data: { isPrimary: false },
        });
      }

      const created = await tx.studentGuardian.create({
        data: {
          id: randomUUID(),
          tenantId,
          studentId: uuidParam(req, 'studentId'),
          guardianId: input.guardianId,
          isPrimary: input.isPrimary ?? false,
        },
      });

      // Same "let the guardian know a login already exists" notification
      // as guardian creation above — this route links an *existing*
      // guardian (e.g. also a sibling's parent) to another student, which
      // is exactly the other case where a guardian might not yet know a
      // student portal login is there.
      await notifyGuardianOfExistingStudentLogin(tx, tenantId, {
        studentId: uuidParam(req, 'studentId'),
        guardian,
        createdByUserId: req.auth!.userId,
      });

      return created;
    });

    res.status(201).json({ data: link });
  },
);
