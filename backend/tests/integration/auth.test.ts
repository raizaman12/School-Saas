import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { prisma } from '../../src/lib/prisma';
import { runWithTenant } from '../../src/lib/tenantContext';

const app = createApp();

const alphaSignup = {
  schoolName: 'Alpha School',
  slug: 'alpha-school',
  adminFullName: 'Ali Admin',
  adminEmail: 'admin@alpha.test',
  adminPassword: 'Passw0rd123',
};

const betaSignup = {
  schoolName: 'Beta School',
  slug: 'beta-school',
  adminFullName: 'Beta Admin',
  adminEmail: 'admin@beta.test',
  adminPassword: 'Passw0rd123',
};

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('creates a new tenant + SCHOOL_ADMIN user and returns tokens', async () => {
    const res = await request(app).post('/api/auth/signup').send(alphaSignup);

    expect(res.status).toBe(201);
    expect(res.body.tenant.slug).toBe('alpha-school');
    expect(res.body.user.role).toBe('SCHOOL_ADMIN');
    expect(res.body.user.email).toBe('admin@alpha.test');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']?.[0]).toMatch(/refreshToken=/);
    // No Domain attribute when COOKIE_DOMAIN is unset (the default for
    // this test file/env) — a host-only cookie. The Domain-attribute
    // behavior itself is covered by tests/integration/cookieDomain.test.ts
    // with its own isolated env override.
    expect(res.headers['set-cookie']?.[0]).not.toMatch(/Domain=/i);
    expect(res.body.tenant.plan).toBe('TRIAL'); // default when no plan is chosen
    expect(res.body.tenant.themeId).toBe('navy-blue'); // default when no theme is chosen

    // A tenant-branding code is derived from the school name at signup
    // (see utils/tenantCode.ts) — used to prefix auto-generated student
    // and staff IDs so two schools don't mint identical-looking codes.
    const tenant = await prisma.tenant.findUnique({ where: { slug: 'alpha-school' } });
    expect(tenant?.code).toBe('AS');
  });

  it('persists a self-selected plan chosen at signup', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, plan: 'STANDARD' });

    expect(res.status).toBe(201);
    expect(res.body.tenant.plan).toBe('STANDARD');
  });

  it('rejects an invalid plan value with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, plan: 'NOT_A_PLAN' });

    expect(res.status).toBe(400);
  });

  it('persists a self-selected theme chosen at signup', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, themeId: 'bottle-green' });

    expect(res.status).toBe(201);
    expect(res.body.tenant.themeId).toBe('bottle-green');
  });

  it('rejects an invalid themeId value with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, themeId: 'not-a-real-theme' });

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate slug with 409', async () => {
    await request(app).post('/api/auth/signup').send(alphaSignup);
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, adminEmail: 'someoneelse@alpha.test' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...alphaSignup, adminPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send(alphaSignup);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@alpha.test', password: 'Passw0rd123' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@alpha.test');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@alpha.test', password: 'WrongPass1' });

    expect(res.status).toBe(401);
  });

  it('rejects a non-existent tenant slug with 401 (not 404 — avoid tenant enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'does-not-exist', email: 'admin@alpha.test', password: 'Passw0rd123' });

    expect(res.status).toBe(401);
  });
});

// A student/non-admin staff member may have no email at all — see
// lib/loginId.ts and User.loginId's doc comment in schema.prisma. The
// "email" field on POST /api/auth/login now doubles as an ID login,
// distinguished purely by whether it contains "@".
describe('Log in by ID (no email required for staff/students)', () => {
  it('a TEACHER created without email logs in with their employeeCode, dash/case/whitespace-insensitively', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const staffRes = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ayesha Teacher',
        role: 'TEACHER',
        designation: 'Class Teacher',
        joiningDate: '2024-01-01',
        monthlySalary: 50000,
      });
    expect(staffRes.status).toBe(201);
    expect(staffRes.body.data.user.email).toBeNull();
    const employeeCode: string = staffRes.body.data.employeeCode;
    expect(staffRes.body.data.user.loginId).toBe(employeeCode.toLowerCase().replace(/-/g, ''));

    const exact = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: employeeCode, password: staffRes.body.tempPassword });
    expect(exact.status).toBe(200);
    expect(exact.body.user.role).toBe('TEACHER');

    // Lowercase, dashes stripped, and surrounding whitespace all still match.
    const scrambled = await request(app).post('/api/auth/login').send({
      slug: tenant.slug,
      email: `  ${employeeCode.toLowerCase().replace(/-/g, '')}  `,
      password: staffRes.body.tempPassword,
    });
    expect(scrambled.status).toBe(200);
  });

  it('a STUDENT admitted without email logs in with their studentCode', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Email Student', gender: 'MALE', dateOfBirth: '2015-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.portalLogin.email).toBeNull();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: res.body.portalLogin.loginId, password: res.body.portalLogin.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('STUDENT');
  });

  it('SCHOOL_ADMIN still requires a real email at staff creation — the ID-login relief does not apply to that role', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Second Admin',
        role: 'SCHOOL_ADMIN',
        designation: 'Admin',
        joiningDate: '2024-01-01',
        monthlySalary: 80000,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.email).toBeTruthy();
  });

  it('an ID login only matches within its own tenant, not a same-code account at a different school', async () => {
    const { accessToken: adminA } = await signupSchool(app, { slug: 'id-login-a', adminEmail: 'a@id-login.test' });
    const { tenant: tenantB } = await signupSchool(app, { slug: 'id-login-b', adminEmail: 'b@id-login.test' });
    const staffRes = await request(app)
      .post('/api/staff')
      .set(authHeader(adminA))
      .send({
        fullName: 'Tenant A Teacher',
        role: 'TEACHER',
        designation: 'Teacher',
        joiningDate: '2024-01-01',
        monthlySalary: 40000,
      });

    const crossTenant = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenantB.slug, email: staffRes.body.data.employeeCode, password: staffRes.body.tempPassword });
    expect(crossTenant.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user with a valid access token', async () => {
    const signupRes = await request(app).post('/api/auth/signup').send(alphaSignup);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@alpha.test');
  });

  it('returns 401 for a malformed/invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh + /api/auth/logout', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').send(alphaSignup);

    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toEqual(expect.any(String));
  });

  it('rejects reuse of a refresh token after logout', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/signup').send(alphaSignup);
    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(204);

    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(401);
  });

  it('replaying a just-rotated token within the grace window is treated as a benign reload race, not theft', async () => {
    // Reproduces a real, observed failure mode: each full page reload is a
    // fresh JS context that silently re-refreshes on mount (see
    // AuthProvider.tsx). If an earlier reload's refresh request reached the
    // server and rotated the token, but that page got torn down before its
    // response could be persisted client-side, the next reload is left
    // holding a token that's already been superseded — through no fault of
    // its own. See refresh()'s doc comment in auth.service.ts.
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);
    const oldCookie = signupRes.headers['set-cookie'];

    // Rotate once via the agent (moves the cookie jar forward)
    const rotated = await agent.post('/api/auth/refresh');
    expect(rotated.status).toBe(200);

    // A near-simultaneous second reload presents the now-superseded
    // pre-rotation token — this must succeed (fast-forwarded to the
    // current valid token), not be treated as theft.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(200);
    expect(replay.body.accessToken).toEqual(expect.any(String));

    // Nothing should have been revoked over this — the legitimate token
    // the real user is holding must keep working too.
    const legitimateRetry = await agent.post('/api/auth/refresh');
    expect(legitimateRetry.status).toBe(200);
  });

  it('reusing a rotated token OUTSIDE the grace window still triggers theft detection — kills the whole session', async () => {
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);
    const oldCookie = signupRes.headers['set-cookie'];
    const tenantId = signupRes.body.tenant.id;

    // Rotate once (this is the "legitimate" new token, now sitting in agent's jar)
    const rotated = await agent.post('/api/auth/refresh');
    expect(rotated.status).toBe(200);

    // Backdate the rotation well outside the reload-race grace window (see
    // refresh()'s REUSE_GRACE_MS) — this is what a REAL stolen-and-replayed
    // token minutes/hours later looks like, as opposed to the benign
    // near-instant race covered by the test above.
    await runWithTenant(tenantId, (tx) =>
      tx.refreshToken.updateMany({
        where: { tenantId, revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 20_000) },
      }),
    );

    // Attacker replays the stale, already-rotated token -> reuse detected
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);

    // The legitimate rotated token the real user is holding must ALSO be
    // dead now, since reuse-detection revokes the whole session family.
    const legitimateRetry = await agent.post('/api/auth/refresh');
    expect(legitimateRetry.status).toBe(401);
  });
});

describe('Tab-scoped refresh tokens — one browser, two tabs, two different accounts', () => {
  // Reproduces the exact scenario reported in production use: a school
  // admin opens the admin panel in one tab, then a teacher (or student)
  // account in a second, separate tab of the SAME browser. Both tabs share
  // one httpOnly refreshToken cookie (supertest's request.agent() mirrors
  // this — one shared cookie jar across every call made through it), so
  // the second login overwrites the cookie the first tab was relying on.
  // The fix: each tab sends its OWN captured refresh token explicitly in
  // the request body, which the backend now prefers over whatever the
  // shared cookie currently holds (see auth.controller.ts's refreshHandler
  // doc comment).
  async function createTeacherLogin(agent: ReturnType<typeof request.agent>, adminAccessToken: string) {
    const staffRes = await agent
      .post('/api/staff')
      .set(authHeader(adminAccessToken))
      .send({
        email: 'teacher@alpha-school.test',
        fullName: 'Teacher One',
        role: 'TEACHER',
        designation: 'Teacher',
        employmentType: 'FULL_TIME',
        joiningDate: '2026-01-15',
        monthlySalary: 50000,
      });
    expect(staffRes.status).toBe(201);
    const tempPassword = staffRes.body.tempPassword as string;

    // A "second tab" in the SAME browser (same agent -> same cookie jar)
    // logs in as the teacher — this overwrites the shared refreshToken
    // cookie, exactly like a real second tab logging into a different
    // account would.
    const teacherLoginRes = await agent
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'teacher@alpha-school.test', password: tempPassword });
    expect(teacherLoginRes.status).toBe(200);
    return teacherLoginRes.body.refreshToken as string;
  }

  it("refreshing with the first tab's own body-supplied token still resolves as that tab's account, even after a second tab overwrote the shared cookie", async () => {
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);
    const adminRefreshToken = signupRes.body.refreshToken as string;
    expect(adminRefreshToken).toEqual(expect.any(String));

    await createTeacherLogin(agent, signupRes.body.accessToken as string);
    // At this point the agent's shared cookie jar holds the TEACHER's
    // refreshToken cookie, not the admin's — the admin never logged out.

    // The first tab (admin) refreshes, sending its own captured token
    // explicitly. Body priority must win over whatever the shared cookie
    // (teacher's, right now) says.
    const adminTabRefresh = await agent.post('/api/auth/refresh').send({ refreshToken: adminRefreshToken });
    expect(adminTabRefresh.status).toBe(200);
    expect(adminTabRefresh.body.user.role).toBe('SCHOOL_ADMIN');
    expect(adminTabRefresh.body.user.email).toBe('admin@alpha.test');
  });

  it("a second tab with no body token of its own still correctly resolves via the shared cookie to whichever account most recently logged in", async () => {
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);
    const teacherRefreshToken = await createTeacherLogin(agent, signupRes.body.accessToken as string);
    expect(teacherRefreshToken).toEqual(expect.any(String));

    // A brand-new tab that never captured its own token falls back to the
    // shared cookie exactly as before this fix — normal single-session
    // continuation is completely unaffected.
    const freshTabRefresh = await agent.post('/api/auth/refresh').send({});
    expect(freshTabRefresh.status).toBe(200);
    expect(freshTabRefresh.body.user.role).toBe('TEACHER');
  });

  it("logging out of one tab (its own body-supplied token) does not revoke a different tab's session", async () => {
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);
    const adminRefreshToken = signupRes.body.refreshToken as string;
    const teacherRefreshToken = await createTeacherLogin(agent, signupRes.body.accessToken as string);

    // Admin's tab logs out, explicitly targeting its own token — not
    // whatever the shared cookie (teacher's, right now) currently holds.
    const logoutRes = await agent.post('/api/auth/logout').send({ refreshToken: adminRefreshToken });
    expect(logoutRes.status).toBe(204);

    // Admin's own token is now dead.
    const deadAdminRefresh = await request(app).post('/api/auth/refresh').send({ refreshToken: adminRefreshToken });
    expect(deadAdminRefresh.status).toBe(401);

    // The teacher's completely separate session is unaffected.
    const teacherStillWorks = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: teacherRefreshToken });
    expect(teacherStillWorks.status).toBe(200);
    expect(teacherStillWorks.body.user.role).toBe('TEACHER');
  });
});

describe('multi-tenant data isolation', () => {
  it('does not let one tenant admin authenticate against another tenant slug', async () => {
    await request(app).post('/api/auth/signup').send(alphaSignup);
    await request(app).post('/api/auth/signup').send(betaSignup);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@beta.test', password: 'Passw0rd123' });

    expect(res.status).toBe(401);
  });

  it('scopes /me to the caller\'s own tenant only', async () => {
    const alphaRes = await request(app).post('/api/auth/signup').send(alphaSignup);
    const betaRes = await request(app).post('/api/auth/signup').send(betaSignup);

    const alphaMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${alphaRes.body.accessToken}`);
    const betaMe = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${betaRes.body.accessToken}`);

    expect(alphaMe.body.user.tenantId).toBe(alphaRes.body.tenant.id);
    expect(betaMe.body.user.tenantId).toBe(betaRes.body.tenant.id);
    expect(alphaMe.body.user.tenantId).not.toBe(betaMe.body.user.tenantId);
  });

  it('enforces isolation at the database layer even bypassing app-level WHERE clauses (raw RLS check)', async () => {
    await request(app).post('/api/auth/signup').send(alphaSignup);
    await request(app).post('/api/auth/signup').send(betaSignup);

    const alphaTenant = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenants WHERE slug = 'alpha-school'
    `;

    // The pooled app-role connection with NO tenant context set: RLS must
    // hide all tenant-scoped rows (fail closed), not just Alpha's.
    const noContext = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::int as count FROM users`;
    expect(Number(noContext[0].count)).toBe(0);

    // With Alpha's context set, only Alpha's user must be visible.
    const alphaUsers = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${alphaTenant[0].id}, true)`;
      return tx.$queryRaw<{ email: string }[]>`SELECT email FROM users`;
    });

    expect(alphaUsers).toHaveLength(1);
    expect(alphaUsers[0].email).toBe('admin@alpha.test');
  });
});

describe('GET /api/auth/tenant-by-slug/:slug', () => {
  it('returns the school name for an existing, active slug — no auth required', async () => {
    await request(app).post('/api/auth/signup').send(alphaSignup);

    const res = await request(app).get('/api/auth/tenant-by-slug/alpha-school');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Alpha School',
      slug: 'alpha-school',
      status: 'TRIAL',
      themeId: 'navy-blue', // default when no theme is chosen at signup
    });
    // Nothing beyond the safe public fields.
    expect(Object.keys(res.body.data).sort()).toEqual(['id', 'name', 'slug', 'status', 'themeId']);
  });

  it('404s for an unknown slug', async () => {
    const res = await request(app).get('/api/auth/tenant-by-slug/no-such-school');
    expect(res.status).toBe(404);
  });

  it('400s for a malformed slug rather than querying the database with it', async () => {
    const res = await request(app).get('/api/auth/tenant-by-slug/Not_A_Valid_Slug!');
    expect(res.status).toBe(400);
  });

  it('does not require an Authorization header', async () => {
    await request(app).post('/api/auth/signup').send(betaSignup);
    const res = await request(app).get('/api/auth/tenant-by-slug/beta-school');
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Beta School');
  });
});

describe('POST /api/auth/change-password', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Passw0rd123', newPassword: 'NewPassw0rd456' });
    expect(res.status).toBe(401);
  });

  it('changes the password, keeping the same email/ID, and the new password logs in', async () => {
    const signupRes = await request(app).post('/api/auth/signup').send(alphaSignup);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ currentPassword: 'Passw0rd123', newPassword: 'NewPassw0rd456' });
    expect(change.status).toBe(204);

    // Old password no longer works.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@alpha.test', password: 'Passw0rd123' });
    expect(oldLogin.status).toBe(401);

    // New password works, and the login ID (email) is unchanged.
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@alpha.test', password: 'NewPassw0rd456' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.email).toBe('admin@alpha.test');
  });

  it('rejects with 400 when currentPassword is wrong, and the old password still works', async () => {
    const signupRes = await request(app).post('/api/auth/signup').send(alphaSignup);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ currentPassword: 'WrongPass1', newPassword: 'NewPassw0rd456' });
    expect(change.status).toBe(400);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-school', email: 'admin@alpha.test', password: 'Passw0rd123' });
    expect(login.status).toBe(200);
  });

  it('rejects a weak new password with 400', async () => {
    const signupRes = await request(app).post('/api/auth/signup').send(alphaSignup);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ currentPassword: 'Passw0rd123', newPassword: 'weak' });
    expect(change.status).toBe(400);
  });

  it('rejects a new password identical to the current one with 400', async () => {
    const signupRes = await request(app).post('/api/auth/signup').send(alphaSignup);

    const change = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ currentPassword: 'Passw0rd123', newPassword: 'Passw0rd123' });
    expect(change.status).toBe(400);
  });

  it('revokes existing refresh tokens (log out everywhere) on password change', async () => {
    const agent = request.agent(app);
    const signupRes = await agent.post('/api/auth/signup').send(alphaSignup);

    await agent
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ currentPassword: 'Passw0rd123', newPassword: 'NewPassw0rd456' });

    // The old refresh-token cookie (still held by the agent from signup) is
    // now revoked, even though change-password used the access token, not
    // the cookie, to authenticate.
    const refreshRes = await agent.post('/api/auth/refresh');
    expect(refreshRes.status).toBe(401);
  });
});

describe('PATCH /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).patch('/api/auth/me').send({ phone: '03001234567' });
    expect(res.status).toBe(401);
  });

  it('SCHOOL_ADMIN can edit their own email and phone', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(accessToken))
      .send({ email: 'admin.new@test-school.test', phone: '03001112222' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin.new@test-school.test');
    expect(res.body.user.phone).toBe('03001112222');

    const me = await request(app).get('/api/auth/me').set(authHeader(accessToken));
    expect(me.body.user.email).toBe('admin.new@test-school.test');
    expect(me.body.user.phone).toBe('03001112222');
  });

  it("a STUDENT can edit their own login email and phone — phone lands on Student.contactPhone, visible to admin", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'ahmed.khan@test-school.test',
      });
    const tempPassword = student.body.portalLogin.tempPassword;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'ahmed.khan@test-school.test', password: tempPassword });
    expect(login.status).toBe(200);
    const studentToken = login.body.accessToken;

    const update = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(studentToken))
      .send({ email: 'ahmed.new@test-school.test', phone: '03009998888' });
    expect(update.status).toBe(200);
    expect(update.body.user.email).toBe('ahmed.new@test-school.test');

    // The old login email no longer works; the new one does.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'ahmed.khan@test-school.test', password: tempPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'ahmed.new@test-school.test', password: tempPassword });
    expect(newLogin.status).toBe(200);

    // The admin sees the updated contact phone on the student record.
    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    expect(detail.body.data.contactPhone).toBe('03009998888');
    expect(detail.body.data.user.email).toBe('ahmed.new@test-school.test');
  });

  it("a PARENT can edit their own login email and phone — both land on Guardian.email/phone too, visible to admin", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Tariq Khan',
        relationship: 'FATHER',
        phone: '03001234567',
        email: 'tariq.khan@example.com',
      });
    const tempPassword = guardian.body.portalLogin.tempPassword;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'tariq.khan@example.com', password: tempPassword });
    const parentToken = login.body.accessToken;

    const update = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(parentToken))
      .send({ email: 'tariq.new@example.com', phone: '03005556666' });
    expect(update.status).toBe(200);

    const guardiansList = await request(app).get('/api/guardians').set(authHeader(accessToken));
    const updated = guardiansList.body.data.find((g: { id: string }) => g.id === guardian.body.data.id);
    expect(updated.phone).toBe('03005556666');
    expect(updated.email).toBe('tariq.new@example.com');
  });

  it('a TEACHER can edit their own email/phone (lands directly on User)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const staff = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        email: 'teacher.self@test-school.test',
        fullName: 'Bilal Ahmed',
        role: 'TEACHER',
        designation: 'Teacher',
        employmentType: 'FULL_TIME',
        joiningDate: '2026-01-15',
        monthlySalary: 60000,
      });
    const tempPassword = staff.body.tempPassword;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.self@test-school.test', password: tempPassword });
    const teacherToken = login.body.accessToken;

    const update = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(teacherToken))
      .send({ phone: '03007778888' });
    expect(update.status).toBe(200);
    expect(update.body.user.phone).toBe('03007778888');

    const detail = await request(app).get(`/api/staff/${staff.body.data.id}`).set(authHeader(accessToken));
    expect(detail.body.data.user.phone).toBe('03007778888');
  });

  it('rejects an email already used by someone else in the same tenant (409)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        email: 'existing@test-school.test',
        fullName: 'Existing Person',
        role: 'TEACHER',
        designation: 'Teacher',
        employmentType: 'FULL_TIME',
        joiningDate: '2026-01-15',
        monthlySalary: 60000,
      });

    const res = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(accessToken))
      .send({ email: 'existing@test-school.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.details.field).toBe('email');
    void tenant;
  });

  it('rejects an empty body with 400 (must provide at least one field)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).patch('/api/auth/me').set(authHeader(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it("a STUDENT can self-edit their own address and emergency contact (My Profile → About tab), visible to admin via GET /api/students/:id", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Sara Malik',
        gender: 'FEMALE',
        dateOfBirth: '2013-03-10',
        email: 'sara.malik@test-school.test',
      });
    const tempPassword = student.body.portalLogin.tempPassword;

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'sara.malik@test-school.test', password: tempPassword });
    const studentToken = login.body.accessToken;

    const update = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(studentToken))
      .send({ address: 'DHA Phase 5, Karachi', emergencyContact: 'Uncle Tariq - 03001234567' });
    expect(update.status).toBe(200);

    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    expect(detail.body.data.address).toBe('DHA Phase 5, Karachi');
    expect(detail.body.data.emergencyContact).toBe('Uncle Tariq - 03001234567');
  });

  it("silently ignores address/emergencyContact for a role with nowhere to put them (e.g. SCHOOL_ADMIN) instead of erroring", async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .patch('/api/auth/me')
      .set(authHeader(accessToken))
      .send({ address: 'Some address', emergencyContact: 'Someone - 03001234567' });
    // Still 200 (the request is well-formed and phone/email are untouched,
    // consistent) — there's simply nothing on User/SCHOOL_ADMIN's shape to
    // write these to, so nothing happens beyond returning the user as-is.
    expect(res.status).toBe(200);
  });
});
