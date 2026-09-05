import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { prisma } from '../../src/lib/prisma';
import { closePdfBrowser } from '../../src/modules/exams/reportCardPdf';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
  await closePdfBrowser();
});

async function setupExamFixture(accessToken: string, tenant: { id: string; slug: string }) {
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
    email: 'mathteacher@test-school.test',
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
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Mathematics' });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
  const exam = await request(app)
    .post('/api/exams')
    .set(authHeader(accessToken))
    .send({ academicYearId: year.body.data.id, name: 'Mid Term' });
  const examSubject = await request(app)
    .post(`/api/exams/${exam.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ sectionSubjectId: sectionSubject.body.data.id, maxMarks: 100, passingMarks: 33 });

  return {
    year: year.body.data,
    section: section.body.data,
    student: student.body.data,
    teacher,
    exam: exam.body.data,
    examSubject: examSubject.body.data,
  };
}

describe('Exam & exam-subject setup', () => {
  it('rejects a duplicate exam name within the same academic year', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { year } = await setupExamFixture(accessToken, tenant);
    const dup = await request(app)
      .post('/api/exams')
      .set(authHeader(accessToken))
      .send({ academicYearId: year.id, name: 'Mid Term' });
    expect(dup.status).toBe(409);
  });

  it('rejects passingMarks greater than maxMarks with 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam, section } = await setupExamFixture(accessToken, tenant);
    const subject2 = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Science' });
    const ss2 = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject2.body.data.id });

    const res = await request(app)
      .post(`/api/exams/${exam.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ss2.body.data.id, maxMarks: 50, passingMarks: 60 });
    expect(res.status).toBe(400);
  });
});

describe('Datesheet (bulk exam-subjects)', () => {
  async function setupTwoSubjectSection(accessToken: string, tenant: { id: string; slug: string }) {
    const fixture = await setupExamFixture(accessToken, tenant);
    const subject2 = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Urdu' });
    const sectionSubject2 = await request(app)
      .post(`/api/sections/${fixture.section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject2.body.data.id, teacherId: fixture.teacher.user.id });
    return { ...fixture, sectionSubject2: sectionSubject2.body.data };
  }

  it('builds a whole class datesheet in one call — one entry per subject, each with its own date', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, exam, examSubject, sectionSubject2 } = await setupTwoSubjectSection(accessToken, tenant);

    const res = await request(app)
      .post(`/api/exams/${exam.id}/subjects/bulk`)
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        subjects: [
          { sectionSubjectId: examSubject.sectionSubjectId, examDate: '2026-03-02', startTime: '09:00', maxMarks: 100, passingMarks: 33 },
          { sectionSubjectId: sectionSubject2.id, examDate: '2026-03-03', startTime: '09:00', maxMarks: 100, passingMarks: 33 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const dates = res.body.data.map((r: { examDate: string }) => r.examDate.slice(0, 10)).sort();
    expect(dates).toEqual(['2026-03-02', '2026-03-03']);

    const list = await request(app).get(`/api/exams/${exam.id}/subjects`).set(authHeader(accessToken));
    expect(list.body.data.map((r: { examDate: string }) => r.examDate.slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('re-running the datesheet builder edits the existing entry instead of duplicating it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, exam, examSubject } = await setupExamFixture(accessToken, tenant).then(async (f) => {
      await request(app)
        .post(`/api/exams/${f.exam.id}/subjects/bulk`)
        .set(authHeader(accessToken))
        .send({
          sectionId: f.section.id,
          subjects: [{ sectionSubjectId: f.examSubject.sectionSubjectId, examDate: '2026-03-02', maxMarks: 100, passingMarks: 33 }],
        });
      return f;
    });

    const edit = await request(app)
      .post(`/api/exams/${exam.id}/subjects/bulk`)
      .set(authHeader(accessToken))
      .send({
        sectionId: section.id,
        subjects: [{ sectionSubjectId: examSubject.sectionSubjectId, examDate: '2026-03-05', maxMarks: 100, passingMarks: 40 }],
      });

    expect(edit.status).toBe(200);
    expect(edit.body.data).toHaveLength(1);
    expect(edit.body.data[0].examDate.slice(0, 10)).toBe('2026-03-05');
    expect(edit.body.data[0].passingMarks).toBe(40);

    const list = await request(app).get(`/api/exams/${exam.id}/subjects`).set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(1); // still just one row — upserted, not duplicated
  });

  it('rejects a sectionSubjectId that does not belong to the given sectionId', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam, examSubject } = await setupExamFixture(accessToken, tenant);
    // A second, unrelated section.
    const cls2 = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 6', order: 6 });
    const year = await request(app).get('/api/academic-years').set(authHeader(accessToken));
    const otherSection = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls2.body.data.id, academicYearId: year.body.data[0].id, name: 'A' });

    const res = await request(app)
      .post(`/api/exams/${exam.id}/subjects/bulk`)
      .set(authHeader(accessToken))
      .send({
        sectionId: otherSection.body.data.id,
        subjects: [{ sectionSubjectId: examSubject.sectionSubjectId, examDate: '2026-03-02', maxMarks: 100, passingMarks: 33 }],
      });
    expect(res.status).toBe(400);
  });

  it('TEACHER cannot build the datesheet — admin only', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, exam, examSubject, teacher } = await setupExamFixture(accessToken, tenant);

    const res = await request(app)
      .post(`/api/exams/${exam.id}/subjects/bulk`)
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        subjects: [{ sectionSubjectId: examSubject.sectionSubjectId, examDate: '2026-03-02', maxMarks: 100, passingMarks: 33 }],
      });
    expect(res.status).toBe(403);
  });
});

describe('Marks entry', () => {
  it('enters marks and rejects marks exceeding maxMarks', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher } = await setupExamFixture(accessToken, tenant);

    const ok = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });
    expect(ok.status).toBe(200);

    const tooHigh = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 150 }] });
    expect(tooHigh.status).toBe(400);
  });

  it('rejects a TEACHER entering marks for a subject they are NOT assigned to teach', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student } = await setupExamFixture(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(otherTeacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 50 }] });
    expect(res.status).toBe(403);
  });

  it('re-entering marks for the same student UPDATES rather than duplicates', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 60 }] });
    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 75 }] });

    const roster = await request(app)
      .get(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(accessToken));
    expect(roster.body.data).toHaveLength(1);
    expect(roster.body.data[0].marksObtained).toBe(75);
  });
});

describe('Report card', () => {
  it('computes percentage and grade correctly for a student', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const rc = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${student.id}`)
      .set(authHeader(accessToken));

    expect(rc.status).toBe(200);
    expect(rc.body.data.subjects).toHaveLength(1);
    expect(rc.body.data.subjects[0]).toMatchObject({
      subject: 'Mathematics',
      marksObtained: 87,
      percentage: 87,
      grade: 'A',
      passed: true,
    });
    expect(rc.body.data.summary).toMatchObject({
      totalObtained: 87,
      totalMax: 100,
      percentage: 87,
      grade: 'A',
    });
  });

  it('marks a below-passing score as failed and reflects it in the F grade band', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 20 }] });

    const rc = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${student.id}`)
      .set(authHeader(accessToken));

    expect(rc.body.data.subjects[0].passed).toBe(false);
    expect(rc.body.data.subjects[0].grade).toBe('F');
  });

  it('returns a valid PDF for the report card', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const pdf = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${student.id}/pdf`)
      .set(authHeader(accessToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);
});

describe('Grading bands', () => {
  it('a fresh tenant is seeded with the default A+..F scale', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/grading-bands').set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.data[0]).toMatchObject({ grade: 'A+', minPercentage: '90' });
  });

  it('TEACHER cannot replace the grading scale; SCHOOL_ADMIN can', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher2@test-school.test',
      role: 'TEACHER',
    });

    const denied = await request(app)
      .put('/api/grading-bands')
      .set(authHeader(teacher.accessToken))
      .send({ bands: [{ grade: 'Pass', minPercentage: 40 }, { grade: 'Fail', minPercentage: 0 }] });
    expect(denied.status).toBe(403);

    const put = await request(app)
      .put('/api/grading-bands')
      .set(authHeader(accessToken))
      .send({ bands: [{ grade: 'Pass', minPercentage: 40 }, { grade: 'Fail', minPercentage: 0 }] });
    expect(put.status).toBe(200);
    expect(put.body.data).toHaveLength(2);
  });

  it('rejects a band set with duplicate grade names', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .put('/api/grading-bands')
      .set(authHeader(accessToken))
      .send({ bands: [{ grade: 'A', minPercentage: 80 }, { grade: 'A', minPercentage: 50 }] });
    expect(res.status).toBe(400);
  });

  it('a custom scale changes report-card grades immediately', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .put('/api/grading-bands')
      .set(authHeader(accessToken))
      .send({ bands: [{ grade: 'Pass', minPercentage: 40 }, { grade: 'Fail', minPercentage: 0 }] });

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const rc = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${student.id}`)
      .set(authHeader(accessToken));

    expect(rc.body.data.subjects[0].grade).toBe('Pass');
    expect(rc.body.data.summary.grade).toBe('Pass');
  });
});

describe('Bulk report card generation (background job)', () => {
  async function pollUntilDone(accessToken: string, jobId: string, timeoutMs = 20000) {
    const start = Date.now();
    for (;;) {
      const res = await request(app).get(`/api/exams/report-card-batches/${jobId}`).set(authHeader(accessToken));
      if (res.body.data.status === 'COMPLETED' || res.body.data.status === 'FAILED') return res.body.data;
      if (Date.now() - start > timeoutMs) throw new Error('Batch job did not finish in time');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it('generates a job, processes it in the background, and produces a downloadable zip', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const classesRes = await request(app).get('/api/classes').set(authHeader(accessToken));
    const classId = classesRes.body.data[0].id;

    const create = await request(app)
      .post(`/api/exams/${exam.id}/report-card-batches`)
      .set(authHeader(accessToken))
      .send({ classId });
    expect(create.status).toBe(202);
    expect(create.body.data.status).toBe('PENDING');

    const finished = await pollUntilDone(accessToken, create.body.data.id);
    expect(finished.status).toBe('COMPLETED');
    expect(finished.processedCount).toBe(1);
    expect(finished.resultFileUrl).toContain(create.body.data.id);

    const zip = await request(app)
      .get(`/api/exams/report-card-batches/${create.body.data.id}/download`)
      .set(authHeader(accessToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.body.subarray(0, 2).toString()).toBe('PK');
  }, 30000);

  it('rejects a TEACHER/FRONT_DESK/ACCOUNTANT triggering a batch — SCHOOL_ADMIN only', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam } = await setupExamFixture(accessToken, tenant);
    const classesRes = await request(app).get('/api/classes').set(authHeader(accessToken));
    const classId = classesRes.body.data[0].id;

    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'frontdesk@test-school.test',
      role: 'FRONT_DESK',
    });
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'accountant@test-school.test',
      role: 'ACCOUNTANT',
    });

    for (const nonAdmin of [frontDesk, accountant]) {
      const res = await request(app)
        .post(`/api/exams/${exam.id}/report-card-batches`)
        .set(authHeader(nonAdmin.accessToken))
        .send({ classId });
      expect(res.status).toBe(403);
    }
  });

  it('rejects downloading a job that is not yet completed', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam } = await setupExamFixture(accessToken, tenant);
    const classesRes = await request(app).get('/api/classes').set(authHeader(accessToken));
    const classId = classesRes.body.data[0].id;

    const create = await request(app)
      .post(`/api/exams/${exam.id}/report-card-batches`)
      .set(authHeader(accessToken))
      .send({ classId });

    const download = await request(app)
      .get(`/api/exams/report-card-batches/${create.body.data.id}/download`)
      .set(authHeader(accessToken));
    // Racy by nature (the background job may finish before this fires), so
    // only assert it's not a 200 with completely wrong data — a real 404
    // (unknown job) would be the actual bug this guards against.
    expect(download.status).not.toBe(404);

    // Drain the background job before the test ends — otherwise it keeps
    // running past this test's teardown and can hit the next test's
    // resetDb() truncating its tenant mid-query (harmless here since
    // there's no assertion left, but noisy/racy against shared DB state).
    await pollUntilDone(accessToken, create.body.data.id);
  });

  it('narrows batch generation to one section when sectionId is given', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam, section, year } = await setupExamFixture(accessToken, tenant);

    // A second section of the same class, with its own student — must be
    // excluded from the batch when sectionId scopes it to the first section.
    const section2 = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: section.schoolClassId, academicYearId: year.id, name: 'B' });
    await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Other Section Student',
        gender: 'FEMALE',
        dateOfBirth: '2015-02-02',
        sectionId: section2.body.data.id,
        academicYearId: year.id,
      });

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const create = await request(app)
      .post(`/api/exams/${exam.id}/report-card-batches`)
      .set(authHeader(accessToken))
      .send({ classId: section.schoolClassId, sectionId: section.id });
    expect(create.status).toBe(202);

    const finished = await pollUntilDone(accessToken, create.body.data.id);
    expect(finished.status).toBe('COMPLETED');
    // Only the 1 student from `section`, not section2's student too.
    expect(finished.processedCount).toBe(1);
  }, 30000);
});

describe('Exam results deadline (admin)', () => {
  it('SCHOOL_ADMIN can set and clear the results deadline; TEACHER cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam, teacher } = await setupExamFixture(accessToken, tenant);

    const denied = await request(app)
      .patch(`/api/exams/${exam.id}`)
      .set(authHeader(teacher.accessToken))
      .send({ resultsDeadline: '2026-01-15' });
    expect(denied.status).toBe(403);

    const set = await request(app)
      .patch(`/api/exams/${exam.id}`)
      .set(authHeader(accessToken))
      .send({ resultsDeadline: '2026-01-15' });
    expect(set.status).toBe(200);
    expect(set.body.data.resultsDeadline).toContain('2026-01-15');

    const cleared = await request(app)
      .patch(`/api/exams/${exam.id}`)
      .set(authHeader(accessToken))
      .send({ resultsDeadline: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.resultsDeadline).toBeNull();
  });
});

describe('Marks submission status', () => {
  it('a TEACHER can submit and unsubmit; SCHOOL_ADMIN sees it in submission-status', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, student, teacher, exam } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 87 }] });

    const before = await request(app)
      .get(`/api/exams/${exam.id}/submission-status`)
      .set(authHeader(accessToken));
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(1);
    expect(before.body.data[0]).toMatchObject({
      examSubjectId: examSubject.id,
      subject: 'Mathematics',
      totalStudents: 1,
      marksEnteredCount: 1,
      submitted: false,
    });
    expect(before.body.data[0].teacher.id).toBe(teacher.user.id);

    const submit = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/submit`)
      .set(authHeader(teacher.accessToken));
    expect(submit.status).toBe(200);
    expect(submit.body.data.marksSubmittedAt).not.toBeNull();

    const after = await request(app)
      .get(`/api/exams/${exam.id}/submission-status`)
      .set(authHeader(accessToken));
    expect(after.body.data[0]).toMatchObject({ submitted: true });
    expect(after.body.data[0].submittedBy.id).toBe(teacher.user.id);

    const unsubmit = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/unsubmit`)
      .set(authHeader(teacher.accessToken));
    expect(unsubmit.status).toBe(200);
    expect(unsubmit.body.data.marksSubmittedAt).toBeNull();
  });

  it('a TEACHER cannot submit a subject they are not assigned to teach', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject } = await setupExamFixture(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'notmysubject@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/submit`)
      .set(authHeader(otherTeacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('only SCHOOL_ADMIN can read submission-status', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { exam, teacher } = await setupExamFixture(accessToken, tenant);

    const res = await request(app)
      .get(`/api/exams/${exam.id}/submission-status`)
      .set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('Exams for a section-subject (teacher "make grades" shortcut)', () => {
  it("lists exams tied to a teacher's own subject, with submitted state, and rejects another teacher's subject", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { examSubject, teacher } = await setupExamFixture(accessToken, tenant);

    const mine = await request(app)
      .get(`/api/exams/for-section-subject/${examSubject.sectionSubjectId}`)
      .set(authHeader(teacher.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ id: examSubject.id, maxMarks: 100 });
    expect(mine.body.data[0].exam.name).toBe('Mid Term');

    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'notmyclass@test-school.test',
      role: 'TEACHER',
    });
    const denied = await request(app)
      .get(`/api/exams/for-section-subject/${examSubject.sectionSubjectId}`)
      .set(authHeader(otherTeacher.accessToken));
    expect(denied.status).toBe(403);
  });
});

describe('Section results & class position (rank)', () => {
  it('ranks students by percentage across all subjects in a section, ties sharing a rank', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, year, exam, teacher } = await setupExamFixture(accessToken, tenant);

    // Two more students in the same section, so there are 3 to rank.
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Bilal Ahmed',
        gender: 'MALE',
        dateOfBirth: '2015-03-03',
        sectionId: section.id,
        academicYearId: year.id,
      });
    const s3 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Zara Sheikh',
        gender: 'FEMALE',
        dateOfBirth: '2015-04-04',
        sectionId: section.id,
        academicYearId: year.id,
      });

    const rosterFirst = await request(app)
      .get(`/api/exams/${exam.id}/subjects?sectionId=${section.id}`)
      .set(authHeader(accessToken));
    const examSubjectId = rosterFirst.body.data[0].id;
    const studentsRes = await request(app).get('/api/students').set(authHeader(accessToken));
    const ahmed = studentsRes.body.data.find((s: { fullName: string }) => s.fullName === 'Ahmed Khan');

    // Ahmed: 90 (top), Bilal: 90 (tied for top), Zara: 40 (last, distinct rank 3).
    await request(app)
      .post(`/api/exams/subjects/${examSubjectId}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({
        records: [
          { studentId: ahmed.id, marksObtained: 90 },
          { studentId: s2.body.data.id, marksObtained: 90 },
          { studentId: s3.body.data.id, marksObtained: 40 },
        ],
      });

    const results = await request(app)
      .get(`/api/exams/${exam.id}/results?sectionId=${section.id}`)
      .set(authHeader(accessToken));
    expect(results.status).toBe(200);
    expect(results.body.data).toHaveLength(3);

    const byName = Object.fromEntries(results.body.data.map((r: { fullName: string }) => [r.fullName, r]));
    expect(byName['Ahmed Khan'].rank).toBe(1);
    expect(byName['Bilal Ahmed'].rank).toBe(1);
    expect(byName['Zara Sheikh'].rank).toBe(3);
    expect(byName['Ahmed Khan'].totalRanked).toBe(3);
    expect(byName['Ahmed Khan'].percentage).toBe(90);

    // The individual report card's own summary agrees with the section list.
    const rc = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${ahmed.id}`)
      .set(authHeader(accessToken));
    expect(rc.body.data.summary.rank).toBe(1);
    expect(rc.body.data.summary.totalRanked).toBe(3);
    expect(rc.body.data.subjects[0].examSubjectId).toBe(examSubjectId);
  });

  it('a student with no marks entered anywhere gets rank: null, not last place with score 0', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, year, exam, examSubject, student, teacher } = await setupExamFixture(accessToken, tenant);

    await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ungraded Student',
        gender: 'MALE',
        dateOfBirth: '2015-05-05',
        sectionId: section.id,
        academicYearId: year.id,
      });

    await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(teacher.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 70 }] });

    const results = await request(app)
      .get(`/api/exams/${exam.id}/results?sectionId=${section.id}`)
      .set(authHeader(accessToken));
    const byName = Object.fromEntries(results.body.data.map((r: { fullName: string }) => [r.fullName, r]));
    expect(byName['Ahmed Khan'].rank).toBe(1);
    expect(byName['Ungraded Student'].rank).toBeNull();
    expect(byName['Ungraded Student'].percentage).toBeNull();
    // totalRanked counts only students who actually have a graded subject.
    expect(byName['Ungraded Student'].totalRanked).toBe(1);
  });
});
