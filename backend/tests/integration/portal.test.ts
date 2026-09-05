import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb, ownerDb } from '../helpers/db';
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

async function setupSection(accessToken: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 4', order: 4 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });

  return { year: year.body.data, section: section.body.data };
}

async function addFamily(
  accessToken: string,
  ctx: { year: { id: string }; section: { id: string } },
  overrides: Partial<Record<string, unknown>> = {},
) {
  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: (overrides.studentFullName as string) ?? 'Hassan Iqbal',
      gender: 'MALE',
      dateOfBirth: '2014-06-01',
      sectionId: ctx.section.id,
      academicYearId: ctx.year.id,
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: (overrides.fullName as string) ?? 'Iqbal Hussain',
      relationship: 'FATHER',
      phone: '03001234567',
      email: Object.prototype.hasOwnProperty.call(overrides, 'email')
        ? overrides.email
        : 'iqbal.hussain@example.com',
      studentId: student.body.data.id,
      isPrimary: true,
    });

  // Supplying an email at guardian creation now auto-provisions (and
  // emails) a portal login immediately — see sis/guardians.ts. Surface it
  // here so callers don't need a redundant manual create-login call.
  //
  // The student itself is now ALWAYS auto-provisioned a portal login too,
  // even with no email supplied above (see createStudentLogin's doc
  // comment) — an ID-based one. Surfacing it the same way means callers
  // log in with `studentPortalLogin.loginId` instead of a separate manual
  // create-login call, which would now 409 ("already has a portal login").
  return {
    student: student.body.data,
    guardian: guardian.body.data,
    guardianPortalLogin: guardian.body.portalLogin as { email: string; tempPassword: string } | undefined,
    studentPortalLogin: student.body.portalLogin as
      | { email: string | null; loginId: string; tempPassword: string }
      | undefined,
  };
}

async function setupFamily(accessToken: string, overrides: Partial<Record<string, unknown>> = {}) {
  const ctx = await setupSection(accessToken);
  const family = await addFamily(accessToken, ctx, overrides);
  return { year: ctx.year, section: ctx.section, ...family };
}

describe('Portal login provisioning', () => {
  it('auto-provisions a guardian portal login at creation when an email is supplied', async () => {
    const { accessToken } = await signupSchool(app);
    const ctx = await setupSection(accessToken);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Hassan Iqbal',
        gender: 'MALE',
        dateOfBirth: '2014-06-01',
        sectionId: ctx.section.id,
        academicYearId: ctx.year.id,
      });

    const res = await request(app)
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

    expect(res.status).toBe(201);
    expect(res.body.portalLogin.email).toBe('iqbal.hussain@example.com');
    expect(typeof res.body.portalLogin.tempPassword).toBe('string');
    expect(res.body.portalLogin.tempPassword.length).toBeGreaterThan(8);

    // The new login works immediately.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'test-school', email: 'iqbal.hussain@example.com', password: res.body.portalLogin.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('PARENT');
  });

  it('does not auto-provision a guardian login when no email is supplied at creation', async () => {
    const { accessToken } = await signupSchool(app);
    const { guardian } = await setupFamily(accessToken, { email: undefined });

    expect(guardian.userId).toBeFalsy();
  });

  it('SCHOOL_ADMIN can still manually create a guardian portal login (fallback path)', async () => {
    const { accessToken } = await signupSchool(app);
    const { guardian } = await setupFamily(accessToken, { email: undefined });

    const res = await request(app)
      .post(`/api/portal/admin/guardians/${guardian.id}/create-login`)
      .set(authHeader(accessToken))
      .send({ email: 'manually.added@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('manually.added@example.com');
    expect(typeof res.body.tempPassword).toBe('string');
  });

  it('rejects creating a second login for the same guardian (already auto-provisioned at creation)', async () => {
    const { accessToken } = await signupSchool(app);
    const { guardian } = await setupFamily(accessToken); // default email -> auto-provisioned already

    const dup = await request(app)
      .post(`/api/portal/admin/guardians/${guardian.id}/create-login`)
      .set(authHeader(accessToken))
      .send({});
    expect(dup.status).toBe(409);
  });

  it('requires an explicit email when the guardian has none on file', async () => {
    const { accessToken } = await signupSchool(app);
    const { guardian } = await setupFamily(accessToken, { email: undefined });

    const missing = await request(app)
      .post(`/api/portal/admin/guardians/${guardian.id}/create-login`)
      .set(authHeader(accessToken))
      .send({});
    expect(missing.status).toBe(400);

    const withEmail = await request(app)
      .post(`/api/portal/admin/guardians/${guardian.id}/create-login`)
      .set(authHeader(accessToken))
      .send({ email: 'supplied@example.com' });
    expect(withEmail.status).toBe(201);
  });

  it('creates a student portal login for a legacy student with no login yet (email now optional)', async () => {
    const { accessToken } = await signupSchool(app);
    const { student } = await setupFamily(accessToken);
    // setupFamily's student already got an auto-provisioned ID-based login
    // at admission (see addFamily's doc comment) — simulate a student who
    // predates that feature (the only way one now has no login at all) by
    // unlinking AND deleting that original User row — leaving it in place
    // would still occupy the loginId derived from this student's own
    // (immutable) studentCode and collide when create-login regenerates it.
    await ownerDb.student.update({ where: { id: student.id }, data: { userId: null } });
    await ownerDb.user.delete({ where: { id: student.userId } });

    const res = await request(app)
      .post(`/api/portal/admin/students/${student.id}/create-login`)
      .set(authHeader(accessToken))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBeNull();
    expect(typeof res.body.data.loginId).toBe('string');
    expect(typeof res.body.tempPassword).toBe('string');

    const alreadyHasOne = await request(app)
      .post(`/api/portal/admin/students/${student.id}/create-login`)
      .set(authHeader(accessToken))
      .send({});
    expect(alreadyHasOne.status).toBe(409);
  });

  it('FRONT_DESK can provision logins but TEACHER cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student } = await setupFamily(accessToken);
    // Same "simulate a pre-feature student" unlink-and-delete as above.
    await ownerDb.student.update({ where: { id: student.id }, data: { userId: null } });
    await ownerDb.user.delete({ where: { id: student.userId } });
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd.portal@test-school.test',
      role: 'FRONT_DESK',
    });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.portal@test-school.test',
      role: 'TEACHER',
    });

    const fdRes = await request(app)
      .post(`/api/portal/admin/students/${student.id}/create-login`)
      .set(authHeader(frontDesk.accessToken))
      .send({ email: 'fd-created@example.com' });
    expect(fdRes.status).toBe(201);

    const teacherRes = await request(app)
      .post('/api/portal/admin/guardians/00000000-0000-0000-0000-000000000000/create-login')
      .set(authHeader(teacher.accessToken))
      .send({});
    expect(teacherRes.status).toBe(403);
  });
});

describe('Student admission auto-provisioning', () => {
  it('auto-provisions a student portal login at admission when an email is supplied', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Hassan Iqbal',
        gender: 'MALE',
        dateOfBirth: '2014-06-01',
        sectionId: ctx.section.id,
        academicYearId: ctx.year.id,
        email: 'hassan.iqbal@example.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.portalLogin.email).toBe('hassan.iqbal@example.com');
    expect(typeof res.body.portalLogin.tempPassword).toBe('string');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'hassan.iqbal@example.com', password: res.body.portalLogin.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('STUDENT');
  });

  it('admits a student with no email — still gets an ID-based portal login', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'No Email Student',
        gender: 'FEMALE',
        dateOfBirth: '2015-01-01',
        sectionId: ctx.section.id,
        academicYearId: ctx.year.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.portalLogin.email).toBeNull();
    expect(typeof res.body.portalLogin.loginId).toBe('string');
    expect(typeof res.body.portalLogin.tempPassword).toBe('string');

    // The new ID-based login works immediately — no email/mobile needed.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: res.body.portalLogin.loginId, password: res.body.portalLogin.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('STUDENT');
  });
});

describe('Portal credentials are emailed on auto-provisioning', () => {
  it('emails the guardian their portal credentials when a login is auto-provisioned at creation', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { guardian, guardianPortalLogin } = await setupFamily(accessToken);

    const notif = await ownerDb.notification.findFirst({
      where: { tenantId: tenant.id, channel: 'EMAIL', relatedEntityType: 'Guardian', relatedEntityId: guardian.id },
    });

    expect(notif).not.toBeNull();
    expect(notif!.status).toBe('SENT');
    expect(notif!.recipientEmail).toBe('iqbal.hussain@example.com');
    expect(notif!.body).toContain(guardianPortalLogin!.tempPassword);
  });

  it('emails the student their portal credentials when a login is auto-provisioned at admission', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Hassan Iqbal',
        gender: 'MALE',
        dateOfBirth: '2014-06-01',
        sectionId: ctx.section.id,
        academicYearId: ctx.year.id,
        email: 'hassan.iqbal@example.com',
      });

    const notif = await ownerDb.notification.findFirst({
      where: {
        tenantId: tenant.id,
        channel: 'EMAIL',
        relatedEntityType: 'Student',
        relatedEntityId: res.body.data.id,
      },
    });

    expect(notif).not.toBeNull();
    expect(notif!.status).toBe('SENT');
    expect(notif!.recipientEmail).toBe('hassan.iqbal@example.com');
    expect(notif!.body).toContain(res.body.portalLogin.tempPassword);
  });
});

async function loginAs(email: string, password: string, slug: string) {
  const res = await request(app).post('/api/auth/login').send({ slug, email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

describe('Parent portal', () => {
  it("PARENT sees their linked child in /me and can read the child's profile, attendance and fees", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, guardianPortalLogin } = await setupFamily(accessToken);
    const parentToken = await loginAs(guardianPortalLogin!.email, guardianPortalLogin!.tempPassword, tenant.slug);

    const me = await request(app).get('/api/portal/me').set(authHeader(parentToken));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('PARENT');
    expect(me.body.data.children).toHaveLength(1);
    expect(me.body.data.children[0].id).toBe(student.id);

    const detail = await request(app).get(`/api/portal/students/${student.id}`).set(authHeader(parentToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.fullName).toBe('Hassan Iqbal');

    const attendance = await request(app)
      .get(`/api/portal/students/${student.id}/attendance`)
      .set(authHeader(parentToken));
    expect(attendance.status).toBe(200);
    expect(attendance.body.data.summary.totalMarked).toBe(0);

    const fees = await request(app).get(`/api/portal/students/${student.id}/fees`).set(authHeader(parentToken));
    expect(fees.status).toBe(200);
    expect(fees.body.data.summary).toEqual({ totalBilled: 0, totalPaid: 0, balance: 0 });
  });

  it('PARENT cannot view a student who is not their child', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);
    const familyA = await addFamily(accessToken, ctx);
    const familyB = await addFamily(accessToken, ctx, {
      email: 'other.parent@example.com',
      fullName: 'Other Parent',
      studentFullName: 'Other Child',
    });
    void familyB.guardian;

    const parentToken = await loginAs(
      familyA.guardianPortalLogin!.email,
      familyA.guardianPortalLogin!.tempPassword,
      tenant.slug,
    );

    const res = await request(app)
      .get(`/api/portal/students/${familyB.student.id}`)
      .set(authHeader(parentToken));
    expect(res.status).toBe(403);
  });

  it("PARENT can read their child's discipline records but not another family's", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);
    const familyA = await addFamily(accessToken, ctx);
    const familyB = await addFamily(accessToken, ctx, {
      email: 'other.parent@example.com',
      fullName: 'Other Parent',
      studentFullName: 'Other Child',
    });

    await request(app)
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: familyA.student.id,
        incidentDate: '2026-02-01',
        category: 'LATE_ARRIVAL',
        severity: 'MINOR',
        description: 'Arrived 20 minutes late without a note.',
      });

    const parentAToken = await loginAs(
      familyA.guardianPortalLogin!.email,
      familyA.guardianPortalLogin!.tempPassword,
      tenant.slug,
    );
    const parentBToken = await loginAs(
      familyB.guardianPortalLogin!.email,
      familyB.guardianPortalLogin!.tempPassword,
      tenant.slug,
    );

    const ownChild = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/discipline-records`)
      .set(authHeader(parentAToken));
    expect(ownChild.status).toBe(200);
    expect(ownChild.body.data).toHaveLength(1);
    expect(ownChild.body.data[0].category).toBe('LATE_ARRIVAL');

    const otherChild = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/discipline-records`)
      .set(authHeader(parentBToken));
    expect(otherChild.status).toBe(403);
  });

  it("PARENT can read their child's health profile and log entries but not another family's", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);
    const familyA = await addFamily(accessToken, ctx);
    const familyB = await addFamily(accessToken, ctx, {
      email: 'other.parent2@example.com',
      fullName: 'Other Parent Two',
      studentFullName: 'Other Child Two',
    });

    await request(app)
      .put(`/api/health/profiles/${familyA.student.id}`)
      .set(authHeader(accessToken))
      .send({ bloodGroup: 'O_POSITIVE', allergies: 'Dust' });
    await request(app)
      .post('/api/health/log-entries')
      .set(authHeader(accessToken))
      .send({
        studentId: familyA.student.id,
        visitDate: '2026-02-01',
        complaint: 'Mild fever.',
        actionTaken: 'Rested in the office.',
      });

    const parentAToken = await loginAs(
      familyA.guardianPortalLogin!.email,
      familyA.guardianPortalLogin!.tempPassword,
      tenant.slug,
    );
    const parentBToken = await loginAs(
      familyB.guardianPortalLogin!.email,
      familyB.guardianPortalLogin!.tempPassword,
      tenant.slug,
    );

    const ownProfile = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/health-profile`)
      .set(authHeader(parentAToken));
    expect(ownProfile.status).toBe(200);
    expect(ownProfile.body.data.bloodGroup).toBe('O_POSITIVE');

    const ownLog = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/health-log`)
      .set(authHeader(parentAToken));
    expect(ownLog.status).toBe(200);
    expect(ownLog.body.data).toHaveLength(1);
    expect(ownLog.body.data[0].complaint).toMatch(/fever/);

    const otherProfile = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/health-profile`)
      .set(authHeader(parentBToken));
    expect(otherProfile.status).toBe(403);

    const otherLog = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/health-log`)
      .set(authHeader(parentBToken));
    expect(otherLog.status).toBe(403);
  });

  it('a PARENT account with no linked guardian profile gets a clean 404 from /me', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    // Directly create a PARENT-role user with no Guardian row pointing at them.
    const orphanParent = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'orphan.parent@test-school.test',
      role: 'PARENT',
    });
    void accessToken;

    const res = await request(app).get('/api/portal/me').set(authHeader(orphanParent.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('Student portal', () => {
  it('STUDENT sees their own profile in /me and can read their own attendance', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, studentPortalLogin } = await setupFamily(accessToken);
    // Logs in with the auto-provisioned ID-based login (see
    // addFamily/setupFamily's doc comment) rather than an email — this is
    // exactly the "log in by ID" path a real school kid with no
    // email/mobile would use.
    const studentToken = await loginAs(studentPortalLogin!.loginId, studentPortalLogin!.tempPassword, tenant.slug);

    const me = await request(app).get('/api/portal/me').set(authHeader(studentToken));
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('STUDENT');
    expect(me.body.data.student.id).toBe(student.id);

    const attendance = await request(app)
      .get(`/api/portal/students/${student.id}/attendance`)
      .set(authHeader(studentToken));
    expect(attendance.status).toBe(200);
  });

  it('STUDENT cannot view another student record', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupSection(accessToken);
    const familyA = await addFamily(accessToken, ctx);
    const familyB = await addFamily(accessToken, ctx, {
      email: 'second.parent@example.com',
      fullName: 'Second Parent',
      studentFullName: 'Second Student',
    });

    const studentToken = await loginAs(
      familyA.studentPortalLogin!.loginId,
      familyA.studentPortalLogin!.tempPassword,
      tenant.slug,
    );

    const res = await request(app)
      .get(`/api/portal/students/${familyB.student.id}`)
      .set(authHeader(studentToken));
    expect(res.status).toBe(403);
  });

  it('staff roles (e.g. TEACHER) cannot access portal read routes', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student } = await setupFamily(accessToken);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.noportal@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .get(`/api/portal/students/${student.id}`)
      .set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('tenant isolation: a PARENT from tenant A cannot access a tenant B studentId', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a-portal', adminEmail: 'admin@a-portal.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b-portal', adminEmail: 'admin@b-portal.test' });

    const familyA = await setupFamily(schoolA.accessToken);
    const familyB = await setupFamily(schoolB.accessToken, { email: 'parentb@example.com' });
    void familyB.guardianPortalLogin;

    const parentAToken = await loginAs(
      familyA.guardianPortalLogin!.email,
      familyA.guardianPortalLogin!.tempPassword,
      schoolA.tenant.slug,
    );

    const res = await request(app)
      .get(`/api/portal/students/${familyB.student.id}`)
      .set(authHeader(parentAToken));
    expect(res.status).toBe(403);
  });
});

describe('Portal "No class today" state', () => {
  it('GET /api/portal/today reflects a declared holiday covering today, for both PARENT and STUDENT', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { guardianPortalLogin, studentPortalLogin } = await setupFamily(accessToken);
    const parentToken = await loginAs(guardianPortalLogin!.email, guardianPortalLogin!.tempPassword, tenant.slug);
    const studentToken = await loginAs(studentPortalLogin!.loginId, studentPortalLogin!.tempPassword, tenant.slug);

    const todayIso = new Date().toISOString().slice(0, 10);
    const holiday = await request(app)
      .post('/api/holidays')
      .set(authHeader(accessToken))
      .send({ name: 'Declared Today Off', startDate: todayIso, endDate: todayIso });
    expect(holiday.status).toBe(201);

    const asParent = await request(app).get('/api/portal/today').set(authHeader(parentToken));
    expect(asParent.status).toBe(200);
    expect(asParent.body.data).toEqual({
      date: expect.any(String),
      isNonWorkingDay: true,
      reason: 'HOLIDAY',
      label: 'Declared Today Off',
    });

    const asStudent = await request(app).get('/api/portal/today').set(authHeader(studentToken));
    expect(asStudent.status).toBe(200);
    expect(asStudent.body.data.isNonWorkingDay).toBe(true);
    expect(asStudent.body.data.reason).toBe('HOLIDAY');
  });

  it('GET /api/portal/today reports no holiday on an ordinary working day', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { guardianPortalLogin } = await setupFamily(accessToken);
    const parentToken = await loginAs(guardianPortalLogin!.email, guardianPortalLogin!.tempPassword, tenant.slug);

    // Clear the default Sunday weekly-off so this assertion holds no matter
    // which real-world weekday the test happens to run on.
    await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(accessToken))
      .send({ weeklyOffDays: [] });

    const res = await request(app).get('/api/portal/today').set(authHeader(parentToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ date: expect.any(String), isNonWorkingDay: false, reason: null, label: null });
  });

  it("a student's attendance `today` field reflects a same-day mark, and null status when unmarked", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, section, guardianPortalLogin } = await setupFamily(accessToken);
    const parentToken = await loginAs(guardianPortalLogin!.email, guardianPortalLogin!.tempPassword, tenant.slug);

    await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(accessToken))
      .send({ weeklyOffDays: [] });

    const beforeMark = await request(app)
      .get(`/api/portal/students/${student.id}/attendance`)
      .set(authHeader(parentToken));
    expect(beforeMark.status).toBe(200);
    expect(beforeMark.body.data.today.isNonWorkingDay).toBe(false);
    expect(beforeMark.body.data.today.status).toBeNull();

    const todayIso = new Date().toISOString().slice(0, 10);
    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(accessToken))
      .send({ sectionId: section.id, date: todayIso, records: [{ studentId: student.id, status: 'LATE' }] });
    expect(mark.status).toBe(200);

    const afterMark = await request(app)
      .get(`/api/portal/students/${student.id}/attendance`)
      .set(authHeader(parentToken));
    expect(afterMark.body.data.today.status).toBe('LATE');
  });
});
