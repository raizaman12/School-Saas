import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { hashPassword } from '../../lib/password';
import { assertCanAddStaff } from '../../lib/planLimits';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { deriveTenantCode } from '../../utils/tenantCode';
import { normalizeLoginId } from '../../lib/loginId';
import {
  createStaffSchema,
  updateStaffSchema,
  updateStaffSalarySchema,
  updateMyStaffProfileSchema,
  listStaffQuerySchema,
} from './validation';

export const staffRouter = Router();
staffRouter.use(requireAuth);

export const READ_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT'] as const;
export const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;
// Salary is the one field of a staff record an Accountant needs to be able
// to set without also getting the rest of WRITE_ROLES' full-edit power
// (name, contact info, status, Bio Data) — see PATCH /:id/salary below.
export const SALARY_WRITE_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT'] as const;
// Deleting a staff member's login is irreversible and, unlike a student,
// a staff member is very often the AUTHOR of other tenant data (homework,
// course material, notices, discipline reports, health-log entries) —
// see the DELETE handler's own pre-checks below for exactly what that
// blocks. Kept to SCHOOL_ADMIN only, same bar as students.
export const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

function sanitizeUser<T extends { passwordHash: string }>(user: T): Omit<T, 'passwordHash'> {
  const safe = { ...user } as Partial<T>;
  delete safe.passwordHash;
  return safe as Omit<T, 'passwordHash'>;
}

/** Generates a random, human-typeable temporary password for a new staff account. */
function generateTempPassword(): string {
  // 12 hex chars from 6 random bytes, prefixed so it always satisfies
  // typical password complexity rules even before the user changes it.
  return `Temp-${randomBytes(6).toString('hex')}`;
}

async function generateEmployeeCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ seq: bigint; code: string; name: string }[]>`
    UPDATE tenants SET "nextEmployeeSeq" = "nextEmployeeSeq" + 1
    WHERE id = ${tenantId}::uuid
    RETURNING "nextEmployeeSeq" - 1 AS seq, code, name
  `;
  const seq = Number(rows[0].seq);
  const prefix = rows[0].code || deriveTenantCode(rows[0].name);
  return `${prefix}-EMP-${String(seq).padStart(6, '0')}`;
}

const staffProfileInclude = {
  user: {
    select: {
      id: true,
      email: true,
      // Surfaced so the admin UI can show "this is their login ID" right
      // after creating a non-SCHOOL_ADMIN staff member (email may be
      // absent — see createStaffSchema's doc comment).
      loginId: true,
      fullName: true,
      phone: true,
      role: true,
      status: true,
      lastLoginAt: true,
    },
  },
} satisfies Prisma.StaffProfileInclude;

/**
 * Self-service "my own staff profile" — any authenticated staff-side role
 * (TEACHER, ACCOUNTANT, FRONT_DESK, SCHOOL_ADMIN), not gated by READ_ROLES
 * since this only ever returns the caller's OWN record. The founding
 * SCHOOL_ADMIN gets a StaffProfile too, at signup (see auth.service.ts —
 * designation "Principal"), so this works for them as well; it 404s only
 * for a role that genuinely never gets one (PARENT/STUDENT calling this by
 * mistake), and the frontend treats that as "nothing to show" rather than
 * surfacing it. Registered before GET /:id so "/me" is never swallowed by
 * that route's :id param.
 */
staffRouter.get('/me', async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const staff = await runWithTenant(tenantId, (tx) =>
    tx.staffProfile.findUnique({ where: { userId }, include: staffProfileInclude }),
  );

  if (!staff) throw AppError.notFound('No staff profile is linked to this account');
  res.json({ data: { ...staff, user: sanitizeUser(staff.user as unknown as { passwordHash: string }) } });
});

/**
 * Self-service — photo, address, and emergency contact only; see
 * updateMyStaffProfileSchema's doc comment for why the rest of the record
 * (including CNIC/DOB/gender, the Bio Data tab) stays admin-managed.
 */
staffRouter.patch('/me', async (req: Request, res: Response) => {
  const input = updateMyStaffProfileSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const staff = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.staffProfile.findUnique({ where: { userId } });
    if (!existing) throw AppError.notFound('No staff profile is linked to this account');

    return tx.staffProfile.update({
      where: { id: existing.id },
      data: {
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact } : {}),
      },
      include: staffProfileInclude,
    });
  });

  res.json({ data: { ...staff, user: sanitizeUser(staff.user as unknown as { passwordHash: string }) } });
});

/**
 * Permanently removes a staff member's login and StaffProfile. Deliberately
 * NOT a bare `tx.user.delete()` the way students.ts's DELETE is — a staff
 * member is very often the AUTHOR of other tenant records, not just a
 * subject of them, and several of those relations are `onDelete: Cascade`
 * pointing FROM the other record TO the staff member's User row (Homework,
 * CourseMaterial, Notice, ReportCardBatchJob, StudentLeaveRequest —
 * deleting the User would silently wipe every homework/notice/course
 * material they ever created, for the WHOLE SCHOOL, not just their own
 * data). Those are pre-checked explicitly below and block the delete with
 * a clear message. A handful of other relations (DisciplineRecord,
 * SupportNeed, StudentHealthProfile, HealthLogEntry,
 * StudentCustomFieldValue) are `onDelete: Restrict` — Postgres itself
 * refuses the delete for those, surfaced here as the same clean 409.
 *
 * For a staff member with real history, the correct "remove them" action
 * is PATCH .../:id { status: 'TERMINATED' } (already supported) — this
 * DELETE exists for the case the frontend guides admins toward: undoing a
 * genuine data-entry mistake (added the wrong person, wrong role, etc.)
 * before they've done anything else in the system yet.
 */
staffRouter.delete('/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const staffId = uuidParam(req, 'id');

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.staffProfile.findUnique({ where: { id: staffId } });
    if (!existing) throw AppError.notFound('Staff member not found');

    if (existing.userId === req.auth!.userId) {
      throw AppError.badRequest('You cannot delete your own account.');
    }

    const [
      adminCount,
      homeworkCount,
      courseMaterialCount,
      noticeCount,
      reportCardBatchCount,
      studentLeaveRequestCount,
      disciplineCount,
      supportNeedCount,
      supportNeedReviewCount,
      healthProfileCount,
      healthLogCount,
      customFieldValueCount,
    ] = await Promise.all([
      tx.user.count({ where: { role: 'SCHOOL_ADMIN', status: 'ACTIVE' } }),
      tx.homework.count({ where: { assignedByUserId: existing.userId } }),
      tx.courseMaterial.count({ where: { uploadedByUserId: existing.userId } }),
      tx.notice.count({ where: { publishedByUserId: existing.userId } }),
      tx.reportCardBatchJob.count({ where: { requestedByUserId: existing.userId } }),
      tx.studentLeaveRequest.count({ where: { requestedByUserId: existing.userId } }),
      tx.disciplineRecord.count({ where: { reportedByUserId: existing.userId } }),
      tx.supportNeed.count({ where: { createdByUserId: existing.userId } }),
      tx.supportNeedReview.count({ where: { reviewedByUserId: existing.userId } }),
      tx.studentHealthProfile.count({ where: { updatedByUserId: existing.userId } }),
      tx.healthLogEntry.count({ where: { loggedByUserId: existing.userId } }),
      tx.studentCustomFieldValue.count({ where: { updatedByUserId: existing.userId } }),
    ]);

    // A departing/being-deleted SCHOOL_ADMIN must never leave the school
    // with zero active admins locked out of their own account.
    const user = await tx.user.findUnique({ where: { id: existing.userId } });
    if (user?.role === 'SCHOOL_ADMIN' && adminCount <= 1) {
      throw AppError.badRequest('Cannot delete the school\'s only remaining admin account.');
    }

    const blockers: string[] = [];
    if (homeworkCount > 0) blockers.push(`${homeworkCount} homework assignment(s)`);
    if (courseMaterialCount > 0) blockers.push(`${courseMaterialCount} course material upload(s)`);
    if (noticeCount > 0) blockers.push(`${noticeCount} published notice(s)`);
    if (reportCardBatchCount > 0) blockers.push(`${reportCardBatchCount} report card batch(es)`);
    if (studentLeaveRequestCount > 0) blockers.push(`${studentLeaveRequestCount} leave request(s) filed`);
    if (disciplineCount > 0) blockers.push(`${disciplineCount} discipline record(s)`);
    if (supportNeedCount > 0) blockers.push(`${supportNeedCount} learning-support record(s)`);
    if (supportNeedReviewCount > 0) blockers.push(`${supportNeedReviewCount} learning-support review(s)`);
    if (healthProfileCount > 0) blockers.push(`${healthProfileCount} health profile update(s)`);
    if (healthLogCount > 0) blockers.push(`${healthLogCount} health log entr(y/ies)`);
    if (customFieldValueCount > 0) blockers.push(`${customFieldValueCount} custom field edit(s)`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `This staff member has ${blockers.join(', ')} on record and cannot be permanently deleted — ` +
          `set their status to Terminated instead to remove them from active use while keeping this history intact.`,
        { blockers },
      );
    }

    // StaffProfile.userId -> User is onDelete: Cascade (the reverse of
    // Student -> User's SetNull), so deleting the User alone removes the
    // StaffProfile automatically.
    await tx.user.delete({ where: { id: existing.userId } });
  });

  res.status(204).send();
});

staffRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listStaffQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId;

  const result = await runWithTenant(tenantId, async (tx) => {
    const where: Prisma.StaffProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.search
        ? {
            OR: [
              { employeeCode: { contains: query.search, mode: 'insensitive' } },
              { designation: { contains: query.search, mode: 'insensitive' } },
              { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      tx.staffProfile.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: staffProfileInclude,
      }),
      tx.staffProfile.count({ where }),
    ]);

    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

staffRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  const staff = await runWithTenant(tenantId, (tx) =>
    tx.staffProfile.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: staffProfileInclude,
    }),
  );

  if (!staff) throw AppError.notFound('Staff member not found');
  res.json({ data: staff });
});

staffRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createStaffSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const staff = await runWithTenant(tenantId, async (tx) => {
    await assertCanAddStaff(tx, tenantId);

    if (input.email) {
      const existingUser = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: input.email } },
      });
      if (existingUser) {
        throw AppError.conflict('A user with this email already exists', { field: 'email' });
      }
    }

    const employeeCode = await generateEmployeeCode(tx, tenantId);

    // Every non-SCHOOL_ADMIN role also gets an ID-based login (see
    // createStaffSchema's doc comment) — set unconditionally, even when
    // an email was also supplied, so the login ID always works regardless
    // of whether email delivery ever reaches them. SCHOOL_ADMIN keeps
    // loginId NULL and stays email-only.
    const loginId = input.role === 'SCHOOL_ADMIN' ? undefined : normalizeLoginId(employeeCode);

    const user = await tx.user.create({
      data: {
        id: randomUUID(),
        tenantId,
        email: input.email,
        loginId,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        role: input.role,
        status: 'ACTIVE',
      },
    });

    const staffProfile = await tx.staffProfile.create({
      data: {
        id: randomUUID(),
        tenantId,
        userId: user.id,
        employeeCode,
        designation: input.designation,
        department: input.department,
        employmentType: input.employmentType,
        joiningDate: input.joiningDate,
        cnic: input.cnic,
        address: input.address,
        emergencyContact: input.emergencyContact,
        monthlySalary: input.monthlySalary,
        photoUrl: input.photoUrl,
      },
      include: staffProfileInclude,
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorUserId: req.auth!.userId,
        action: 'staff.create',
        entityType: 'StaffProfile',
        entityId: staffProfile.id,
      },
    });

    return staffProfile;
  });

  res.status(201).json({
    data: { ...staff, user: sanitizeUser(staff.user as unknown as { passwordHash: string }) },
    // Returned ONCE, at creation time only — never retrievable again. The
    // admin is expected to relay this to the new staff member out-of-band.
    tempPassword,
  });
});

staffRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateStaffSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const staff = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.staffProfile.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Staff member not found');

    const { fullName, phone, email, ...profileFields } = input;

    if (email !== undefined) {
      const emailTaken = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
      if (emailTaken && emailTaken.id !== existing.userId) {
        throw AppError.conflict('A user with this email already exists', { field: 'email' });
      }
    }

    if (fullName !== undefined || phone !== undefined || email !== undefined) {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(fullName !== undefined ? { fullName } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(email !== undefined ? { email } : {}),
        },
      });
    }

    return tx.staffProfile.update({
      where: { id: existing.id },
      data: profileFields,
      include: staffProfileInclude,
    });
  });

  res.json({ data: { ...staff, user: sanitizeUser(staff.user as unknown as { passwordHash: string }) } });
});

/**
 * Salary-only edit — see SALARY_WRITE_ROLES above for why this exists as
 * its own route rather than just widening PATCH /:id's WRITE_ROLES: an
 * Accountant sets pay rates as routine work, but shouldn't thereby also
 * gain the ability to change a colleague's name, status, contact info, or
 * Bio Data. updateStaffSalarySchema accepts (and the Prisma update below
 * writes) monthlySalary alone.
 */
staffRouter.patch('/:id/salary', requireRole(...SALARY_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateStaffSalarySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const staff = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.staffProfile.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Staff member not found');

    return tx.staffProfile.update({
      where: { id: existing.id },
      data: { monthlySalary: input.monthlySalary },
      include: staffProfileInclude,
    });
  });

  res.json({ data: { ...staff, user: sanitizeUser(staff.user as unknown as { passwordHash: string }) } });
});
