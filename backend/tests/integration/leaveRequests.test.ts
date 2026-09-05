import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

async function setupStaffMember(accessToken: string, tenant: { slug: string }, overrides: Partial<Record<string, unknown>> = {}) {
  const created = await request(app)
    .post('/api/staff')
    .set(authHeader(accessToken))
    .send({
      email: 'teacher@test-school.test',
      fullName: 'Bilal Ahmed',
      role: 'TEACHER',
      designation: 'Senior Teacher',
      employmentType: 'FULL_TIME',
      joiningDate: '2026-01-01',
      monthlySalary: 60000,
      ...overrides,
    });
  if (created.status !== 201) {
    throw new Error(`setupStaffMember failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const login = await request(app)
    .post('/api/auth/login')
    .send({ slug: tenant.slug, email: created.body.data.user.email, password: created.body.tempPassword });

  return { staffProfileId: created.body.data.id as string, accessToken: login.body.accessToken as string };
}

function leavePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    leaveType: 'SICK',
    fromDate: '2026-03-10',
    toDate: '2026-03-11',
    reason: 'Feeling unwell, doctor advised rest',
    ...overrides,
  };
}

describe('Leave requests — self-service', () => {
  it('a staff member files their own leave request', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await setupStaffMember(accessToken, tenant);

    const res = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacher.accessToken))
      .send(leavePayload());

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.staffProfile.id).toBe(teacher.staffProfileId);
  });

  it('rejects toDate before fromDate with 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await setupStaffMember(accessToken, tenant);

    const res = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacher.accessToken))
      .send(leavePayload({ fromDate: '2026-03-11', toDate: '2026-03-10' }));

    expect(res.status).toBe(400);
  });

  it('the founding SCHOOL_ADMIN also has a staff profile (from signup) and can file their own leave', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(accessToken))
      .send(leavePayload());

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.staffProfile.employeeCode).toBe('TS-ADMIN');
  });

  it('a staff member sees only their own requests; SCHOOL_ADMIN sees everyone\'s', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacherA = await setupStaffMember(accessToken, tenant, { email: 'a@test-school.test' });
    const teacherB = await setupStaffMember(accessToken, tenant, { email: 'b@test-school.test' });

    await request(app).post('/api/staff/leave-requests').set(authHeader(teacherA.accessToken)).send(leavePayload());
    await request(app).post('/api/staff/leave-requests').set(authHeader(teacherB.accessToken)).send(leavePayload());

    const ownList = await request(app).get('/api/staff/leave-requests').set(authHeader(teacherA.accessToken));
    expect(ownList.status).toBe(200);
    expect(ownList.body.data).toHaveLength(1);
    expect(ownList.body.data[0].staffProfile.id).toBe(teacherA.staffProfileId);

    const adminList = await request(app).get('/api/staff/leave-requests').set(authHeader(accessToken));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data).toHaveLength(2);
  });

  it('the requester can cancel their own pending request; others cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacherA = await setupStaffMember(accessToken, tenant, { email: 'a@test-school.test' });
    const teacherB = await setupStaffMember(accessToken, tenant, { email: 'b@test-school.test' });

    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacherA.accessToken))
      .send(leavePayload());

    const forbidden = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/cancel`)
      .set(authHeader(teacherB.accessToken));
    expect(forbidden.status).toBe(403);

    const cancelled = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/cancel`)
      .set(authHeader(teacherA.accessToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const recancel = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/cancel`)
      .set(authHeader(teacherA.accessToken));
    expect(recancel.status).toBe(409);
  });
});

describe('Leave requests — review workflow', () => {
  it('SCHOOL_ADMIN approves a pending leave request', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await setupStaffMember(accessToken, tenant);
    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacher.accessToken))
      .send(leavePayload());

    const approved = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/approve`)
      .set(authHeader(accessToken))
      .send({ reviewNote: 'Approved, get well soon' });

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.reviewNote).toBe('Approved, get well soon');
    expect(approved.body.data.reviewedByUser).toBeTruthy();
  });

  it('SCHOOL_ADMIN rejects a pending leave request', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await setupStaffMember(accessToken, tenant);
    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacher.accessToken))
      .send(leavePayload());

    const rejected = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/reject`)
      .set(authHeader(accessToken))
      .send({});

    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
  });

  it('a non-admin cannot approve or reject leave requests (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacherA = await setupStaffMember(accessToken, tenant, { email: 'a@test-school.test' });
    const teacherB = await setupStaffMember(accessToken, tenant, { email: 'b@test-school.test' });
    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacherA.accessToken))
      .send(leavePayload());

    const res = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/approve`)
      .set(authHeader(teacherB.accessToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it('approving an already-approved request is rejected with 409', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await setupStaffMember(accessToken, tenant);
    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacher.accessToken))
      .send(leavePayload());

    await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/approve`)
      .set(authHeader(accessToken))
      .send({});

    const again = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/approve`)
      .set(authHeader(accessToken))
      .send({});
    expect(again.status).toBe(409);
  });

  it('cannot approve another tenant\'s leave request (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });
    const teacherA = await setupStaffMember(schoolA.accessToken, schoolA.tenant);
    const created = await request(app)
      .post('/api/staff/leave-requests')
      .set(authHeader(teacherA.accessToken))
      .send(leavePayload());

    const res = await request(app)
      .patch(`/api/staff/leave-requests/${created.body.data.id}/approve`)
      .set(authHeader(schoolB.accessToken))
      .send({});
    expect(res.status).toBe(404);
  });
});
