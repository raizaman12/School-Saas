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

describe('GET /api/students/me — self-service student bio-data', () => {
  it("a STUDENT can read their own bio-data and family detail (My Profile → Bio Data tab)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Sara Malik',
        gender: 'FEMALE',
        dateOfBirth: '2013-03-10',
        bFormOrCnic: '35202-1234567-1',
        email: 'sara.malik@test-school.test',
      });
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Malik Farooq',
        relationship: 'FATHER',
        phone: '03001234567',
        studentId: student.body.data.id,
      });
    expect(guardian.status).toBe(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'sara.malik@test-school.test', password: student.body.portalLogin.tempPassword });

    const res = await request(app).get('/api/students/me').set(authHeader(login.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Sara Malik');
    expect(res.body.data.gender).toBe('FEMALE');
    expect(res.body.data.bFormOrCnic).toBe('35202-1234567-1');
    expect(res.body.data.user.email).toBe('sara.malik@test-school.test');
    expect(res.body.data.guardians).toHaveLength(1);
    expect(res.body.data.guardians[0].guardian.fullName).toBe('Malik Farooq');
    expect(res.body.data.guardians[0].guardian.relationship).toBe('FATHER');
  });

  it("a PARENT/staff calling /api/students/me gets 403, not another student's data", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.notstudent@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app).get('/api/students/me').set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
    void accessToken;
  });

  it('an unauthenticated request is rejected (401)', async () => {
    const res = await request(app).get('/api/students/me');
    expect(res.status).toBe(401);
  });

  it("a STUDENT account somehow with no linked Student row gets 404, not a 500", async () => {
    const { tenant } = await signupSchool(app);
    const orphan = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'orphan.student@test-school.test',
      role: 'STUDENT',
    });

    const res = await request(app).get('/api/students/me').set(authHeader(orphan.accessToken));
    expect(res.status).toBe(404);
  });
});
