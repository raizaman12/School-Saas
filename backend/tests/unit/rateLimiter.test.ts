import type { Request } from 'express';
import { userOrIpKey, accountOrIpKey, refreshTokenKey, globalLimit } from '../../src/middleware/rateLimiter';
import { signAccessToken, signRefreshToken } from '../../src/lib/jwt';

/**
 * Real bug this covers: every rate limiter in this app used to key purely
 * on `req.ip` (express-rate-limit's own default). A real school has every
 * teacher/admin/student/parent on campus sharing ONE public IP behind the
 * school's WiFi/NAT, so the whole school shared one request/login budget —
 * ordinary busy-day usage (or a handful of mistyped passwords during the
 * morning login rush) could trip "Too many requests" for everyone, no
 * matter which of them actually caused it. These key generators partition
 * the budget per user/account instead — this file tests that partitioning
 * logic directly and deterministically, since the actual rate-limit
 * windows/timing are fully disabled under NODE_ENV=test (see
 * rateLimiter.ts's `isTest`/`skip`) and so aren't exercisable through the
 * real middleware in this suite the way every other integration test runs.
 */
describe('rate limiter key generators', () => {
  function fakeReq(overrides: Partial<Request> = {}): Request {
    return { headers: {}, cookies: {}, ip: '203.0.113.5', ...overrides } as unknown as Request;
  }

  describe('userOrIpKey', () => {
    it('keys by the verified user id when a valid Bearer access token is present', () => {
      const token = signAccessToken({ sub: 'user-1', tenantId: 't1', role: 'TEACHER' });
      const req = fakeReq({ headers: { authorization: `Bearer ${token}` } });
      expect(userOrIpKey(req)).toBe('user:user-1');
    });

    it('gives two different users on the SAME IP two different keys — the actual fix', () => {
      const tokenA = signAccessToken({ sub: 'teacher-a', tenantId: 't1', role: 'TEACHER' });
      const tokenB = signAccessToken({ sub: 'teacher-b', tenantId: 't1', role: 'TEACHER' });
      const reqA = fakeReq({ headers: { authorization: `Bearer ${tokenA}` } });
      const reqB = fakeReq({ headers: { authorization: `Bearer ${tokenB}` } });
      expect(userOrIpKey(reqA)).not.toBe(userOrIpKey(reqB));
    });

    it('falls back to an IP-based key when there is no Authorization header', () => {
      const req = fakeReq();
      expect(userOrIpKey(req)).not.toMatch(/^user:/);
    });

    it('falls back to an IP-based key when the token is invalid/garbage rather than throwing', () => {
      const req = fakeReq({ headers: { authorization: 'Bearer not-a-real-token' } });
      expect(() => userOrIpKey(req)).not.toThrow();
      expect(userOrIpKey(req)).not.toMatch(/^user:/);
    });
  });

  describe('accountOrIpKey', () => {
    it('keys by tenant slug + email (lowercased/trimmed) for login-shaped bodies', () => {
      const req = fakeReq({ body: { slug: 'Alpha-School', email: '  Teacher@Test.com ' } } as Partial<Request>);
      expect(accountOrIpKey(req)).toBe('account:alpha-school:teacher@test.com');
    });

    it('keys by adminEmail for signup-shaped bodies (no plain "email" field)', () => {
      const req = fakeReq({ body: { slug: 'alpha-school', adminEmail: 'principal@test.com' } } as Partial<Request>);
      expect(accountOrIpKey(req)).toBe('account:alpha-school:principal@test.com');
    });

    it('gives two different accounts on the SAME IP two different keys — the actual fix', () => {
      const reqA = fakeReq({ body: { slug: 'alpha-school', email: 'a@test.com' } } as Partial<Request>);
      const reqB = fakeReq({ body: { slug: 'alpha-school', email: 'b@test.com' } } as Partial<Request>);
      expect(accountOrIpKey(reqA)).not.toBe(accountOrIpKey(reqB));
    });

    it('still separates the SAME email across two different schools (tenant-scoped)', () => {
      const reqA = fakeReq({ body: { slug: 'alpha-school', email: 'teacher@test.com' } } as Partial<Request>);
      const reqB = fakeReq({ body: { slug: 'beta-school', email: 'teacher@test.com' } } as Partial<Request>);
      expect(accountOrIpKey(reqA)).not.toBe(accountOrIpKey(reqB));
    });

    it('falls back to the caller\'s verified user id for change-password (no email/slug in its body)', () => {
      const token = signAccessToken({ sub: 'user-1', tenantId: 't1', role: 'TEACHER' });
      const req = fakeReq({
        headers: { authorization: `Bearer ${token}` },
        body: { currentPassword: 'x', newPassword: 'y' },
      } as Partial<Request>);
      expect(accountOrIpKey(req)).toBe('user:user-1');
    });

    it('falls back to an IP-based key with no email/slug and no auth at all', () => {
      const req = fakeReq({ body: {} } as Partial<Request>);
      expect(accountOrIpKey(req)).not.toMatch(/^account:|^user:/);
    });
  });

  // Real bug this covers, the follow-up report: even after keying was
  // fixed, a whole school's not-yet-logged-in traffic (login page loads,
  // tenant-by-slug lookups, ...) still shares ONE IP-fallback bucket —
  // this proves it's sized generously (much bigger than the per-user
  // bucket), so a school-wide login rush from one campus IP doesn't
  // exhaust it, while it still stays a genuine finite backstop.
  describe('globalLimit', () => {
    it('gives an authenticated caller the larger per-user ceiling', () => {
      const token = signAccessToken({ sub: 'user-1', tenantId: 't1', role: 'TEACHER' });
      const req = fakeReq({ headers: { authorization: `Bearer ${token}` } });
      expect(globalLimit(req)).toBeGreaterThanOrEqual(1000);
    });

    it('gives an unauthenticated caller a ceiling generous enough for a whole school sharing one IP, and it is larger than the per-user one', () => {
      const req = fakeReq();
      const authedToken = signAccessToken({ sub: 'user-1', tenantId: 't1', role: 'TEACHER' });
      const authedReq = fakeReq({ headers: { authorization: `Bearer ${authedToken}` } });

      // 5 admins + 50 teachers + 800 students all loading the portal at
      // once, well within one 15-minute window — an unrealistic worst
      // case (real usage spreads across the day), used here as the floor
      // this ceiling must clear.
      expect(globalLimit(req)).toBeGreaterThanOrEqual(855);
      expect(globalLimit(req)).toBeGreaterThan(globalLimit(authedReq));
    });

    it('treats an invalid/expired token the same as unauthenticated rather than throwing', () => {
      const req = fakeReq({ headers: { authorization: 'Bearer not-a-real-token' } });
      expect(() => globalLimit(req)).not.toThrow();
      expect(globalLimit(req)).toBe(globalLimit(fakeReq()));
    });
  });

  describe('refreshTokenKey', () => {
    it('keys by the verified user id from a body-supplied refresh token', () => {
      const { token } = signRefreshToken({ sub: 'user-1', tenantId: 't1' });
      const req = fakeReq({ body: { refreshToken: token } } as Partial<Request>);
      expect(refreshTokenKey(req)).toBe('user:user-1');
    });

    it('keys by the verified user id from the refreshToken cookie when the body has none', () => {
      const { token } = signRefreshToken({ sub: 'user-2', tenantId: 't1' });
      const req = fakeReq({ cookies: { refreshToken: token } } as Partial<Request>);
      expect(refreshTokenKey(req)).toBe('user:user-2');
    });

    it('prefers a body-supplied token over the cookie, matching refreshHandler\'s own priority', () => {
      const { token: bodyToken } = signRefreshToken({ sub: 'body-user', tenantId: 't1' });
      const { token: cookieToken } = signRefreshToken({ sub: 'cookie-user', tenantId: 't1' });
      const req = fakeReq({
        body: { refreshToken: bodyToken },
        cookies: { refreshToken: cookieToken },
      } as Partial<Request>);
      expect(refreshTokenKey(req)).toBe('user:body-user');
    });

    it('falls back to an IP-based key when there is no refresh token anywhere', () => {
      const req = fakeReq({ body: {} } as Partial<Request>);
      expect(refreshTokenKey(req)).not.toMatch(/^user:/);
    });
  });
});
