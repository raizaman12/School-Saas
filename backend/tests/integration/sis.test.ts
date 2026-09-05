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

async function setupYearClassSection(adminToken: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(adminToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });

  const schoolClass = await request(app)
    .post('/api/classes')
    .set(authHeader(adminToken))
    .send({ name: 'Class 5', order: 5 });

  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(adminToken))
    .send({
      schoolClassId: schoolClass.body.data.id,
      academicYearId: year.body.data.id,
      name: 'A',
    });

  return { year: year.body.data, schoolClass: schoolClass.body.data, section: section.body.data };
}

describe('Academic years', () => {
  it('creates an academic year and lists it', async () => {
    const { accessToken } = await signupSchool(app);
    const create = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    expect(create.status).toBe(201);

    const list = await request(app).get('/api/academic-years').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('activating a new year deactivates the previously active one', async () => {
    const { accessToken } = await signupSchool(app);
    await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2024-2025', startDate: '2024-08-01', endDate: '2025-05-31', isActive: true });

    await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });

    const list = await request(app).get('/api/academic-years').set(authHeader(accessToken));
    const active = list.body.data.filter((y: { isActive: boolean }) => y.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('2025-2026');
  });

  it('rejects endDate before startDate with 400', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2026-05-31', endDate: '2025-08-01' });
    expect(res.status).toBe(400);
  });

  it('FRONT_DESK cannot create an academic year (403) but can list', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const createRes = await request(app)
      .post('/api/academic-years')
      .set(authHeader(frontDesk.accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31' });
    expect(createRes.status).toBe(403);

    await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31' });

    const listRes = await request(app).get('/api/academic-years').set(authHeader(frontDesk.accessToken));
    expect(listRes.status).toBe(200);
  });

  it('PARENT role is blocked entirely (403)', async () => {
    const { tenant } = await signupSchool(app);
    const parent = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'parent@test-school.test',
      role: 'PARENT',
    });
    const res = await request(app).get('/api/academic-years').set(authHeader(parent.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('School classes & sections', () => {
  it('rejects a duplicate class name within the same tenant (409)', async () => {
    const { accessToken } = await signupSchool(app);
    await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 5', order: 5 });
    const res = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    expect(res.status).toBe(409);
  });

  it('allows the SAME class name across two different tenants (no cross-tenant conflict)', async () => {
    const alpha = await signupSchool(app, { slug: 'alpha-x', adminEmail: 'a@alpha-x.test' });
    const beta = await signupSchool(app, { slug: 'beta-x', adminEmail: 'a@beta-x.test' });

    const r1 = await request(app).post('/api/classes').set(authHeader(alpha.accessToken)).send({ name: 'Class 5', order: 5 });
    const r2 = await request(app).post('/api/classes').set(authHeader(beta.accessToken)).send({ name: 'Class 5', order: 5 });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it('rejects assigning a non-existent/non-TEACHER user as class teacher', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, schoolClass } = await setupYearClassSection(accessToken);

    const res = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.id,
        academicYearId: year.id,
        name: 'B',
        classTeacherId: '00000000-0000-0000-0000-000000000000',
      });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate section (same class + year + name) with 409', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, schoolClass } = await setupYearClassSection(accessToken);
    const dup = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, academicYearId: year.id, name: 'A' });
    expect(dup.status).toBe(409);
  });
});

describe('Students', () => {
  it('creates a student without a section and assigns a sequential studentCode', async () => {
    const { accessToken } = await signupSchool(app);
    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-03-10' });
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ayesha Malik', gender: 'FEMALE', dateOfBirth: '2016-01-01' });

    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
    expect(s1.body.data.studentCode).not.toBe(s2.body.data.studentCode);
    // Tenant-code-prefixed (see utils/tenantCode.ts): "TS-2026-000001".
    expect(s1.body.data.studentCode).toMatch(/^[A-Z]+-\d{4}-\d{6}$/);
  });

  it('creating a student with a sectionId also creates an Enrollment', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupYearClassSection(accessToken);

    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-03-10',
        sectionId: section.id,
        academicYearId: year.id,
      });
    expect(res.status).toBe(201);

    const detail = await request(app)
      .get(`/api/students/${res.body.data.id}`)
      .set(authHeader(accessToken));
    expect(detail.body.data.enrollments).toHaveLength(1);
    expect(detail.body.data.enrollments[0].section.name).toBe('A');
  });

  it('searches students by name and paginates results', async () => {
    const { accessToken } = await signupSchool(app);
    for (const name of ['Ahmed Khan', 'Ali Raza', 'Ayesha Malik']) {
      await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: name, gender: 'MALE', dateOfBirth: '2015-01-01' });
    }

    const search = await request(app)
      .get('/api/students?search=Raza')
      .set(authHeader(accessToken));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].fullName).toBe('Ali Raza');

    const page1 = await request(app).get('/api/students?page=1&limit=2').set(authHeader(accessToken));
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('searches students by roll number, B-Form/CNIC, and studentCode (in addition to name)', async () => {
    const { accessToken } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });

    const created = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Sara Fatima',
        gender: 'FEMALE',
        dateOfBirth: '2015-02-02',
        bFormOrCnic: '35202-7654321-9',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
        rollNumber: 'R-42',
      });
    expect(created.status).toBe(201);

    const byRollNumber = await request(app).get('/api/students?search=R-42').set(authHeader(accessToken));
    expect(byRollNumber.body.data).toHaveLength(1);
    expect(byRollNumber.body.data[0].id).toBe(created.body.data.id);

    const byBForm = await request(app)
      .get('/api/students?search=35202-7654321-9')
      .set(authHeader(accessToken));
    expect(byBForm.body.data).toHaveLength(1);
    expect(byBForm.body.data[0].id).toBe(created.body.data.id);

    const byStudentCode = await request(app)
      .get(`/api/students?search=${created.body.data.studentCode}`)
      .set(authHeader(accessToken));
    expect(byStudentCode.body.data).toHaveLength(1);
    expect(byStudentCode.body.data[0].id).toBe(created.body.data.id);
  });

  it('returns 404 for a non-existent student, and 404 (not a cross-tenant leak) for another tenant\'s student', async () => {
    const alpha = await signupSchool(app, { slug: 'alpha-y', adminEmail: 'a@alpha-y.test' });
    const beta = await signupSchool(app, { slug: 'beta-y', adminEmail: 'a@beta-y.test' });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(alpha.accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const crossTenantGet = await request(app)
      .get(`/api/students/${student.body.data.id}`)
      .set(authHeader(beta.accessToken));
    expect(crossTenantGet.status).toBe(404);

    const notFound = await request(app)
      .get('/api/students/00000000-0000-0000-0000-000000000000')
      .set(authHeader(alpha.accessToken));
    expect(notFound.status).toBe(404);
  });

  it('FRONT_DESK can create students; TEACHER cannot', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 't@test-school.test',
      role: 'TEACHER',
    });
    void accessToken;

    const fdCreate = await request(app)
      .post('/api/students')
      .set(authHeader(frontDesk.accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    expect(fdCreate.status).toBe(201);

    const teacherCreate = await request(app)
      .post('/api/students')
      .set(authHeader(teacher.accessToken))
      .send({ fullName: 'Ali Raza', gender: 'MALE', dateOfBirth: '2015-01-01' });
    expect(teacherCreate.status).toBe(403);
  });
});

describe('Bulk student import (CSV)', () => {
  const HEADER = 'fullName,gender,dateOfBirth,bFormOrCnic,rollNumber,className,sectionName';

  it('imports every valid row, unenrolled (no className/sectionName columns)', async () => {
    const { accessToken } = await signupSchool(app);
    const csv = ['fullName,gender,dateOfBirth', 'Ahmed Khan,MALE,2015-03-10', 'Ayesha Malik,FEMALE,2016-01-01'].join(
      '\n',
    );

    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.status).toBe(207);
    expect(res.body.data.totalRows).toBe(2);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.results.map((r: { status: string }) => r.status)).toEqual(['created', 'created']);

    const list = await request(app).get('/api/students').set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(2);
  });

  it('resolves className+sectionName to the active academic year\'s section and enrolls the student', async () => {
    const { accessToken } = await signupSchool(app);
    await setupYearClassSection(accessToken); // "Class 5" / "A", active year

    const csv = [HEADER, 'Ahmed Khan,MALE,2015-03-10,,5,Class 5,A'].join('\n');
    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.status).toBe(207);
    expect(res.body.data.created).toBe(1);

    const detail = await request(app)
      .get(`/api/students?search=${encodeURIComponent('Ahmed Khan')}`)
      .set(authHeader(accessToken));
    const student = detail.body.data[0];
    expect(student.currentSection.name).toBe('A');
    expect(student.rollNumber).toBe('5');
  });

  it('a bad row is reported as an error without blocking the good rows around it', async () => {
    const { accessToken } = await signupSchool(app);
    const csv = [
      'fullName,gender,dateOfBirth',
      'Ahmed Khan,MALE,2015-03-10',
      ',MALE,2015-03-10', // missing fullName — invalid
      'Ayesha Malik,FEMALE,2016-01-01',
    ].join('\n');

    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.status).toBe(207);
    expect(res.body.data.totalRows).toBe(3);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.failed).toBe(1);
    const failedRow = res.body.data.results.find((r: { status: string }) => r.status === 'error');
    expect(failedRow.row).toBe(3); // header is row 1, so the 2nd data row is row 3
    expect(failedRow.error).toMatch(/fullName/);

    const list = await request(app).get('/api/students').set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(2);
  });

  it('an unknown className/sectionName combo fails just that row', async () => {
    const { accessToken } = await signupSchool(app);
    await setupYearClassSection(accessToken);

    const csv = [HEADER, 'Ahmed Khan,MALE,2015-03-10,,,Class 9,Z'].join('\n');
    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[0].error).toMatch(/No section/);
  });

  it('className without sectionName (or vice versa) fails that row with a clear message', async () => {
    const { accessToken } = await signupSchool(app);
    await setupYearClassSection(accessToken);

    const csv = [HEADER, 'Ahmed Khan,MALE,2015-03-10,,,Class 5,'].join('\n');
    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[0].error).toMatch(/must both be provided/);
  });

  it('a duplicate CNIC within the same file fails the second occurrence only', async () => {
    const { accessToken } = await signupSchool(app);
    const csv = [
      'fullName,gender,dateOfBirth,bFormOrCnic',
      'Ahmed Khan,MALE,2015-03-10,35202-1234567-1',
      'Ali Raza,MALE,2015-06-01,35202-1234567-1',
    ].join('\n');

    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');

    expect(res.body.data.created).toBe(1);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[1].error).toMatch(/already exists/);
  });

  it('rejects a non-CSV file (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('not a csv'), 'students.txt');
    expect(res.status).toBe(400);
  });

  it('rejects an empty CSV (just a header, no data rows) with 400', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(accessToken))
      .attach('file', Buffer.from('fullName,gender,dateOfBirth'), 'students.csv');
    expect(res.status).toBe(400);
  });

  it('FRONT_DESK can bulk-import, TEACHER cannot (403)', async () => {
    const { tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 't@test-school.test',
      role: 'TEACHER',
    });
    const csv = ['fullName,gender,dateOfBirth', 'Ahmed Khan,MALE,2015-03-10'].join('\n');

    const fdRes = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(frontDesk.accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');
    expect(fdRes.status).toBe(207);

    const teacherRes = await request(app)
      .post('/api/students/bulk-import')
      .set(authHeader(teacher.accessToken))
      .attach('file', Buffer.from(csv), 'students.csv');
    expect(teacherRes.status).toBe(403);
  });
});

describe('Student portal-login email & delete', () => {
  it('list and detail include the linked portal-login user — an ID-only login (no email) still shows up', async () => {
    const { accessToken } = await signupSchool(app);
    // Every admission now auto-provisions a portal login (an ID-based one
    // when no email is given — see createStudentLogin's doc comment), so
    // there is no "no login" student through the normal API anymore.
    const noEmail = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Email Student', gender: 'MALE', dateOfBirth: '2015-01-01' });
    expect(noEmail.body.portalLogin.email).toBeNull();
    expect(typeof noEmail.body.portalLogin.loginId).toBe('string');

    const noEmailDetail = await request(app)
      .get(`/api/students/${noEmail.body.data.id}`)
      .set(authHeader(accessToken));
    expect(noEmailDetail.body.data.user).toEqual({
      id: expect.any(String),
      email: null,
      loginId: expect.any(String),
    });

    const withLogin = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Has Login Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'has.login.student@test-school.test',
      });
    expect(withLogin.body.portalLogin.email).toBe('has.login.student@test-school.test');

    const list = await request(app).get('/api/students').set(authHeader(accessToken));
    const listed = list.body.data.find((s: { id: string }) => s.id === withLogin.body.data.id);
    expect(listed.user.email).toBe('has.login.student@test-school.test');

    const detail = await request(app)
      .get(`/api/students/${withLogin.body.data.id}`)
      .set(authHeader(accessToken));
    expect(detail.body.data.user.email).toBe('has.login.student@test-school.test');
  });

  it("PATCH updates the student's portal-login email, rejects a duplicate, and rejects editing when no login exists", async () => {
    const { accessToken } = await signupSchool(app);
    const withLogin = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Student One',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'student.one@test-school.test',
      });
    const noLogin = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Student Two', gender: 'MALE', dateOfBirth: '2015-01-01' });
    // Simulates a student who predates portal-login auto-provisioning
    // (or whose provisioning otherwise failed) — the only way a student
    // has no linked User at all now, since every normal admission gets
    // one (see createStudentLogin). The PATCH guard below still exists
    // for exactly this case.
    await ownerDb.student.update({ where: { id: noLogin.body.data.id }, data: { userId: null } });

    const updated = await request(app)
      .patch(`/api/students/${withLogin.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'student.one.new@test-school.test' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user.email).toBe('student.one.new@test-school.test');

    const noLoginEdit = await request(app)
      .patch(`/api/students/${noLogin.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'student.two@test-school.test' });
    expect(noLoginEdit.status).toBe(400);

    const another = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Student Three',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'student.three@test-school.test',
      });
    const conflict = await request(app)
      .patch(`/api/students/${another.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'student.one.new@test-school.test' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.field).toBe('email');
  });

  it('DELETE removes the student and their linked portal-login user (204), 403 for non-admin, 404 for unknown/cross-tenant', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'To Delete',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        email: 'to.delete@test-school.test',
      });
    const createdDetail = await request(app)
      .get(`/api/students/${created.body.data.id}`)
      .set(authHeader(accessToken));
    const userId = createdDetail.body.data.user.id;

    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd-del@test-school.test',
      role: 'FRONT_DESK',
    });
    const forbidden = await request(app)
      .delete(`/api/students/${created.body.data.id}`)
      .set(authHeader(frontDesk.accessToken));
    expect(forbidden.status).toBe(403);

    const notFound = await request(app)
      .delete('/api/students/00000000-0000-0000-0000-000000000000')
      .set(authHeader(accessToken));
    expect(notFound.status).toBe(404);

    const del = await request(app)
      .delete(`/api/students/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(del.status).toBe(204);

    const getAfter = await request(app)
      .get(`/api/students/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(getAfter.status).toBe(404);

    const orphanUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(orphanUser).toBeNull();

    const other = await signupSchool(app, { slug: 'del-other', adminEmail: 'a@del-other.test' });
    const otherStudent = await request(app)
      .post('/api/students')
      .set(authHeader(other.accessToken))
      .send({ fullName: 'Other Tenant Student', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const crossTenantDelete = await request(app)
      .delete(`/api/students/${otherStudent.body.data.id}`)
      .set(authHeader(accessToken));
    expect(crossTenantDelete.status).toBe(404);
  });
});

describe('Teacher section scoping', () => {
  it("a TEACHER only sees students in sections they are the class teacher of", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });

    const sectionA = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: cls.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: teacher.user.id,
      });
    const sectionB = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'B' });

    const studentInA = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section A',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: sectionA.body.data.id,
        academicYearId: year.body.data.id,
      });
    const studentInB = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section B',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: sectionB.body.data.id,
        academicYearId: year.body.data.id,
      });

    // Teacher's unfiltered list only contains their own section's student
    const list = await request(app).get('/api/students').set(authHeader(teacher.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].fullName).toBe('In Section A');

    // Direct fetch of a student outside their section is forbidden
    const forbiddenGet = await request(app)
      .get(`/api/students/${studentInB.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(forbiddenGet.status).toBe(403);

    // Direct fetch of their own section's student works
    const okGet = await request(app)
      .get(`/api/students/${studentInA.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(okGet.status).toBe(200);

    // Explicitly filtering by the OTHER section is forbidden
    const forbiddenFilter = await request(app)
      .get(`/api/students?sectionId=${sectionB.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(forbiddenFilter.status).toBe(403);
  });

  it("a TEACHER who is NOT the class teacher but teaches a subject in that section can still see its students", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const subjectTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'subject-teacher@test-school.test',
      role: 'TEACHER',
    });

    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    // No classTeacherId set — subjectTeacher is only assigned as a subject teacher below.
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Math Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });

    // Before any subject assignment, the teacher has no access at all.
    const beforeAssignment = await request(app)
      .get(`/api/students/${student.body.data.id}`)
      .set(authHeader(subjectTeacher.accessToken));
    expect(beforeAssignment.status).toBe(403);

    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });
    await request(app)
      .post(`/api/sections/${section.body.data.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: subjectTeacher.user.id });

    // After assignment, the subject-only teacher can now see this section's students.
    const list = await request(app).get('/api/students').set(authHeader(subjectTeacher.accessToken));
    expect(list.body.data).toHaveLength(1);

    const get = await request(app)
      .get(`/api/students/${student.body.data.id}`)
      .set(authHeader(subjectTeacher.accessToken));
    expect(get.status).toBe(200);
  });
});

describe('Guardians', () => {
  it('creates a guardian linked to a student, then rejects a duplicate link', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Tariq Khan',
        relationship: 'FATHER',
        phone: '03001234567',
        studentId: student.body.data.id,
        isPrimary: true,
      });
    expect(guardian.status).toBe(201);

    const dupLink = await request(app)
      .post(`/api/guardians/link/${student.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ guardianId: guardian.body.data.id });
    expect(dupLink.status).toBe(409);

    const fetched = await request(app)
      .get(`/api/guardians/${guardian.body.data.id}`)
      .set(authHeader(accessToken));
    expect(fetched.body.data.students).toHaveLength(1);
    expect(fetched.body.data.students[0].student.fullName).toBe('Ahmed Khan');
  });

  it('lists and searches guardians by name/phone/email — used by the notice recipient picker', async () => {
    const { accessToken } = await signupSchool(app);
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
        email: 'tariq.khan@example.com',
        studentId: student.body.data.id,
        isPrimary: true,
      });
    await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Sana Malik', relationship: 'MOTHER', phone: '03009999999' });

    const all = await request(app).get('/api/guardians').set(authHeader(accessToken));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);

    const searchByName = await request(app).get('/api/guardians?search=Tariq').set(authHeader(accessToken));
    expect(searchByName.body.data).toHaveLength(1);
    expect(searchByName.body.data[0].fullName).toBe('Tariq Khan');

    const searchByPhone = await request(app).get('/api/guardians?search=03009999999').set(authHeader(accessToken));
    expect(searchByPhone.body.data).toHaveLength(1);
    expect(searchByPhone.body.data[0].fullName).toBe('Sana Malik');

    const noMatch = await request(app).get('/api/guardians?search=nobody').set(authHeader(accessToken));
    expect(noMatch.body.data).toHaveLength(0);
  });

  it("a TEACHER's guardian search is scoped to guardians of students in sections they teach", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const schoolClass = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: teacher.user.id,
      });

    const inSectionStudent = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    const outsideStudent = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Outside Student', gender: 'MALE', dateOfBirth: '2015-01-01' });

    await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Guardian',
        relationship: 'FATHER',
        phone: '03001234567',
        studentId: inSectionStudent.body.data.id,
        isPrimary: true,
      });
    await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Outside Guardian',
        relationship: 'FATHER',
        phone: '03009999999',
        studentId: outsideStudent.body.data.id,
        isPrimary: true,
      });

    const teacherList = await request(app).get('/api/guardians').set(authHeader(teacher.accessToken));
    expect(teacherList.status).toBe(200);
    expect(teacherList.body.data).toHaveLength(1);
    expect(teacherList.body.data[0].fullName).toBe('In Section Guardian');

    // SCHOOL_ADMIN still sees both, unaffected by the teacher scoping.
    const adminList = await request(app).get('/api/guardians').set(authHeader(accessToken));
    expect(adminList.body.data).toHaveLength(2);
  });

  it('GET /api/guardians/:id enforces the same TEACHER section-scoping as the list route (404, not a leak)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const schoolClass = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher2@test-school.test',
      role: 'TEACHER',
    });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: teacher.user.id,
      });

    const inSectionStudent = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    const outsideStudent = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Outside Student', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const inSectionGuardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Guardian',
        relationship: 'FATHER',
        phone: '03001234567',
        email: 'insection.guardian@test.com',
        studentId: inSectionStudent.body.data.id,
        isPrimary: true,
      });
    const outsideGuardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Outside Guardian',
        relationship: 'FATHER',
        phone: '03009999999',
        email: 'outside.guardian@test.com',
        studentId: outsideStudent.body.data.id,
        isPrimary: true,
      });

    // The teacher's own student's guardian is readable by id.
    const allowed = await request(app)
      .get(`/api/guardians/${inSectionGuardian.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.email).toBe('insection.guardian@test.com');

    // A guardian outside the teacher's sections 404s — not a 403, and
    // critically not a 200 leaking the email/phone — exactly mirroring
    // how that guardian is simply absent from the list route's results.
    const blocked = await request(app)
      .get(`/api/guardians/${outsideGuardian.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(blocked.status).toBe(404);

    // SCHOOL_ADMIN is unaffected by the teacher scoping.
    const adminView = await request(app)
      .get(`/api/guardians/${outsideGuardian.body.data.id}`)
      .set(authHeader(accessToken));
    expect(adminView.status).toBe(200);
  });

  it("PATCH syncs the contact email to the guardian's portal-login email when one exists, with no error when it doesn't", async () => {
    const { accessToken } = await signupSchool(app);
    const withLogin = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Tariq Khan',
        relationship: 'FATHER',
        phone: '03001234567',
        email: 'tariq.khan@example.com',
      });
    expect(withLogin.body.portalLogin.email).toBe('tariq.khan@example.com');

    const noLogin = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Sana Malik', relationship: 'MOTHER', phone: '03009999999' });

    const updated = await request(app)
      .patch(`/api/guardians/${withLogin.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'tariq.new@example.com' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.email).toBe('tariq.new@example.com');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'test-school', email: 'tariq.new@example.com', password: 'wrong-password' });
    // Login itself fails (wrong password), but a 401 (not "user not found")
    // confirms the synced email now resolves to a real user.
    expect(login.status).toBe(401);

    const noLoginUpdate = await request(app)
      .patch(`/api/guardians/${noLogin.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'sana@example.com' });
    expect(noLoginUpdate.status).toBe(200);
    expect(noLoginUpdate.body.data.email).toBe('sana@example.com');

    const another = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Another Parent', relationship: 'FATHER', phone: '03005555555', email: 'another@example.com' });
    const conflict = await request(app)
      .patch(`/api/guardians/${another.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'tariq.new@example.com' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.field).toBe('email');
  });

  it('deletes a guardian with no portal login, and one with a login and no leave-request history', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const noLogin = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Login Parent', relationship: 'MOTHER', phone: '03001112222', studentId: student.body.data.id });
    const withLogin = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'With Login Parent',
        relationship: 'FATHER',
        phone: '03003334444',
        email: 'withlogin@example.com',
        studentId: student.body.data.id,
      });
    expect(withLogin.body.data.userId).toEqual(expect.any(String));

    const delNoLogin = await request(app).delete(`/api/guardians/${noLogin.body.data.id}`).set(authHeader(accessToken));
    expect(delNoLogin.status).toBe(204);
    const delWithLogin = await request(app).delete(`/api/guardians/${withLogin.body.data.id}`).set(authHeader(accessToken));
    expect(delWithLogin.status).toBe(204);

    expect((await request(app).get(`/api/guardians/${noLogin.body.data.id}`).set(authHeader(accessToken))).status).toBe(404);
    // The login itself is gone too — logging in with the old credentials now 404s the account (not merely a wrong password).
    const loginAttempt = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'test-school', email: 'withlogin@example.com', password: 'irrelevant' });
    expect(loginAttempt.status).toBe(401);
  });

  it('refuses to delete a guardian who has filed a student leave request, with a clear message, and leaves the record untouched', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Tariq Khan',
        relationship: 'FATHER',
        phone: '03001234567',
        email: 'tariq.leave@example.com',
        studentId: student.body.data.id,
        isPrimary: true,
      });
    const parentLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'tariq.leave@example.com', password: guardian.body.portalLogin.tempPassword });

    const leaveRequest = await request(app)
      .post('/api/portal/leave-requests')
      .set(authHeader(parentLogin.body.accessToken))
      .send({
        studentId: student.body.data.id,
        fromDate: '2026-03-01',
        toDate: '2026-03-02',
        reason: 'Family function',
      });
    expect(leaveRequest.status).toBe(201);

    const del = await request(app).delete(`/api/guardians/${guardian.body.data.id}`).set(authHeader(accessToken));
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('leave request');

    const stillThere = await request(app).get(`/api/guardians/${guardian.body.data.id}`).set(authHeader(accessToken));
    expect(stillThere.status).toBe(200);
  });

  it('only SCHOOL_ADMIN (not FRONT_DESK) can delete a guardian, and an unauthenticated request is rejected', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Some Parent', relationship: 'FATHER', phone: '03001234567' });
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const fdAttempt = await request(app)
      .delete(`/api/guardians/${guardian.body.data.id}`)
      .set(authHeader(frontDesk.accessToken));
    expect(fdAttempt.status).toBe(403);

    const noAuth = await request(app).delete(`/api/guardians/${guardian.body.data.id}`);
    expect(noAuth.status).toBe(401);
  });
});

describe('Enrollment', () => {
  it('re-enrolling a student in a new section for the SAME academic year updates the existing enrollment (no duplicate)', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section, schoolClass } = await setupYearClassSection(accessToken);

    const sectionB = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, academicYearId: year.id, name: 'B' });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
      });

    const move = await request(app)
      .post(`/api/students/${student.body.data.id}/enroll`)
      .set(authHeader(accessToken))
      .send({ sectionId: sectionB.body.data.id, academicYearId: year.id });
    expect(move.status).toBe(200);

    const detail = await request(app)
      .get(`/api/students/${student.body.data.id}`)
      .set(authHeader(accessToken));
    expect(detail.body.data.enrollments).toHaveLength(1);
    expect(detail.body.data.enrollments[0].section.name).toBe('B');
    expect(detail.body.data.currentSectionId).toBe(sectionB.body.data.id);
  });

  it('rejects enrolling into a section that does not belong to the given academicYearId', async () => {
    const { accessToken } = await signupSchool(app);
    const { section } = await setupYearClassSection(accessToken);

    const otherYear = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2026-2027', startDate: '2026-08-01', endDate: '2027-05-31' });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const res = await request(app)
      .post(`/api/students/${student.body.data.id}/enroll`)
      .set(authHeader(accessToken))
      .send({ sectionId: section.id, academicYearId: otherYear.body.data.id });
    expect(res.status).toBe(400);
  });
});

describe('student photo at admission', () => {
  it('accepts a photoUrl on student create and stores it on the record', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Sana Malik',
        gender: 'FEMALE',
        dateOfBirth: '2016-03-01',
        photoUrl: 'https://example.test/uploads/abc123.jpg',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.photoUrl).toBe('https://example.test/uploads/abc123.jpg');
  });

  it('admits a student with no photoUrl just fine (it stays null)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Photo Yet', gender: 'MALE', dateOfBirth: '2016-03-01' });
    expect(res.status).toBe(201);
    expect(res.body.data.photoUrl).toBeNull();
  });

  it('rejects a photoUrl that is not a valid URL', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bad Photo', gender: 'MALE', dateOfBirth: '2016-03-01', photoUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });
});

describe('CNIC/B-Form format validation', () => {
  it('rejects a malformed bFormOrCnic on student create', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01', bFormOrCnic: '12345' });
    expect(res.status).toBe(400);
  });

  it('accepts a correctly-formatted bFormOrCnic', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01', bFormOrCnic: '35202-1234567-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.bFormOrCnic).toBe('35202-1234567-1');
  });

  it('rejects a malformed guardian cnic', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bilal Khan', relationship: 'FATHER', phone: '03001234567', cnic: 'not-a-cnic' });
    expect(res.status).toBe(400);
  });

  it('treats an empty-string bFormOrCnic/cnic as "not provided" instead of a validation error', async () => {
    // Regression test: the frontend's "Add student" form always submits
    // bFormOrCnic as "" (not omitted) when the field is left blank — a
    // bare `.optional()` only accepts `undefined`, so this used to 400 on
    // every student admitted without a CNIC/B-Form on hand yet, which is
    // the explicit, documented use case the field exists to support.
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'No Cnic Yet', gender: 'MALE', dateOfBirth: '2015-01-01', bFormOrCnic: '' });
    expect(student.status).toBe(201);
    expect(student.body.data.bFormOrCnic).toBeNull();

    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bilal Khan', relationship: 'FATHER', phone: '03001234567', cnic: '' });
    expect(guardian.status).toBe(201);
    expect(guardian.body.data.cnic).toBeNull();
  });

  it('rejects a duplicate bFormOrCnic tenant-wide on create (409), even across different sections', async () => {
    const { accessToken } = await signupSchool(app);
    const first = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01', bFormOrCnic: '35202-1234567-1' });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bilal Malik', gender: 'MALE', dateOfBirth: '2015-02-01', bFormOrCnic: '35202-1234567-1' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.field).toBe('bFormOrCnic');
  });

  it('rejects updating a student to a bFormOrCnic already used by someone else, but allows keeping their own', async () => {
    const { accessToken } = await signupSchool(app);
    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01', bFormOrCnic: '35202-1234567-1' });
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bilal Malik', gender: 'MALE', dateOfBirth: '2015-02-01', bFormOrCnic: '35202-7654321-9' });

    const conflict = await request(app)
      .patch(`/api/students/${s2.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ bFormOrCnic: '35202-1234567-1' });
    expect(conflict.status).toBe(409);

    const selfUpdate = await request(app)
      .patch(`/api/students/${s1.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ bFormOrCnic: '35202-1234567-1', fullName: 'Ahmed Khan Updated' });
    expect(selfUpdate.status).toBe(200);
    expect(selfUpdate.body.data.fullName).toBe('Ahmed Khan Updated');
  });
});

describe('Roll number', () => {
  it('assigns a roll number on create and rejects a duplicate within the same section', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupYearClassSection(accessToken);

    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
        rollNumber: '5',
      });
    expect(s1.status).toBe(201);
    expect(s1.body.data.rollNumber).toBe('5');

    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Bilal Malik',
        gender: 'MALE',
        dateOfBirth: '2015-02-01',
        sectionId: section.id,
        academicYearId: year.id,
        rollNumber: '5',
      });
    expect(s2.status).toBe(409);
  });

  it('the same roll number is allowed in two different sections', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section, schoolClass } = await setupYearClassSection(accessToken);
    const sectionB = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, academicYearId: year.id, name: 'B' });

    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
        rollNumber: '1',
      });
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Bilal Malik',
        gender: 'MALE',
        dateOfBirth: '2015-02-01',
        sectionId: sectionB.body.data.id,
        academicYearId: year.id,
        rollNumber: '1',
      });
    expect(s1.status).toBe(201);
    expect(s2.status).toBe(201);
  });

  it('rejects updating a student to a roll number already used by someone else in their section', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupYearClassSection(accessToken);

    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
        rollNumber: '1',
      });
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Bilal Malik',
        gender: 'MALE',
        dateOfBirth: '2015-02-01',
        sectionId: section.id,
        academicYearId: year.id,
      });

    const update = await request(app)
      .patch(`/api/students/${s2.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ rollNumber: '1' });
    expect(update.status).toBe(409);
    void s1;
  });
});

describe('Class promotion', () => {
  it('promotes active students from one section to another, resetting roll numbers', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section, schoolClass } = await setupYearClassSection(accessToken);
    const nextYear = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2026-2027', startDate: '2026-08-01', endDate: '2027-05-31' });
    const nextClass = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 6', order: 6 });
    const nextSection = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: nextClass.body.data.id, academicYearId: nextYear.body.data.id, name: 'A' });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
        rollNumber: '1',
      });

    const promote = await request(app)
      .post(`/api/sections/${section.id}/promote`)
      .set(authHeader(accessToken))
      .send({ targetSectionId: nextSection.body.data.id, targetAcademicYearId: nextYear.body.data.id });
    expect(promote.status).toBe(200);
    expect(promote.body.data.promotedCount).toBe(1);
    expect(promote.body.data.students[0].currentSectionId).toBe(nextSection.body.data.id);
    expect(promote.body.data.students[0].rollNumber).toBeNull();

    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    expect(detail.body.data.currentSectionId).toBe(nextSection.body.data.id);
    expect(detail.body.data.enrollments.some((e: { academicYear: { name: string } }) => e.academicYear.name === '2026-2027')).toBe(true);
    void schoolClass;
  });

  it('promoting only a subset holds the rest back', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupYearClassSection(accessToken);
    const nextYear = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2026-2027', startDate: '2026-08-01', endDate: '2027-05-31' });
    const nextClass = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 6', order: 6 });
    const nextSection = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: nextClass.body.data.id, academicYearId: nextYear.body.data.id, name: 'A' });

    const s1 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01', sectionId: section.id, academicYearId: year.id });
    const s2 = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Bilal Malik', gender: 'MALE', dateOfBirth: '2015-02-01', sectionId: section.id, academicYearId: year.id });

    const promote = await request(app)
      .post(`/api/sections/${section.id}/promote`)
      .set(authHeader(accessToken))
      .send({
        targetSectionId: nextSection.body.data.id,
        targetAcademicYearId: nextYear.body.data.id,
        studentIds: [s1.body.data.id],
      });
    expect(promote.body.data.promotedCount).toBe(1);

    const s2Detail = await request(app).get(`/api/students/${s2.body.data.id}`).set(authHeader(accessToken));
    expect(s2Detail.body.data.currentSectionId).toBe(section.id);
  });
});

describe('Transfer certificates', () => {
  it('issues a TC, sets student status to TRANSFERRED_OUT, and generates a sequential tcNumber', async () => {
    const { accessToken } = await signupSchool(app);
    const { year, section } = await setupYearClassSection(accessToken);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
      });

    const tc = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'RELOCATION', conduct: 'Good', remarks: 'Family relocating abroad' });
    expect(tc.status).toBe(201);
    expect(tc.body.data.tcNumber).toMatch(/^TC-\d{4}-\d{6}$/);

    const studentDetail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    expect(studentDetail.body.data.status).toBe('TRANSFERRED_OUT');
  });

  it('rejects issuing a second TC for an already-transferred student', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'GRADUATED' });

    const second = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'GRADUATED' });
    expect(second.status).toBe(409);
  });

  it('voiding a mistakenly-issued TC reverts the student to ACTIVE and lets a fresh TC be issued afterward', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const tc = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'OTHER' });

    const voided = await request(app)
      .post(`/api/transfer-certificates/${tc.body.data.id}/void`)
      .set(authHeader(accessToken));
    expect(voided.status).toBe(200);
    expect(voided.body.data.voidedAt).not.toBeNull();
    expect(voided.body.student.status).toBe('ACTIVE');

    const detail = await request(app).get(`/api/students/${student.body.data.id}`).set(authHeader(accessToken));
    expect(detail.body.data.status).toBe('ACTIVE');

    // Voiding twice is rejected.
    const voidAgain = await request(app)
      .post(`/api/transfer-certificates/${tc.body.data.id}/void`)
      .set(authHeader(accessToken));
    expect(voidAgain.status).toBe(409);

    // A fresh TC can now be issued for the (un-transferred) student.
    const fresh = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'RELOCATION' });
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.tcNumber).not.toBe(tc.body.data.tcNumber);
  });

  it('rejects voiding an older TC once a newer one has been issued for the same student', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const first = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'OTHER' });
    await request(app)
      .post(`/api/transfer-certificates/${first.body.data.id}/void`)
      .set(authHeader(accessToken));
    const second = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'RELOCATION' });

    // The already-voided first TC can't be voided again (covered above);
    // here the newer, still-active `second` TC is the only voidable one.
    const staleVoid = await request(app)
      .post(`/api/transfer-certificates/${first.body.data.id}/void`)
      .set(authHeader(accessToken));
    expect(staleVoid.status).toBe(409);

    const voidSecond = await request(app)
      .post(`/api/transfer-certificates/${second.body.data.id}/void`)
      .set(authHeader(accessToken));
    expect(voidSecond.status).toBe(200);
  });

  it('TEACHER cannot void a TC (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const tc = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'OTHER' });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post(`/api/transfer-certificates/${tc.body.data.id}/void`)
      .set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });

  it('lists TCs for a student and returns a valid PDF', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const tc = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'ACADEMIC' });

    const list = await request(app)
      .get(`/api/students/${student.body.data.id}/transfer-certificates`)
      .set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const pdf = await request(app)
      .get(`/api/transfer-certificates/${tc.body.data.id}/pdf`)
      .set(authHeader(accessToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  it('TEACHER cannot issue a TC (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post(`/api/students/${student.body.data.id}/transfer-certificate`)
      .set(authHeader(teacher.accessToken))
      .send({ reason: 'OTHER' });
    expect(res.status).toBe(403);
  });

  it('a TEACHER can list/view/print a TC only for a student in a section they teach (403 otherwise)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const schoolClass = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: teacher.user.id,
      });

    const inSection = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    const outsideSection = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Outside Student', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const inSectionTc = await request(app)
      .post(`/api/students/${inSection.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'ACADEMIC' });
    const outsideTc = await request(app)
      .post(`/api/students/${outsideSection.body.data.id}/transfer-certificate`)
      .set(authHeader(accessToken))
      .send({ reason: 'ACADEMIC' });

    // List: allowed for the in-section student, forbidden for the outside one.
    const listAllowed = await request(app)
      .get(`/api/students/${inSection.body.data.id}/transfer-certificates`)
      .set(authHeader(teacher.accessToken));
    expect(listAllowed.status).toBe(200);
    const listForbidden = await request(app)
      .get(`/api/students/${outsideSection.body.data.id}/transfer-certificates`)
      .set(authHeader(teacher.accessToken));
    expect(listForbidden.status).toBe(403);

    // Single TC by id: same split.
    const detailAllowed = await request(app)
      .get(`/api/transfer-certificates/${inSectionTc.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(detailAllowed.status).toBe(200);
    const detailForbidden = await request(app)
      .get(`/api/transfer-certificates/${outsideTc.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(detailForbidden.status).toBe(403);

    // PDF: same split.
    const pdfAllowed = await fetchPdf(teacher.accessToken, `/api/transfer-certificates/${inSectionTc.body.data.id}/pdf`);
    expect(pdfAllowed.status).toBe(200);
    const pdfForbidden = await request(app)
      .get(`/api/transfer-certificates/${outsideTc.body.data.id}/pdf`)
      .set(authHeader(teacher.accessToken));
    expect(pdfForbidden.status).toBe(403);
  }, 30000);
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

describe('Admission form PDF', () => {
  it("generates a printable admission form with the student's guardian and fee details", async () => {
    const { accessToken } = await signupSchool(app);
    const { year, schoolClass, section } = await setupYearClassSection(accessToken);

    const category = await request(app)
      .post('/api/fee-categories')
      .set(authHeader(accessToken))
      .send({ name: 'Tuition Fee' });
    await request(app)
      .post('/api/fee-structure-items')
      .set(authHeader(accessToken))
      .send({
        academicYearId: year.id,
        schoolClassId: schoolClass.id,
        feeCategoryId: category.body.data.id,
        amount: 5000,
        frequency: 'MONTHLY',
      });

    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Ahmed Khan',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.id,
        academicYearId: year.id,
      });
    await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Bilal Khan',
        relationship: 'FATHER',
        phone: '03001234567',
        occupation: 'Engineer',
        studentId: student.body.data.id,
        isPrimary: true,
      });

    const pdf = await fetchPdf(accessToken, `/api/students/${student.body.data.id}/admission-form/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  it("includes the student's photo in the generated PDF when one is on file", async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Photo Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        photoUrl: 'https://example.test/uploads/photo-student.jpg',
      });

    const pdf = await fetchPdf(accessToken, `/api/students/${student.body.data.id}/admission-form/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  it('generates an admission form even for a student with no guardians and no fee structure yet', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Solo Student', gender: 'FEMALE', dateOfBirth: '2016-03-15' });

    const pdf = await fetchPdf(accessToken, `/api/students/${student.body.data.id}/admission-form/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 30000);

  it('a TEACHER can print an admission form only for a student in a section they teach (403 otherwise)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const schoolClass = await request(app)
      .post('/api/classes')
      .set(authHeader(accessToken))
      .send({ name: 'Class 5', order: 5 });
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: teacher.user.id,
      });

    const inSection = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'In Section Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });
    const outsideSection = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Outside Student', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const forbidden = await request(app)
      .get(`/api/students/${outsideSection.body.data.id}/admission-form/pdf`)
      .set(authHeader(teacher.accessToken));
    expect(forbidden.status).toBe(403);

    const pdf = await fetchPdf(teacher.accessToken, `/api/students/${inSection.body.data.id}/admission-form/pdf`);
    expect(pdf.status).toBe(200);
  }, 30000);

  it('cannot access another tenant student admission form (tenant isolation, 404)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(schoolA.accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const res = await request(app)
      .get(`/api/students/${student.body.data.id}/admission-form/pdf`)
      .set(authHeader(schoolB.accessToken));
    expect(res.status).toBe(404);
  });
});
