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
 * Builds a section with a class teacher, a separate subject teacher, and an
 * enrolled student — the cast needed to test "class teacher and subject
 * teacher can both act on this student, an unrelated teacher cannot".
 */
async function setupStudentWithTeachers(accessToken: string, tenant: { id: string; slug: string }) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 5', order: 5 });

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
      fullName: 'Bilal Ahmed',
      gender: 'MALE',
      dateOfBirth: '2014-06-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });

  return { section: section.body.data, student: student.body.data, classTeacher, otherTeacher };
}

describe('Discipline records', () => {
  it('SCHOOL_ADMIN logs an incident and can list/fetch it', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const create = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-10',
        category: 'FIGHTING',
        severity: 'MAJOR',
        description: 'Got into a physical altercation with another student during recess.',
        actionTaken: 'PARENT_CALLED',
        actionNotes: 'Called the father, he is coming to school tomorrow.',
      });
    expect(create.status).toBe(201);
    expect(create.body.data.category).toBe('FIGHTING');
    expect(create.body.data.actionTaken).toBe('PARENT_CALLED');
    expect(create.body.data.resolved).toBe(false);
    expect(create.body.data.reportedByUser.email).toBeUndefined(); // only id/fullName selected
    expect(create.body.data.student.fullName).toBe('Ahmed Khan');

    const list = await request(app).get('/api/discipline-records').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const detail = await request(app)
      .get(`/api/discipline-records/${create.body.data.id}`)
      .set(authHeader(accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.description).toMatch(/altercation/);
  });

  it('defaults actionTaken to NONE and guardianNotified to false when omitted', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const create = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-10',
        category: 'UNIFORM_VIOLATION',
        severity: 'MINOR',
        description: 'Not wearing the school tie.',
      });
    expect(create.body.data.actionTaken).toBe('NONE');
    expect(create.body.data.guardianNotified).toBe(false);
  });

  it('a TEACHER can log/view incidents only for students in their own sections', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher, otherTeacher } = await setupStudentWithTeachers(accessToken, tenant);

    const byClassTeacher = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(classTeacher.accessToken))
      .send({
        studentId: student.id,
        incidentDate: '2026-02-10',
        category: 'DISRUPTIVE_BEHAVIOR',
        severity: 'MODERATE',
        description: 'Repeatedly talking during the lesson despite warnings.',
      });
    expect(byClassTeacher.status).toBe(201);

    const byOtherTeacher = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(otherTeacher.accessToken))
      .send({
        studentId: student.id,
        incidentDate: '2026-02-10',
        category: 'DISRUPTIVE_BEHAVIOR',
        severity: 'MODERATE',
        description: 'Should be forbidden — not this teacher\'s section.',
      });
    expect(byOtherTeacher.status).toBe(403);

    const listByOther = await request(app).get('/api/discipline-records').set(authHeader(otherTeacher.accessToken));
    expect(listByOther.status).toBe(200);
    expect(listByOther.body.data).toHaveLength(0); // scoped away, not just forbidden to create

    const listByClassTeacher = await request(app)
      .get('/api/discipline-records')
      .set(authHeader(classTeacher.accessToken));
    expect(listByClassTeacher.body.data).toHaveLength(1);
  });

  it('a TEACHER can only edit records they themselves reported', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);

    const created = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(accessToken)) // reported by the admin
      .send({
        studentId: student.id,
        incidentDate: '2026-02-10',
        category: 'CHEATING',
        severity: 'MAJOR',
        description: 'Copying from another student during a quiz.',
      });

    const teacherEdit = await request(app)
      .patch(`/api/discipline-records/${created.body.data.id}`)
      .set(authHeader(classTeacher.accessToken))
      .send({ resolved: true });
    expect(teacherEdit.status).toBe(403);

    const adminEdit = await request(app)
      .patch(`/api/discipline-records/${created.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ resolved: true, resolvedNote: 'Spoke with the student; will not recur.' });
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.body.data.resolved).toBe(true);
    expect(adminEdit.body.data.resolvedAt).not.toBeNull();
  });

  it('only SCHOOL_ADMIN can delete a discipline record', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);
    const created = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(classTeacher.accessToken))
      .send({
        studentId: student.id,
        incidentDate: '2026-02-10',
        category: 'BULLYING',
        severity: 'MAJOR',
        description: 'Reported bullying incident in the playground.',
      });

    const teacherDelete = await request(app)
      .delete(`/api/discipline-records/${created.body.data.id}`)
      .set(authHeader(classTeacher.accessToken));
    expect(teacherDelete.status).toBe(403);

    const adminDelete = await request(app)
      .delete(`/api/discipline-records/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(adminDelete.status).toBe(204);
  });

  it('filters by studentId, category, severity, resolved, and date range', async () => {
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
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: s1.body.data.id,
        incidentDate: '2026-01-15',
        category: 'LATE_ARRIVAL',
        severity: 'MINOR',
        description: 'Late by 10 minutes.',
      });
    await request(app)
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: s2.body.data.id,
        incidentDate: '2026-02-15',
        category: 'FIGHTING',
        severity: 'MAJOR',
        description: 'Fight in the corridor.',
      });

    const byStudent = await request(app)
      .get(`/api/discipline-records?studentId=${s1.body.data.id}`)
      .set(authHeader(accessToken));
    expect(byStudent.body.data).toHaveLength(1);
    expect(byStudent.body.data[0].id).toBe(r1.body.data.id);

    const byCategory = await request(app)
      .get('/api/discipline-records?category=FIGHTING')
      .set(authHeader(accessToken));
    expect(byCategory.body.data).toHaveLength(1);
    expect(byCategory.body.data[0].category).toBe('FIGHTING');

    const bySeverity = await request(app)
      .get('/api/discipline-records?severity=MAJOR')
      .set(authHeader(accessToken));
    expect(bySeverity.body.data).toHaveLength(1);

    const byResolved = await request(app)
      .get('/api/discipline-records?resolved=false')
      .set(authHeader(accessToken));
    expect(byResolved.body.data).toHaveLength(2);

    const byDateRange = await request(app)
      .get('/api/discipline-records?from=2026-02-01&to=2026-02-28')
      .set(authHeader(accessToken));
    expect(byDateRange.body.data).toHaveLength(1);
    expect(byDateRange.body.data[0].category).toBe('FIGHTING');
  });

  it('notifyGuardianNow dispatches a (simulated, in test env) SMS to every linked guardian and marks guardianNotified', async () => {
    // TRIAL/BASIC plans have zero SMS credits (see config/plans.ts) — this
    // exercises the actual "guardian gets messaged" path, so it needs a
    // plan where SMS is available at all, same as notifications.test.ts.
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
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-10',
        category: 'FIGHTING',
        severity: 'MAJOR',
        description: 'Serious altercation — parent must be informed immediately.',
        notifyGuardianNow: true,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.guardianNotified).toBe(true);
    expect(create.body.data.guardianNotifiedAt).not.toBeNull();
  });

  it('notifyGuardianNow degrades gracefully (record still created) when the plan has no SMS credits', async () => {
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
      .post('/api/discipline-records')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-10',
        category: 'FIGHTING',
        severity: 'MAJOR',
        description: 'Serious altercation.',
        notifyGuardianNow: true,
      });
    expect(create.status).toBe(201); // the record itself is never blocked by a notification failure
    expect(create.body.data.guardianNotified).toBe(false);
  });

  it('FRONT_DESK can read but not create a discipline record (403)', async () => {
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

    const readRes = await request(app).get('/api/discipline-records').set(authHeader(frontDesk.accessToken));
    expect(readRes.status).toBe(200);

    const createRes = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(frontDesk.accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-10',
        category: 'OTHER',
        severity: 'MINOR',
        description: 'Should be forbidden for FRONT_DESK.',
      });
    expect(createRes.status).toBe(403);
  });

  it('ACCOUNTANT is blocked entirely (403)', async () => {
    const { tenant } = await signupSchool(app);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'acct@test-school.test',
      role: 'ACCOUNTANT',
    });
    const res = await request(app).get('/api/discipline-records').set(authHeader(accountant.accessToken));
    expect(res.status).toBe(403);
  });
});
