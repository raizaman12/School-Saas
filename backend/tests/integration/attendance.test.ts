import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb, ownerDb } from '../helpers/db';
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

async function setupSectionWithStudents(
  accessToken: string,
  tenant: { id: string; slug: string },
  studentCount = 3,
) {
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
    email: 'classteacher@test-school.test',
    role: 'TEACHER',
  });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({
      schoolClassId: cls.body.data.id,
      academicYearId: year.body.data.id,
      name: 'A',
      classTeacherId: teacher.user.id,
    });

  const students = [];
  for (let i = 0; i < studentCount; i++) {
    const s = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: `Student ${i}`,
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    students.push(s.body.data);
  }

  return { year: year.body.data, section: section.body.data, teacher, students };
}

describe('Marking attendance', () => {
  it('bulk-marks a section roster and the roster GET reflects it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        date: '2026-02-10',
        records: [
          { studentId: students[0].id, status: 'PRESENT' },
          { studentId: students[1].id, status: 'ABSENT', remarks: 'Sick' },
          { studentId: students[2].id, status: 'LATE' },
        ],
      });
    expect(mark.status).toBe(200);
    expect(mark.body.data).toHaveLength(3);

    const roster = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-10`)
      .set(authHeader(teacher.accessToken));
    expect(roster.status).toBe(200);
    expect(roster.body.data.holiday).toBeNull();
    const byName = Object.fromEntries(roster.body.data.roster.map((r: { fullName: string; status: string }) => [r.fullName, r.status]));
    expect(byName['Student 0']).toBe('PRESENT');
    expect(byName['Student 1']).toBe('ABSENT');
    expect(byName['Student 2']).toBe('LATE');
  });

  it('re-marking the same student on the same date UPDATES the record, not duplicates it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'ABSENT' }] });

    const second = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(second.status).toBe(200);

    const history = await request(app)
      .get(`/api/attendance/student/${students[0].id}`)
      .set(authHeader(accessToken));
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].status).toBe('PRESENT');
  });

  it('rejects marking a student who is not currently in that section', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, teacher } = await setupSectionWithStudents(accessToken, tenant, 0);

    const res = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        date: '2026-02-10',
        records: [{ studentId: '00000000-0000-0000-0000-000000000000', status: 'PRESENT' }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects a TEACHER marking attendance for a section they are NOT the class teacher of', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students } = await setupSectionWithStudents(accessToken, tenant, 1);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/attendance')
      .set(authHeader(otherTeacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(res.status).toBe(403);
  });

  it('a TEACHER who only has a subject assignment (not class teacher) in a section can still mark its attendance', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students } = await setupSectionWithStudents(accessToken, tenant, 1);
    const subjectTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'subject-teacher@test-school.test',
      role: 'TEACHER',
    });

    // Before any subject assignment, marking is forbidden — same as any other unrelated teacher.
    const before = await request(app)
      .post('/api/attendance')
      .set(authHeader(subjectTeacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(before.status).toBe(403);

    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });
    await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: subjectTeacher.user.id });

    const after = await request(app)
      .post('/api/attendance')
      .set(authHeader(subjectTeacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(after.status).toBe(200);
  });

  it('SCHOOL_ADMIN and FRONT_DESK can mark attendance on behalf of a section', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students } = await setupSectionWithStudents(accessToken, tenant, 1);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const asAdmin = await request(app)
      .post('/api/attendance')
      .set(authHeader(accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(asAdmin.status).toBe(200);

    const asFrontDesk = await request(app)
      .post('/api/attendance')
      .set(authHeader(frontDesk.accessToken))
      .send({ sectionId: section.id, date: '2026-02-11', records: [{ studentId: students[0].id, status: 'ABSENT' }] });
    expect(asFrontDesk.status).toBe(200);
  });

  it('rejects marking attendance for a future date', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    const farFuture = new Date();
    farFuture.setUTCFullYear(farFuture.getUTCFullYear() + 1);
    const futureDate = farFuture.toISOString().slice(0, 10);

    const res = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: futureDate, records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(res.status).toBe(400);
  });

  it('allows marking attendance for today (not just strictly past dates)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);
    const today = new Date().toISOString().slice(0, 10);

    // Cleared so this assertion holds regardless of which real-world
    // weekday the test happens to run on (the default weekly-off is Sunday).
    await request(app)
      .patch('/api/tenant/weekly-off-days')
      .set(authHeader(accessToken))
      .send({ weeklyOffDays: [] });

    const res = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: today, records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(res.status).toBe(200);
  });
});

// Real bug this covers: a teacher on the course page could hit "Save
// attendance" for their class a couple of minutes before that lecture's own
// scheduled start time — and, separately, could keep reopening and rewriting
// it long after the lecture was over — since the endpoint never checked the
// timetable at all. `sectionSubjectId` is what opts a request into that
// check (see markAttendanceSchema's and
// assertLectureAttendanceWindowOpen's doc comments) — it's only ever sent
// by that one course-page shortcut, so the plain sectionId+date flow the
// tests above exercise stays provably unaffected.
describe("Lecture-start/lock guard for the course page's quick-mark (sectionSubjectId)", () => {
  const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
  function todaysDayOfWeek() {
    return DAY_NAMES[new Date().getUTCDay()];
  }
  // Matches createTimetableSlotSchema's own "HH:MM" (24h) parsing, offset
  // from the current Pakistan wall-clock time-of-day (matching production's
  // minutesSinceMidnightPakistanNow — the app compares "now" in Pakistan
  // time against these literal HH:MM values, see attendance.ts's own doc
  // comment) so these tests hold no matter when they're actually run.
  function hhmmOffsetFromNow(offsetMinutes: number) {
    const now = new Date();
    const pakistanNowMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 5 * 60) % 1440;
    const wrapped = ((pakistanNowMinutes + offsetMinutes) % 1440 + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  }

  async function seedLectureToday(
    accessToken: string,
    tenant: { id: string; slug: string },
    startOffsetMinutes: number,
    durationMinutes = 40,
  ) {
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);
    // Cleared for the same reason as the test above — the assertion must
    // hold regardless of which real weekday the suite happens to run on.
    await request(app).patch('/api/tenant/weekly-off-days').set(authHeader(accessToken)).send({ weeklyOffDays: [] });

    const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Physics' });
    const sectionSubject = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({
        sectionSubjectId: sectionSubject.body.data.id,
        dayOfWeek: todaysDayOfWeek(),
        startTime: hhmmOffsetFromNow(startOffsetMinutes),
        endTime: hhmmOffsetFromNow(startOffsetMinutes + durationMinutes),
      });

    return { section, students, teacher, sectionSubjectId: sectionSubject.body.data.id };
  }

  // Real bug this covers: a subject with no timetable slot on today's day
  // of the week (e.g. it only ever runs Mon/Tue/Thu, and today is
  // Wednesday) used to be treated as "nothing to check against" and let
  // through unrestricted — attendance for that lecture shortcut should
  // only ever be markable on a day it's actually scheduled.
  it('rejects marking today\'s attendance for a subject with no timetable slot at all today', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);
    await request(app).patch('/api/tenant/weekly-off-days').set(authHeader(accessToken)).send({ weeklyOffDays: [] });
    const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'History' });
    const sectionSubject = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
    // Deliberately no /api/timetable slot created at all for this subject.

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        sectionSubjectId: sectionSubject.body.data.id,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(400);
    expect(mark.body.error.message).toMatch(/no timetable slot scheduled for today/);
  });

  it("rejects marking today's attendance for a lecture that hasn't started yet", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher, sectionSubjectId } = await seedLectureToday(accessToken, tenant, 5);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        sectionSubjectId,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(400);
    expect(mark.body.error.message).toMatch(/hasn't started yet/);
  });

  it('allows marking once the scheduled lecture has actually started', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher, sectionSubjectId } = await seedLectureToday(accessToken, tenant, -5);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        sectionSubjectId,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(200);
  });

  it('leaves the general (no sectionSubjectId) daily-attendance flow completely unaffected by an upcoming lecture', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    // Scheduled 5 minutes from now — would 400 if sectionSubjectId were sent.
    const { section, students, teacher } = await seedLectureToday(accessToken, tenant, 5);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(200);
  });

  // Real bug this covers, the second half of the user's own report: a
  // teacher could reopen and rewrite today's attendance long after the
  // lecture ended. Lecture runs -37..+3 (40 minutes), so "now" sits 2
  // minutes past the endTime-5 lock cutoff (-37+35=-2) — solidly inside the
  // locked window without being flaky at the exact boundary.
  it("rejects marking once the lecture's attendance window has locked (5 minutes before it ends)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher, sectionSubjectId } = await seedLectureToday(accessToken, tenant, -37, 40);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        sectionSubjectId,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(400);
    expect(mark.body.error.message).toMatch(/locked/);
  });

  it('still allows marking mid-lecture, comfortably before the end-of-lecture lock', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    // Lecture runs -10..+30 — 10 minutes in, 25 minutes clear of the lock.
    const { section, students, teacher, sectionSubjectId } = await seedLectureToday(accessToken, tenant, -10, 40);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        sectionSubjectId,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(200);
  });

  it('leaves the general (no sectionSubjectId) daily-attendance flow completely unaffected by a locked lecture — admin/front desk can still correct it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    // Same locked window as above — would 400 if sectionSubjectId were sent.
    const { section, students, teacher } = await seedLectureToday(accessToken, tenant, -37, 40);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({
        sectionId: section.id,
        date: new Date().toISOString().slice(0, 10),
        records: [{ studentId: students[0].id, status: 'PRESENT' }],
      });
    expect(mark.status).toBe(200);
  });
});

describe('Attendance audit trail', () => {
  it('does not log an audit entry for a first-time (non-edit) mark', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });

    const entries = await ownerDb.auditLog.findMany({ where: { action: 'attendance.records_edited' } });
    expect(entries).toHaveLength(0);
  });

  it('logs an audit entry with the before/after status when an already-marked day is corrected', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'ABSENT' }] });

    const edit = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(edit.status).toBe(200);

    const entries = await ownerDb.auditLog.findMany({ where: { action: 'attendance.records_edited' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId).toBe(tenant.id);
    expect(entries[0].actorUserId).toBe(teacher.user.id);
    expect(entries[0].entityId).toBe(section.id);
    expect(entries[0].metadata).toEqual({
      date: '2026-02-10',
      edits: [{ studentId: students[0].id, fromStatus: 'ABSENT', toStatus: 'PRESENT' }],
    });
  });

  it('re-marking with the SAME status again is not logged as an edit', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });

    const entries = await ownerDb.auditLog.findMany({ where: { action: 'attendance.records_edited' } });
    expect(entries).toHaveLength(0);
  });
});

describe('Attendance summary', () => {
  it('aggregates present/absent/late counts per student over a date range', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    // Mon-Thu (2026-02-01 is a Sunday, a default weekly-off day that would
    // otherwise be silently rejected by the attendance-marking route).
    for (const [date, status] of [
      ['2026-02-02', 'PRESENT'],
      ['2026-02-03', 'PRESENT'],
      ['2026-02-04', 'ABSENT'],
      ['2026-02-05', 'LATE'],
    ] as const) {
      await request(app)
        .post('/api/attendance')
        .set(authHeader(teacher.accessToken))
        .send({ sectionId: section.id, date, records: [{ studentId: students[0].id, status }] });
    }

    const summary = await request(app)
      .get(`/api/attendance/summary?sectionId=${section.id}&from=2026-02-01&to=2026-02-28`)
      .set(authHeader(accessToken));

    expect(summary.status).toBe(200);
    expect(summary.body.data[0].totalMarked).toBe(4);
    expect(summary.body.data[0].counts).toEqual({
      PRESENT: 2,
      ABSENT: 1,
      LATE: 1,
      LEAVE: 0,
      HALF_DAY: 0,
      EARLY_LEAVE: 0,
    });
  });
});

describe('Tenant isolation for attendance', () => {
  it('cannot read another tenant\'s attendance summary (section lookup fails closed)', async () => {
    const alpha = await signupSchool(app, { slug: 'alpha-att', adminEmail: 'a@alpha-att.test' });
    const beta = await signupSchool(app, { slug: 'beta-att', adminEmail: 'a@beta-att.test' });
    const { section } = await setupSectionWithStudents(alpha.accessToken, alpha.tenant, 1);

    const res = await request(app)
      .get(`/api/attendance/summary?sectionId=${section.id}&from=2026-02-01&to=2026-02-28`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(400); // section not found under Beta's RLS-scoped connection
  });
});

async function fetchPdf(accessToken: string, path: string) {
  return request(app)
    .get(path)
    .set(authHeader(accessToken))
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

describe('Attendance report PDF', () => {
  it('prints a full-year attendance report for one student, with correct summary counts', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    // A spread of dates across most of an academic year (Aug through May)
    // — "1 day up to 1 full year" is the range the school actually asked
    // for, so this exercises the wide end of that range, not just a
    // handful of consecutive days.
    for (const [date, status] of [
      ['2025-08-15', 'PRESENT'],
      ['2025-11-20', 'ABSENT'],
      ['2026-01-10', 'LATE'],
      ['2026-03-05', 'LEAVE'],
      ['2026-05-20', 'PRESENT'],
    ] as const) {
      await request(app)
        .post('/api/attendance')
        .set(authHeader(teacher.accessToken))
        .send({ sectionId: section.id, date, records: [{ studentId: students[0].id, status }] });
    }

    const pdf = await fetchPdf(
      accessToken,
      `/api/attendance/student/${students[0].id}/pdf?from=2025-08-01&to=2026-05-31`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  it('prints a single-day attendance report just as well as a full-year one', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);
    await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'PRESENT' }] });

    const pdf = await fetchPdf(
      accessToken,
      `/api/attendance/student/${students[0].id}/pdf?from=2026-02-10&to=2026-02-10`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 30000);

  it('a TEACHER can print attendance only for a student in a section they are the class teacher of', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { students } = await setupSectionWithStudents(accessToken, tenant, 1);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other-teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .get(`/api/attendance/student/${students[0].id}/pdf`)
      .set(authHeader(otherTeacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('cannot print another tenant\'s student attendance (404)', async () => {
    const alpha = await signupSchool(app, { slug: 'alpha-att2', adminEmail: 'a@alpha-att2.test' });
    const beta = await signupSchool(app, { slug: 'beta-att2', adminEmail: 'a@beta-att2.test' });
    const { students } = await setupSectionWithStudents(alpha.accessToken, alpha.tenant, 1);

    const res = await request(app)
      .get(`/api/attendance/student/${students[0].id}/pdf`)
      .set(authHeader(beta.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('EARLY_LEAVE attendance status', () => {
  it('can be marked, shows up on the roster, in student history, and in the section summary counts', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-10', records: [{ studentId: students[0].id, status: 'EARLY_LEAVE' }] });
    expect(mark.status).toBe(200);
    expect(mark.body.data[0].status).toBe('EARLY_LEAVE');

    const roster = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-10`)
      .set(authHeader(teacher.accessToken));
    expect(roster.body.data.roster[0].status).toBe('EARLY_LEAVE');

    const history = await request(app)
      .get(`/api/attendance/student/${students[0].id}`)
      .set(authHeader(accessToken));
    expect(history.body.data[0].status).toBe('EARLY_LEAVE');

    const summary = await request(app)
      .get(`/api/attendance/summary?sectionId=${section.id}&from=2026-02-01&to=2026-02-28`)
      .set(authHeader(accessToken));
    expect(summary.body.data[0].counts.EARLY_LEAVE).toBe(1);
  });
});

describe('Holidays & non-working days', () => {
  it('a school default (Sunday) weekly-off day blocks marking attendance with a 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    const res = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      // 2026-02-01 is a Sunday, and a tenant's weeklyOffDays defaults to [0] (Sunday).
      .send({ sectionId: section.id, date: '2026-02-01', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? res.body.message).toMatch(/non-working day/i);
  });

  it('the roster GET flags a weekly-off date as a holiday and does not for an ordinary weekday', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    const sunday = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-01`)
      .set(authHeader(teacher.accessToken));
    expect(sunday.status).toBe(200);
    expect(sunday.body.data.holiday).toEqual({ reason: 'WEEKLY_OFF', label: 'Sunday' });

    const tuesday = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-10`)
      .set(authHeader(teacher.accessToken));
    expect(tuesday.body.data.holiday).toBeNull();
  });

  it('a declared Holiday date range blocks marking and is flagged on the roster, by its own name', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, students, teacher } = await setupSectionWithStudents(accessToken, tenant, 1);

    const created = await request(app)
      .post('/api/holidays')
      .set(authHeader(accessToken))
      .send({ name: 'Eid Holidays', startDate: '2026-02-16', endDate: '2026-02-18' });
    expect(created.status).toBe(201);

    // Tuesday, would otherwise be a perfectly normal working day.
    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: section.id, date: '2026-02-17', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(mark.status).toBe(400);
    expect(mark.body.error?.message ?? mark.body.message).toMatch(/Eid Holidays/);

    const roster = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-17`)
      .set(authHeader(teacher.accessToken));
    expect(roster.body.data.holiday).toEqual({ reason: 'HOLIDAY', label: 'Eid Holidays' });

    // The day right after the range ends is unaffected.
    const dayAfter = await request(app)
      .get(`/api/attendance?sectionId=${section.id}&date=2026-02-19`)
      .set(authHeader(teacher.accessToken));
    expect(dayAfter.body.data.holiday).toBeNull();
  });

  it('lists and deletes declared holidays, and only SCHOOL_ADMIN can create/delete them', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'holiday-teacher@test-school.test',
      role: 'TEACHER',
    });

    const rejected = await request(app)
      .post('/api/holidays')
      .set(authHeader(teacher.accessToken))
      .send({ name: 'Summer Break', startDate: '2026-06-01', endDate: '2026-08-15' });
    expect(rejected.status).toBe(403);

    const created = await request(app)
      .post('/api/holidays')
      .set(authHeader(accessToken))
      .send({ name: 'Summer Break', startDate: '2026-06-01', endDate: '2026-08-15' });
    expect(created.status).toBe(201);

    // Any staff role (READ_ROLES) can list.
    const list = await request(app)
      .get('/api/holidays')
      .set(authHeader(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe('Summer Break');

    const deleteRejected = await request(app)
      .delete(`/api/holidays/${created.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(deleteRejected.status).toBe(403);

    const deleted = await request(app)
      .delete(`/api/holidays/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(deleted.status).toBe(204);

    const listAfter = await request(app)
      .get('/api/holidays')
      .set(authHeader(accessToken));
    expect(listAfter.body.data).toHaveLength(0);
  });

  it('holidays are tenant-isolated — one school\'s holiday does not affect another', async () => {
    const alpha = await signupSchool(app, { slug: 'alpha-hol', adminEmail: 'a@alpha-hol.test' });
    const beta = await signupSchool(app, { slug: 'beta-hol', adminEmail: 'a@beta-hol.test' });
    const { section: betaSection, students, teacher } = await setupSectionWithStudents(beta.accessToken, beta.tenant, 1);

    await request(app)
      .post('/api/holidays')
      .set(authHeader(alpha.accessToken))
      .send({ name: 'Alpha School Trip', startDate: '2026-02-17', endDate: '2026-02-17' });

    // Beta's own roster/marking for the same date is unaffected by Alpha's holiday.
    const roster = await request(app)
      .get(`/api/attendance?sectionId=${betaSection.id}&date=2026-02-17`)
      .set(authHeader(teacher.accessToken));
    expect(roster.body.data.holiday).toBeNull();

    const mark = await request(app)
      .post('/api/attendance')
      .set(authHeader(teacher.accessToken))
      .send({ sectionId: betaSection.id, date: '2026-02-17', records: [{ studentId: students[0].id, status: 'PRESENT' }] });
    expect(mark.status).toBe(200);

    const betaList = await request(app).get('/api/holidays').set(authHeader(beta.accessToken));
    expect(betaList.body.data).toHaveLength(0);
  });
});
