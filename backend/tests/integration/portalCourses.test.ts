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

/** Section + subject + teacher + one enrolled student with a portal login, all in the current academic year. */
async function setupCourseWithStudent(accessToken: string, tenant: { id: string; slug: string }) {
  // Academic year/class/subject/student-email are all unique per tenant —
  // tag each with a short random id so a test that calls this helper more
  // than once (e.g. to set up two separate, unrelated courses) doesn't
  // collide. AcademicYear.name is capped at 20 chars (see validation.ts),
  // so the tag has to stay short.
  const tag = Math.random().toString(36).slice(2, 8);
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: `Yr-${tag}`, startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: `Class 5 (${tag})`, order: 5 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const teacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: `teacher-${tag}@test-school.test`,
    role: 'TEACHER',
  });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: `Mathematics (${tag})` });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });

  const studentEmail = `sana.student-${tag}@test-school.test`;
  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Sana Malik',
      gender: 'FEMALE',
      dateOfBirth: '2015-04-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
      email: studentEmail,
    });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ slug: tenant.slug, email: studentEmail, password: student.body.portalLogin.tempPassword });

  return {
    year: year.body.data,
    section: section.body.data,
    subject: subject.body.data,
    teacher,
    sectionSubject: sectionSubject.body.data,
    student: student.body.data,
    studentAccessToken: login.body.accessToken as string,
  };
}

describe('Portal — course cards (GET /students/:id/courses)', () => {
  it("lists the student's current-section courses with subject and teacher", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(ctx.sectionSubject.id);
    expect(res.body.data[0].subject.name).toBe(ctx.subject.name);
    expect(res.body.data[0].teacher.id).toBe(ctx.teacher.user.id);
  });

  it('an unenrolled (no currentSectionId) student sees an empty course list, not an error', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'No Section Yet',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'nosection@test-school.test',
      });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'nosection@test-school.test', password: student.body.portalLogin.tempPassword });

    const res = await request(app)
      .get(`/api/portal/students/${student.body.data.id}/courses`)
      .set(authHeader(login.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("a different student cannot list another student's courses (403)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    const other = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bystander', gender: 'MALE', dateOfBirth: '2015-01-01', email: 'bystander@test-school.test' });
    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'bystander@test-school.test', password: other.body.portalLogin.tempPassword });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses`)
      .set(authHeader(otherLogin.body.accessToken));
    expect(res.status).toBe(403);
  });
});

// Real gap this covers: the portal had no view of the student's actual
// WEEK — which lecture is when, with which teacher, in which room — the
// way a real printed school timetable lays it out. Reuses
// setupCourseWithStudent's single section-subject; a dedicated timetable
// slot is added per test since the shared helper doesn't create one.
describe('Portal — weekly timetable (GET /students/:id/timetable)', () => {
  it("shows the student's current-section timetable slots with subject, teacher, and room", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({
        sectionSubjectId: ctx.sectionSubject.id,
        dayOfWeek: 'MONDAY',
        startTime: '08:00',
        endTime: '08:45',
        roomNumber: 'C9',
      });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/timetable`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].dayOfWeek).toBe('MONDAY');
    expect(res.body.data[0].roomNumber).toBe('C9');
    expect(res.body.data[0].sectionSubject.subject.name).toBe(ctx.subject.name);
    expect(res.body.data[0].sectionSubject.teacher.id).toBe(ctx.teacher.user.id);
    expect(res.body.data[0].sectionSubject.section.id).toBe(ctx.section.id);
  });

  it('an unenrolled (no currentSectionId) student sees an empty timetable, not an error', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Section Yet', gender: 'MALE', dateOfBirth: '2015-01-01', email: 'nosection-tt@test-school.test' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'nosection-tt@test-school.test', password: student.body.portalLogin.tempPassword });

    const res = await request(app)
      .get(`/api/portal/students/${student.body.data.id}/timetable`)
      .set(authHeader(login.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("a different student cannot view another student's timetable (403)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    const other = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bystander TT', gender: 'MALE', dateOfBirth: '2015-01-01', email: 'bystander-tt@test-school.test' });
    const otherLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'bystander-tt@test-school.test', password: other.body.portalLogin.tempPassword });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/timetable`)
      .set(authHeader(otherLogin.body.accessToken));
    expect(res.status).toBe(403);
  });

  it('a PARENT sees their own child\'s timetable', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ctx.sectionSubject.id, dayOfWeek: 'TUESDAY', startTime: '09:00', endTime: '09:45' });

    const guardianRes = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Iqbal Hussain',
        relationship: 'FATHER',
        phone: '03001234567',
        email: 'parent-tt@test-school.test',
        studentId: ctx.student.id,
        isPrimary: true,
      });
    const guardianLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'parent-tt@test-school.test', password: guardianRes.body.portalLogin.tempPassword });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/timetable`)
      .set(authHeader(guardianLogin.body.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].dayOfWeek).toBe('TUESDAY');
  });
});

describe('Portal — per-course Announcement tab', () => {
  it("shows a SECTION notice published by the course's own teacher", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    await request(app)
      .post('/api/notices')
      .set(authHeader(ctx.teacher.accessToken))
      .send({
        title: 'Math quiz next week',
        body: 'Bring your calculators.',
        audiences: ['SECTION'],
        sectionId: ctx.section.id,
      });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/announcements`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Math quiz next week');
  });

  it("does NOT show a SECTION notice from a DIFFERENT teacher of the same section", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    // A second subject in the same section, taught by a different teacher.
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other-subj-teacher@test-school.test',
      role: 'TEACHER',
    });
    const otherSubject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Urdu' });
    await request(app)
      .post(`/api/sections/${ctx.section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: otherSubject.body.data.id, teacherId: otherTeacher.user.id });

    await request(app)
      .post('/api/notices')
      .set(authHeader(otherTeacher.accessToken))
      .send({ title: 'Urdu homework reminder', body: 'Complete page 10.', audiences: ['SECTION'], sectionId: ctx.section.id });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/announcements`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('does NOT show a school-wide ALL_STUDENTS notice on a course tab', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    await request(app)
      .post('/api/notices')
      .set(authHeader(accessToken))
      .send({ title: 'School closed Friday', body: 'Public holiday.', audiences: ['ALL_STUDENTS'] });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/announcements`)
      .set(authHeader(ctx.studentAccessToken));
    expect(res.body.data).toHaveLength(0);
  });
});

describe('Portal — per-course Course Material tab', () => {
  it('shows material uploaded for this section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    await request(app)
      .post('/api/course-materials')
      .set(authHeader(ctx.teacher.accessToken))
      .send({ sectionSubjectId: ctx.sectionSubject.id, title: 'Chapter 3 slides', fileUrl: 'https://example.test/a.pdf' });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/materials`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Chapter 3 slides');
  });
});

describe('Portal — per-course Assessment tab', () => {
  it('shows homework assigned for this section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    await request(app)
      .post('/api/homework')
      .set(authHeader(ctx.teacher.accessToken))
      .send({ sectionId: ctx.section.id, subjectId: ctx.subject.id, title: 'Exercise 4', dueDate: '2026-03-01' });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/homework`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Exercise 4');
  });
});

describe('Portal — per-course View Grades tab', () => {
  it('shows this exam-subject\'s marks for the student, across exams', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);

    const exam = await request(app)
      .post('/api/exams')
      .set(authHeader(accessToken))
      .send({ academicYearId: ctx.year.id, name: 'Mid Term', startDate: '2025-10-01', endDate: '2025-10-10' });
    const examSubject = await request(app)
      .post(`/api/exams/${exam.body.data.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ctx.sectionSubject.id, maxMarks: 100, passingMarks: 40 });
    await request(app)
      .post(`/api/exams/subjects/${examSubject.body.data.id}/marks`)
      .set(authHeader(ctx.teacher.accessToken))
      .send({ records: [{ studentId: ctx.student.id, marksObtained: 78 }] });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/grades`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].exam.name).toBe('Mid Term');
    expect(res.body.data[0].marksObtained).toBe(78);
    expect(res.body.data[0].maxMarks).toBe(100);
  });

  it('an exam-subject with no mark entered yet for this student shows marksObtained: null, not an error', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    const exam = await request(app)
      .post('/api/exams')
      .set(authHeader(accessToken))
      .send({ academicYearId: ctx.year.id, name: 'Final Term', startDate: '2026-04-01', endDate: '2026-04-10' });
    await request(app)
      .post(`/api/exams/${exam.body.data.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ctx.sectionSubject.id, maxMarks: 100, passingMarks: 40 });

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${ctx.sectionSubject.id}/grades`)
      .set(authHeader(ctx.studentAccessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].marksObtained).toBeNull();
  });
});

describe('Portal — course-tab access control', () => {
  it('a sectionSubjectId that does not belong to the student\'s current section returns 404, not a leak', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const ctx = await setupCourseWithStudent(accessToken, tenant);
    const otherCourse = await setupCourseWithStudent(accessToken, tenant); // a different section+subject entirely

    const res = await request(app)
      .get(`/api/portal/students/${ctx.student.id}/courses/${otherCourse.sectionSubject.id}/homework`)
      .set(authHeader(ctx.studentAccessToken));
    expect(res.status).toBe(404);
  });

  it("a parent of a DIFFERENT school's family gets 403 on another school's course tabs (cross-tenant)", async () => {
    const schoolA = await signupSchool(app, { slug: 'pc-school-a', adminEmail: 'admin@pc-a.test' });
    const schoolB = await signupSchool(app, { slug: 'pc-school-b', adminEmail: 'admin@pc-b.test' });
    const ctxA = await setupCourseWithStudent(schoolA.accessToken, schoolA.tenant);
    void schoolB;

    const guardianB = await createAndLoginUser(app, {
      tenantId: schoolB.tenant.id,
      slug: schoolB.tenant.slug,
      email: 'unrelated-parent@pc-b.test',
      role: 'PARENT',
    });

    const res = await request(app)
      .get(`/api/portal/students/${ctxA.student.id}/courses`)
      .set(authHeader(guardianB.accessToken));
    expect(res.status).toBe(403);
  });
});
