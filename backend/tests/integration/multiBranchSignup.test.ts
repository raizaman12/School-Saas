import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { prisma } from '../../src/lib/prisma';
import { runWithTenant } from '../../src/lib/tenantContext';
import { verifyAccessToken } from '../../src/lib/jwt';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

function branch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    branchName: 'DHA Campus',
    city: 'Karachi',
    adminFullName: 'DHA Admin',
    adminEmail: 'admin@dha.test',
    adminPassword: 'Passw0rd123',
    ...overrides,
  };
}

function twoBranchPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schoolName: 'Alpha Schools',
    slug: 'alpha-schools',
    branches: [
      branch(),
      branch({ branchName: 'Gulberg Campus', city: 'Lahore', adminEmail: 'admin@gulberg.test' }),
    ],
    ...overrides,
  };
}

describe('POST /api/auth/signup-multi-branch', () => {
  it('creates one SchoolGroup + N independent Tenants + N independent SCHOOL_ADMIN users', async () => {
    const res = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());

    expect(res.status).toBe(201);
    expect(res.body.schoolGroup.slug).toBe('alpha-schools');
    expect(res.body.branches).toHaveLength(2);

    // No tokens/login state — there is no single "the" admin for a
    // multi-branch signup to log in as.
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();

    const [dha, gulberg] = res.body.branches;
    expect(dha.tenant.branchName).toBe('DHA Campus');
    expect(dha.tenant.slug).toBe('alpha-schools-dha-campus');
    expect(gulberg.tenant.branchName).toBe('Gulberg Campus');
    expect(gulberg.tenant.slug).toBe('alpha-schools-gulberg-campus');
    expect(dha.user.email).toBe('admin@dha.test');
    expect(gulberg.user.email).toBe('admin@gulberg.test');
    expect(dha.user.passwordHash).toBeUndefined();

    const group = await prisma.schoolGroup.findUnique({ where: { slug: 'alpha-schools' } });
    expect(group?.name).toBe('Alpha Schools');

    const dhaTenant = await prisma.tenant.findUnique({ where: { slug: 'alpha-schools-dha-campus' } });
    expect(dhaTenant?.schoolGroupId).toBe(group?.id);
    expect(dhaTenant?.branchName).toBe('DHA Campus');
    expect(dhaTenant?.city).toBe('Karachi');
    expect(dhaTenant?.name).toBe('Alpha Schools — DHA Campus');

    const gulbergTenant = await prisma.tenant.findUnique({ where: { slug: 'alpha-schools-gulberg-campus' } });
    expect(gulbergTenant?.schoolGroupId).toBe(group?.id);

    // Each branch got its own SCHOOL_ADMIN, StaffProfile, and grading
    // bands — the exact same "what happens on signup" sequence a single
    // school gets (verified via createTenantWithAdmin's shared code path).
    // users/staff_profiles/grading_bands are tenant-scoped tables, so
    // reading them (even by the test's own privileged client) must go
    // through runWithTenant — see tenantContext.ts's own doc comment.
    const dhaAdmin = await runWithTenant(dhaTenant!.id, (tx) =>
      tx.user.findFirst({ where: { role: 'SCHOOL_ADMIN' } }),
    );
    expect(dhaAdmin?.email).toBe('admin@dha.test');
    const dhaStaffProfile = await runWithTenant(dhaTenant!.id, (tx) => tx.staffProfile.findFirst());
    expect(dhaStaffProfile).not.toBeNull();
    const dhaGradingBands = await runWithTenant(dhaTenant!.id, (tx) => tx.gradingBand.findMany());
    expect(dhaGradingBands.length).toBeGreaterThan(0);
  });

  it('each branch admin logs in via the unchanged POST /api/auth/login using only their own branch slug', async () => {
    const signupRes = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    expect(signupRes.status).toBe(201);
    const [dha, gulberg] = signupRes.body.branches;

    const dhaLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: dha.tenant.slug, email: 'admin@dha.test', password: 'Passw0rd123' });
    expect(dhaLogin.status).toBe(200);
    expect(dhaLogin.body.tenant.slug).toBe(dha.tenant.slug);

    const claims = verifyAccessToken(dhaLogin.body.accessToken);
    expect(claims.tenantId).toBe(dha.tenant.id);
    expect(claims.tenantId).not.toBe(gulberg.tenant.id);
    expect(claims.role).toBe('SCHOOL_ADMIN');

    // The group's own shared slug is NOT itself a loginable tenant.
    const groupLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'alpha-schools', email: 'admin@dha.test', password: 'Passw0rd123' });
    expect(groupLogin.status).toBe(401);
  });

  it('a branch admin cannot see or reach another branch\'s data (RLS cross-tenant isolation)', async () => {
    const signupRes = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    const [dha, gulberg] = signupRes.body.branches;

    const dhaLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: dha.tenant.slug, email: 'admin@dha.test', password: 'Passw0rd123' });

    // A DHA-scoped request for Gulberg's tenant id via /api/auth/me must
    // only ever return DHA's own tenant — RLS + JWT tenantId scoping,
    // completely unaware SchoolGroup even exists.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${dhaLogin.body.accessToken}`);
    expect(me.body.tenant.id).toBe(dha.tenant.id);
    expect(me.body.tenant.id).not.toBe(gulberg.tenant.id);
  });

  it('a branch admin cannot see, list, or fetch-by-id another branch\'s real business data (classes, students)', async () => {
    // Two branches of the SAME SchoolGroup are otherwise completely
    // ordinary, independent Tenant rows — this test proves that sharing a
    // SchoolGroup creates NO special data-access path between them: every
    // one of the ~40 tenant-scoped modules (classes, students, ...) stays
    // scoped purely by JWT tenantId + Postgres RLS, exactly as it already
    // is between two totally unrelated single schools (see the existing,
    // much larger sweep in tenantIsolation.test.ts, which this mirrors).
    const signupRes = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    const [dha, gulberg] = signupRes.body.branches;

    const dhaLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: dha.tenant.slug, email: 'admin@dha.test', password: 'Passw0rd123' });
    const gulbergLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: gulberg.tenant.slug, email: 'admin@gulberg.test', password: 'Passw0rd123' });

    const dhaAuth = { Authorization: `Bearer ${dhaLogin.body.accessToken}` };
    const gulbergAuth = { Authorization: `Bearer ${gulbergLogin.body.accessToken}` };

    // DHA creates a class and a student.
    const dhaClass = await request(app).post('/api/classes').set(dhaAuth).send({ name: 'Class 5', order: 5 });
    expect(dhaClass.status).toBe(201);
    const dhaYear = await request(app)
      .post('/api/academic-years')
      .set(dhaAuth)
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const dhaSection = await request(app)
      .post('/api/sections')
      .set(dhaAuth)
      .send({ schoolClassId: dhaClass.body.data.id, academicYearId: dhaYear.body.data.id, name: 'A' });
    const dhaStudent = await request(app)
      .post('/api/students')
      .set(dhaAuth)
      .send({
        fullName: 'DHA Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: dhaSection.body.data.id,
        academicYearId: dhaYear.body.data.id,
      });
    expect(dhaStudent.status).toBe(201);

    // Gulberg's own class list must NOT include DHA's class.
    const gulbergClasses = await request(app).get('/api/classes').set(gulbergAuth);
    expect(gulbergClasses.body.data.some((c: { id: string }) => c.id === dhaClass.body.data.id)).toBe(false);

    // Gulberg's own student list must NOT include DHA's student.
    const gulbergStudents = await request(app).get('/api/students').set(gulbergAuth);
    expect(gulbergStudents.body.data.some((s: { id: string }) => s.id === dhaStudent.body.data.id)).toBe(false);

    // A direct fetch-by-id of DHA's student, using Gulberg's own token,
    // must 404 — not leak the record, not silently redirect to a "wrong
    // tenant" error.
    const crossFetch = await request(app).get(`/api/students/${dhaStudent.body.data.id}`).set(gulbergAuth);
    expect(crossFetch.status).toBe(404);

    // And the reverse direction, symmetric: Gulberg creates its own class,
    // DHA's token cannot see it either.
    const gulbergClass = await request(app).post('/api/classes').set(gulbergAuth).send({ name: 'Class 6', order: 6 });
    expect(gulbergClass.status).toBe(201);
    const dhaClasses = await request(app).get('/api/classes').set(dhaAuth);
    expect(dhaClasses.body.data.some((c: { id: string }) => c.id === gulbergClass.body.data.id)).toBe(false);
  });

  it('rejects a group slug that collides with an existing Tenant.slug', async () => {
    await request(app).post('/api/auth/signup').send({
      schoolName: 'Existing School',
      slug: 'existing-school',
      adminFullName: 'Admin',
      adminEmail: 'admin@existing.test',
      adminPassword: 'Passw0rd123',
    });

    const res = await request(app)
      .post('/api/auth/signup-multi-branch')
      .send(twoBranchPayload({ slug: 'existing-school' }));

    expect(res.status).toBe(409);
  });

  it('rejects a group slug that collides with an existing SchoolGroup.slug', async () => {
    await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());

    const res = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    expect(res.status).toBe(409);
  });

  it('auto-dedupes two branches whose derived slugs would otherwise collide', async () => {
    const res = await request(app)
      .post('/api/auth/signup-multi-branch')
      .send(
        twoBranchPayload({
          branches: [
            branch({ branchName: 'Main Campus', adminEmail: 'admin1@main.test' }),
            branch({ branchName: 'Main Campus', adminEmail: 'admin2@main.test' }),
          ],
        }),
      );

    expect(res.status).toBe(201);
    const slugs = res.body.branches.map((b: { tenant: { slug: string } }) => b.tenant.slug);
    expect(new Set(slugs).size).toBe(2);
    expect(slugs).toContain('alpha-schools-main-campus');
    expect(slugs).toContain('alpha-schools-main-campus-2');
  });

  it('creates zero rows (no SchoolGroup, no branch Tenants) when a request is rejected', async () => {
    // The pre-check path (slug already taken) is the deterministic,
    // reproducible way to exercise "request rejected, nothing written" from
    // outside the service — a genuine mid-transaction P2002 race (two
    // concurrent requests both passing the pre-check for the same slug) is
    // handled by the same isUniqueConstraintError catch block that wraps
    // the whole $transaction (see auth.service.ts's signupMultiBranch), but
    // isn't deterministically reproducible from a single-process test
    // without mocking internals — this test instead proves the guarantee
    // that matters operationally: whatever the failure reason, a rejected
    // multi-branch signup never leaves partial branch rows behind.
    await request(app).post('/api/auth/signup').send({
      schoolName: 'Existing School',
      slug: 'existing-school',
      adminFullName: 'Admin',
      adminEmail: 'admin@existing.test',
      adminPassword: 'Passw0rd123',
    });

    const beforeGroups = await prisma.schoolGroup.count();
    const beforeTenants = await prisma.tenant.count();
    expect(beforeGroups).toBe(0);
    expect(beforeTenants).toBe(1); // just the single "Existing School" tenant above

    const res = await request(app)
      .post('/api/auth/signup-multi-branch')
      .send(twoBranchPayload({ slug: 'existing-school' }));

    expect(res.status).toBe(409);
    // No SchoolGroup and no additional Tenant rows were created by the
    // rejected request — row counts are unchanged from before it ran.
    expect(await prisma.schoolGroup.count()).toBe(beforeGroups);
    expect(await prisma.tenant.count()).toBe(beforeTenants);
  });

  it('rejects fewer than 2 branches with 400 and creates nothing', async () => {
    const res = await request(app)
      .post('/api/auth/signup-multi-branch')
      .send(twoBranchPayload({ branches: [branch()] }));

    expect(res.status).toBe(400);
    expect(await prisma.schoolGroup.count()).toBe(0);
    expect(await prisma.tenant.count()).toBe(0);
  });

  it('rejects more than 20 branches with 400 and creates nothing', async () => {
    const res = await request(app)
      .post('/api/auth/signup-multi-branch')
      .send(
        twoBranchPayload({
          branches: Array.from({ length: 21 }, (_, i) =>
            branch({ branchName: `Campus ${i}`, adminEmail: `admin${i}@campus.test` }),
          ),
        }),
      );

    expect(res.status).toBe(400);
    expect(await prisma.schoolGroup.count()).toBe(0);
    expect(await prisma.tenant.count()).toBe(0);
  });
});

describe('GET /api/auth/resolve-school/:slug', () => {
  it('resolves a single-school slug to kind:"tenant" with no group context', async () => {
    await request(app).post('/api/auth/signup').send({
      schoolName: 'Solo School',
      slug: 'solo-school',
      adminFullName: 'Admin',
      adminEmail: 'admin@solo.test',
      adminPassword: 'Passw0rd123',
    });

    const res = await request(app).get('/api/auth/resolve-school/solo-school');
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('tenant');
    expect(res.body.data.tenant.slug).toBe('solo-school');
    expect(res.body.data.tenant.groupSlug).toBeNull();
    expect(res.body.data.tenant.branchName).toBeNull();
  });

  it('resolves a branch\'s own slug to kind:"tenant" WITH group/branch context', async () => {
    const signupRes = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    const [dha] = signupRes.body.branches;

    const res = await request(app).get(`/api/auth/resolve-school/${dha.tenant.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('tenant');
    expect(res.body.data.tenant.slug).toBe(dha.tenant.slug);
    expect(res.body.data.tenant.branchName).toBe('DHA Campus');
    expect(res.body.data.tenant.groupSlug).toBe('alpha-schools');
    expect(res.body.data.tenant.groupName).toBe('Alpha Schools');
  });

  it('resolves the group\'s own shared slug to kind:"group" with a branch list', async () => {
    await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());

    const res = await request(app).get('/api/auth/resolve-school/alpha-schools');
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('group');
    expect(res.body.data.group.slug).toBe('alpha-schools');
    expect(res.body.data.group.branches).toHaveLength(2);
    const names = res.body.data.group.branches.map((b: { branchName: string }) => b.branchName).sort();
    expect(names).toEqual(['DHA Campus', 'Gulberg Campus']);
    expect(res.body.data.group.branches[0]).toHaveProperty('city');
  });

  it('excludes SUSPENDED/CANCELLED branches from the group branch list', async () => {
    const signupRes = await request(app).post('/api/auth/signup-multi-branch').send(twoBranchPayload());
    const [dha] = signupRes.body.branches;

    await prisma.tenant.update({ where: { id: dha.tenant.id }, data: { status: 'SUSPENDED' } });

    const res = await request(app).get('/api/auth/resolve-school/alpha-schools');
    expect(res.status).toBe(200);
    const names = res.body.data.group.branches.map((b: { branchName: string }) => b.branchName);
    expect(names).not.toContain('DHA Campus');
    expect(names).toContain('Gulberg Campus');
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await request(app).get('/api/auth/resolve-school/does-not-exist');
    expect(res.status).toBe(404);
  });
});
