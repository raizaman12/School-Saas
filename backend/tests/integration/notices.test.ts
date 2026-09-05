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

async function setupSection(accessToken: string, tenant: { id: string; slug: string }, classTeacherEmail?: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 5', order: 5 });

  let classTeacher: Awaited<ReturnType<typeof createAndLoginUser>> | undefined;
  if (classTeacherEmail) {
    classTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: classTeacherEmail,
      role: 'TEACHER',
    });
  }

  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({
      schoolClassId: cls.body.data.id,
      academicYearId: year.body.data.id,
      name: 'A',
      ...(classTeacher ? { classTeacherId: classTeacher.user.id } : {}),
    });

  return { section: section.body.data, classTeacher };
}

/** Creates a class + section under an *already-created* academic year (unlike `setupSection`, which always mints its own year — use this when a test needs to create the year itself, e.g. to create more than one section under it). */
async function createSectionForYear(
  accessToken: string,
  yearId: string,
  opts: { className: string; order: number; sectionName?: string; classTeacherId?: string },
) {
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: opts.className, order: opts.order });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({
      schoolClassId: cls.body.data.id,
      academicYearId: yearId,
      name: opts.sectionName ?? 'A',
      ...(opts.classTeacherId ? { classTeacherId: opts.classTeacherId } : {}),
    });
  return section.body.data;
}

function noticePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: 'PTM this Friday',
    body: 'Parent-teacher meeting will be held this Friday at 3pm.',
    audiences: ['ALL_GUARDIANS'],
    ...overrides,
  };
}

describe('Notices', () => {
  it('SCHOOL_ADMIN publishes a school-wide notice', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app).post('/api/notices').set(authHeader(accessToken)).send(noticePayload());

    expect(res.status).toBe(201);
    expect(res.body.data.audiences).toEqual(['ALL_GUARDIANS']);
    expect(res.body.data.tone).toBe('GENERAL');
    expect(res.body.data.publishedByUser).toBeTruthy();
  });

  it('rejects a SECTION notice without a sectionId (400)', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['SECTION'] }));

    expect(res.status).toBe(400);
  });

  it('rejects a non-SECTION notice that includes a sectionId (400)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setupSection(accessToken, tenant);

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['ALL_STAFF'], sectionId: section.id }));

    expect(res.status).toBe(400);
  });

  it('a TEACHER cannot publish a school-wide notice (403)', async () => {
    const { tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(teacher.accessToken))
      .send(noticePayload({ audiences: ['ALL_STAFF'] }));

    expect(res.status).toBe(403);
  });

  it("the section's class teacher can publish a SECTION notice; a teacher with no connection to it cannot", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, classTeacher } = await setupSection(accessToken, tenant, 'homeroom@test-school.test');
    const unrelatedTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'unrelated-teacher@test-school.test',
      role: 'TEACHER',
    });

    const forbidden = await request(app)
      .post('/api/notices')
      .set(authHeader(unrelatedTeacher.accessToken))
      .send(noticePayload({ audiences: ['SECTION'], sectionId: section.id, title: 'Field trip reminder' }));
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher!.accessToken))
      .send(noticePayload({ audiences: ['SECTION'], sectionId: section.id, title: 'Field trip reminder' }));
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.section.id).toBe(section.id);
  });

  // Regression coverage for the course-card portal feature (see
  // portal.ts's GET .../courses/:sectionSubjectId/announcements): a
  // section has ONE class/homeroom teacher but usually SEVERAL subject
  // teachers, and each of them needs to be able to post a SECTION notice
  // for the class they actually teach — not just the homeroom teacher.
  it('a subject teacher (not the class teacher) can also publish a SECTION notice for a section they teach', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setupSection(accessToken, tenant, 'homeroom2@test-school.test');
    const subjectTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'math-teacher@test-school.test',
      role: 'TEACHER',
    });
    const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
    await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: subjectTeacher.user.id });

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(subjectTeacher.accessToken))
      .send(noticePayload({ audiences: ['SECTION'], sectionId: section.id, title: 'Math quiz next week' }));
    expect(res.status).toBe(201);
    expect(res.body.data.publishedByUser.id).toBe(subjectTeacher.user.id);
  });

  it('pinned notices sort first, then most recently published', async () => {
    const { accessToken } = await signupSchool(app);
    await request(app).post('/api/notices').set(authHeader(accessToken)).send(noticePayload({ title: 'First' }));
    await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ title: 'Pinned', isPinned: true }));
    await request(app).post('/api/notices').set(authHeader(accessToken)).send(noticePayload({ title: 'Second' }));

    const list = await request(app).get('/api/notices').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data[0].title).toBe('Pinned');
    expect(list.body.data[1].title).toBe('Second');
  });

  it('FRONT_DESK can list but not publish notices', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await request(app).post('/api/notices').set(authHeader(accessToken)).send(noticePayload());
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const list = await request(app).get('/api/notices').set(authHeader(frontDesk.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(frontDesk.accessToken))
      .send(noticePayload());
    expect(create.status).toBe(403);
  });

  it('the publishing TEACHER can edit/delete their own SECTION notice; others cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, classTeacher } = await setupSection(accessToken, tenant, 'homeroom@test-school.test');
    const created = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher!.accessToken))
      .send(noticePayload({ audiences: ['SECTION'], sectionId: section.id }));

    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other-teacher@test-school.test',
      role: 'TEACHER',
    });

    const forbiddenEdit = await request(app)
      .patch(`/api/notices/${created.body.data.id}`)
      .set(authHeader(otherTeacher.accessToken))
      .send({ title: 'Hijacked' });
    expect(forbiddenEdit.status).toBe(403);

    const ownEdit = await request(app)
      .patch(`/api/notices/${created.body.data.id}`)
      .set(authHeader(classTeacher!.accessToken))
      .send({ isPinned: true });
    expect(ownEdit.status).toBe(200);
    expect(ownEdit.body.data.isPinned).toBe(true);

    // SCHOOL_ADMIN can delete anyone's notice.
    const del = await request(app)
      .delete(`/api/notices/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(del.status).toBe(204);
  });

  it('cannot access another tenant notice (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });

    const created = await request(app).post('/api/notices').set(authHeader(schoolA.accessToken)).send(noticePayload());

    const patch = await request(app)
      .patch(`/api/notices/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken))
      .send({ title: 'Nope' });
    expect(patch.status).toBe(404);

    const del = await request(app)
      .delete(`/api/notices/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken));
    expect(del.status).toBe(404);
  });
});

describe('Combined audiences & tone', () => {
  it('SCHOOL_ADMIN publishes one notice to ALL_STUDENTS + ALL_GUARDIANS at once; both students and guardians see it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const yearRes = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const section = await createSectionForYear(accessToken, yearRes.body.data.id, { className: 'Class 5', order: 5 });
    const family = await addFamilyWithLogins(accessToken, { year: yearRes.body.data, section });

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['ALL_STUDENTS', 'ALL_GUARDIANS'], title: 'School closed Monday' }));
    expect(create.status).toBe(201);
    expect(create.body.data.audiences.sort()).toEqual(['ALL_GUARDIANS', 'ALL_STUDENTS']);

    const studentToken = await loginAs(
      family.studentPortalLogin.email,
      family.studentPortalLogin.tempPassword,
      tenant.slug,
    );
    const studentInbox = await request(app).get('/api/portal/notices').set(authHeader(studentToken));
    expect(studentInbox.body.data.map((n: { title: string }) => n.title)).toContain('School closed Monday');

    const parentToken = await loginAs(
      family.guardianPortalLogin.email,
      family.guardianPortalLogin.tempPassword,
      tenant.slug,
    );
    const parentInbox = await request(app).get('/api/portal/notices').set(authHeader(parentToken));
    expect(parentInbox.body.data.map((n: { title: string }) => n.title)).toContain('School closed Monday');
  });

  it('rejects combining a broad audience with SECTION when published by a non-admin TEACHER (403), but SCHOOL_ADMIN may combine SECTION + INDIVIDUAL freely', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, classTeacher } = await setupSection(accessToken, tenant, 'homeroom@test-school.test');
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'target-teacher@test-school.test',
      role: 'TEACHER',
    });

    // A TEACHER combining their own SECTION with a school-wide audience is still forbidden.
    const forbidden = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher!.accessToken))
      .send(noticePayload({ audiences: ['SECTION', 'ALL_STAFF'], sectionId: section.id }));
    expect(forbidden.status).toBe(403);

    // SCHOOL_ADMIN combining SECTION + INDIVIDUAL (an extra staff add-on) in one notice is fine.
    const combined = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(
        noticePayload({
          audiences: ['SECTION', 'INDIVIDUAL'],
          sectionId: section.id,
          recipientStaffUserIds: [teacher.user.id],
        }),
      );
    expect(combined.status).toBe(201);
    expect(combined.body.data.recipients).toHaveLength(1);
  });

  it('a notice combining INDIVIDUAL with a broad audience is NOT treated as individual-only-private (a bystander with that broad role can still see it)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const bystanderTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'bystander@test-school.test',
      role: 'TEACHER',
    });
    const targetTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'target@test-school.test',
      role: 'TEACHER',
    });

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(
        noticePayload({
          audiences: ['ALL_STAFF', 'INDIVIDUAL'],
          title: 'Staff meeting + a private note for one teacher',
          recipientStaffUserIds: [targetTeacher.user.id],
        }),
      );
    expect(create.status).toBe(201);
    expect(create.body.data.recipients).toHaveLength(1);

    // The bystander isn't a named recipient, but ALL_STAFF is one of this
    // notice's audiences, so they still see it via that broad audience.
    const bystanderList = await request(app).get('/api/notices').set(authHeader(bystanderTeacher.accessToken));
    expect(bystanderList.body.data.map((n: { title: string }) => n.title)).toContain(
      'Staff meeting + a private note for one teacher',
    );
  });

  it('sets and updates the tone of a notice', async () => {
    const { accessToken } = await signupSchool(app);

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ tone: 'URGENT' }));
    expect(create.status).toBe(201);
    expect(create.body.data.tone).toBe('URGENT');

    const patch = await request(app)
      .patch(`/api/notices/${create.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ tone: 'EVENT' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.tone).toBe('EVENT');
  });

  it('rejects an empty audiences array (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: [] }));
    expect(res.status).toBe(400);
  });
});

async function loginAs(email: string, password: string, slug: string) {
  const res = await request(app).post('/api/auth/login').send({ slug, email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

/** Admits a student (with a portal login) and links a guardian (with a portal login) in one call. */
async function addFamilyWithLogins(
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
      email: (overrides.studentEmail as string) ?? 'hassan.iqbal@example.com',
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: (overrides.guardianFullName as string) ?? 'Iqbal Hussain',
      relationship: 'FATHER',
      phone: '03001234567',
      email: (overrides.guardianEmail as string) ?? 'iqbal.hussain@example.com',
      studentId: student.body.data.id,
      isPrimary: true,
    });

  return {
    student: student.body.data,
    studentPortalLogin: student.body.portalLogin as { email: string; tempPassword: string },
    guardian: guardian.body.data,
    guardianPortalLogin: guardian.body.portalLogin as { email: string; tempPassword: string },
  };
}

describe('ALL_STUDENTS audience', () => {
  it('SCHOOL_ADMIN publishes an ALL_STUDENTS notice, visible on the student portal', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setupSection(accessToken, tenant);
    const years = await request(app).get('/api/academic-years').set(authHeader(accessToken));
    const { studentPortalLogin } = await addFamilyWithLogins(accessToken, { year: years.body.data[0], section });

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['ALL_STUDENTS'], title: 'Sports day' }));
    expect(create.status).toBe(201);

    const studentToken = await loginAs(studentPortalLogin.email, studentPortalLogin.tempPassword, tenant.slug);
    const portalList = await request(app).get('/api/portal/notices').set(authHeader(studentToken));
    expect(portalList.status).toBe(200);
    expect(portalList.body.data.map((n: { title: string }) => n.title)).toContain('Sports day');
  });

  it('a TEACHER cannot publish an ALL_STUDENTS notice (403)', async () => {
    const { tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(teacher.accessToken))
      .send(noticePayload({ audiences: ['ALL_STUDENTS'] }));
    expect(res.status).toBe(403);
  });
});

describe('INDIVIDUAL audience — targeting one or more specific people', () => {
  it('rejects an INDIVIDUAL notice with no recipients (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['INDIVIDUAL'] }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-INDIVIDUAL notice that includes recipients (400)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['ALL_STAFF'], recipientStaffUserIds: [teacher.user.id] }));
    expect(res.status).toBe(400);
  });

  it('SCHOOL_ADMIN sends an INDIVIDUAL notice to a specific student + guardian; both see it, an unrelated family does not', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const yearRes = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const section = await createSectionForYear(accessToken, yearRes.body.data.id, { className: 'Class 5', order: 5 });
    const family = await addFamilyWithLogins(accessToken, { year: yearRes.body.data, section });
    const otherFamily = await addFamilyWithLogins(
      accessToken,
      { year: yearRes.body.data, section },
      {
        studentFullName: 'Bilal Ahmed',
        studentEmail: 'bilal.ahmed@example.com',
        guardianFullName: 'Ahmed Raza',
        guardianEmail: 'ahmed.raza@example.com',
      },
    );

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(
        noticePayload({
          audiences: ['INDIVIDUAL'],
          title: 'Fee reminder for Hassan',
          recipientStudentIds: [family.student.id],
          recipientGuardianIds: [family.guardian.id],
        }),
      );
    expect(create.status).toBe(201);
    expect(create.body.data.recipients).toHaveLength(2);

    const studentToken = await loginAs(
      family.studentPortalLogin.email,
      family.studentPortalLogin.tempPassword,
      tenant.slug,
    );
    const studentInbox = await request(app).get('/api/portal/notices').set(authHeader(studentToken));
    expect(studentInbox.body.data.map((n: { title: string }) => n.title)).toContain('Fee reminder for Hassan');

    const parentToken = await loginAs(
      family.guardianPortalLogin.email,
      family.guardianPortalLogin.tempPassword,
      tenant.slug,
    );
    const parentInbox = await request(app).get('/api/portal/notices').set(authHeader(parentToken));
    expect(parentInbox.body.data.map((n: { title: string }) => n.title)).toContain('Fee reminder for Hassan');

    const otherParentToken = await loginAs(
      otherFamily.guardianPortalLogin.email,
      otherFamily.guardianPortalLogin.tempPassword,
      tenant.slug,
    );
    const otherInbox = await request(app).get('/api/portal/notices').set(authHeader(otherParentToken));
    expect(otherInbox.body.data.map((n: { title: string }) => n.title)).not.toContain('Fee reminder for Hassan');
  });

  it('an INDIVIDUAL notice to one staff member does not leak to another staff member, but SCHOOL_ADMIN and the publisher can see it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const targetTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'target-teacher@test-school.test',
      role: 'TEACHER',
    });
    const bystanderTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'bystander-teacher@test-school.test',
      role: 'TEACHER',
    });

    const create = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(
        noticePayload({
          audiences: ['INDIVIDUAL'],
          title: 'Private note for target teacher',
          recipientStaffUserIds: [targetTeacher.user.id],
        }),
      );
    expect(create.status).toBe(201);

    const adminList = await request(app).get('/api/notices').set(authHeader(accessToken));
    expect(adminList.body.data.map((n: { title: string }) => n.title)).toContain('Private note for target teacher');

    const targetList = await request(app).get('/api/notices').set(authHeader(targetTeacher.accessToken));
    expect(targetList.body.data.map((n: { title: string }) => n.title)).toContain('Private note for target teacher');

    const bystanderList = await request(app).get('/api/notices').set(authHeader(bystanderTeacher.accessToken));
    expect(bystanderList.body.data.map((n: { title: string }) => n.title)).not.toContain(
      'Private note for target teacher',
    );
  });

  it('a TEACHER can send an INDIVIDUAL notice to a student in their own section, but not to a student outside it, and never to staff', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const yearRes = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const classTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'homeroom@test-school.test',
      role: 'TEACHER',
    });
    const section = await createSectionForYear(accessToken, yearRes.body.data.id, {
      className: 'Class 5',
      order: 5,
      classTeacherId: classTeacher.user.id,
    });
    const ownFamily = await addFamilyWithLogins(accessToken, { year: yearRes.body.data, section });

    // A second section this teacher does NOT teach.
    const otherSection = await createSectionForYear(accessToken, yearRes.body.data.id, { className: 'Class 6', order: 6 });
    const outsideFamily = await addFamilyWithLogins(
      accessToken,
      { year: yearRes.body.data, section: otherSection },
      {
        studentFullName: 'Outside Student',
        studentEmail: 'outside.student@example.com',
        guardianFullName: 'Outside Guardian',
        guardianEmail: 'outside.guardian@example.com',
      },
    );

    const allowed = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher.accessToken))
      .send(
        noticePayload({
          audiences: ['INDIVIDUAL'],
          title: 'Homework reminder',
          recipientStudentIds: [ownFamily.student.id],
        }),
      );
    expect(allowed.status).toBe(201);

    const forbiddenOutsideStudent = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher.accessToken))
      .send(
        noticePayload({
          audiences: ['INDIVIDUAL'],
          title: 'Should not send',
          recipientStudentIds: [outsideFamily.student.id],
        }),
      );
    expect(forbiddenOutsideStudent.status).toBe(403);

    const forbiddenStaffTarget = await request(app)
      .post('/api/notices')
      .set(authHeader(classTeacher.accessToken))
      .send(
        noticePayload({
          audiences: ['INDIVIDUAL'],
          title: 'Should not send either',
          recipientStaffUserIds: [classTeacher.user.id],
        }),
      );
    expect(forbiddenStaffTarget.status).toBe(403);
  });

  it('rejects targeting a guardian/student that has no portal login yet (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const yearRes = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const section = await createSectionForYear(accessToken, yearRes.body.data.id, { className: 'Class 5', order: 5 });
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'No Login Student',
        gender: 'MALE',
        dateOfBirth: '2014-06-01',
        sectionId: section.id,
        academicYearId: yearRes.body.data.id,
        // no `email` supplied — an ID-based portal login is still
        // auto-provisioned now (see createStudentLogin's doc comment), so
        // simulate a student who predates that feature below, the only
        // way one now has no login at all.
      });
    await ownerDb.student.update({ where: { id: student.body.data.id }, data: { userId: null } });

    const res = await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send(noticePayload({ audiences: ['INDIVIDUAL'], recipientStudentIds: [student.body.data.id] }));
    expect(res.status).toBe(400);
  });
});
