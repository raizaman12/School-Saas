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
 * Same shape as exams.test.ts's setupExamFixture, minus the exam/examSubject
 * setup — a class test hangs directly off a sectionSubject with no exam
 * involved at all. Also provisions a guardian portal login for the student
 * so portal-visibility tests don't need their own separate setup.
 */
async function setupClassTestFixture(accessToken: string, tenant: { id: string; slug: string }) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 5', order: 5 });
  const teacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: 'ctteacher@test-school.test',
    role: 'TEACHER',
  });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Ahmed Khan',
      gender: 'MALE',
      dateOfBirth: '2015-01-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Khan Sahab',
      relationship: 'FATHER',
      phone: '03001234567',
      email: 'khan.sahab@example.com',
      studentId: student.body.data.id,
      isPrimary: true,
    });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Mathematics' });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });

  return {
    year: year.body.data,
    section: section.body.data,
    student: student.body.data,
    guardianPortalLogin: guardian.body.portalLogin as { email: string; tempPassword: string },
    teacher,
    sectionSubject: sectionSubject.body.data,
  };
}

describe('Class test creation', () => {
  it('a TEACHER can self-serve create a class test for their own subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher } = await setupClassTestFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Chapter 3 Quiz', maxMarks: 20, passingMarks: 8 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Chapter 3 Quiz', maxMarks: 20, passingMarks: 8 });
  });

  it('SCHOOL_ADMIN can also create a class test', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupClassTestFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Surprise Test', maxMarks: 10, passingMarks: 4 });
    expect(res.status).toBe(201);
  });

  it('rejects a TEACHER creating a class test for a subject they do not teach', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupClassTestFixture(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'notmyclasstest@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(otherTeacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Sneaky Test', maxMarks: 10, passingMarks: 4 });
    expect(res.status).toBe(403);
  });

  it('rejects passingMarks greater than maxMarks with 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher } = await setupClassTestFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Bad Test', maxMarks: 10, passingMarks: 15 });
    expect(res.status).toBe(400);
  });

  it('lists class tests for a section-subject with an entered-count, newest first', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student } = await setupClassTestFixture(accessToken, tenant);

    const t1 = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Quiz 1', maxMarks: 10, passingMarks: 4 });
    const t2 = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Quiz 2', maxMarks: 10, passingMarks: 4 });
    await request(app)
      .post(`/api/exams/class-tests/${t1.body.data.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 7 }] });

    const list = await request(app)
      .get(`/api/exams/class-tests/for-section-subject/${sectionSubject.id}`)
      .set(authHeader(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].id).toBe(t2.body.data.id); // newest first
    const quiz1 = list.body.data.find((c: { id: string }) => c.id === t1.body.data.id);
    expect(quiz1.marksEnteredCount).toBe(1);
  });
});

describe('Class test marks entry', () => {
  it("shows the whole class roster and lets the teacher enter marks, exceeding maxMarks rejected", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student } = await setupClassTestFixture(accessToken, tenant);

    const test = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Quiz 1', maxMarks: 20, passingMarks: 8 });
    const classTestId = test.body.data.id;

    const rosterBefore = await request(app)
      .get(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken));
    expect(rosterBefore.status).toBe(200);
    expect(rosterBefore.body.data.classTest).toMatchObject({ id: classTestId, name: 'Quiz 1', maxMarks: 20 });
    expect(rosterBefore.body.data.roster).toHaveLength(1);
    expect(rosterBefore.body.data.roster[0]).toMatchObject({ studentId: student.id, marksObtained: null });

    const ok = await request(app)
      .post(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 17 }] });
    expect(ok.status).toBe(200);

    const tooHigh = await request(app)
      .post(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 50 }] });
    expect(tooHigh.status).toBe(400);

    const rosterAfter = await request(app)
      .get(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken));
    expect(rosterAfter.body.data.roster[0].marksObtained).toBe(17);
  });

  it('re-entering marks for the same student UPDATES rather than duplicates', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student } = await setupClassTestFixture(accessToken, tenant);

    const test = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Quiz 1', maxMarks: 20, passingMarks: 8 });
    const classTestId = test.body.data.id;

    await request(app)
      .post(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 10 }] });
    await request(app)
      .post(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 15 }] });

    const roster = await request(app)
      .get(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(teacher.accessToken));
    expect(roster.body.data.roster).toHaveLength(1);
    expect(roster.body.data.roster[0].marksObtained).toBe(15);
  });

  it('rejects a TEACHER entering/reading marks for a class test they did not create and do not teach', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student } = await setupClassTestFixture(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'otherct@test-school.test',
      role: 'TEACHER',
    });

    const test = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Quiz 1', maxMarks: 20, passingMarks: 8 });
    const classTestId = test.body.data.id;

    const readDenied = await request(app)
      .get(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(otherTeacher.accessToken));
    expect(readDenied.status).toBe(403);

    const writeDenied = await request(app)
      .post(`/api/exams/class-tests/${classTestId}/marks`)
      .set(authHeader(otherTeacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 5 }] });
    expect(writeDenied.status).toBe(403);
  });
});

describe('Class tests never count toward the report card or section ranking', () => {
  it("a class test's marks do not appear in the exam report card or affect its totals", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student, section, year } = await setupClassTestFixture(accessToken, tenant);

    // A real formal exam + exam-subject, graded normally.
    const exam = await request(app)
      .post('/api/exams')
      .set(authHeader(accessToken))
      .send({ academicYearId: year.id, name: 'Mid Term' });
    const examSubject = await request(app)
      .post(`/api/exams/${exam.body.data.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, maxMarks: 100, passingMarks: 33 });
    await request(app)
      .post(`/api/exams/subjects/${examSubject.body.data.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    // A class test on the SAME subject, graded very differently (a low
    // score) — if it leaked into the report card it would visibly drag the
    // percentage down.
    const classTest = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Pop Quiz', maxMarks: 10, passingMarks: 4 });
    await request(app)
      .post(`/api/exams/class-tests/${classTest.body.data.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 1 }] });

    const rc = await request(app)
      .get(`/api/exams/${exam.body.data.id}/report-card/${student.id}`)
      .set(authHeader(accessToken));
    expect(rc.body.data.subjects).toHaveLength(1); // just the formal exam subject
    expect(rc.body.data.subjects[0]).toMatchObject({ marksObtained: 87, percentage: 87 });
    expect(rc.body.data.summary).toMatchObject({ totalObtained: 87, totalMax: 100, percentage: 87 });

    const results = await request(app)
      .get(`/api/exams/${exam.body.data.id}/results?sectionId=${section.id}`)
      .set(authHeader(accessToken));
    expect(results.body.data[0]).toMatchObject({ totalObtained: 87, totalMax: 100, percentage: 87 });
  });
});

describe('Class test results on the student/parent portal', () => {
  it("shows a class test's result on the portal course page once marks are entered", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student, guardianPortalLogin } = await setupClassTestFixture(
      accessToken,
      tenant,
    );

    const classTest = await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Pop Quiz', maxMarks: 10, passingMarks: 4 });

    const parentToken = await loginAs(guardianPortalLogin.email, guardianPortalLogin.tempPassword, tenant.slug);

    const beforeMarks = await request(app)
      .get(`/api/portal/students/${student.id}/courses/${sectionSubject.id}/class-tests`)
      .set(authHeader(parentToken));
    expect(beforeMarks.status).toBe(200);
    expect(beforeMarks.body.data).toHaveLength(1);
    expect(beforeMarks.body.data[0]).toMatchObject({ name: 'Pop Quiz', marksObtained: null });

    await request(app)
      .post(`/api/exams/class-tests/${classTest.body.data.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 9 }] });

    const afterMarks = await request(app)
      .get(`/api/portal/students/${student.id}/courses/${sectionSubject.id}/class-tests`)
      .set(authHeader(parentToken));
    expect(afterMarks.body.data[0]).toMatchObject({ name: 'Pop Quiz', marksObtained: 9, maxMarks: 10 });
  });

  it("rejects a parent reading another family's child's class-test results", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher, student } = await setupClassTestFixture(accessToken, tenant);
    await request(app)
      .post('/api/exams/class-tests')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, name: 'Pop Quiz', maxMarks: 10, passingMarks: 4 });

    // A second, unrelated family in a different section.
    const cls2 = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 6', order: 6 });
    const yearRes = await request(app).get('/api/academic-years').set(authHeader(accessToken));
    const section2 = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls2.body.data.id, academicYearId: yearRes.body.data[0].id, name: 'A' });
    const student2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Other Family Kid',
        gender: 'FEMALE',
        dateOfBirth: '2015-06-06',
        sectionId: section2.body.data.id,
        academicYearId: yearRes.body.data[0].id,
      });
    const guardian2 = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Other Guardian',
        relationship: 'MOTHER',
        phone: '03009876543',
        email: 'other.guardian@example.com',
        studentId: student2.body.data.id,
        isPrimary: true,
      });
    const otherParentToken = await loginAs(
      guardian2.body.portalLogin.email,
      guardian2.body.portalLogin.tempPassword,
      tenant.slug,
    );

    const res = await request(app)
      .get(`/api/portal/students/${student.id}/courses/${sectionSubject.id}/class-tests`)
      .set(authHeader(otherParentToken));
    expect(res.status).toBe(403);
  });
});
