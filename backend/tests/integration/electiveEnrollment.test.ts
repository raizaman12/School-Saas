import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
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

/**
 * A Grade 11 section with two students who share a core subject
 * (Mathematics, everyone takes it) plus two electives (Biology, Computer
 * Science) that only one of the two students each takes — the classic
 * O/A-Level "shared section, different subject combination" shape.
 */
async function setupElectiveFixture(accessToken: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Grade 11', order: 11 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });

  const studentBio = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Sana Malik',
      gender: 'FEMALE',
      dateOfBirth: '2009-01-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const studentCs = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Bilal Ahmed',
      gender: 'MALE',
      dateOfBirth: '2009-01-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });

  const math = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
  const biology = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Biology' });
  const cs = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Computer Science' });

  const mathSs = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: math.body.data.id });
  const bioSs = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: biology.body.data.id, isElective: true });
  const csSs = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: cs.body.data.id, isElective: true });

  await request(app)
    .put(`/api/section-subjects/${bioSs.body.data.id}/elective-students`)
    .set(authHeader(accessToken))
    .send({ studentIds: [studentBio.body.data.id] });
  await request(app)
    .put(`/api/section-subjects/${csSs.body.data.id}/elective-students`)
    .set(authHeader(accessToken))
    .send({ studentIds: [studentCs.body.data.id] });

  const exam = await request(app)
    .post('/api/exams')
    .set(authHeader(accessToken))
    .send({ academicYearId: year.body.data.id, name: 'Mid Term' });
  const mathExamSubject = await request(app)
    .post(`/api/exams/${exam.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ sectionSubjectId: mathSs.body.data.id, maxMarks: 100, passingMarks: 33 });
  const bioExamSubject = await request(app)
    .post(`/api/exams/${exam.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ sectionSubjectId: bioSs.body.data.id, maxMarks: 100, passingMarks: 33 });
  const csExamSubject = await request(app)
    .post(`/api/exams/${exam.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ sectionSubjectId: csSs.body.data.id, maxMarks: 100, passingMarks: 33 });

  return {
    section: section.body.data,
    studentBio: studentBio.body.data,
    studentCs: studentCs.body.data,
    mathSs: mathSs.body.data,
    bioSs: bioSs.body.data,
    csSs: csSs.body.data,
    exam: exam.body.data,
    mathExamSubject: mathExamSubject.body.data,
    bioExamSubject: bioExamSubject.body.data,
    csExamSubject: csExamSubject.body.data,
  };
}

describe('Elective/subject-combination enrollment', () => {
  it('rejects assigning an elective roster to a subject that is not marked elective', async () => {
    const { accessToken } = await signupSchool(app);
    const { mathSs, studentBio } = await setupElectiveFixture(accessToken);

    const res = await request(app)
      .put(`/api/section-subjects/${mathSs.id}/elective-students`)
      .set(authHeader(accessToken))
      .send({ studentIds: [studentBio.id] });
    expect(res.status).toBe(400);
  });

  it('rejects assigning a student from outside the section to an elective', async () => {
    const { accessToken } = await signupSchool(app);
    const { bioSs } = await setupElectiveFixture(accessToken);
    const outsider = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Outsider Student', gender: 'MALE', dateOfBirth: '2010-01-01' });

    const res = await request(app)
      .put(`/api/section-subjects/${bioSs.id}/elective-students`)
      .set(authHeader(accessToken))
      .send({ studentIds: [outsider.body.data.id] });
    expect(res.status).toBe(400);
  });

  it('GET elective-students shows the full section roster with an enrolled flag', async () => {
    const { accessToken } = await signupSchool(app);
    const { bioSs, studentBio, studentCs } = await setupElectiveFixture(accessToken);

    const res = await request(app)
      .get(`/api/section-subjects/${bioSs.id}/elective-students`)
      .set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const bio = res.body.data.find((r: { id: string }) => r.id === studentBio.id);
    const cs = res.body.data.find((r: { id: string }) => r.id === studentCs.id);
    expect(bio.enrolled).toBe(true);
    expect(cs.enrolled).toBe(false);
  });

  it('the marks-entry roster for an elective subject only includes enrolled students', async () => {
    const { accessToken } = await signupSchool(app);
    const { bioExamSubject, studentBio, studentCs } = await setupElectiveFixture(accessToken);

    const roster = await request(app)
      .get(`/api/exams/subjects/${bioExamSubject.id}/marks`)
      .set(authHeader(accessToken));
    expect(roster.status).toBe(200);
    const ids = roster.body.data.map((r: { studentId: string }) => r.studentId);
    expect(ids).toContain(studentBio.id);
    expect(ids).not.toContain(studentCs.id);
  });

  it('the core (non-elective) subject roster still includes every section student', async () => {
    const { accessToken } = await signupSchool(app);
    const { mathExamSubject, studentBio, studentCs } = await setupElectiveFixture(accessToken);

    const roster = await request(app)
      .get(`/api/exams/subjects/${mathExamSubject.id}/marks`)
      .set(authHeader(accessToken));
    const ids = roster.body.data.map((r: { studentId: string }) => r.studentId);
    expect(ids).toContain(studentBio.id);
    expect(ids).toContain(studentCs.id);
  });

  it('rejects entering marks for a student not enrolled in the elective subject', async () => {
    const { accessToken } = await signupSchool(app);
    const { bioExamSubject, studentCs } = await setupElectiveFixture(accessToken);

    const res = await request(app)
      .post(`/api/exams/subjects/${bioExamSubject.id}/marks`)
      .set(authHeader(accessToken))
      .send({ records: [{ studentId: studentCs.id, marksObtained: 80 }] });
    expect(res.status).toBe(400);
  });

  it("a student's report card only shows electives they're enrolled in, plus every core subject", async () => {
    const { accessToken } = await signupSchool(app);
    const { exam, studentBio, mathExamSubject, bioExamSubject } = await setupElectiveFixture(accessToken);

    await request(app)
      .post(`/api/exams/subjects/${mathExamSubject.id}/marks`)
      .set(authHeader(accessToken))
      .send({ records: [{ studentId: studentBio.id, marksObtained: 70 }] });
    await request(app)
      .post(`/api/exams/subjects/${bioExamSubject.id}/marks`)
      .set(authHeader(accessToken))
      .send({ records: [{ studentId: studentBio.id, marksObtained: 85 }] });

    const reportCard = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${studentBio.id}`)
      .set(authHeader(accessToken));
    expect(reportCard.status).toBe(200);
    const subjectNames = reportCard.body.data.subjects.map((s: { subject: string }) => s.subject);
    expect(subjectNames).toEqual(expect.arrayContaining(['Mathematics', 'Biology']));
    expect(subjectNames).not.toContain('Computer Science');
  });
});
