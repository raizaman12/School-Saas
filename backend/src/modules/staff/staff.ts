import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { hashPassword } from '../../lib/password';
import { assertCanAddStaff } from '../../lib/planLimits';
import { dispatchNotification } from '../notifications/notificationService';
import { credentialsEmailBody, credentialsSmsBody, ROLE_LABELS } from '../portal/provisioning';
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

// FRONT_DESK added for Previous Data → Teachers (see previousData.ts) —
// front desk staff need to browse terminated/on-leave staff the same way
// they can already browse students (students.ts's own READ_ROLES already
// includes FRONT_DESK).
export const READ_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT', 'FRONT_DESK'] as const;
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

// FRONT_DESK was added to READ_ROLES for Previous Data → Teachers, but
// salary is a payroll detail front desk staff have no business seeing —
// redact it from any response FRONT_DESK receives, same idea as
// sanitizeUser() stripping passwordHash below.
function redactSalaryIfFrontDesk<T extends { monthlySalary: unknown }>(
  role: string,
  staff: T,
): T | Omit<T, 'monthlySalary'> {
  if (role !== 'FRONT_DESK') return staff;
  const redacted = { ...staff } as Partial<T>;
  delete redacted.monthlySalary;
  return redacted as Omit<T, 'monthlySalary'>;
}

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
 * "Delete" a staff member. This used to be a real, cascading SQL DELETE —
 * but ONLY when the staff member had authored nothing (homework, notices,
 * discipline records, health logs, ...); anyone with real history got a
 * 409 telling the admin to PATCH status to TERMINATED instead, since a
 * hard delete really would have destroyed everything they authored (and
 * a few relations are `onDelete: Restrict`, so Postgres would have
 * refused it outright anyway). That whole history-count safety net is no
 * longer needed: "Delete" now ALWAYS does what that 409 message told
 * admins to do manually — set status to TERMINATED and disable their
 * login — never a destructive delete, for anyone, with or without
 * history. Every relation (payroll, leave requests, everything they ever
 * authored) stays completely intact; the staff member just drops out of
 * the default (unfiltered) GET / list and shows up under Previous Data →
 * Teachers instead (see previousData.ts).
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
    if (existing.status === 'TERMINATED') return; // already archived — idempotent

    // A departing/being-terminated SCHOOL_ADMIN must never leave the
    // school with zero active admins locked out of their own account.
    const user = await tx.user.findUnique({ where: { id: existing.userId } });
    if (user?.role === 'SCHOOL_ADMIN') {
      const adminCount = await tx.user.count({ where: { role: 'SCHOOL_ADMIN', status: 'ACTIVE' } });
      if (adminCount <= 1) {
        throw AppError.badRequest("Cannot remove the school's only remaining admin account.");
      }
    }

    await tx.staffProfile.update({
      where: { id: staffId },
      data: { status: 'TERMINATED', leavingDate: new Date() },
    });
    if (user) {
      await tx.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    }
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

  res.json({
    data: result.data.map((s) => redactSalaryIfFrontDesk(req.auth!.role, s)),
    meta: paginationMeta(query.page, query.limit, result.total),
  });
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
  res.json({ data: redactSalaryIfFrontDesk(req.auth!.role, staff) });
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

    // Email + SMS the credentials, same independent-legs pattern as
    // guardian/student login creation (see portal/provisioning.ts's
    // credentialsEmailBody/credentialsSmsBody, reused here rather than
    // duplicated) — a staff member no longer has to wait for the admin to
    // relay this out-of-band. Only fires for whichever address is on file;
    // an ID-only account (input.email absent) still works to log in, the
    // admin just has to hand over the ID + temp password directly.
    if (input.email || input.phone) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
      const roleLabel = ROLE_LABELS[input.role] ?? 'staff';

      if (input.email) {
        await dispatchNotification(tx, tenantId, {
          channel: 'EMAIL',
          recipientUserId: user.id,
          recipientEmail: input.email,
          trustedRecipient: true,
          subject: `Your ${tenant?.name ?? 'school'} ${roleLabel} portal login`,
          body: credentialsEmailBody({
            tenantName: tenant?.name ?? 'your school',
            slug: tenant?.slug ?? '',
            email: input.email,
            tempPassword,
            roleLabel,
          }),
          relatedEntityType: 'StaffProfile',
          relatedEntityId: staffProfile.id,
          createdByUserId: req.auth!.userId,
        });
      }

      if (input.phone) {
        await dispatchNotification(tx, tenantId, {
          channel: 'SMS',
          recipientUserId: user.id,
          recipientPhone: input.phone,
          trustedRecipient: true,
          body: credentialsSmsBody({
            tenantName: tenant?.name ?? 'your school',
            loginIdOrEmail: input.email ?? loginId ?? '(ask the admin)',
            tempPassword,
            roleLabel,
          }),
          relatedEntityType: 'StaffProfile',
          relatedEntityId: staffProfile.id,
          createdByUserId: req.auth!.userId,
        });
      }
    }

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
