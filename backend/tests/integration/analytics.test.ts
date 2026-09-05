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

/** Returns "YYYY-MM-DD" for `monthsAgo` full calendar months before today, on the 10th. */
function dateMonthsAgo(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 10));
  return d.toISOString().slice(0, 10);
}

async function setupClassWithStudents(
  accessToken: string,
  opts: { className: string; order: number; academicYearId: string; count: number },
) {
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: opts.className, order: opts.order });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: opts.academicYearId, name: 'A' });

  const students = [];
  for (let i = 0; i < opts.count; i++) {
    const s = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: `${opts.className} Student ${i + 1}`,
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: opts.academicYearId,
      });
    students.push(s.body.data);
  }

  return { class: cls.body.data, section: section.body.data, students };
}

describe('Analytics', () => {
  describe('Overview', () => {
    it('returns zeroed/null values for a brand-new tenant with no data', async () => {
      const { accessToken } = await signupSchool(app);

      const res = await request(app).get('/api/analytics/overview').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.activeStudents).toBe(0);
      expect(res.body.data.totalStaff).toBe(1); // the admin who signed up
      expect(res.body.data.attendanceRateLast30Days).toBeNull();
      expect(res.body.data.feeCollectionRateActiveYear).toBeNull();
      expect(res.body.data.activeAcademicYear).toBeNull();
      expect(res.body.data.latestExam).toBeNull();
    });

    it('computes real KPI numbers once students, attendance, fees, and exams exist', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      // Every new tenant defaults to Sunday as a non-working day (see
      // schema.prisma's Tenant.weeklyOffDays) and attendance can't be
      // marked on a non-working day (attendance.ts's isNonWorkingDay
      // check) — clear it so this test's "mark attendance for today" step
      // below doesn't depend on which real calendar weekday the suite
      // happens to run on.
      await request(app)
        .patch('/api/tenant/weekly-off-days')
        .set(authHeader(accessToken))
        .send({ weeklyOffDays: [] });
      const year = await request(app)
        .post('/api/academic-years')
        .set(authHeader(accessToken))
        .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
      const { section, students } = await setupClassWithStudents(accessToken, {
        className: 'Class 5',
        order: 5,
        academicYearId: year.body.data.id,
        count: 2,
      });
      await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'teacher1@test-school.test',
        role: 'TEACHER',
      });

      // Attendance: 1 present, 1 absent -> 50% rate, dated within the last 30 days.
      const today = new Date().toISOString().slice(0, 10);
      await request(app)
        .post('/api/attendance')
        .set(authHeader(accessToken))
        .send({
          sectionId: section.id,
          date: today,
          records: [
            { studentId: students[0].id, status: 'PRESENT' },
            { studentId: students[1].id, status: 'ABSENT' },
          ],
        });

      // Fees: bulk-generate bills both students (5000 each = 10000 total),
      // pay 2000 against one of them -> 20% collection rate.
      const category = await request(app)
        .post('/api/fee-categories')
        .set(authHeader(accessToken))
        .send({ name: 'Tuition Fee' });
      await request(app)
        .post('/api/fee-structure-items')
        .set(authHeader(accessToken))
        .send({
          academicYearId: year.body.data.id,
          schoolClassId: section.schoolClassId,
          feeCategoryId: category.body.data.id,
          amount: 5000,
          frequency: 'MONTHLY',
        });
      const gen = await request(app)
        .post('/api/invoices/bulk-generate')
        .set(authHeader(accessToken))
        .send({ sectionId: section.id, academicYearId: year.body.data.id, period: '2026-02', issueDate: '2026-02-01', dueDate: '2026-02-10' });
      const invoice = gen.body.data.invoices[0];
      await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set(authHeader(accessToken))
        .send({ amount: 2000, method: 'CASH', idempotencyKey: 'analytics-key-1' });

      // Exam: one subject, one mark at 80/100.
      const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
      const sectionSubject = await request(app)
        .post(`/api/sections/${section.id}/subjects`)
        .set(authHeader(accessToken))
        .send({ subjectId: subject.body.data.id });
      const exam = await request(app)
        .post('/api/exams')
        .set(authHeader(accessToken))
        .send({ academicYearId: year.body.data.id, name: 'Mid Term' });
      const examSubject = await request(app)
        .post(`/api/exams/${exam.body.data.id}/subjects`)
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.body.data.id, maxMarks: 100, passingMarks: 33 });
      await request(app)
        .post(`/api/exams/subjects/${examSubject.body.data.id}/marks`)
        .set(authHeader(accessToken))
        .send({ records: [{ studentId: students[0].id, marksObtained: 80 }] });

      const res = await request(app).get('/api/analytics/overview').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.activeStudents).toBe(2);
      expect(res.body.data.totalStaff).toBe(2); // admin + teacher
      expect(res.body.data.attendanceRateLast30Days).toBe(50);
      expect(res.body.data.feeCollectionRateActiveYear).toBe(20);
      expect(res.body.data.activeAcademicYear).toBe('2025-2026');
      expect(res.body.data.latestExam).toEqual({ name: 'Mid Term', averagePercentage: 80 });
    });
  });

  describe('Enrollment by class', () => {
    it('groups active students by class, sorted by class order', async () => {
      const { accessToken } = await signupSchool(app);
      const year = await request(app)
        .post('/api/academic-years')
        .set(authHeader(accessToken))
        .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });

      await setupClassWithStudents(accessToken, { className: 'Class 9', order: 9, academicYearId: year.body.data.id, count: 1 });
      await setupClassWithStudents(accessToken, { className: 'Class 2', order: 2, academicYearId: year.body.data.id, count: 3 });

      const res = await request(app).get('/api/analytics/enrollment-by-class').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // Sorted by SchoolClass.order, not creation order.
      expect(res.body.data[0].className).toBe('Class 2');
      expect(res.body.data[0].count).toBe(3);
      expect(res.body.data[1].className).toBe('Class 9');
      expect(res.body.data[1].count).toBe(1);
    });
  });

  describe('Attendance trend', () => {
    it('buckets attendance by month with zero-filled months that have no records', async () => {
      const { accessToken } = await signupSchool(app);
      const year = await request(app)
        .post('/api/academic-years')
        .set(authHeader(accessToken))
        .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
      const { section, students } = await setupClassWithStudents(accessToken, {
        className: 'Class 3',
        order: 3,
        academicYearId: year.body.data.id,
        count: 2,
      });

      await request(app)
        .post('/api/attendance')
        .set(authHeader(accessToken))
        .send({
          sectionId: section.id,
          date: dateMonthsAgo(0),
          records: [
            { studentId: students[0].id, status: 'PRESENT' },
            { studentId: students[1].id, status: 'ABSENT' },
          ],
        });

      const res = await request(app).get('/api/analytics/attendance-trend?months=3').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      const currentMonth = res.body.data[2];
      expect(currentMonth.totalMarked).toBe(2);
      expect(currentMonth.attendanceRate).toBe(50);
      const twoMonthsAgo = res.body.data[0];
      expect(twoMonthsAgo.totalMarked).toBe(0);
      expect(twoMonthsAgo.attendanceRate).toBeNull();
    });
  });

  describe('Fee collection trend', () => {
    it('buckets billed/collected totals by invoice issue-date month', async () => {
      const { accessToken } = await signupSchool(app);
      const year = await request(app)
        .post('/api/academic-years')
        .set(authHeader(accessToken))
        .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
      const { section } = await setupClassWithStudents(accessToken, {
        className: 'Class 4',
        order: 4,
        academicYearId: year.body.data.id,
        count: 1,
      });
      const category = await request(app)
        .post('/api/fee-categories')
        .set(authHeader(accessToken))
        .send({ name: 'Tuition Fee' });
      await request(app)
        .post('/api/fee-structure-items')
        .set(authHeader(accessToken))
        .send({
          academicYearId: year.body.data.id,
          schoolClassId: section.schoolClassId,
          feeCategoryId: category.body.data.id,
          amount: 1000,
          frequency: 'MONTHLY',
        });
      const gen = await request(app)
        .post('/api/invoices/bulk-generate')
        .set(authHeader(accessToken))
        .send({
          sectionId: section.id,
          academicYearId: year.body.data.id,
          period: 'current-month',
          issueDate: dateMonthsAgo(0),
          dueDate: dateMonthsAgo(0),
        });
      const invoice = gen.body.data.invoices[0];
      await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set(authHeader(accessToken))
        .send({ amount: 400, method: 'CASH', idempotencyKey: 'trend-key-1' });

      const res = await request(app).get('/api/analytics/fee-collection-trend?months=2').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      const currentMonth = res.body.data[1];
      expect(currentMonth.billed).toBe(1000);
      expect(currentMonth.collected).toBe(400);
      expect(currentMonth.collectionRate).toBe(40);
    });
  });

  describe('Exam performance', () => {
    it('returns average percentage per exam, oldest of the selected window first', async () => {
      const { accessToken } = await signupSchool(app);
      const year = await request(app)
        .post('/api/academic-years')
        .set(authHeader(accessToken))
        .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
      const { section, students } = await setupClassWithStudents(accessToken, {
        className: 'Class 6',
        order: 6,
        academicYearId: year.body.data.id,
        count: 1,
      });
      const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Science' });
      const sectionSubject = await request(app)
        .post(`/api/sections/${section.id}/subjects`)
        .set(authHeader(accessToken))
        .send({ subjectId: subject.body.data.id });

      const examA = await request(app)
        .post('/api/exams')
        .set(authHeader(accessToken))
        .send({ academicYearId: year.body.data.id, name: 'First Term', startDate: dateMonthsAgo(2) });
      const examSubjectA = await request(app)
        .post(`/api/exams/${examA.body.data.id}/subjects`)
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.body.data.id, maxMarks: 100, passingMarks: 33 });
      await request(app)
        .post(`/api/exams/subjects/${examSubjectA.body.data.id}/marks`)
        .set(authHeader(accessToken))
        .send({ records: [{ studentId: students[0].id, marksObtained: 60 }] });

      const examB = await request(app)
        .post('/api/exams')
        .set(authHeader(accessToken))
        .send({ academicYearId: year.body.data.id, name: 'Final Term', startDate: dateMonthsAgo(0) });
      const examSubjectB = await request(app)
        .post(`/api/exams/${examB.body.data.id}/subjects`)
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.body.data.id, maxMarks: 50, passingMarks: 20 });
      await request(app)
        .post(`/api/exams/subjects/${examSubjectB.body.data.id}/marks`)
        .set(authHeader(accessToken))
        .send({ records: [{ studentId: students[0].id, marksObtained: 45 }] }); // 90%

      const res = await request(app).get('/api/analytics/exam-performance?limit=5').set(authHeader(accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // Most-recent-first from the DB query, then .reverse()'d to read chronologically.
      expect(res.body.data[0].examName).toBe('First Term');
      expect(res.body.data[0].averagePercentage).toBe(60);
      expect(res.body.data[1].examName).toBe('Final Term');
      expect(res.body.data[1].averagePercentage).toBe(90);
    });
  });

  describe('Role access', () => {
    it('TEACHER, FRONT_DESK, and ACCOUNTANT are all blocked (403) — SCHOOL_ADMIN only', async () => {
      const { tenant } = await signupSchool(app);
      const teacher = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'teacher@test-school.test',
        role: 'TEACHER',
      });
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'fd@test-school.test',
        role: 'FRONT_DESK',
      });
      const accountant = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'acct@test-school.test',
        role: 'ACCOUNTANT',
      });

      for (const user of [teacher, frontDesk, accountant]) {
        const res = await request(app).get('/api/analytics/overview').set(authHeader(user.accessToken));
        expect(res.status).toBe(403);
      }
    });
  });
});
