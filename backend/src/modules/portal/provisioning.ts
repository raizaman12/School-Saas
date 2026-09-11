import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma, Guardian, Student } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { hashPassword } from '../../lib/password';
import { dispatchNotification } from '../notifications/notificationService';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { normalizeLoginId } from '../../lib/loginId';
import { createGuardianLoginSchema, createStudentLoginSchema } from './validation';

export const portalProvisioningRouter = Router();
portalProvisioningRouter.use(requireAuth);

const PROVISION_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;

function generateTempPassword(): string {
  return `Temp-${randomBytes(6).toString('hex')}`;
}

/**
 * Shared credentials-email body for both roles — deliberately plain text
 * (matches LocalNotificationProvider's current logging-stub delivery, no
 * HTML templating exists anywhere else in this codebase yet). Mentions the
 * tenant's slug since logging in also requires picking the right school.
 */
export function credentialsEmailBody(params: {
  tenantName: string;
  slug: string;
  email: string;
  tempPassword: string;
  roleLabel: string;
}): string {
  return [
    `Your ${params.roleLabel} portal account for ${params.tenantName} has been created.`,
    '',
    `School: ${params.tenantName} (${params.slug})`,
    `Login email: ${params.email}`,
    `Temporary password: ${params.tempPassword}`,
    '',
    'Please log in and change your password as soon as possible. Your login email stays the same even after you change your password.',
  ].join('\n');
}

/**
 * SMS companion to credentialsEmailBody() above — same information, kept to
 * one short line since SMS is priced/split per ~160-character segment
 * (unlike email, where length is free). Sent as a *second*, independent
 * dispatch alongside the email at every call site below — losing the SMS
 * leg (e.g. no real Twilio credentials yet, or the recipient has no phone
 * on file) never blocks or is blocked by the email leg.
 */
export function credentialsSmsBody(params: {
  tenantName: string;
  loginIdOrEmail: string;
  tempPassword: string;
  roleLabel: string;
}): string {
  return `${params.tenantName}: your ${params.roleLabel} login is ${params.loginIdOrEmail}, temp password ${params.tempPassword}. Please log in and change it soon.`;
}

/**
 * Creates a PARENT portal login for a guardian and emails the credentials.
 * Shared by the manual "create login" endpoint below and by guardian
 * creation (sis/guardians.ts), which calls this automatically when an
 * email is supplied up front — so a guardian added with an email on file
 * gets their login without a separate admin step.
 */
export async function createGuardianLogin(
  tx: Prisma.TransactionClient,
  tenantId: string,
  guardianId: string,
  opts: { email?: string; createdByUserId?: string },
): Promise<{ guardian: Guardian; userId: string; email: string; tempPassword: string }> {
  const guardian = await tx.guardian.findUnique({ where: { id: guardianId } });
  if (!guardian) throw AppError.notFound('Guardian not found');
  if (guardian.userId) throw AppError.conflict('This guardian already has a portal login');

  const email = opts.email ?? guardian.email;
  if (!email) {
    throw AppError.badRequest('An email is required to create a login (guardian has none on file)', {
      field: 'email',
    });
  }

  const existingUser = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (existingUser) throw AppError.conflict('A user with this email already exists', { field: 'email' });

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email,
      passwordHash,
      fullName: guardian.fullName,
      phone: guardian.phone,
      role: 'PARENT',
      status: 'ACTIVE',
    },
  });

  const updatedGuardian = await tx.guardian.update({
    where: { id: guardian.id },
    data: { userId: user.id },
  });

  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });

  await dispatchNotification(tx, tenantId, {
    channel: 'EMAIL',
    recipientUserId: user.id,
    recipientEmail: email,
    // Safe: user.id was just resolved by our own tenant-scoped create above.
    trustedRecipient: true,
    subject: `Your ${tenant?.name ?? 'school'} parent portal login`,
    body: credentialsEmailBody({
      tenantName: tenant?.name ?? 'your school',
      slug: tenant?.slug ?? '',
      email,
      tempPassword,
      roleLabel: 'parent',
    }),
    relatedEntityType: 'Guardian',
    relatedEntityId: guardian.id,
    createdByUserId: opts.createdByUserId,
  });

  // Guardian.phone is a required field (never null) — unlike email, this
  // leg never needs a presence guard. A failed/quota-exceeded SMS send is
  // recorded as a FAILED Notification row by dispatchNotification itself
  // and never throws, so it can't undo the login/email work already done
  // above.
  await dispatchNotification(tx, tenantId, {
    channel: 'SMS',
    recipientUserId: user.id,
    recipientPhone: guardian.phone,
    trustedRecipient: true,
    body: credentialsSmsBody({
      tenantName: tenant?.name ?? 'your school',
      loginIdOrEmail: email,
      tempPassword,
      roleLabel: 'parent',
    }),
    relatedEntityType: 'Guardian',
    relatedEntityId: guardian.id,
    createdByUserId: opts.createdByUserId,
  });

  // `email` (not `user.email`) — same value, but typed as the guaranteed
  // string it is here (guardians stay email-only; User.email is nullable
  // now only for the ID-only staff/student logins elsewhere).
  return { guardian: updatedGuardian, userId: user.id, email, tempPassword };
}

/**
 * Creates a STUDENT portal login. Shared by the manual "create login"
 * endpoint below and by student creation (sis/students.ts), which now
 * calls this automatically for every admission, not just ones with an
 * email — the login itself is always an ID-based one (Student.studentCode,
 * dashes/case ignored — see lib/loginId.ts), since a school kid may well
 * have no email/mobile of their own. `opts.email` is optional and, when
 * supplied, is ALSO wired up as an alternate login (either works) purely
 * so the credentials can be emailed out too — see the guarded dispatch
 * below, which is simply skipped when there's no address to send to.
 */
export async function createStudentLogin(
  tx: Prisma.TransactionClient,
  tenantId: string,
  studentId: string,
  opts: { email?: string; createdByUserId?: string },
): Promise<{ student: Student; userId: string; email: string | null; loginId: string; tempPassword: string }> {
  const student = await tx.student.findUnique({ where: { id: studentId } });
  if (!student) throw AppError.notFound('Student not found');
  if (student.userId) throw AppError.conflict('This student already has a portal login');

  if (opts.email) {
    const existingUser = await tx.user.findUnique({
      where: { tenantId_email: { tenantId, email: opts.email } },
    });
    if (existingUser) throw AppError.conflict('A user with this email already exists', { field: 'email' });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const loginId = normalizeLoginId(student.studentCode);

  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      tenantId,
      email: opts.email,
      loginId,
      passwordHash,
      fullName: student.fullName,
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  });

  const updatedStudent = await tx.student.update({
    where: { id: student.id },
    data: { userId: user.id },
  });

  // Email and SMS legs are independent — an admission with an email but no
  // contact phone (or vice versa) still gets whichever address it has; a
  // student admitted with neither just gets their ID-based login (above)
  // and the admin relays it out-of-band, same as staff creation does.
  if (opts.email || student.contactPhone) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });

    if (opts.email) {
      await dispatchNotification(tx, tenantId, {
        channel: 'EMAIL',
        recipientUserId: user.id,
        recipientEmail: opts.email,
        trustedRecipient: true,
        subject: `Your ${tenant?.name ?? 'school'} student portal login`,
        body: credentialsEmailBody({
          tenantName: tenant?.name ?? 'your school',
          slug: tenant?.slug ?? '',
          email: opts.email,
          tempPassword,
          roleLabel: 'student',
        }),
        relatedEntityType: 'Student',
        relatedEntityId: student.id,
        createdByUserId: opts.createdByUserId,
      });
    }

    // student.contactPhone is the family contact number captured at
    // admission (see sis/students.ts's CreateStudentRecordInput) — there's
    // no separate student-only phone field, so this is the right SMS
    // target for a young student's login credentials.
    if (student.contactPhone) {
      await dispatchNotification(tx, tenantId, {
        channel: 'SMS',
        recipientUserId: user.id,
        recipientPhone: student.contactPhone,
        trustedRecipient: true,
        body: credentialsSmsBody({
          tenantName: tenant?.name ?? 'your school',
          loginIdOrEmail: opts.email ?? loginId,
          tempPassword,
          roleLabel: 'student',
        }),
        relatedEntityType: 'Student',
        relatedEntityId: student.id,
        createdByUserId: opts.createdByUserId,
      });
    }
  }

  return { student: updatedStudent, userId: user.id, email: user.email, loginId, tempPassword };
}

/**
 * Notifies a guardian, right when they're linked to a student, that a
 * portal login already exists for that student — called from
 * sis/guardians.ts both when a new guardian is created with a studentId
 * and when an existing guardian is linked to a second/third child via
 * POST /link/:studentId. Deliberately does NOT include (or reset) the
 * password: the student may already be actively using it, and silently
 * changing it just because another guardian was added would be a
 * surprising side effect. A no-op when the student has no login yet —
 * createStudentLogin (student creation) or a manual "create login" already
 * covers that path, and there's nothing to tell this guardian yet.
 */
export async function notifyGuardianOfExistingStudentLogin(
  tx: Prisma.TransactionClient,
  tenantId: string,
  params: { studentId: string; guardian: Guardian; createdByUserId?: string },
) {
  const student = await tx.student.findUnique({ where: { id: params.studentId } });
  if (!student?.userId) return;

  const studentUser = await tx.user.findUnique({ where: { id: student.userId } });
  if (!studentUser) return;

  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
  const loginIdOrEmail = studentUser.email ?? studentUser.loginId ?? '(ask the school admin for the login ID)';
  const body = `${tenant?.name ?? 'Your school'}: ${student.fullName} already has a student portal login — ID: ${loginIdOrEmail}. Contact the school admin, or use "Forgot password" on the login page, if you need the password reset.`;

  if (params.guardian.email) {
    await dispatchNotification(tx, tenantId, {
      channel: 'EMAIL',
      recipientEmail: params.guardian.email,
      subject: `${student.fullName}'s student portal login`,
      body,
      relatedEntityType: 'Student',
      relatedEntityId: student.id,
      createdByUserId: params.createdByUserId,
    });
  }

  // Guardian.phone is required (never null) — same as the credentials-SMS
  // legs above, no presence guard needed.
  await dispatchNotification(tx, tenantId, {
    channel: 'SMS',
    recipientPhone: params.guardian.phone,
    body,
    relatedEntityType: 'Student',
    relatedEntityId: student.id,
    createdByUserId: params.createdByUserId,
  });
}

portalProvisioningRouter.post(
  '/guardians/:guardianId/create-login',
  requireRole(...PROVISION_ROLES),
  async (req: Request, res: Response) => {
    const input = createGuardianLoginSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;
    const guardianId = uuidParam(req, 'guardianId');

    const result = await runWithTenant(tenantId, (tx) =>
      createGuardianLogin(tx, tenantId, guardianId, { email: input.email, createdByUserId: req.auth!.userId }),
    );

    res.status(201).json({
      data: { guardian: result.guardian, userId: result.userId, email: result.email },
      // Returned once, at creation time — never retrievable again. Also
      // emailed to the guardian directly (see createGuardianLogin above).
      tempPassword: result.tempPassword,
    });
  },
);

portalProvisioningRouter.post(
  '/students/:studentId/create-login',
  requireRole(...PROVISION_ROLES),
  async (req: Request, res: Response) => {
    const input = createStudentLoginSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;
    const studentId = uuidParam(req, 'studentId');

    const result = await runWithTenant(tenantId, (tx) =>
      createStudentLogin(tx, tenantId, studentId, { email: input.email, createdByUserId: req.auth!.userId }),
    );

    res.status(201).json({
      data: { student: result.student, userId: result.userId, email: result.email, loginId: result.loginId },
      // Returned once, at creation time — never retrievable again. Emailed
      // to the student directly when an email was supplied (see
      // createStudentLogin above); otherwise the admin relays this ID +
      // temp password out-of-band, same as staff creation already does.
      tempPassword: result.tempPassword,
    });
  },
);

export const ROLE_LABELS: Record<string, string> = {
  SCHOOL_ADMIN: 'admin',
  PRINCIPAL: 'principal',
  TEACHER: 'teacher',
  ACCOUNTANT: 'accountant',
  FRONT_DESK: 'front desk',
  PARENT: 'parent',
  STUDENT: 'student',
};

/**
 * Admin-triggered password reset — covers "the student/teacher/parent
 * forgot their password" the same way an admin resetting a forgotten
 * university/office password would: generate a fresh one-time temp
 * password, email it (same template as first-time provisioning), and
 * force every existing session for that account to log out. Works for
 * any portal-login user (student, guardian/parent, or staff) since the
 * password lives on the shared User model regardless of role — the
 * caller only needs that user's id (student.user.id, guardian.userId,
 * or staff.user.id from their respective detail responses).
 *
 * Self-service is covered separately by POST /api/auth/forgot-password
 * (no admin needed) — this route is for when an admin does it *for*
 * someone, e.g. over the phone/in person.
 */
portalProvisioningRouter.post(
  '/users/:userId/reset-password',
  requireRole(...PROVISION_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId!;
    const userId = uuidParam(req, 'userId');

    const result = await runWithTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw AppError.notFound('User not found');

      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);

      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Same "log out everywhere" convention as self-service password
      // change/reset — a reset password shouldn't leave old sessions
      // (e.g. on a shared/lost device) still logged in under the old one.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Only when there's an address on file — an ID-only login (see
      // createStudentLogin/staff.ts's doc comments) has nowhere to send
      // this; the admin relays the temp password from the response below
      // instead, same out-of-band pattern used at creation time. Email and
      // SMS legs are independent, same as at creation.
      if (user.email || user.phone) {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });

        if (user.email) {
          await dispatchNotification(tx, tenantId, {
            channel: 'EMAIL',
            recipientUserId: userId,
            recipientEmail: user.email,
            trustedRecipient: true,
            subject: `Your ${tenant?.name ?? 'school'} portal password has been reset`,
            body: credentialsEmailBody({
              tenantName: tenant?.name ?? 'your school',
              slug: tenant?.slug ?? '',
              email: user.email,
              tempPassword,
              roleLabel: ROLE_LABELS[user.role] ?? 'portal',
            }),
            relatedEntityType: 'User',
            relatedEntityId: userId,
            createdByUserId: req.auth!.userId,
          });
        }

        if (user.phone) {
          await dispatchNotification(tx, tenantId, {
            channel: 'SMS',
            recipientUserId: userId,
            recipientPhone: user.phone,
            trustedRecipient: true,
            body: credentialsSmsBody({
              tenantName: tenant?.name ?? 'your school',
              loginIdOrEmail: user.email ?? user.loginId ?? user.phone,
              tempPassword,
              roleLabel: ROLE_LABELS[user.role] ?? 'portal',
            }),
            relatedEntityType: 'User',
            relatedEntityId: userId,
            createdByUserId: req.auth!.userId,
          });
        }
      }

      return { email: user.email, tempPassword };
    });

    res.status(200).json({
      data: { userId, email: result.email },
      // Returned once, right here — never retrievable again. Also emailed
      // to the account directly (see credentialsEmailBody above).
      tempPassword: result.tempPassword,
    });
  },
);
