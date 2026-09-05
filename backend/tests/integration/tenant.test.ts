import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { THEME_IDS } from '../../src/config/themePresets';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('GET /api/tenant/theme-presets', () => {
  it('returns the full theme catalog with no auth required', async () => {
    const res = await request(app).get('/api/tenant/theme-presets');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(THEME_IDS.length);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), label: expect.any(String), primaryHex: expect.stringMatching(/^#[0-9a-f]{6}$/i) }),
    );
    // Every id present matches a known theme id (no drift between the
    // catalog array and the id list validated at signup/theme-change time).
    const ids = res.body.data.map((t: { id: string }) => t.id);
    expect(new Set(ids)).toEqual(new Set(THEME_IDS));
  });
});

describe('PATCH /api/tenant/theme', () => {
  it('SCHOOL_ADMIN changes their own tenant theme', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    expect(tenant.plan).toBe('TRIAL'); // sanity: signupSchool default unaffected by this change

    const res = await request(app)
      .patch('/api/tenant/theme')
      .set(authHeader(accessToken))
      .send({ themeId: 'maroon' });

    expect(res.status).toBe(200);
    expect(res.body.data.themeId).toBe('maroon');

    const updated = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.themeId).toBe('maroon');
  });

  it('rejects an unknown themeId with 400', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .patch('/api/tenant/theme')
      .set(authHeader(accessToken))
      .send({ themeId: 'not-a-real-theme' });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/tenant/theme').send({ themeId: 'maroon' });
    expect(res.status).toBe(401);
  });

  it('non-admin roles (e.g. TEACHER) cannot change the tenant theme', async () => {
    const { tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.theme@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .patch('/api/tenant/theme')
      .set(authHeader(teacher.accessToken))
      .send({ themeId: 'maroon' });

    expect(res.status).toBe(403);
  });

  it('only changes the caller\'s own tenant (isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'theme-school-a', adminEmail: 'admin@theme-a.test' });
    const schoolB = await signupSchool(app, { slug: 'theme-school-b', adminEmail: 'admin@theme-b.test' });

    await request(app).patch('/api/tenant/theme').set(authHeader(schoolA.accessToken)).send({ themeId: 'maroon' });

    const tenantB = await prisma.tenant.findUnique({ where: { id: schoolB.tenant.id } });
    expect(tenantB?.themeId).toBe('navy-blue'); // untouched, still the default
  });
});

describe('GET/PATCH /api/tenant/weekly-off-days', () => {
  it('defaults to Sunday only, any authenticated staff role can read it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.weeklyoff@test-school.test',
      role: 'TEACHER',
    });

    const asAdmin = await request(app).get('/api/tenant/weekly-off-days').set(authHeader(accessToken));
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.weeklyOffDays).toEqual([0]);

    const asTeacher = await request(app).get('/api/tenant/weekly-off-days').set(authHeader(teacher.accessToken));
    expect(asTeacher.status).toBe(200);
    expect(asTeacher.body.data.weeklyOffDays).toEqual([0]);
  });

  it('SCHOOL_ADMIN can change weekly off days; other roles cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.weeklyoff2@test-school.test',
      role: 'TEACHER',
    });

    const rejected = await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(teacher.accessToken))
      .send({ weeklyOffDays: [0, 6] });
    expect(rejected.status).toBe(403);

    const updated = await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(accessToken))
      .send({ weeklyOffDays: [0, 6] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.weeklyOffDays.sort()).toEqual([0, 6]);

    const persisted = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(persisted?.weeklyOffDays.sort()).toEqual([0, 6]);
  });

  it('rejects an out-of-range day value', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(accessToken))
      .send({ weeklyOffDays: [7] });
    expect(res.status).toBe(400);
  });

  it('only changes the caller\'s own tenant (isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'weeklyoff-school-a', adminEmail: 'admin@weeklyoff-a.test' });
    const schoolB = await signupSchool(app, { slug: 'weeklyoff-school-b', adminEmail: 'admin@weeklyoff-b.test' });

    await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(schoolA.accessToken))
      .send({ weeklyOffDays: [5, 6] });

    const tenantB = await prisma.tenant.findUnique({ where: { id: schoolB.tenant.id } });
    expect(tenantB?.weeklyOffDays).toEqual([0]); // untouched, still the default
  });
});
