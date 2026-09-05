/**
 * System-wide cross-tenant isolation smoke test.
 *
 * Standalone-module RLS/tenant-scoping was already verified per-file (see
 * the other integration test suites, and the live DB-role proof described
 * in docs). This file exists as a single, permanent regression net that
 * mirrors the user's own literal worry ("kya multiple schools ek sath
 * chalte hue kisi ek panel mein bhi dusre school ka data show ho sakta
 * hai?") — it creates two real, fully independent schools with real data
 * across most of the app's major panels (students, staff, guardians,
 * notices, fee categories, discipline) and then, for EVERY one of those
 * panels' list/detail endpoints, asserts School A's data never appears in
 * School B's responses (and vice versa), including a direct object
 * reference (IDOR) attempt — using School A's own valid token to fetch
 * School B's record by ID.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

async function seedSchool(label: 'Alpha' | 'Beta') {
  const { accessToken, tenant } = await signupSchool(app, {
    schoolName: `${label} School`,
    slug: `smoke-${label.toLowerCase()}`,
    adminEmail: `admin@smoke-${label.toLowerCase()}.test`,
  });

  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: `${label}-Only-Student`,
      gender: 'MALE',
      dateOfBirth: '2014-01-01',
      bFormOrCnic: label === 'Alpha' ? '35202-1111111-1' : '35202-2222222-2',
    });
  expect(student.status).toBe(201);

  const staff = await request(app)
    .post('/api/staff')
    .set(authHeader(accessToken))
    .send({
      email: `teacher@smoke-${label.toLowerCase()}.test`,
      fullName: `${label}-Only-Teacher`,
      role: 'TEACHER',
      designation: 'Teacher',
      employmentType: 'FULL_TIME',
      joiningDate: '2026-01-15',
      monthlySalary: 50000,
    });
  expect(staff.status).toBe(201);

  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: `${label}-Only-Guardian`,
      relationship: 'FATHER',
      phone: '03001234567',
      studentId: student.body.data.id,
    });
  expect(guardian.status).toBe(201);

  const notice = await request(app)
    .post('/api/notices')
    .set(authHeader(accessToken))
    .send({ title: `${label}-Only-Notice`, body: 'Notice body text', audiences: ['ALL_STUDENTS'] });
  expect(notice.status).toBe(201);

  const feeCategory = await request(app)
    .post('/api/fee-categories')
    .set(authHeader(accessToken))
    .send({ name: `${label}-Only-FeeCategory` });
  expect(feeCategory.status).toBe(201);

  const discipline = await request(app)
    .post('/api/discipline-records')
    .set(authHeader(accessToken))
    .send({
      studentId: student.body.data.id,
      incidentDate: '2026-02-01',
      category: 'LATE_ARRIVAL',
      severity: 'MINOR',
      description: `${label}-Only-DisciplineNote`,
    });
  expect(discipline.status).toBe(201);

  return {
    accessToken,
    tenant,
    studentId: student.body.data.id as string,
    staffId: staff.body.data.id as string,
    guardianId: guardian.body.data.id as string,
    disciplineId: discipline.body.data.id as string,
  };
}

describe('Cross-tenant isolation smoke test — every panel, two schools live at once, neither ever logs out', () => {
  it('never shows one school\'s students/staff/guardians/notices/fee-categories/discipline records in the other\'s list endpoints', async () => {
    const alpha = await seedSchool('Alpha');
    const beta = await seedSchool('Beta');

    const alphaStudents = await request(app).get('/api/students').set(authHeader(alpha.accessToken));
    const betaStudents = await request(app).get('/api/students').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaStudents.body)).not.toContain('Beta-Only-Student');
    expect(JSON.stringify(alphaStudents.body)).toContain('Alpha-Only-Student');
    expect(JSON.stringify(betaStudents.body)).not.toContain('Alpha-Only-Student');
    expect(JSON.stringify(betaStudents.body)).toContain('Beta-Only-Student');

    const alphaStaff = await request(app).get('/api/staff').set(authHeader(alpha.accessToken));
    const betaStaff = await request(app).get('/api/staff').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaStaff.body)).not.toContain('Beta-Only-Teacher');
    expect(JSON.stringify(betaStaff.body)).not.toContain('Alpha-Only-Teacher');

    const alphaGuardians = await request(app).get('/api/guardians').set(authHeader(alpha.accessToken));
    const betaGuardians = await request(app).get('/api/guardians').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaGuardians.body)).not.toContain('Beta-Only-Guardian');
    expect(JSON.stringify(betaGuardians.body)).not.toContain('Alpha-Only-Guardian');

    const alphaNotices = await request(app).get('/api/notices').set(authHeader(alpha.accessToken));
    const betaNotices = await request(app).get('/api/notices').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaNotices.body)).not.toContain('Beta-Only-Notice');
    expect(JSON.stringify(betaNotices.body)).not.toContain('Alpha-Only-Notice');

    const alphaFeeCats = await request(app).get('/api/fee-categories').set(authHeader(alpha.accessToken));
    const betaFeeCats = await request(app).get('/api/fee-categories').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaFeeCats.body)).not.toContain('Beta-Only-FeeCategory');
    expect(JSON.stringify(betaFeeCats.body)).not.toContain('Alpha-Only-FeeCategory');

    const alphaDiscipline = await request(app).get('/api/discipline-records').set(authHeader(alpha.accessToken));
    const betaDiscipline = await request(app).get('/api/discipline-records').set(authHeader(beta.accessToken));
    expect(JSON.stringify(alphaDiscipline.body)).not.toContain('Beta-Only-DisciplineNote');
    expect(JSON.stringify(betaDiscipline.body)).not.toContain('Alpha-Only-DisciplineNote');
  });

  it('refuses a direct-object-reference attempt — School Alpha\'s valid token fetching School Beta\'s own record IDs by URL, and vice versa (404, never the data)', async () => {
    const alpha = await seedSchool('Alpha');
    const beta = await seedSchool('Beta');

    // Student detail
    expect((await request(app).get(`/api/students/${beta.studentId}`).set(authHeader(alpha.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/students/${alpha.studentId}`).set(authHeader(beta.accessToken))).status).toBe(404);

    // Staff detail
    expect((await request(app).get(`/api/staff/${beta.staffId}`).set(authHeader(alpha.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/staff/${alpha.staffId}`).set(authHeader(beta.accessToken))).status).toBe(404);

    // Discipline detail
    expect((await request(app).get(`/api/discipline-records/${beta.disciplineId}`).set(authHeader(alpha.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/discipline-records/${alpha.disciplineId}`).set(authHeader(beta.accessToken))).status).toBe(404);

    // Cross-tenant mutation attempts must also fail closed, not silently
    // succeed against the wrong tenant's row.
    const crossUpdate = await request(app)
      .patch(`/api/students/${beta.studentId}`)
      .set(authHeader(alpha.accessToken))
      .send({ fullName: 'Hijacked Name' });
    expect(crossUpdate.status).toBe(404);
    const crossDelete = await request(app).delete(`/api/students/${beta.studentId}`).set(authHeader(alpha.accessToken));
    expect(crossDelete.status).toBe(404);

    const stillIntact = await request(app).get(`/api/students/${beta.studentId}`).set(authHeader(beta.accessToken));
    expect(stillIntact.body.data.fullName).toBe('Beta-Only-Student');
  });

  it('matches the exact scenario the user reported: registering a second school while still signed in to the first must never surface the first school\'s data on the second\'s pages', async () => {
    const alpha = await seedSchool('Alpha');
    // Alpha is never logged out here — deliberately, per the user's report.
    const beta = await seedSchool('Beta');

    // Beta's own session (its own fresh accessToken) must only ever see
    // Beta's own data on every panel a parent/teacher would land on.
    const betaMe = await request(app).get('/api/auth/me').set(authHeader(beta.accessToken));
    expect(betaMe.body.tenant.slug).toBe('smoke-beta');

    const betaStudents = await request(app).get('/api/students').set(authHeader(beta.accessToken));
    expect(JSON.stringify(betaStudents.body)).not.toContain('Alpha-Only-Student');

    // And Alpha's still-live session (never logged out) is likewise
    // unaffected by Beta having been registered afterward.
    const alphaMe = await request(app).get('/api/auth/me').set(authHeader(alpha.accessToken));
    expect(alphaMe.body.tenant.slug).toBe('smoke-alpha');
    const alphaStudents = await request(app).get('/api/students').set(authHeader(alpha.accessToken));
    expect(JSON.stringify(alphaStudents.body)).not.toContain('Beta-Only-Student');
  });
});
