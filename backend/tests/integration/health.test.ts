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

/**
 * Builds a section with a class teacher, a separate unrelated teacher, and
 * an enrolled student — the cast needed to test "the class teacher can act
 * on this student, an unrelated teacher cannot".
 */
async function setupStudentWithTeachers(accessToken: string, tenant: { id: string; slug: string }) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 4', order: 4 });

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

  const otherTeacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: 'unrelated-teacher@test-school.test',
    role: 'TEACHER',
  });

  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Hamza Sheikh',
      gender: 'MALE',
      dateOfBirth: '2015-09-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });

  return { section: section.body.data, student: student.body.data, classTeacher, otherTeacher };
}

describe('Health records', () => {
  describe('Health profile', () => {
    it('SCHOOL_ADMIN creates and updates a health profile via PUT (upsert)', async () => {
      const { accessToken } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const missing = await request(app)
        .get(`/api/health/profiles/${student.body.data.id}`)
        .set(authHeader(accessToken));
      expect(missing.status).toBe(200);
      expect(missing.body.data).toBeNull();

      const create = await request(app)
        .put(`/api/health/profiles/${student.body.data.id}`)
        .set(authHeader(accessToken))
        .send({
          bloodGroup: 'B_POSITIVE',
          allergies: 'Penicillin',
          emergencyContactName: 'Farida Khan',
          emergencyContactPhone: '03001112222',
        });
      expect(create.status).toBe(200);
      expect(create.body.data.bloodGroup).toBe('B_POSITIVE');
      expect(create.body.data.allergies).toBe('Penicillin');
      expect(create.body.data.student.fullName).toBe('Ahmed Khan');

      const update = await request(app)
        .put(`/api/health/profiles/${student.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ chronicConditions: 'Mild asthma', bloodGroup: 'B_POSITIVE' });
      expect(update.status).toBe(200);
      expect(update.body.data.chronicConditions).toBe('Mild asthma');
      // Omitted fields are left as-is (zod .optional() -> undefined -> Prisma
      // skips the column) — a partial-update semantic, same convention as
      // discipline.ts/supportNeeds.ts's optional string fields. A field is
      // only cleared by explicitly sending it as an empty value.
      expect(update.body.data.allergies).toBe('Penicillin');
    });

    it('a TEACHER can read a health profile but not write it', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);

      const read = await request(app)
        .get(`/api/health/profiles/${student.id}`)
        .set(authHeader(classTeacher.accessToken));
      expect(read.status).toBe(200);

      const write = await request(app)
        .put(`/api/health/profiles/${student.id}`)
        .set(authHeader(classTeacher.accessToken))
        .send({ bloodGroup: 'O_POSITIVE' });
      expect(write.status).toBe(403);
    });

    it('FRONT_DESK can read and write a health profile', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'fd@test-school.test',
        role: 'FRONT_DESK',
      });

      const write = await request(app)
        .put(`/api/health/profiles/${student.body.data.id}`)
        .set(authHeader(frontDesk.accessToken))
        .send({ bloodGroup: 'A_NEGATIVE' });
      expect(write.status).toBe(200);
      expect(write.body.data.bloodGroup).toBe('A_NEGATIVE');
    });

    it('a TEACHER outside the student\'s section cannot read the profile', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, otherTeacher } = await setupStudentWithTeachers(accessToken, tenant);

      const res = await request(app)
        .get(`/api/health/profiles/${student.id}`)
        .set(authHeader(otherTeacher.accessToken));
      expect(res.status).toBe(403);
    });

    it('ACCOUNTANT is blocked entirely (403)', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      const accountant = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'acct@test-school.test',
        role: 'ACCOUNTANT',
      });

      const res = await request(app)
        .get(`/api/health/profiles/${student.body.data.id}`)
        .set(authHeader(accountant.accessToken));
      expect(res.status).toBe(403);
    });
  });

  describe('Health log entries', () => {
    it('SCHOOL_ADMIN logs a clinic visit and can list/fetch it', async () => {
      const { accessToken } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const create = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: student.body.data.id,
          visitDate: '2026-03-10',
          complaint: 'Mild fever during assembly.',
          actionTaken: 'Given water and rest in the office; temperature checked.',
          outcome: 'PARENT_CALLED_TO_COLLECT',
        });
      expect(create.status).toBe(201);
      expect(create.body.data.outcome).toBe('PARENT_CALLED_TO_COLLECT');
      expect(create.body.data.guardianNotified).toBe(false);

      const list = await request(app).get('/api/health/log-entries').set(authHeader(accessToken));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);

      const detail = await request(app)
        .get(`/api/health/log-entries/${create.body.data.id}`)
        .set(authHeader(accessToken));
      expect(detail.status).toBe(200);
      expect(detail.body.data.complaint).toMatch(/fever/);
    });

    it('defaults outcome to RETURNED_TO_CLASS when omitted', async () => {
      const { accessToken } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const create = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: student.body.data.id,
          visitDate: '2026-03-10',
          complaint: 'Small scrape on the knee during sports.',
          actionTaken: 'Cleaned and bandaged the scrape.',
        });
      expect(create.body.data.outcome).toBe('RETURNED_TO_CLASS');
    });

    it('a TEACHER can log/view entries only for students in their own sections', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher, otherTeacher } = await setupStudentWithTeachers(accessToken, tenant);

      const byClassTeacher = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(classTeacher.accessToken))
        .send({
          studentId: student.id,
          visitDate: '2026-03-10',
          complaint: 'Headache during class.',
          actionTaken: 'Sent to the office, given a short rest.',
        });
      expect(byClassTeacher.status).toBe(201);

      const byOtherTeacher = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(otherTeacher.accessToken))
        .send({
          studentId: student.id,
          visitDate: '2026-03-10',
          complaint: 'Should be forbidden — not this teacher\'s section.',
          actionTaken: 'N/A',
        });
      expect(byOtherTeacher.status).toBe(403);

      const listByOther = await request(app)
        .get('/api/health/log-entries')
        .set(authHeader(otherTeacher.accessToken));
      expect(listByOther.body.data).toHaveLength(0);

      const listByClassTeacher = await request(app)
        .get('/api/health/log-entries')
        .set(authHeader(classTeacher.accessToken));
      expect(listByClassTeacher.body.data).toHaveLength(1);
    });

    it('a TEACHER can only edit entries they themselves logged; SCHOOL_ADMIN can edit any', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);

      const created = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken)) // logged by the admin
        .send({
          studentId: student.id,
          visitDate: '2026-03-10',
          complaint: 'Stomach ache after lunch.',
          actionTaken: 'Given ORS and rested for 30 minutes.',
        });

      const teacherEdit = await request(app)
        .patch(`/api/health/log-entries/${created.body.data.id}`)
        .set(authHeader(classTeacher.accessToken))
        .send({ outcome: 'SENT_HOME' });
      expect(teacherEdit.status).toBe(403);

      const adminEdit = await request(app)
        .patch(`/api/health/log-entries/${created.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ outcome: 'SENT_HOME' });
      expect(adminEdit.status).toBe(200);
      expect(adminEdit.body.data.outcome).toBe('SENT_HOME');
    });

    it('only SCHOOL_ADMIN can delete a health log entry', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);
      const created = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(classTeacher.accessToken))
        .send({
          studentId: student.id,
          visitDate: '2026-03-10',
          complaint: 'Test entry.',
          actionTaken: 'N/A',
        });

      const teacherDelete = await request(app)
        .delete(`/api/health/log-entries/${created.body.data.id}`)
        .set(authHeader(classTeacher.accessToken));
      expect(teacherDelete.status).toBe(403);

      const adminDelete = await request(app)
        .delete(`/api/health/log-entries/${created.body.data.id}`)
        .set(authHeader(accessToken));
      expect(adminDelete.status).toBe(204);
    });

    it('filters by studentId, outcome, and date range', async () => {
      const { accessToken } = await signupSchool(app);
      const s1 = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      const s2 = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ali Raza', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const r1 = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: s1.body.data.id,
          visitDate: '2026-01-15',
          complaint: 'Minor headache.',
          actionTaken: 'Rested in the office.',
        });
      await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: s2.body.data.id,
          visitDate: '2026-02-15',
          complaint: 'Fell during sports, twisted ankle.',
          actionTaken: 'Ice pack applied, parent called.',
          outcome: 'PARENT_CALLED_TO_COLLECT',
        });

      const byStudent = await request(app)
        .get(`/api/health/log-entries?studentId=${s1.body.data.id}`)
        .set(authHeader(accessToken));
      expect(byStudent.body.data).toHaveLength(1);
      expect(byStudent.body.data[0].id).toBe(r1.body.data.id);

      const byOutcome = await request(app)
        .get('/api/health/log-entries?outcome=PARENT_CALLED_TO_COLLECT')
        .set(authHeader(accessToken));
      expect(byOutcome.body.data).toHaveLength(1);

      const byDateRange = await request(app)
        .get('/api/health/log-entries?from=2026-02-01&to=2026-02-28')
        .set(authHeader(accessToken));
      expect(byDateRange.body.data).toHaveLength(1);
      expect(byDateRange.body.data[0].complaint).toMatch(/ankle/);
    });

    it('notifyGuardianNow dispatches a (simulated, in test env) SMS to every linked guardian and marks guardianNotified', async () => {
      const { accessToken } = await signupSchool(app, { plan: 'STANDARD' });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      await request(app)
        .post('/api/guardians')
        .set(authHeader(accessToken))
        .send({
          fullName: 'Tariq Khan',
          relationship: 'FATHER',
          phone: '03001234567',
          studentId: student.body.data.id,
          isPrimary: true,
        });

      const create = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: student.body.data.id,
          visitDate: '2026-03-10',
          complaint: 'High fever, sent home.',
          actionTaken: 'Parent informed and asked to collect.',
          outcome: 'SENT_HOME',
          notifyGuardianNow: true,
        });
      expect(create.status).toBe(201);
      expect(create.body.data.guardianNotified).toBe(true);
      expect(create.body.data.guardianNotifiedAt).not.toBeNull();
    });

    it('notifyGuardianNow degrades gracefully (entry still created) when the plan has no SMS credits', async () => {
      const { accessToken } = await signupSchool(app); // default TRIAL — 0 SMS credits
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      await request(app)
        .post('/api/guardians')
        .set(authHeader(accessToken))
        .send({
          fullName: 'Tariq Khan',
          relationship: 'FATHER',
          phone: '03001234567',
          studentId: student.body.data.id,
          isPrimary: true,
        });

      const create = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(accessToken))
        .send({
          studentId: student.body.data.id,
          visitDate: '2026-03-10',
          complaint: 'Fever.',
          actionTaken: 'Rested in the office.',
          notifyGuardianNow: true,
        });
      expect(create.status).toBe(201);
      expect(create.body.data.guardianNotified).toBe(false);
    });

    it('FRONT_DESK can log and read entries', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'fd@test-school.test',
        role: 'FRONT_DESK',
      });

      const create = await request(app)
        .post('/api/health/log-entries')
        .set(authHeader(frontDesk.accessToken))
        .send({
          studentId: student.body.data.id,
          visitDate: '2026-03-10',
          complaint: 'Nosebleed.',
          actionTaken: 'First aid given at the front office.',
        });
      expect(create.status).toBe(201);
    });

    it('ACCOUNTANT is blocked entirely (403)', async () => {
      const { tenant } = await signupSchool(app);
      const accountant = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'acct@test-school.test',
        role: 'ACCOUNTANT',
      });
      const res = await request(app).get('/api/health/log-entries').set(authHeader(accountant.accessToken));
      expect(res.status).toBe(403);
    });
  });
});
