import type { Request, Response } from 'express';
import { env } from '../../config/env';
import * as authService from './auth.service';
import {
  signupSchema,
  signupMultiBranchSchema,
  loginSchema,
  platformLoginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateMeSchema,
  slugSchema,
  refreshSchema,
} from './auth.validation';
import { AppError } from '../../utils/AppError';
import { runWithTenant } from '../../lib/tenantContext';
import { prisma } from '../../lib/prisma';
import { param } from '../../utils/params';
import { listPlans } from '../../config/plans';

// Exported so rateLimiter.ts's refresh-endpoint key generator can read the
// same cookie name to identify the caller for its own budget partitioning
// — see refreshRateLimiter's doc comment there.
export const REFRESH_COOKIE = 'refreshToken';

function requestMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  // Whenever COOKIE_DOMAIN is configured, the cookie is deliberately being
  // shared between two different hosts (the API's own host and each
  // school's app host) — verified empirically (via a real headless-browser
  // + CDP cookie-block-reason probe, not just spec-reading) that Chrome
  // treats this as a cross-site relationship for SameSite purposes in at
  // least one real topology (multi-label *.localhost dev hosts, which
  // aren't on the public suffix list, so Chrome can't collapse them into
  // one "site" the way it would for two subdomains of a real registered
  // domain like yourschoolsaas.com). SameSite=Lax cookies get silently
  // dropped in that case (confirmed via
  // Network.responseReceivedExtraInfo's blockedCookies:
  // blockedReasons=["SameSiteLax"]) — SameSite=None is the only setting
  // that reliably works across every such host pairing, real or
  // synthetic. SameSite=None requires Secure; also confirmed (same
  // probe technique) that Chrome accepts a Secure cookie over plain
  // http://*.localhost without real TLS, because *.localhost is spec'd as
  // a "potentially trustworthy origin" regardless of scheme — so this
  // doesn't require HTTPS in local dev, only in a real production host.
  // See COOKIE_SAMESITE_NONE's doc comment in config/env.ts — it's a
  // separate knob from COOKIE_DOMAIN because the two solve different
  // topologies (a shared parent domain vs. two entirely unrelated
  // domains, e.g. this project's own Vercel-frontend + Render-API
  // free-tier demo deployment, where a Domain attribute can't help at
  // all — a browser will only accept a Domain that is the setting host's
  // own domain or a parent of it).
  const crossHost = Boolean(env.COOKIE_DOMAIN) || env.COOKIE_SAMESITE_NONE;
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: crossHost || env.NODE_ENV === 'production',
    sameSite: crossHost ? 'none' : 'lax',
    expires: expiresAt,
    // Path is deliberately "/" rather than "/api/auth": the cookie is
    // httpOnly (never readable by JS regardless of path), and while it's
    // no longer what the frontend's proxy (middleware) reads for its own
    // session-presence check (see frontend/src/proxy.ts + lib/api.ts's
    // session-hint cookie — this one is invisible cross-domain in the
    // split free-tier topology, so the middleware can't rely on it there
    // either), a full path keeps this cookie behaving like an ordinary
    // site-wide session cookie rather than one scoped to a single route.
    path: '/',
    // See COOKIE_DOMAIN's doc comment in config/env.ts. undefined falls
    // back to express's own host-only default.
    domain: env.COOKIE_DOMAIN,
  });
}

export async function signupHandler(req: Request, res: Response) {
  const input = signupSchema.parse(req.body);
  const { tenant, user, tokens } = await authService.signup(input, requestMeta(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(201).json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      themeId: tenant.themeId,
    },
    user,
    accessToken: tokens.accessToken,
    // Also returned in the body (not just the httpOnly cookie) so the
    // frontend can pin this specific browser TAB to this specific login —
    // see refreshHandler's doc comment for why the shared cookie alone
    // isn't enough once more than one account is signed in across
    // different tabs of the same browser.
    refreshToken: tokens.refreshToken,
  });
}

/**
 * Multi-branch school registration — creates a SchoolGroup plus 2-20
 * independent branch Tenants, each with its own SCHOOL_ADMIN. Unlike
 * signupHandler, this issues NO tokens and sets NO refresh cookie: with N
 * independent branch admins created at once, there is no single "the"
 * account to log this request in as. The response lists every created
 * branch's slug/name so the frontend can show each branch admin their own
 * login URL.
 */
export async function signupMultiBranchHandler(req: Request, res: Response) {
  const input = signupMultiBranchSchema.parse(req.body);
  const { schoolGroup, branches } = await authService.signupMultiBranch(input, requestMeta(req));
  res.status(201).json({
    schoolGroup: { id: schoolGroup.id, name: schoolGroup.name, slug: schoolGroup.slug },
    branches: branches.map(({ tenant, user }) => ({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        branchName: tenant.branchName,
      },
      user: { id: user.id, email: user.email, fullName: user.fullName },
    })),
  });
}

/**
 * Public, unauthenticated pre-login lookup — the login page calls this
 * (instead of tenantBySlugHandler) so it can tell, before rendering the
 * credentials form, whether the entered/auto-detected URL belongs to a
 * single school (straight to the login form, unchanged UX) or a
 * multi-branch group (show a "Choose your branch" picker first). Same
 * "no auth required" rationale as tenantBySlugHandler above — nothing
 * returned here is sensitive.
 */
export async function resolveSchoolHandler(req: Request, res: Response) {
  const slug = slugSchema.parse(param(req, 'slug'));
  const result = await authService.resolveSchool(slug);
  res.status(200).json({ data: result });
}

// Public — no auth, called from the signup page's plan-selection step
// before any account exists. Only ever returns active plans: a
// deactivated tier (see platform/plans.ts) is still valid on tenants
// already assigned to it, but must not be offered to a new signup.
export async function plansHandler(_req: Request, res: Response) {
  res.status(200).json({ data: await listPlans({ includeInactive: false }) });
}

export async function loginHandler(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const { tenant, user, tokens } = await authService.login(input, requestMeta(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      themeId: tenant.themeId,
    },
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}

/**
 * Public, unauthenticated lookup — the frontend calls this when a request
 * arrives on a school's subdomain (<slug>.<appDomain>) to show the school's
 * name on the login page before the user has entered anything. Deliberately
 * mirrors the `tenants` table's own "open SELECT" RLS policy (see that
 * migration's comment): a school's name, active/suspended status, and
 * chosen theme color are not sensitive — the same information anyone could
 * already read from the login/signup forms' error messages — so no auth is
 * required here. themeId is included so the login page can render in the
 * school's own accent color before anyone authenticates.
 */
export async function tenantBySlugHandler(req: Request, res: Response) {
  const slug = slugSchema.parse(param(req, 'slug'));
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, status: true, themeId: true },
  });
  if (!tenant) throw AppError.notFound('School not found');
  res.status(200).json({ data: tenant });
}

export async function platformLoginHandler(req: Request, res: Response) {
  const input = platformLoginSchema.parse(req.body);
  const { user, tokens } = await authService.platformLogin(input, requestMeta(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

/**
 * Body-supplied token takes priority over the cookie (not the other way
 * around, as this used to be). Why: the httpOnly refresh cookie is a
 * single, browser-wide value shared by every tab open on this site — if
 * one tab logs in as a teacher and a second, separate tab then logs in as
 * a student, the cookie now holds only the student's token, even though
 * the teacher tab never logged out and still has its own valid session.
 * The frontend keeps a copy of *that specific login's* refresh token in
 * that tab's own sessionStorage (tab-isolated by the browser itself,
 * unlike a cookie) and sends it explicitly in the body on every refresh —
 * so each tab restores *its own* session on reload instead of whichever
 * session happens to currently be sitting in the shared cookie. A tab
 * that never captured its own token (sessionStorage empty — e.g. a
 * genuinely fresh tab continuing an existing single-session login) still
 * falls back to the cookie exactly as before, so a normal one-account
 * browser session is completely unaffected by this.
 */
export async function refreshHandler(req: Request, res: Response) {
  const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  if (!token) throw AppError.unauthorized('No refresh token provided');

  // req.body may legitimately be `{}` (no Content-Type sent) — parse
  // defensively rather than requiring a body at all, since older/other
  // clients calling this endpoint with no body must keep working.
  const { expectedSlug } = refreshSchema.parse(req.body ?? {});

  const { user, tokens } = await authService.refresh(token, requestMeta(req), expectedSlug);
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(200).json({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
}

export async function logoutHandler(req: Request, res: Response) {
  // Same body-first priority as refreshHandler — logging out of one tab
  // must revoke *that tab's own* session, not whichever session the
  // shared cookie happens to currently hold.
  const token = req.body?.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  if (token) await authService.logout(token);
  // Must match the Domain (and Path) the cookie was originally set with —
  // otherwise the browser treats this as clearing a *different* cookie and
  // the real one lingers.
  res.clearCookie(REFRESH_COOKIE, { path: '/', domain: env.COOKIE_DOMAIN });
  res.status(204).send();
}

/**
 * Self-service password change — works for every authenticated role, since
 * the password lives on the shared User model regardless of role. The
 * email/login ID never changes here, only the password. Every existing
 * refresh token (this device and any other) is revoked as part of this, so
 * the client must expect its current session to end and log in again with
 * the new password — matches the "log out everywhere on password change"
 * convention.
 */
export async function changePasswordHandler(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const input = changePasswordSchema.parse(req.body);

  await authService.changePassword(
    { id: req.auth.userId, tenantId: req.auth.tenantId },
    input,
    requestMeta(req),
  );

  // The refresh token this device was holding is now revoked too — clear
  // the cookie so the browser doesn't keep sending a dead token.
  res.clearCookie(REFRESH_COOKIE, { path: '/', domain: env.COOKIE_DOMAIN });
  res.status(204).send();
}

/**
 * Self-service "edit my own email/phone" — any authenticated role. See
 * authService.updateMe for which underlying field each role's "phone"
 * actually maps to.
 */
export async function updateMeHandler(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const input = updateMeSchema.parse(req.body);

  const user = await authService.updateMe(
    { id: req.auth.userId, tenantId: req.auth.tenantId, role: req.auth.role },
    input,
  );

  res.status(200).json({ user });
}

/**
 * Self-service "forgot password" (unauthenticated). Always answers with
 * the same generic 200 whether or not the account exists — see
 * authService.requestPasswordReset's doc comment. Outside production
 * only, the raw reset code is echoed back in the response for local
 * testing convenience — mirrors errorHandler.ts's `debug` field, which
 * does the same for unexpected-error messages; in production the code is
 * only ever emailed.
 */
export async function forgotPasswordHandler(req: Request, res: Response) {
  const input = forgotPasswordSchema.parse(req.body);
  const result = await authService.requestPasswordReset(input);

  res.status(200).json({
    message: 'If an account exists for that email, a password reset code has been sent to it.',
    ...(env.NODE_ENV !== 'production' && result ? { debugToken: result.token } : {}),
  });
}

export async function resetPasswordHandler(req: Request, res: Response) {
  const input = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(input, requestMeta(req));
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response) {
  if (!req.auth) throw AppError.unauthorized();
  const { userId, tenantId } = req.auth;

  const user = await runWithTenant(tenantId, (tx) =>
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
  );

  if (!user) throw AppError.unauthorized();

  // The tenants table has an open SELECT policy (see its migration
  // comment) — safe to read directly without a tenant-scoped transaction.
  const tenant = tenantId
    ? await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, status: true, themeId: true },
      })
    : null;

  res.status(200).json({ user, tenant });
}
