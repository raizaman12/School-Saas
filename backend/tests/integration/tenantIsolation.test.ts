import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { createAndLoginUser } from '../helpers/users';
import { prisma } from '../../src/lib/prisma';
import { closePdfBrowser } from '../../src/lib/pdfBrowser';

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
 * Dedicated "School A token vs. School B id" cross-tenant security sweep.
 *
 * Postgres RLS already protects every table here at the DB layer
 * independently of any of these tests (confirmed separately with
 * `FORCE ROW LEVEL SECURITY`, see Section 1 of the verification report) —
 * this file exists purely as a *regression-detection* net: a future
 * change that swaps `runWithTenant` for a raw `prisma` call in any of
 * these modules would silently reopen a cross-tenant leak, and nothing
 * before this file would notice. Auth/students/staff/attendance/
 * notifications/portal already had this coverage; this file fills the
 * gap for academics, exams/grading/marks, fees/invoices/payments,
 * payroll, and the remaining SIS sub-resources (academic years, classes,
 * sections, guardians, enrollments).
 *
 * One full "School A" fixture (one of everything) is built once per test
 * run and reused — "School B" only ever needs its own access token, never
 * its own data, since every probe here is "does B's token leak A's row".
 */
async function setupCrossTenantFixture() {
  const alpha = await signupSchool(app, { slug: 'alpha-sweep', adminEmail: 'admin@alpha-sweep.test' });
  const beta = await signupSchool(app, { slug: 'beta-sweep', adminEmail: 'admin@beta-sweep.test' });
  const a = authHeader(alpha.accessToken);

  const year = await request(app)
    .post('/api/academic-years')
    .set(a)
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app).post('/api/classes').set(a).send({ name: 'Class 5', order: 5 });
  const section = await request(app)
    .post('/api/sections')
    .set(a)
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const teacher = await createAndLoginUser(app, {
    tenantId: alpha.tenant.id,
    slug: alpha.tenant.slug,
    email: 'teacher@alpha-sweep.test',
    role: 'TEACHER',
  });
  const student = await request(app)
    .post('/api/students')
    .set(a)
    .send({
      fullName: 'Ahmed Khan',
      gender: 'MALE',
      dateOfBirth: '2015-01-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(a)
    .send({
      fullName: 'Raza Khan',
      relationship: 'FATHER',
      phone: '03001112222',
      studentId: student.body.data.id,
      isPrimary: true,
    });
  const subject = await request(app).post('/api/subjects').set(a).send({ name: 'Mathematics' });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(a)
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
  const timetableSlot = await request(app)
    .post('/api/timetable')
    .set(a)
    .send({ sectionSubjectId: sectionSubject.body.data.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:40' });
  const exam = await request(app)
    .post('/api/exams')
    .set(a)
    .send({ academicYearId: year.body.data.id, name: 'Mid Term' });
  const examSubject = await request(app)
    .post(`/api/exams/${exam.body.data.id}/subjects`)
    .set(a)
    .send({ sectionSubjectId: sectionSubject.body.data.id, maxMarks: 100, passingMarks: 33 });
  const category = await request(app).post('/api/fee-categories').set(a).send({ name: 'Tuition Fee' });
  await request(app)
    .post('/api/fee-structure-items')
    .set(a)
    .send({
      academicYearId: year.body.data.id,
      schoolClassId: cls.body.data.id,
      feeCategoryId: category.body.data.id,
      amount: 5000,
      frequency: 'MONTHLY',
    });
  const invoiceGen = await request(app)
    .post('/api/invoices/bulk-generate')
    .set(a)
    .send({ sectionId: section.body.data.id, academicYearId: year.body.data.id, period: '2026-02', issueDate: '2026-02-01', dueDate: '2026-02-10' });
  const staffTeacher = await request(app)
    .post('/api/staff')
    .set(a)
    .send({
      email: 'payroll.teacher@alpha-sweep.test',
      fullName: 'Payroll Teacher',
      role: 'TEACHER',
      designation: 'Teacher',
      joiningDate: '2024-01-01',
      monthlySalary: 50000,
    });
  const payroll = await request(app)
    .post('/api/staff/payroll/generate')
    .set(a)
    .send({ staffProfileId: staffTeacher.body.data.id, month: '2026-02' });

  return {
    alpha,
    beta,
    year: year.body.data,
    schoolClass: cls.body.data,
    section: section.body.data,
    student: student.body.data,
    guardian: guardian.body.data,
    subject: subject.body.data,
    sectionSubject: sectionSubject.body.data,
    timetableSlot: timetableSlot.body.data,
    exam: exam.body.data,
    examSubject: examSubject.body.data,
    invoice: invoiceGen.body.data.invoices[0],
    staffTeacher: staffTeacher.body.data,
    payroll: payroll.body.data,
  };
}

describe('Cross-tenant security sweep — SIS sub-resources', () => {
  it('cannot patch another tenant\'s academic year', async () => {
    const { beta, year } = await setupCrossTenantFixture();
    const res = await request(app)
      .patch(`/api/academic-years/${year.id}`)
      .set(authHeader(beta.accessToken))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('cannot patch another tenant\'s class', async () => {
    const { beta, schoolClass } = await setupCrossTenantFixture();
    const res = await request(app)
      .patch(`/api/classes/${schoolClass.id}`)
      .set(authHeader(beta.accessToken))
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('cannot patch another tenant\'s section, and section lists never include it', async () => {
    const { beta, section } = await setupCrossTenantFixture();
    const patch = await request(app)
      .patch(`/api/sections/${section.id}`)
      .set(authHeader(beta.accessToken))
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(404);

    const list = await request(app).get('/api/sections').set(authHeader(beta.accessToken));
    expect(list.body.data.find((s: { id: string }) => s.id === section.id)).toBeUndefined();
  });

  it('cannot enroll a student into another tenant\'s section', async () => {
    const { beta, section, year } = await setupCrossTenantFixture();
    // Beta needs its own student to attempt the enroll call against — the
    // interesting id under test is the cross-tenant sectionId.
    const betaYear = await request(app)
      .post('/api/academic-years')
      .set(authHeader(beta.accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const betaStudent = await request(app)
      .post('/api/students')
      .set(authHeader(beta.accessToken))
      .send({ fullName: 'Beta Student', gender: 'FEMALE', dateOfBirth: '2015-01-01' });

    const res = await request(app)
      .post(`/api/students/${betaStudent.body.data.id}/enroll`)
      .set(authHeader(beta.accessToken))
      .send({ sectionId: section.id, academicYearId: year.id });
    expect(res.status).toBe(400); // "Unknown sectionId" — not found under Beta's RLS-scoped connection

    void betaYear; // fetched only to keep the fixture realistic; unused otherwise
  });

  it('cannot read or patch another tenant\'s guardian', async () => {
    const { beta, guardian } = await setupCrossTenantFixture();
    const get = await request(app).get(`/api/guardians/${guardian.id}`).set(authHeader(beta.accessToken));
    expect(get.status).toBe(404);

    const patch = await request(app)
      .patch(`/api/guardians/${guardian.id}`)
      .set(authHeader(beta.accessToken))
      .send({ phone: '03000000000' });
    expect(patch.status).toBe(404);
  });
});

describe('Cross-tenant security sweep — Academics', () => {
  it('cannot patch another tenant\'s subject, and subject lists never include it', async () => {
    const { beta, subject } = await setupCrossTenantFixture();
    const patch = await request(app)
      .patch(`/api/subjects/${subject.id}`)
      .set(authHeader(beta.accessToken))
      .send({ name: 'Hijacked' });
    expect(patch.status).toBe(404);

    const list = await request(app).get('/api/subjects').set(authHeader(beta.accessToken));
    expect(list.body.data.find((s: { id: string }) => s.id === subject.id)).toBeUndefined();
  });

  it('cannot delete another tenant\'s timetable slot', async () => {
    const { beta, timetableSlot } = await setupCrossTenantFixture();
    const res = await request(app).delete(`/api/timetable/${timetableSlot.id}`).set(authHeader(beta.accessToken));
    expect(res.status).toBe(404);
  });

  it('another tenant\'s timetable list is always empty for a cross-tenant section id', async () => {
    const { beta, section } = await setupCrossTenantFixture();
    const res = await request(app)
      .get(`/api/timetable?sectionId=${section.id}`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('Cross-tenant security sweep — Exams, grading & marks', () => {
  it('another tenant sees an empty exam-subjects list for another tenant\'s exam id', async () => {
    const { beta, exam } = await setupCrossTenantFixture();
    const res = await request(app)
      .get(`/api/exams/${exam.id}/subjects`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('cannot read or enter marks for another tenant\'s exam-subject', async () => {
    const { beta, examSubject, student } = await setupCrossTenantFixture();
    const get = await request(app)
      .get(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(beta.accessToken));
    expect(get.status).toBe(404);

    const post = await request(app)
      .post(`/api/exams/subjects/${examSubject.id}/marks`)
      .set(authHeader(beta.accessToken))
      .send({ records: [{ studentId: student.id, marksObtained: 50 }] });
    expect(post.status).toBe(404);
  });

  it('cannot fetch another tenant\'s report card (exam id and student id both cross-tenant)', async () => {
    const { beta, exam, student } = await setupCrossTenantFixture();
    const res = await request(app)
      .get(`/api/exams/${exam.id}/report-card/${student.id}`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('Cross-tenant security sweep — Fees, invoices & payments', () => {
  it('cannot read another tenant\'s invoice', async () => {
    const { beta, invoice } = await setupCrossTenantFixture();
    const res = await request(app).get(`/api/invoices/${invoice.id}`).set(authHeader(beta.accessToken));
    expect(res.status).toBe(404);
  });

  it('cannot record a payment against another tenant\'s invoice', async () => {
    const { beta, invoice } = await setupCrossTenantFixture();
    const res = await request(app)
      .post(`/api/invoices/${invoice.id}/payments`)
      .set(authHeader(beta.accessToken))
      .send({ amount: 100, method: 'CASH', idempotencyKey: 'cross-tenant-payment-attempt-1' });
    expect(res.status).toBe(404);
  });

  it('another tenant\'s invoice list never includes it', async () => {
    const { beta, invoice } = await setupCrossTenantFixture();
    const list = await request(app).get('/api/invoices').set(authHeader(beta.accessToken));
    expect(list.body.data.find((i: { id: string }) => i.id === invoice.id)).toBeUndefined();
  });
});

describe('Cross-tenant security sweep — Parent/Student portal', () => {
  // The user-reported concern this answers directly: a parent/student
  // logged in to School B's portal must never see any trace of School
  // A's data — not their own child's records leaking out, and not being
  // able to reach School A's child by id at all, on any portal endpoint.
  async function setupPortalFamily(accessToken: string, tag: string) {
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 4', order: 4 });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: `${tag} Student`,
        gender: 'MALE',
        dateOfBirth: '2014-06-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: `${tag} Parent`,
        relationship: 'FATHER',
        phone: '03001112222',
        email: `${tag.toLowerCase()}.parent@${tag.toLowerCase()}-portal-sweep.test`,
        studentId: student.body.data.id,
        isPrimary: true,
      });
    return {
      student: student.body.data,
      guardianPortalLogin: guardian.body.portalLogin as { email: string; tempPassword: string },
    };
  }

  async function loginAsParent(slug: string, email: string, password: string) {
    const res = await request(app).post('/api/auth/login').send({ slug, email, password });
    if (res.status !== 200) throw new Error(`portal login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  }

  it("School B's parent cannot read School A's child by id via /api/portal/students/:id (403, no data)", async () => {
    const alpha = await signupSchool(app, { slug: 'portal-alpha', adminEmail: 'admin@portal-alpha.test' });
    const beta = await signupSchool(app, { slug: 'portal-beta', adminEmail: 'admin@portal-beta.test' });
    const familyA = await setupPortalFamily(alpha.accessToken, 'Alpha');
    const familyB = await setupPortalFamily(beta.accessToken, 'Beta');

    const parentBToken = await loginAsParent(
      beta.tenant.slug,
      familyB.guardianPortalLogin.email,
      familyB.guardianPortalLogin.tempPassword,
    );

    // /me must only ever list Beta's own child, never Alpha's.
    const me = await request(app).get('/api/portal/me').set(authHeader(parentBToken));
    expect(me.status).toBe(200);
    expect(me.body.data.children).toHaveLength(1);
    expect(me.body.data.children[0].id).toBe(familyB.student.id);

    // Reaching for Alpha's child id directly must fail, not leak.
    const detail = await request(app)
      .get(`/api/portal/students/${familyA.student.id}`)
      .set(authHeader(parentBToken));
    expect(detail.status).toBe(403);

    const attendance = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/attendance`)
      .set(authHeader(parentBToken));
    expect(attendance.status).toBe(403);

    const fees = await request(app)
      .get(`/api/portal/students/${familyA.student.id}/fees`)
      .set(authHeader(parentBToken));
    expect(fees.status).toBe(403);
  });

  it("School B's parent cannot even log in against School A's slug with School A's own credentials mixed in", async () => {
    const alpha = await signupSchool(app, { slug: 'portal-alpha2', adminEmail: 'admin@portal-alpha2.test' });
    const beta = await signupSchool(app, { slug: 'portal-beta2', adminEmail: 'admin@portal-beta2.test' });
    const familyB = await setupPortalFamily(beta.accessToken, 'Beta2');
    void alpha;

    // Beta's parent credentials don't exist under Alpha's tenant scope.
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        slug: alpha.tenant.slug,
        email: familyB.guardianPortalLogin.email,
        password: familyB.guardianPortalLogin.tempPassword,
      });
    expect(res.status).toBe(401);
  });
});

describe('Cross-tenant security sweep — Payroll', () => {
  it('another tenant\'s payroll list never includes another tenant\'s record', async () => {
    const { beta, payroll } = await setupCrossTenantFixture();
    const list = await request(app).get('/api/staff/payroll').set(authHeader(beta.accessToken));
    expect(list.body.data.find((p: { id: string }) => p.id === payroll.id)).toBeUndefined();
  });

  it('cannot mark another tenant\'s payroll record as paid', async () => {
    const { beta, payroll } = await setupCrossTenantFixture();
    const res = await request(app)
      .patch(`/api/staff/payroll/${payroll.id}/mark-paid`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(404);
  });
});
