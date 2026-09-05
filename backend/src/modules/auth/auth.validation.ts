import { z } from 'zod';
import { THEME_IDS, DEFAULT_THEME_ID } from '../../config/themePresets';

// Slug: lowercase letters, numbers, hyphens — used as the tenant's
// subdomain-style identifier (e.g. "alpha-school"). Exported for reuse by
// the public tenant-by-slug lookup route (GET /api/auth/tenant-by-slug/:slug),
// which the frontend calls when a request arrives on <slug>.<appDomain> to
// resolve the school's display name before the login form even renders.
export const slugSchema = z
  .string()
  // Mirrors the frontend's same .trim() (see frontend/src/lib/auth/schemas.ts)
  // — belt-and-suspenders in case a request ever reaches the API directly
  // (or a future client) without the frontend's own trim already applied.
  .trim()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers and hyphens only');

// Exported for reuse by the createSuperAdmin bootstrap script — platform
// admin accounts should be held to the same strength bar as school admins.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72) // bcrypt's hard limit
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const signupSchema = z.object({
  schoolName: z.string().min(2).max(150),
  slug: slugSchema,
  contactEmail: z.string().email().max(255).optional(),
  contactPhone: z.string().max(30).optional(),
  address: z.string().max(255).optional(),
  city: z.string().max(100).optional(),

  adminFullName: z.string().min(2).max(150),
  adminEmail: z.string().email().max(255),
  adminPassword: passwordSchema,

  // Self-selected subscription tier. No payment gateway exists yet, so
  // this is informational/self-declared at signup — a Super Admin can
  // always correct it later via PATCH /api/platform/tenants/:id/plan.
  // Defaults to TRIAL (unchanged behavior) when omitted, matching every
  // signup before a plan-selection step existed.
  plan: z.enum(['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM']).default('TRIAL'),

  // Chosen dashboard/portal accent-color theme (see config/themePresets.ts)
  // — picked at signup, changeable later via PATCH /api/tenant/theme.
  themeId: z.enum([...THEME_IDS]).default(DEFAULT_THEME_ID),
});
export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Multi-branch school registration: one shared, publicly-known school/group
 * URL plus 2-20 branches, each getting its own fully independent
 * SCHOOL_ADMIN (no shared "master" admin) — see auth.service.ts's
 * signupMultiBranch. `slug` here is the GROUP's login URL (what families
 * type at login before picking a branch — see resolveSchool); each
 * branch's own internal tenant slug is derived server-side from it (see
 * utils/slugify.ts), never supplied by the client.
 */
export const signupMultiBranchSchema = z.object({
  schoolName: z.string().min(2).max(150),
  slug: slugSchema,
  plan: z.enum(['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM']).default('TRIAL'),
  themeId: z.enum([...THEME_IDS]).default(DEFAULT_THEME_ID),
  branches: z
    .array(
      z.object({
        branchName: z.string().min(2).max(100),
        city: z.string().min(1).max(100),
        adminFullName: z.string().min(2).max(150),
        adminEmail: z.string().email().max(255),
        adminPassword: passwordSchema,
      }),
    )
    .min(2, 'A multi-branch school needs at least 2 branches')
    .max(20, 'A single registration can add at most 20 branches at once'),
});
export type SignupMultiBranchInput = z.infer<typeof signupMultiBranchSchema>;

// Named `email` for wire/backward compatibility (the field the frontend
// has always posted), but it now accepts EITHER a real email address OR a
// system-generated login ID (StaffProfile.employeeCode / Student.studentCode,
// dashes/case ignored — see lib/loginId.ts). auth.service.ts's login()
// decides which one this is purely by whether it contains "@". Kept to a
// generous max length and a minimum of 1 rather than `.email()` so an
// ID-shaped value isn't rejected before it even reaches that check.
export const loginSchema = z.object({
  slug: slugSchema,
  email: z.string().trim().min(1, 'Required').max(255),
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Body for POST /api/auth/refresh. `expectedSlug` is the tenant slug the
 * FRONTEND currently believes it's representing — derived client-side from
 * <slug>.<appDomain> (see subdomain.ts's extractTenantSlugFromHost). The
 * refresh-token cookie's Domain is deliberately shared across every
 * school's subdomain (see auth.controller.ts's setRefreshCookie — needed
 * so the API host can see a cookie set while browsing a school's own
 * host), which means the SAME browser can be carrying a DIFFERENT school's
 * still-valid refresh cookie at the moment this fires (e.g. the visitor
 * was signed in to School A, then navigated to School B's subdomain
 * without an explicit logout). Without this check, refresh() would
 * silently mint a fresh access token for whichever tenant the stale
 * cookie belongs to — visually indistinguishable from "School A's data is
 * showing on School B's page". `expectedSlug` is optional: a non-subdomain
 * deployment (no NEXT_PUBLIC_APP_DOMAIN configured, e.g. plain local dev)
 * has no way to derive it and skips this check entirely, same as before.
 */
export const refreshSchema = z.object({
  expectedSlug: slugSchema.optional(),
});

export const platformLoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(72),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

// Self-service password change for any authenticated role (staff, PARENT,
// STUDENT, SUPER_ADMIN — password lives on the shared User model regardless
// of role). The user's email/ID never changes here, only the passwordHash.
// Reuses the same strength bar (`passwordSchema`) enforced at signup/staff
// creation.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Self-service "forgot password" — unauthenticated, so it needs the same
// slug+email pair login does (there's no other way to identify a tenant
// user without being logged in). Always answered with a generic 200
// regardless of whether the account exists, to avoid leaking which
// emails are registered (see auth.service.ts's requestPasswordReset).
export const forgotPasswordSchema = z.object({
  slug: slugSchema,
  email: z.string().email().max(255),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// slug is required for the same reason forgotPasswordSchema needs it: the
// reset token alone doesn't identify a tenant, and the lookup has to run
// inside that tenant's RLS-scoped transaction (see auth.service.ts).
export const resetPasswordSchema = z.object({
  slug: slugSchema,
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Self-service "edit my own contact info" — any authenticated role. Only
// email/phone are editable here (not fullName or anything role-specific);
// see authService.updateMe for where each field actually lands depending
// on role (a STUDENT's "phone" is Student.contactPhone, a PARENT's is
// Guardian.phone, everyone else's is User.phone directly).
//
// address/emergencyContact are STUDENT-only additions (the portal's My
// Profile → About tab — see Student.emergencyContact's doc comment in
// schema.prisma) — land on Student.address/Student.emergencyContact.
// Silently ignored for every other role (a staff member's equivalent
// fields are self-edited via PATCH /api/staff/me instead, and no other
// role has an address/emergencyContact field to write to) rather than
// rejected, since the frontend simply never sends them for those roles.
export const updateMeSchema = z
  .object({
    email: z.string().email().max(255).optional(),
    phone: z.string().max(30).optional(),
    address: z.string().max(255).optional(),
    emergencyContact: z.string().max(100).optional(),
  })
  .refine(
    (data) =>
      data.email !== undefined ||
      data.phone !== undefined ||
      data.address !== undefined ||
      data.emergencyContact !== undefined,
    { message: 'Provide at least one field to update' },
  );
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
