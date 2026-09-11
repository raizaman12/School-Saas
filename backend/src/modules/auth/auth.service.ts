import { randomUUID, randomBytes } from 'crypto';
import type { UserRole, Prisma, RefreshToken } from '@prisma/client';
import { getPlan } from '../../config/plans';
import { prisma } from '../../lib/prisma';
import { runWithTenant, type TenantTx } from '../../lib/tenantContext';
import { hashPassword, comparePassword } from '../../lib/password';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  decodeExpiryMs,
} from '../../lib/jwt';
import { AppError } from '../../utils/AppError';
import { logger } from '../../lib/logger';
import { DEFAULT_GRADE_BANDS } from '../exams/grading';
import { deriveTenantCode } from '../../utils/tenantCode';
import { slugify } from '../../utils/slugify';
import { dispatchNotification } from '../notifications/notificationService';
import { ROLE_LABELS } from '../portal/provisioning';
import { looksLikeEmail, normalizeLoginId } from '../../lib/loginId';
import type {
  SignupInput,
  SignupMultiBranchInput,
  LoginInput,
  PlatformLoginInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateMeInput,
} from './auth.validation';

// Kept short deliberately — a forgotten-password window doesn't need to be
// long-lived, and a shorter window shrinks the exposure if the "email"
// (currently logged via LocalNotificationProvider, not really delivered —
// see providers/localProvider.ts) were ever intercepted.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface AuthSubject {
  id: string;
  tenantId: string | null;
  role: UserRole;
}

async function issueTokens(
  subject: AuthSubject,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthTokens> {
  const accessToken = signAccessToken({
    sub: subject.id,
    tenantId: subject.tenantId,
    role: subject.role,
  });

  const { token: refreshToken } = signRefreshToken({
    sub: subject.id,
    tenantId: subject.tenantId,
  });

  const refreshTokenExpiresAt = new Date(decodeExpiryMs(refreshToken));

  await runWithTenant(subject.tenantId, (tx) =>
    tx.refreshToken.create({
      data: {
        id: randomUUID(),
        tenantId: subject.tenantId,
        userId: subject.id,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: refreshTokenExpiresAt,
      },
    }),
  );

  return { accessToken, refreshToken, refreshTokenExpiresAt };
}

interface CreateTenantWithAdminParams {
  tenantId: string;
  // Full display name for this tenant row — for an ordinary single-school
  // signup this is just the school's own name; for a multi-branch signup
  // this is `${groupName} — ${branchName}` (computed by the caller) so
  // every existing consumer of Tenant.name (report-card headers, the
  // password-reset email subject, /me, /tenant-by-slug) stays meaningful
  // without needing to know about SchoolGroup at all.
  name: string;
  slug: string;
  plan: string;
  themeId: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  schoolGroupId?: string;
  branchName?: string;
  adminEmail: string;
  // Pre-hashed — bcrypt at cost-12 is slow, so every caller hashes before
  // opening a transaction (multi-branch signup hashes all branch passwords
  // via Promise.all up front, specifically to never hold a DB transaction
  // open across that cost).
  adminPasswordHash: string;
  adminFullName: string;
  ipAddress?: string;
}

/**
 * Creates one tenant (school/branch) plus its first SCHOOL_ADMIN user,
 * staff profile, and default grading bands — the full "what happens when a
 * school is created" sequence, factored out of signup() so
 * signupMultiBranch() can run it once per branch inside one shared
 * transaction. Byte-for-byte the same steps signup() always ran; behavior
 * is verified unchanged by the full existing auth.test.ts suite staying
 * green against this refactor.
 */
async function createTenantWithAdmin(tx: TenantTx, params: CreateTenantWithAdminParams) {
  const tenant = await tx.tenant.create({
    data: {
      id: params.tenantId,
      name: params.name,
      slug: params.slug,
      code: deriveTenantCode(params.name),
      plan: params.plan,
      themeId: params.themeId,
      contactEmail: params.contactEmail ?? params.adminEmail,
      contactPhone: params.contactPhone,
      address: params.address,
      city: params.city,
      schoolGroupId: params.schoolGroupId,
      branchName: params.branchName,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  const user = await tx.user.create({
    data: {
      id: randomUUID(),
      tenantId: params.tenantId,
      email: params.adminEmail,
      passwordHash: params.adminPasswordHash,
      fullName: params.adminFullName,
      role: 'SCHOOL_ADMIN',
    },
  });

  // The founding admin is staff too — without this, they have no
  // StaffProfile and every staff-only feature (filing their own leave
  // request, appearing in the staff directory/payroll, etc.) rejects
  // them with "No staff profile is linked to your account". Uses a
  // fixed "-ADMIN" code rather than generateEmployeeCode()'s per-tenant
  // sequence (see staff.ts) so it doesn't shift EMP-000001 numbering
  // for staff actually hired through POST /api/staff. Salary/CNIC/etc.
  // aren't collected at signup — the admin (or another admin) can fill
  // those in later via PATCH /api/staff/:id, same as any other staff
  // member editing their own record.
  await tx.staffProfile.create({
    data: {
      id: randomUUID(),
      tenantId: params.tenantId,
      userId: user.id,
      employeeCode: `${tenant.code}-ADMIN`,
      designation: 'Principal',
      employmentType: 'FULL_TIME',
      joiningDate: new Date(),
      monthlySalary: 0,
    },
  });

  // Seed the tenant's grading bands with the historical hardcoded
  // defaults, so a fresh signup grades exams identically to before
  // per-tenant configurability existed — a School Admin can customize
  // these later via /api/grading-bands.
  await tx.gradingBand.createMany({
    data: DEFAULT_GRADE_BANDS.map((band) => ({
      id: randomUUID(),
      tenantId: params.tenantId,
      grade: band.grade,
      minPercentage: band.minPercentage,
      sortOrder: band.sortOrder,
    })),
  });

  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      tenantId: params.tenantId,
      actorUserId: user.id,
      action: 'auth.signup',
      entityType: 'Tenant',
      entityId: tenant.id,
      ipAddress: params.ipAddress,
    },
  });

  return { tenant, user };
}

/** Registers a brand-new school (tenant) plus its first SCHOOL_ADMIN user. */
export async function signup(
  input: SignupInput,
  meta: { userAgent?: string; ipAddress?: string },
) {
  const existing = await prisma.tenant.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw AppError.conflict('That school URL is already taken. Please choose another.', {
      field: 'slug',
    });
  }

  // input.plan used to be validated against a fixed enum at parse time;
  // plans are now a DB table (config/plans.ts), so existence + active-ness
  // is checked here instead. Inactive rejects the same as unknown — a
  // deactivated plan must not be selectable from the public signup form.
  const selectedPlan = await getPlan(input.plan);
  if (!selectedPlan || !selectedPlan.active) {
    throw AppError.badRequest('Selected plan is not available', { field: 'plan' });
  }

  const tenantId = randomUUID();
  const passwordHash = await hashPassword(input.adminPassword);

  const { tenant, user } = await runWithTenant(tenantId, (tx) =>
    createTenantWithAdmin(tx, {
      tenantId,
      name: input.schoolName,
      slug: input.slug,
      plan: input.plan,
      themeId: input.themeId,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      address: input.address,
      city: input.city,
      adminEmail: input.adminEmail,
      adminPasswordHash: passwordHash,
      adminFullName: input.adminFullName,
      ipAddress: meta.ipAddress,
    }),
  );

  logger.info('New tenant signed up', { tenantId: tenant.id, slug: tenant.slug });

  const tokens = await issueTokens({ id: user.id, tenantId, role: user.role }, meta);
  return { tenant, user: sanitizeUser(user), tokens };
}

/** True when `err` is a Prisma unique-constraint violation (error code P2002). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Checks whether `slug` is already taken — against BOTH `Tenant.slug` and
 * `SchoolGroup.slug`, since the two are different tables with no shared
 * DB constraint between them (a branch's own tenant slug and a group's
 * login slug must never collide with each other).
 */
async function isSlugTaken(slug: string): Promise<boolean> {
  const [tenant, group] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    prisma.schoolGroup.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  return Boolean(tenant || group);
}

/**
 * Derives a unique branch tenant slug from `base` (already slugified),
 * checking both the DB (via isSlugTaken) and every slug already claimed
 * earlier in this same signup request (`reserved`) — two branches whose
 * names slugify identically (e.g. two "Main Campus" branches) must not
 * collide with each other either. Appends a numeric suffix (-2, -3, ...)
 * on collision, truncating the base so the result still fits slugSchema's
 * 63-char max.
 */
async function resolveUniqueBranchSlug(base: string, reserved: Set<string>): Promise<string> {
  let candidate = base.slice(0, 63);
  let suffix = 2;
  while (reserved.has(candidate) || (await isSlugTaken(candidate))) {
    const suffixStr = `-${suffix}`;
    candidate = `${base.slice(0, 63 - suffixStr.length)}${suffixStr}`;
    suffix++;
  }
  reserved.add(candidate);
  return candidate;
}

/**
 * Registers a multi-branch school: one shared, publicly-known SchoolGroup
 * (its `slug` is what families type at login — see resolveSchool below)
 * plus 2-20 branches, each a fully ordinary, independent Tenant with its
 * own SCHOOL_ADMIN — matching the requirement that no branch admin ever
 * needs to go through whoever registered the group. Returns no tokens and
 * sets no login state: with N independent admins there is no single "the"
 * logged-in user this signup could log in as.
 */
export async function signupMultiBranch(
  input: SignupMultiBranchInput,
  meta: { userAgent?: string; ipAddress?: string },
) {
  if (await isSlugTaken(input.slug)) {
    throw AppError.conflict('That school URL is already taken. Please choose another.', {
      field: 'slug',
    });
  }

  // See signup()'s identical check — plans are a DB table now.
  const selectedPlan = await getPlan(input.plan);
  if (!selectedPlan || !selectedPlan.active) {
    throw AppError.badRequest('Selected plan is not available', { field: 'plan' });
  }

  // Derive + reserve every branch's own tenant slug up front, fully
  // outside any transaction — these are plain reads plus in-memory
  // bookkeeping, cheap to do before we commit to opening the transaction.
  const reservedSlugs = new Set<string>([input.slug]);
  const branchPlans: Array<
    SignupMultiBranchInput['branches'][number] & { tenantId: string; slug: string }
  > = [];
  for (const branch of input.branches) {
    const base = slugify(`${input.slug}-${branch.branchName}`);
    const slug = await resolveUniqueBranchSlug(base || input.slug, reservedSlugs);
    branchPlans.push({ ...branch, tenantId: randomUUID(), slug });
  }

  // Hash every branch admin's password BEFORE opening the transaction —
  // bcrypt at cost-12 is CPU-slow (confirmed elsewhere in this codebase),
  // and holding a DB transaction open across N of those hashes would tie
  // up a connection far longer than necessary and risk hitting the
  // transaction's own timeout under load.
  const passwordHashes = await Promise.all(branchPlans.map((b) => hashPassword(b.adminPassword)));

  const schoolGroupId = randomUUID();

  try {
    const { schoolGroup, createdBranches } = await prisma.$transaction(
      async (tx) => {
        // SchoolGroup is not tenant-scoped (much like Tenant itself — see
        // its own RLS policy comment in the migration) — no app.tenant_id
        // context is needed to create it.
        const schoolGroup = await tx.schoolGroup.create({
          data: { id: schoolGroupId, name: input.schoolName, slug: input.slug },
        });

        const createdBranches: Array<Awaited<ReturnType<typeof createTenantWithAdmin>>> = [];

        // STRICTLY SEQUENTIAL — never Promise.all/concurrent. Every
        // iteration re-issues `set_config('app.tenant_id', ...)` on this
        // SAME shared transaction connection (see tenantContext.ts's own
        // warning about SET LOCAL being transaction-scoped); running these
        // branch creations concurrently would race that call and could
        // silently write one branch's rows under a DIFFERENT branch's
        // tenant context on the shared connection — a real cross-tenant
        // data-isolation bug, not merely a slower one. Do not "optimize"
        // this loop.
        for (let i = 0; i < branchPlans.length; i++) {
          const branch = branchPlans[i];
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${branch.tenantId}, true)`;
          const created = await createTenantWithAdmin(tx as unknown as TenantTx, {
            tenantId: branch.tenantId,
            name: `${input.schoolName} — ${branch.branchName}`,
            slug: branch.slug,
            plan: input.plan,
            themeId: input.themeId,
            city: branch.city,
            schoolGroupId: schoolGroup.id,
            branchName: branch.branchName,
            adminEmail: branch.adminEmail,
            adminPasswordHash: passwordHashes[i],
            adminFullName: branch.adminFullName,
            ipAddress: meta.ipAddress,
          });
          createdBranches.push(created);
        }

        return { schoolGroup, createdBranches };
      },
      { timeout: 20_000 },
    );

    logger.info('New multi-branch school group signed up', {
      schoolGroupId: schoolGroup.id,
      slug: schoolGroup.slug,
      branchCount: createdBranches.length,
    });

    return {
      schoolGroup,
      branches: createdBranches.map(({ tenant, user }) => ({ tenant, user: sanitizeUser(user) })),
    };
  } catch (err) {
    // Raced unique violation — another request claimed one of these slugs
    // between our pre-checks above and this transaction actually
    // committing. Narrow enough window that a pre-check-only approach is
    // normally fine (matches this codebase's established convention — see
    // students.ts's assertRollNumberFree doc comment), but signup traffic
    // makes it worth a safety net rather than a raw 500.
    if (isUniqueConstraintError(err)) {
      throw AppError.conflict('One of the school URLs was just taken by another request. Please try again.');
    }
    throw err;
  }
}

/**
 * Resolves a login-time school URL to either a single tenant or a
 * multi-branch group — the pre-authentication lookup the login page runs
 * as soon as a slug is entered/auto-detected (see the frontend's
 * resolveSchool resource). Checks Tenant.slug first: a branch's own real
 * slug always resolves directly (whether the visitor typed it themselves
 * or arrived via the group's branch-picker), landing straight on the
 * credentials form. Only falls through to SchoolGroup.slug when no tenant
 * matches, surfacing the branch list for the group's own shared login URL.
 */
export async function resolveSchool(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      themeId: true,
      branchName: true,
      schoolGroup: { select: { name: true, slug: true } },
    },
  });
  if (tenant) {
    return {
      kind: 'tenant' as const,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        themeId: tenant.themeId,
        branchName: tenant.branchName,
        groupName: tenant.schoolGroup?.name ?? null,
        groupSlug: tenant.schoolGroup?.slug ?? null,
      },
    };
  }

  const group = await prisma.schoolGroup.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      branches: {
        // Excludes branches that can't actually be logged into (matches
        // login()'s own SUSPENDED/CANCELLED block above) — otherwise a
        // picked branch would dead-end right at the credentials step.
        where: { status: { notIn: ['SUSPENDED', 'CANCELLED'] } },
        select: { slug: true, branchName: true, city: true },
        orderBy: { branchName: 'asc' },
      },
    },
  });
  if (group) {
    return { kind: 'group' as const, group };
  }

  throw AppError.notFound('School not found');
}

export async function login(
  input: LoginInput,
  meta: { userAgent?: string; ipAddress?: string },
) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: input.slug } });
  if (!tenant) throw AppError.unauthorized('Invalid credentials');

  if (tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
    throw AppError.forbidden('This school account is not active. Please contact support.');
  }

  // input.email now doubles as an ID login — see loginSchema's doc
  // comment. An "@" means it's a real email, matched exactly as before;
  // anything else is treated as a system-generated login ID and matched
  // against User.loginId, dash/case-insensitively (see lib/loginId.ts).
  const identifier = input.email;
  const user = await runWithTenant(tenant.id, (tx) =>
    looksLikeEmail(identifier)
      ? tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: identifier } } })
      : tx.user.findFirst({ where: { tenantId: tenant.id, loginId: normalizeLoginId(identifier) } }),
  );

  // Constant-shape response whether the user exists or not, to avoid
  // leaking which emails are registered.
  if (!user || user.status !== 'ACTIVE') {
    // Still run a bcrypt compare against a dummy hash so the response
    // timing doesn't reveal whether the account exists.
    await comparePassword(input.password, '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvOK');
    throw AppError.unauthorized('Invalid credentials');
  }

  const passwordOk = await comparePassword(input.password, user.passwordHash);
  if (!passwordOk) throw AppError.unauthorized('Invalid credentials');

  await runWithTenant(tenant.id, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  );

  await runWithTenant(tenant.id, (tx) =>
    tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ipAddress,
      },
    }),
  );

  const tokens = await issueTokens({ id: user.id, tenantId: tenant.id, role: user.role }, meta);
  return { tenant, user: sanitizeUser(user), tokens };
}

/** Platform-level (SUPER_ADMIN) login — no tenant/slug involved. */
export async function platformLogin(
  input: PlatformLoginInput,
  meta: { userAgent?: string; ipAddress?: string },
) {
  const user = await runWithTenant(null, (tx) =>
    tx.user.findFirst({ where: { email: input.email, role: 'SUPER_ADMIN' } }),
  );

  if (!user || user.status !== 'ACTIVE') {
    await comparePassword(input.password, '$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvOK');
    throw AppError.unauthorized('Invalid credentials');
  }

  const passwordOk = await comparePassword(input.password, user.passwordHash);
  if (!passwordOk) throw AppError.unauthorized('Invalid credentials');

  await runWithTenant(null, (tx) =>
    tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  );

  const tokens = await issueTokens({ id: user.id, tenantId: null, role: user.role }, meta);
  return { user: sanitizeUser(user), tokens };
}

/** Verifies + rotates a refresh token, issuing a fresh access/refresh pair. */
export async function refresh(
  refreshTokenRaw: string,
  meta: { userAgent?: string; ipAddress?: string },
  expectedSlug?: string,
) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshTokenRaw);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  // Cross-tenant session guard — see refreshSchema's doc comment for why
  // this is needed despite RLS already isolating every table: the
  // refresh-token cookie itself is shared by Domain across every school's
  // subdomain, so without this a stale cookie from School A would silently
  // mint a valid School A access token while the visitor is on School B's
  // page. A mismatch here means "this cookie is for a different school
  // than the page currently claims to be" — treated exactly like no
  // session at all, forcing a fresh, explicit login.
  if (expectedSlug) {
    if (!claims.tenantId) {
      throw AppError.unauthorized('Session invalidated — please log in again');
    }
    const expectedTenant = await prisma.tenant.findUnique({
      where: { id: claims.tenantId },
      select: { slug: true },
    });
    if (!expectedTenant || expectedTenant.slug !== expectedSlug) {
      logger.warn('Refresh rejected — session tenant does not match the requesting page\'s school', {
        tenantId: claims.tenantId,
        expectedSlug,
      });
      throw AppError.unauthorized('This session belongs to a different school — please log in again.');
    }
  }

  let tokenHash = hashToken(refreshTokenRaw);

  let stored: RefreshToken | null = await runWithTenant(claims.tenantId, (tx) =>
    tx.refreshToken.findUnique({ where: { tokenHash } }),
  );

  if (!stored || stored.userId !== claims.sub) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  // Rotation below is strictly single-use, but a client can legitimately
  // present an already-rotated token in a narrow, benign race: each full
  // page load/reload is a fresh JS context (see AuthProvider.tsx's
  // silent-refresh-on-mount effect), so if the PREVIOUS reload's refresh
  // request reached the server and rotated the token, but that page got
  // torn down (navigated away again) before its response could be
  // persisted to storage, the NEXT reload is left holding a token that's
  // already been superseded — through no fault of its own. Confirmed live:
  // this alone was enough to force a real, still-valid session back to the
  // login page on nothing more than a normal page reload.
  //
  // Fast-forward to whatever this token was actually superseded by, but
  // ONLY when that rotation happened within the last few seconds — a
  // narrow enough window to cover a reload race, not a window a real
  // attacker replaying a stolen token minutes/hours later could ever land
  // in. Anything outside it (or with no valid replacement to forward to)
  // still falls through to the theft-detection branch below, unchanged.
  const REUSE_GRACE_MS = 10_000;
  let hops = 0;
  while (
    stored?.revokedAt &&
    stored.replacedByTokenHash &&
    Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS &&
    hops < 5
  ) {
    const replacedByTokenHash: string = stored.replacedByTokenHash;
    const next: RefreshToken | null = await runWithTenant(claims.tenantId, (tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash: replacedByTokenHash } }),
    );
    if (!next || next.userId !== claims.sub) break;
    stored = next;
    tokenHash = stored.tokenHash;
    hops++;
  }

  if (stored.revokedAt) {
    // This token was already rotated away and either has no valid
    // replacement to fast-forward to, or was rotated too long ago for the
    // reload-race above to plausibly explain it — either a client retried
    // a truly stale token, or an attacker stole it after a legitimate
    // rotation already happened. We can't tell which, so we fail safe:
    // kill every session for this user and force a fresh login.
    logger.warn('Refresh token reuse detected — revoking all sessions for user', {
      userId: stored.userId,
      tenantId: claims.tenantId,
    });
    await runWithTenant(claims.tenantId, (tx) =>
      tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    throw AppError.unauthorized('Session invalidated — please log in again');
  }

  if (stored.expiresAt < new Date()) {
    throw AppError.unauthorized('Invalid or expired refresh token');
  }

  const user = await runWithTenant(claims.tenantId, (tx) =>
    tx.user.findUnique({ where: { id: claims.sub } }),
  );
  if (!user || user.status !== 'ACTIVE') throw AppError.unauthorized('Invalid or expired refresh token');

  const tokens = await issueTokens({ id: user.id, tenantId: claims.tenantId, role: user.role }, meta);

  // Rotate: revoke the old token and link it to the new one (helps detect
  // refresh-token replay/theft if the old token is ever presented again).
  await runWithTenant(claims.tenantId, (tx) =>
    tx.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date(), replacedByTokenHash: hashToken(tokens.refreshToken) },
    }),
  );

  return { user: sanitizeUser(user), tokens };
}

export async function logout(refreshTokenRaw: string) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshTokenRaw);
  } catch {
    return; // already invalid/expired — nothing to revoke
  }

  const tokenHash = hashToken(refreshTokenRaw);
  await runWithTenant(claims.tenantId, (tx) =>
    tx.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

/**
 * Self-service password change for the currently authenticated user, any
 * role (staff, PARENT, STUDENT, SUPER_ADMIN — password lives on the shared
 * User model regardless of role). The email/ID never changes here, only
 * the passwordHash — matches the "same login ID, new password" flow the
 * user asked to have confirmed (e.g. a university portal that lets you
 * change your password but keeps your student ID the same).
 */
export async function changePassword(
  subject: { id: string; tenantId: string | null },
  input: ChangePasswordInput,
  meta: { ipAddress?: string },
) {
  const user = await runWithTenant(subject.tenantId, (tx) => tx.user.findUnique({ where: { id: subject.id } }));
  if (!user || user.status !== 'ACTIVE') throw AppError.unauthorized('Invalid credentials');

  const passwordOk = await comparePassword(input.currentPassword, user.passwordHash);
  if (!passwordOk) throw AppError.badRequest('Current password is incorrect', { field: 'currentPassword' });

  const newPasswordHash = await hashPassword(input.newPassword);

  await runWithTenant(subject.tenantId, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: newPasswordHash } });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: subject.tenantId,
        actorUserId: user.id,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: user.id,
        ipAddress: meta.ipAddress,
      },
    });
  });

  // Reuse detection: revoke every existing refresh token so any other
  // logged-in session/device is forced to re-authenticate with the new
  // password, same as a "log out everywhere" on password change.
  await runWithTenant(subject.tenantId, (tx) =>
    tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

/**
 * Self-service "edit my own contact info" — any authenticated role
 * (student, parent/guardian, teacher/staff, SCHOOL_ADMIN). Lets a portal
 * user fix their own email/phone themselves instead of always having to
 * ask an admin — the same fields an admin can already edit for them (see
 * sis/students.ts, sis/guardians.ts, staff/staff.ts's PATCH routes),
 * except scoped to "my own record" rather than requiring an id + an
 * admin/front-desk role. Writes land on exactly the same columns those
 * admin routes read/write, so the change shows up in the admin's view
 * immediately — there's no separate sync step needed.
 */
export async function updateMe(
  subject: { id: string; tenantId: string | null; role: UserRole },
  input: UpdateMeInput,
) {
  return runWithTenant(subject.tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: subject.id } });
    if (!user || user.status !== 'ACTIVE') throw AppError.unauthorized();

    if (input.email !== undefined && input.email !== user.email) {
      // SUPER_ADMIN accounts have a NULL tenantId, so the usual
      // tenantId_email compound-unique lookup (which every other role
      // uses) doesn't apply — mirrors platformLogin()'s same tenantId ===
      // null branch above.
      const emailTaken = subject.tenantId
        ? await tx.user.findUnique({
            where: { tenantId_email: { tenantId: subject.tenantId, email: input.email } },
          })
        : await tx.user.findFirst({ where: { tenantId: null, email: input.email } });
      if (emailTaken && emailTaken.id !== user.id) {
        throw AppError.conflict('A user with this email already exists', { field: 'email' });
      }
    }

    const userData: Prisma.UserUpdateInput = {};
    if (input.email !== undefined) userData.email = input.email;

    if (input.email !== undefined && subject.role === 'PARENT') {
      // Same drift risk as phone below (and the exact bug fixed on the
      // admin side in guardians.ts's PATCH): Guardian.email is the
      // contact address the admin's guardian list/detail actually reads,
      // separate from the login email on User — keep them in sync.
      const guardian = await tx.guardian.findUnique({ where: { userId: subject.id } });
      if (guardian) await tx.guardian.update({ where: { id: guardian.id }, data: { email: input.email } });
    }

    if (input.phone !== undefined) {
      if (subject.role === 'STUDENT') {
        // A student has no phone of their own on User — their contact
        // number lives on Student.contactPhone (see sis/students.ts).
        const student = await tx.student.findUnique({ where: { userId: subject.id } });
        if (student) await tx.student.update({ where: { id: student.id }, data: { contactPhone: input.phone } });
      } else if (subject.role === 'PARENT') {
        // Guardian.phone is the canonical number the admin's guardian
        // list/detail views read — User.phone is kept in sync alongside
        // it (same two-places-one-value pattern as email, see
        // sis/guardians.ts's PATCH sync comment) rather than left to drift.
        const guardian = await tx.guardian.findUnique({ where: { userId: subject.id } });
        if (guardian) await tx.guardian.update({ where: { id: guardian.id }, data: { phone: input.phone } });
        userData.phone = input.phone;
      } else {
        userData.phone = input.phone;
      }
    }

    // address/emergencyContact only exist on Student — see updateMeSchema's
    // doc comment for why other roles' equivalent fields go through a
    // different endpoint (or don't exist at all) and are silently ignored
    // here rather than erroring.
    if ((input.address !== undefined || input.emergencyContact !== undefined) && subject.role === 'STUDENT') {
      const student = await tx.student.findUnique({ where: { userId: subject.id } });
      if (student) {
        await tx.student.update({
          where: { id: student.id },
          data: {
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact } : {}),
          },
        });
      }
    }

    const updated =
      Object.keys(userData).length > 0 ? await tx.user.update({ where: { id: user.id }, data: userData }) : user;

    return sanitizeUser(updated);
  });
}

/**
 * Requests a "forgot password" reset token for a tenant portal user
 * (STUDENT/PARENT/staff — matches the slug+email pair login() takes,
 * since there's no other way to identify a user before authenticating).
 *
 * Always resolves without throwing, and the controller always answers
 * with the same generic 200 regardless of what happened here — same
 * "constant-shape response" principle as login()'s invalid-credentials
 * path, so a caller can't use this to enumerate which emails have
 * accounts. Returns the raw token only so the controller can echo it
 * back in non-production responses for local testing (see
 * auth.controller.ts) — the real "delivery" is always the email.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<{ token: string } | null> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: input.slug } });
  if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') return null;

  const user = await runWithTenant(tenant.id, (tx) =>
    tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: input.email } } }),
  );
  if (!user || user.status !== 'ACTIVE') return null;

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await runWithTenant(tenant.id, async (tx) => {
    // Old, still-unused tokens for this user are superseded, not kept
    // around — otherwise an old leaked email could still reset the
    // password after the user requested (and expects to use) a fresh one.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    await tx.passwordResetToken.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await dispatchNotification(tx, tenant.id, {
      channel: 'EMAIL',
      recipientUserId: user.id,
      // Always set here — this user was just found via an exact-email
      // lookup a few lines up (requestPasswordReset only ever runs for a
      // real-email login), the `?? undefined` is purely to satisfy the
      // (now nullable, for ID-only accounts elsewhere) User.email type.
      recipientEmail: user.email ?? undefined,
      trustedRecipient: true,
      subject: `Reset your ${tenant.name} portal password`,
      body: [
        `A password reset was requested for your ${tenant.name} portal account.`,
        '',
        `School: ${tenant.name} (${tenant.slug})`,
        `Login email: ${user.email}`,
        `Reset code: ${rawToken}`,
        '',
        'Enter this code on the "Reset password" page to choose a new password.',
        'This code expires in 1 hour. If you did not request this, you can ignore this message.',
      ].join('\n'),
      relatedEntityType: 'User',
      relatedEntityId: user.id,
    });
  });

  return { token: rawToken };
}

/**
 * Completes a "forgot password" reset: verifies the token (hashed lookup,
 * same convention as RefreshToken.tokenHash), sets the new password, and
 * — like changePassword() — revokes every existing refresh token so any
 * other logged-in session is forced to re-authenticate.
 */
export async function resetPassword(input: ResetPasswordInput, meta: { ipAddress?: string }) {
  const tenant = await prisma.tenant.findUnique({ where: { slug: input.slug } });
  if (!tenant) throw AppError.badRequest('Invalid or expired reset code');

  const tokenHash = hashToken(input.token);

  await runWithTenant(tenant.id, async (tx) => {
    const stored = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw AppError.badRequest('Invalid or expired reset code');
    }

    const newPasswordHash = await hashPassword(input.newPassword);

    const user = await tx.user.update({
      where: { id: stored.userId },
      data: { passwordHash: newPasswordHash },
    });
    await tx.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
    await tx.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        actorUserId: stored.userId,
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: stored.userId,
        ipAddress: meta.ipAddress,
      },
    });

    // Security-notice confirmation, separate from requestPasswordReset's
    // own "here's your reset code" email above — this one fires only once
    // the password has actually been changed, so the account owner finds
    // out even if they weren't the one who requested it. Deliberately
    // contains no password/code — just "this happened" — same independent
    // email+SMS legs as every other credentials dispatch in this app.
    if (user.email || user.phone) {
      const body = `Your ${tenant.name} ${ROLE_LABELS[user.role] ?? 'portal'} password was just changed. If this wasn't you, contact the school admin immediately.`;

      if (user.email) {
        await dispatchNotification(tx, tenant.id, {
          channel: 'EMAIL',
          recipientUserId: user.id,
          recipientEmail: user.email,
          trustedRecipient: true,
          subject: `Your ${tenant.name} password was changed`,
          body,
          relatedEntityType: 'User',
          relatedEntityId: user.id,
        });
      }
      if (user.phone) {
        await dispatchNotification(tx, tenant.id, {
          channel: 'SMS',
          recipientUserId: user.id,
          recipientPhone: user.phone,
          trustedRecipient: true,
          body,
          relatedEntityType: 'User',
          relatedEntityId: user.id,
        });
      }
    }
  });
}

/** Never return passwordHash to a client. */
function sanitizeUser<T extends { passwordHash: string }>(user: T): Omit<T, 'passwordHash'> {
  const safe = { ...user } as Partial<T>;
  delete safe.passwordHash;
  return safe as Omit<T, 'passwordHash'>;
}
