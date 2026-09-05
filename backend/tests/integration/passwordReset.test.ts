import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('Admin-triggered password reset', () => {
  it("SCHOOL_ADMIN resets a student's password; the old password stops working and the new temp password logs in", async () => {
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
    const oldPassword = student.body.portalLogin.tempPassword;
    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    const userId = detail.body.data.user.id;

    const reset = await request(app)
      .post(`/api/portal/admin/users/${userId}/reset-password`)
      .set(authHeader(accessToken));
    expect(reset.status).toBe(200);
    expect(reset.body.data.email).toBe('ahmed.khan@test-school.test');
    expect(typeof reset.body.tempPassword).toBe('string');
    expect(reset.body.tempPassword).not.toBe(oldPassword);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'ahmed.khan@test-school.test', password: oldPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'ahmed.khan@test-school.test', password: reset.body.tempPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.role).toBe('STUDENT');
  });

  it('TEACHER cannot reset a password (403)', async () => {
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
    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    const userId = detail.body.data.user.id;

    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post(`/api/portal/admin/users/${userId}/reset-password`)
      .set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown user id or one belonging to another tenant', async () => {
    const schoolA = await signupSchool(app, { slug: 'reset-a', adminEmail: 'a@reset-a.test' });
    const schoolB = await signupSchool(app, { slug: 'reset-b', adminEmail: 'a@reset-b.test' });

    const notFound = await request(app)
      .post('/api/portal/admin/users/00000000-0000-0000-0000-000000000000/reset-password')
      .set(authHeader(schoolA.accessToken));
    expect(notFound.status).toBe(404);

    const crossTenant = await request(app)
      .post(`/api/portal/admin/users/${schoolB.user.id}/reset-password`)
      .set(authHeader(schoolA.accessToken));
    expect(crossTenant.status).toBe(404);
  });
});

describe('Self-service forgot/reset password', () => {
  it("requesting a reset for an unregistered email returns the same generic 200 (no debugToken) as a real one", async () => {
    const { tenant } = await signupSchool(app);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ slug: tenant.slug, email: 'nobody@test-school.test' });
    expect(res.status).toBe(200);
    expect(res.body.debugToken).toBeUndefined();
  });

  it('a guardian (parent) can request and complete a password reset end-to-end', async () => {
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
    const oldPassword = guardian.body.portalLogin.tempPassword;

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ slug: tenant.slug, email: 'tariq.khan@example.com' });
    expect(forgot.status).toBe(200);
    expect(typeof forgot.body.debugToken).toBe('string');

    const badReset = await request(app)
      .post('/api/auth/reset-password')
      .send({ slug: tenant.slug, token: 'not-the-right-token', newPassword: 'NewPassw0rd1' });
    expect(badReset.status).toBe(400);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ slug: tenant.slug, token: forgot.body.debugToken, newPassword: 'NewPassw0rd1' });
    expect(reset.status).toBe(204);

    // The same token can't be replayed a second time.
    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ slug: tenant.slug, token: forgot.body.debugToken, newPassword: 'AnotherPassw0rd1' });
    expect(replay.status).toBe(400);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'tariq.khan@example.com', password: oldPassword });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'tariq.khan@example.com', password: 'NewPassw0rd1' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.role).toBe('PARENT');
  });

  it('requesting a second reset supersedes the first token', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send({
        email: 'teacher.reset@test-school.test',
        fullName: 'Bilal Ahmed',
        role: 'TEACHER',
        designation: 'Teacher',
        employmentType: 'FULL_TIME',
        joiningDate: '2026-01-15',
        monthlySalary: 60000,
      });

    const first = await request(app)
      .post('/api/auth/forgot-password')
      .send({ slug: tenant.slug, email: 'teacher.reset@test-school.test' });
    const second = await request(app)
      .post('/api/auth/forgot-password')
      .send({ slug: tenant.slug, email: 'teacher.reset@test-school.test' });

    const useFirst = await request(app)
      .post('/api/auth/reset-password')
      .send({ slug: tenant.slug, token: first.body.debugToken, newPassword: 'NewPassw0rd1' });
    expect(useFirst.status).toBe(400);

    const useSecond = await request(app)
      .post('/api/auth/reset-password')
      .send({ slug: tenant.slug, token: second.body.debugToken, newPassword: 'NewPassw0rd1' });
    expect(useSecond.status).toBe(204);
  });
});
