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

async function loginAs(email: string, password: string, slug: string) {
  const res = await request(app).post('/api/auth/login').send({ slug, email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/**
 * Builds a section with a class teacher, a separate subject teacher
 * assigned to it, an enrolled student, and a guardian with a portal login
 * — the full cast needed to test "routes to every teacher who teaches the
 * student, not just the class teacher, plus admin".
 */
async function setupStudentWithTeachers(accessToken: string, tenant: { id: string; slug: string }) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 5', order: 5 });

  const classTeacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: 'homeroom@test-school.test',
    role: 'TEACHER',
  });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({
      schoolClassId: cls.body.data.id,
      academicYearId: year.body.data.id,
      name: 'A',
      classTeacherId: classTeacher.user.id,
    });

  const subjectTeacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: 'subject-teacher@test-school.test',
    role: 'TEACHER',
  });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Mathematics' });
  await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: subjectTeacher.user.id });

  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Hassan Iqbal',
      gender: 'MALE',
      dateOfBirth: '2014-06-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Iqbal Hussain',
      relationship: 'FATHER',
      phone: '03001234567',
      email: 'iqbal.hussain@example.com',
      studentId: student.body.data.id,
      isPrimary: true,
    });

  return {
    section: section.body.data,
    classTeacher,
    subjectTeacher,
    student: student.body.data,
    guardianPortalLogin: guardian.body.portalLogin as { email: string; tempPassword: string },
  };
}

function leavePayload(studentId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    studentId,
    fromDate: '2026-03-02',
    toDate: '2026-03-03',
    reason: 'Family wedding out of town.',
    ...overrides,
  };
}

describe('Student leave requests — creation (PARENT portal only)', () => {
  it('a PARENT creates a leave request for their own child; notifies the class teacher, the subject teacher, and admin (not an unrelated teacher)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { classTeacher, subjectTeacher, student, guardianPortalLogin } = await setupStudentWithTeachers(
      accessToken,
      tenant,
    );
    const unrelatedTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'unrelated@test-school.test',
      role: 'TEACHER',
    });

    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);

    const create = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id));
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe('PENDING');
    expect(create.body.data.student.id).toBe(student.id);

    const classTeacherNotifs = await request(app).get('/api/notifications').set(authHeader(classTeacher.accessToken));
    expect(classTeacherNotifs.body.data.some((n: { relatedEntityId: string }) => n.relatedEntityId === create.body.data.id)).toBe(
      true,
    );

    const subjectTeacherNotifs = await request(app)
      .get('/api/notifications')
      .set(authHeader(subjectTeacher.accessToken));
    expect(
      subjectTeacherNotifs.body.data.some((n: { relatedEntityId: string }) => n.relatedEntityId === create.body.data.id),
    ).toBe(true);

    const adminNotifs = await request(app).get('/api/notifications').set(authHeader(accessToken));
    expect(adminNotifs.body.data.some((n: { relatedEntityId: string }) => n.relatedEntityId === create.body.data.id)).toBe(
      true,
    );

    const unrelatedNotifs = await request(app)
      .get('/api/notifications')
      .set(authHeader(unrelatedTeacher.accessToken));
    expect(
      unrelatedNotifs.body.data.some((n: { relatedEntityId: string }) => n.relatedEntityId === create.body.data.id),
    ).toBe(false);
  });

  it('a PARENT cannot create a leave request for a child that is not theirs (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student } = await setupStudentWithTeachers(accessToken, tenant);
    const otherGuardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Unrelated Guardian',
        relationship: 'MOTHER',
        phone: '03009876543',
        email: 'unrelated.guardian@example.com',
        isPrimary: false,
      });
    const otherParentToken = await loginAs(
      otherGuardian.body.portalLogin.email,
      otherGuardian.body.portalLogin.tempPassword,
      tenant.slug,
    );

    const res = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(otherParentToken))
      .send(leavePayload(student.id));
    expect(res.status).toBe(403);
  });

  it('rejects a toDate before fromDate (400)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, guardianPortalLogin } = await setupStudentWithTeachers(accessToken, tenant);
    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);

    const res = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id, { fromDate: '2026-03-05', toDate: '2026-03-01' }));
    expect(res.status).toBe(400);
  });

  it('non-PARENT roles cannot create a student leave request via the portal route (403/401)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student } = await setupStudentWithTeachers(accessToken, tenant);

    // SCHOOL_ADMIN is a staff token, not a PARENT/STUDENT portal token —
    // rejected by the portal router's own requireAuth/requireRole chain.
    const asAdmin = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(accessToken))
      .send(leavePayload(student.id));
    expect([401, 403]).toContain(asAdmin.status);
  });
});

describe('Student leave requests — parent list/cancel', () => {
  it('a PARENT sees only their own children\'s requests and can cancel a pending one', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, guardianPortalLogin } = await setupStudentWithTeachers(accessToken, tenant);
    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);

    const create = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id));

    const list = await request(app).get('/api/portal/leave-requests').set(authHeader(parentToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const cancel = await request(app)
      .patch(`/api/portal/leave-requests/${create.body.data.id}/cancel`)
      .set(authHeader(parentToken));
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');

    const cancelAgain = await request(app)
      .patch(`/api/portal/leave-requests/${create.body.data.id}/cancel`)
      .set(authHeader(parentToken));
    expect(cancelAgain.status).toBe(409);
  });
});

describe('Student leave requests — staff review (SCHOOL_ADMIN + every teacher who teaches the student)', () => {
  it('the class teacher, the subject teacher, and SCHOOL_ADMIN can all see and approve/reject it; an unrelated teacher cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { classTeacher, subjectTeacher, student, guardianPortalLogin } = await setupStudentWithTeachers(
      accessToken,
      tenant,
    );
    const unrelatedTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'unrelated@test-school.test',
      role: 'TEACHER',
    });
    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);

    const create = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id));

    const unrelatedList = await request(app)
      .get('/api/student-leave-requests')
      .set(authHeader(unrelatedTeacher.accessToken));
    expect(unrelatedList.body.data).toHaveLength(0);

    const unrelatedApprove = await request(app)
      .patch(`/api/student-leave-requests/${create.body.data.id}/approve`)
      .set(authHeader(unrelatedTeacher.accessToken))
      .send({});
    expect(unrelatedApprove.status).toBe(403);

    const subjectTeacherList = await request(app)
      .get('/api/student-leave-requests')
      .set(authHeader(subjectTeacher.accessToken));
    expect(subjectTeacherList.body.data).toHaveLength(1);

    const adminList = await request(app).get('/api/student-leave-requests').set(authHeader(accessToken));
    expect(adminList.body.data).toHaveLength(1);

    const approve = await request(app)
      .patch(`/api/student-leave-requests/${create.body.data.id}/approve`)
      .set(authHeader(classTeacher.accessToken))
      .send({ reviewNote: 'Approved — have a safe trip.' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');
    expect(approve.body.data.reviewedByUser.id).toBe(classTeacher.user.id);

    const approveAgain = await request(app)
      .patch(`/api/student-leave-requests/${create.body.data.id}/approve`)
      .set(authHeader(accessToken))
      .send({});
    expect(approveAgain.status).toBe(409);
  });

  it('a FRONT_DESK/ACCOUNTANT cannot list or review student leave requests (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, guardianPortalLogin } = await setupStudentWithTeachers(accessToken, tenant);
    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);
    const create = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id));

    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant@test-school.test',
      role: 'ACCOUNTANT',
    });

    const list = await request(app).get('/api/student-leave-requests').set(authHeader(accountant.accessToken));
    expect(list.status).toBe(403);

    const reject = await request(app)
      .patch(`/api/student-leave-requests/${create.body.data.id}/reject`)
      .set(authHeader(accountant.accessToken))
      .send({});
    expect(reject.status).toBe(403);
  });

  it('cannot access another tenant\'s student leave request (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });
    const { student, guardianPortalLogin } = await setupStudentWithTeachers(schoolA.accessToken, schoolA.tenant);
    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, schoolA.tenant.slug);
    const create = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentToken))
      .send(leavePayload(student.id));

    const get = await request(app)
      .get(`/api/student-leave-requests/${create.body.data.id}`)
      .set(authHeader(schoolB.accessToken));
    expect(get.status).toBe(404);
  });
});
