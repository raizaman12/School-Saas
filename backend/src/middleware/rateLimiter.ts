import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import { verifyAccessToken, verifyRefreshToken } from '../lib/jwt';
import { REFRESH_COOKIE } from '../modules/auth/auth.controller';

// Rate limiting is disabled under automated tests (each test file hammers
// the same endpoints far faster than any real client) but stays fully
// active in development and production.
const isTest = env.NODE_ENV === 'test';

/**
 * Partitions a rate-limit budget per signed-in USER instead of per network
 * IP, whenever a valid access token is present on the request.
 *
 * Real bug this exists to fix: express-rate-limit's own default key is
 * `req.ip`, and a real school deployment has EVERY teacher, admin,
 * student, and parent on campus sharing one public IP behind the school's
 * WiFi/NAT. With a plain per-IP key, the whole school was drawing down one
 * single shared request budget together — busy but completely normal
 * usage (a few dozen people each clicking around their dashboards, as
 * happens many times over any school day) could trip "Too many requests"
 * for EVERYONE on campus, regardless of which of them actually made the
 * requests. Keying by the verified user id instead means each person's own
 * usage counts against their own budget only — sharing a network with
 * hundreds of other users no longer matters, and a single account would
 * need to make hundreds of requests within the window to trip anything.
 *
 * Falls back to IP (via ipKeyGenerator, which normalizes IPv6 addresses
 * safely — see its own doc comment) when there's no valid access token
 * yet, e.g. before login.
 */
// Exported (only) so tests/unit/rateLimiter.test.ts can exercise this
// keying logic directly and deterministically — the limiters themselves
// are fully disabled under NODE_ENV=test (see `isTest`/`skip` above), so
// there's no window/timing behavior to test through the real middleware;
// what actually needed covering was this bug fix's real logic: which key
// a given request resolves to.
export function userOrIpKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const claims = verifyAccessToken(header.slice('Bearer '.length));
      return `user:${claims.sub}`;
    } catch {
      // Expired/invalid token — fall through to the IP-based key below,
      // same as a genuinely unauthenticated request.
    }
  }
  return ipKeyGenerator(req.ip ?? 'unknown');
}

/**
 * Partitions login/signup/password-flow attempts per ACCOUNT (tenant slug
 * + email, read straight from the request body — every one of these
 * routes except change-password has both) rather than per IP alone.
 *
 * Same underlying bug as userOrIpKey above, applied to the pre-login
 * surfaces: a school's shared WiFi/NAT means every teacher, admin,
 * student, and parent logging in from campus shares one IP, so a pure
 * per-IP budget for these "credential-guessing surfaces" meant a handful
 * of people mistyping a password during the morning login rush could
 * exhaust the WHOLE SCHOOL's shared budget and lock everyone else out of
 * logging in — exactly the "too many requests" behaviour reported, and
 * completely unrelated to any actual attack. Scoping by account instead
 * keeps the limiter's real purpose fully intact — repeatedly guessing ONE
 * account's password is still bounded — while different people logging
 * into their own different accounts from the same network no longer
 * compete for the same shared budget at all.
 */
export function accountOrIpKey(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const email =
    typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : typeof body?.adminEmail === 'string'
        ? body.adminEmail.trim().toLowerCase()
        : '';
  if (email) return `account:${slug}:${email}`;
  // change-password is the one route on this limiter with no email/slug
  // in its body (it's already authenticated) — key by the caller's own
  // verified user id instead, so it stays per-account rather than per-IP.
  return userOrIpKey(req);
}

/**
 * Same per-user partitioning idea as userOrIpKey, but for POST
 * /api/auth/refresh specifically — that route is called holding a REFRESH
 * token (body field or the httpOnly cookie), not an access token, so it
 * needs its own key derived from verifyRefreshToken instead.
 */
export function refreshTokenKey(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const bodyToken = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
  const token = bodyToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
  if (token) {
    try {
      const claims = verifyRefreshToken(token);
      return `user:${claims.sub}`;
    } catch {
      // Expired/invalid/missing token — fall through to the IP-based key.
    }
  }
  return ipKeyGenerator(req.ip ?? 'unknown');
}

// Per verified user, per 15-minute window. Generous on purpose: this is a
// backstop against a runaway client/bug, not a security control (that's
// authRateLimiter, further below, which stays tight and per-ACCOUNT) — so
// there's no security cost to sizing it for even a heavy real user. Covers
// comfortably more than a human could generate by hand: dozens of
// dashboard opens with several API calls each, all inside one window.
const AUTHENTICATED_GLOBAL_LIMIT = 3000;

// Shared by every request that ISN'T authenticated yet (no valid access
// token) — login-page loads, GET tenant-by-slug, the login/signup POST
// itself, etc. — keyed by IP via userOrIpKey's fallback since there's no
// user identity yet to key by. Sized for a whole school at once, not one
// person: with ~5 admins + ~50 teachers + ~800 students all sharing one
// campus WiFi/NAT IP, even every single one of them loading the portal
// within the same 15 minutes (an unrealistic worst case — real usage is
// spread across the day) stays comfortably under this. Still a genuine,
// finite bound — a truly runaway/malicious client firing far faster than
// any human still trips it — and doesn't weaken login security at all,
// since actual credential-guessing protection lives in authRateLimiter's
// per-account budget below, which this number has no effect on.
const UNAUTHENTICATED_GLOBAL_LIMIT = 6000;

// Exported only for tests/unit/rateLimiter.test.ts — same reasoning as
// the exported key generators above.
export function globalLimit(req: Request): number {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      verifyAccessToken(header.slice('Bearer '.length));
      return AUTHENTICATED_GLOBAL_LIMIT;
    } catch {
      // Expired/invalid token — treat the same as unauthenticated below.
    }
  }
  return UNAUTHENTICATED_GLOBAL_LIMIT;
}

// Generous global limiter — mainly a backstop against runaway clients/bugs,
// not the credential-guessing control (see authRateLimiter for that). Two
// different numeric ceilings depending on whether the caller is signed in
// yet (see globalLimit above) on top of the per-user/per-IP-fallback
// partitioning from userOrIpKey — together these are what let an entire
// school (any number of admins/teachers/students/parents, however many
// times a day each of them opens the portal) use the system normally
// without ever sharing a budget with anyone else's usage.
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: globalLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: userOrIpKey,
});

// Limiter for credential-guessing surfaces (login/signup/platform-login/
// change-password/forgot-password/reset-password) — slows down
// credential-stuffing and brute-force attempts. Keyed per-account (see
// accountOrIpKey above), not per-IP — a school's shared WiFi/NAT means the
// whole school would otherwise share one budget; 100 per 15 minutes per
// ACCOUNT comfortably covers normal login traffic (including the odd
// mistyped-password retry) for every individual teacher/admin/student/
// parent, however many of them are on campus at once, while still
// meaningfully bounding brute-force attempts against any single account.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: accountOrIpKey,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later.' } },
});

// Separate, much more generous limiter for POST /api/auth/refresh only.
// Unlike login/signup, this is NOT a credential-guessing surface — it
// requires already holding a valid, cryptographically-signed refresh token
// (cookie or tab-scoped storage), so brute-forcing it isn't a realistic
// attack the way password-guessing is. It's also called far more often
// than login: once per page load/tab for every signed-in user (see
// AuthProvider.tsx's silent-refresh-on-mount effect) plus once per access
// token expiry after that. Keyed per-user (see refreshTokenKey above) for
// the same reason as everything else in this file — a school with ~100
// concurrent students/teachers/admins across many tabs sharing one campus
// IP must not share one pooled budget for silent refreshes, or GET
// /api/auth/refresh starts 429ing and — because AuthProvider treats a
// failed refresh as "not logged in" — everyone gets bounced back to the
// login page even though their session was still perfectly valid.
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: refreshTokenKey,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later.' } },
});
