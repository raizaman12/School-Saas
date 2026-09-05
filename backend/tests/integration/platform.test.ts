import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb, ownerDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginSuperAdmin } from '../helpers/platform';
import { hashPassword } from '../../src/lib/password';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('Plan catalog', () => {
  it('SUPER_ADMIN can list the subscription plan catalog', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);

    const res = await request(app).get('/api/platform/plans').set(authHeader(superAdmin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.data.map((p: { code: string }) => p.code).sort()).toEqual(['BASIC', 'PREMIUM', 'STANDARD', 'TRIAL']);
  });

  it('a regular SCHOOL_ADMIN cannot access platform routes (403)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/platform/plans').set(authHeader(accessToken));
    expect(res.status).toBe(403);
  });

  it('unauthenticated requests are rejected (401)', async () => {
    const res = await request(app).get('/api/platform/tenants');
    expect(res.status).toBe(401);
  });
});

describe('Platform tenant management', () => {
  it('lists all tenants and supports search + status filters', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    await signupSchool(app, { slug: 'alpha-school', schoolName: 'Alpha School', adminEmail: 'admin@alpha.test' });
    await signupSchool(app, { slug: 'beta-school', schoolName: 'Beta School', adminEmail: 'admin@beta.test' });

    const all = await request(app).get('/api/platform/tenants').set(authHeader(superAdmin.accessToken));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);

    const search = await request(app)
      .get('/api/platform/tenants')
      .query({ search: 'Alpha' })
      .set(authHeader(superAdmin.accessToken));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].slug).toBe('alpha-school');

    const byStatus = await request(app)
      .get('/api/platform/tenants')
      .query({ status: 'TRIAL' })
      .set(authHeader(superAdmin.accessToken));
    expect(byStatus.body.meta.total).toBe(2); // both start on TRIAL
  });

  it('returns tenant detail with usage counts and plan limits', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    const { tenant } = await signupSchool(app);

    const res = await request(app)
      .get(`/api/platform/tenants/${tenant.id}`)
      .set(authHeader(superAdmin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.usage.userCount).toBe(1); // the admin created at signup
    expect(res.body.data.usage.studentCount).toBe(0);
    expect(res.body.data.usage.smsCreditsUsedThisMonth).toBe(0);
    expect(res.body.data.planDefinition.code).toBe('TRIAL');
    expect(res.body.data.limits.withinStudentLimit).toBe(true);
    expect(res.body.data.limits.withinSmsLimit).toBe(false); // TRIAL has a 0 SMS quota
  });

  it('404s for an unknown tenant id', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    const res = await request(app)
      .get('/api/platform/tenants/00000000-0000-0000-0000-000000000000')
      .set(authHeader(superAdmin.accessToken));
    expect(res.status).toBe(404);
  });

  it('suspends a tenant, blocking further logins, then reactivates it', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    const { tenant, user } = await signupSchool(app);

    const suspend = await request(app)
      .patch(`/api/platform/tenants/${tenant.id}/status`)
      .set(authHeader(superAdmin.accessToken))
      .send({ status: 'SUSPENDED', reason: 'Non-payment' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.status).toBe('SUSPENDED');

    const loginBlocked = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: user.email, password: 'Passw0rd123' });
    expect(loginBlocked.status).toBe(403);

    const reactivate = await request(app)
      .patch(`/api/platform/tenants/${tenant.id}/status`)
      .set(authHeader(superAdmin.accessToken))
      .send({ status: 'ACTIVE' });
    expect(reactivate.status).toBe(200);

    const loginOk = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: user.email, password: 'Passw0rd123' });
    expect(loginOk.status).toBe(200);
  });

  it('changes a tenant plan and records an audit log entry', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    const { tenant } = await signupSchool(app);

    const res = await request(app)
      .patch(`/api/platform/tenants/${tenant.id}/plan`)
      .set(authHeader(superAdmin.accessToken))
      .send({ plan: 'STANDARD' });

    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBe('STANDARD');

    const auditEntry = await ownerDb.auditLog.findFirst({
      where: { action: 'platform.tenant.plan_change', entityId: tenant.id },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.metadata).toEqual({ from: 'TRIAL', to: 'STANDARD' });
  });

  it('404s when changing status/plan for an unknown tenant', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    const res = await request(app)
      .patch('/api/platform/tenants/00000000-0000-0000-0000-000000000000/status')
      .set(authHeader(superAdmin.accessToken))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(404);
  });
});

describe('Plan limit enforcement', () => {
  it('blocks student creation once a tenant hits its plan\'s student limit', async () => {
    const { accessToken, tenant } = await signupSchool(app); // TRIAL: maxStudents = 50
    // Fast-forward straight to the limit via a privileged bulk insert
    // instead of 50 sequential HTTP requests.
    await ownerDb.student.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        id: randomUUID(),
        tenantId: tenant.id,
        studentCode: `BULK-${i}`,
        fullName: `Bulk Student ${i}`,
        gender: 'MALE' as const,
        dateOfBirth: new Date('2015-01-01'),
        status: 'ACTIVE' as const,
      })),
    });

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'One Too Many', gender: 'MALE', dateOfBirth: '2015-06-01' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.message).toMatch(/50 active students/);
  });

  it('does not block student creation on an unlimited (PREMIUM) plan', async () => {
    const { accessToken, tenant } = await signupSchool(app, { plan: 'PREMIUM' });
    await ownerDb.student.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        id: randomUUID(),
        tenantId: tenant.id,
        studentCode: `BULK-${i}`,
        fullName: `Bulk Student ${i}`,
        gender: 'MALE' as const,
        dateOfBirth: new Date('2015-01-01'),
        status: 'ACTIVE' as const,
      })),
    });

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Sixty First', gender: 'FEMALE', dateOfBirth: '2015-06-01' });

    expect(res.status).toBe(201);
  });

  it('blocks staff creation once a tenant hits its plan\'s staff limit', async () => {
    const { accessToken, tenant } = await signupSchool(app); // TRIAL: maxStaff = 10
    const passwordHash = await hashPassword('Passw0rd123');
    for (let i = 0; i < 10; i++) {
      const userId = randomUUID();
      await ownerDb.user.create({
        data: {
          id: userId,
          tenantId: tenant.id,
          email: `bulk-staff-${i}@test-school.test`,
          passwordHash,
          fullName: `Bulk Staff ${i}`,
          role: 'TEACHER',
          status: 'ACTIVE',
        },
      });
      await ownerDb.staffProfile.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          userId,
          employeeCode: `EMP-BULK-${i}`,
          designation: 'Teacher',
          joiningDate: new Date('2024-01-01'),
          monthlySalary: 50000,
          status: 'ACTIVE',
        },
      });
    }

    const res = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        email: 'eleventh@test-school.test',
        fullName: 'Eleventh Hire',
        role: 'TEACHER',
        designation: 'Teacher',
        joiningDate: '2026-01-01',
        monthlySalary: 55000,
      });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.error.message).toMatch(/10 active staff members/);
  });
});

describe('Platform stats', () => {
  it('summarizes tenant counts by status/plan and recent signups', async () => {
    const superAdmin = await createAndLoginSuperAdmin(app);
    await signupSchool(app, { slug: 'stats-alpha', adminEmail: 'admin@stats-alpha.test', plan: 'STANDARD' });
    await signupSchool(app, { slug: 'stats-beta', adminEmail: 'admin@stats-beta.test' });

    const res = await request(app).get('/api/platform/stats').set(authHeader(superAdmin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.totalTenants).toBe(2);
    expect(res.body.data.byPlan.STANDARD).toBe(1);
    expect(res.body.data.byPlan.TRIAL).toBe(1);
    expect(res.body.data.byStatus.TRIAL).toBe(2); // status defaults to TRIAL regardless of chosen plan
    expect(res.body.data.newSignups.last7Days).toBe(2);
    expect(res.body.data.recentSignups).toHaveLength(2);
  });

  it('a regular SCHOOL_ADMIN cannot access platform stats (403)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/platform/stats').set(authHeader(accessToken));
    expect(res.status).toBe(403);
  });
});
