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

function staffPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'teacher.new@test-school.test',
    fullName: 'Bilal Ahmed',
    phone: '03001234567',
    role: 'TEACHER',
    designation: 'Senior Teacher',
    department: 'Science',
    employmentType: 'FULL_TIME',
    joiningDate: '2026-01-15',
    cnic: '35202-1234567-1',
    address: 'Lahore, Pakistan',
    emergencyContact: '03007654321',
    monthlySalary: 60000,
    ...overrides,
  };
}

describe('Staff creation', () => {
  it('SCHOOL_ADMIN creates a staff member, generating employeeCode + one-time temp password', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload());

    expect(res.status).toBe(201);
    // "Test School" -> tenant code "TS" (see utils/tenantCode.ts).
    expect(res.body.data.employeeCode).toBe('TS-EMP-000001');
    expect(res.body.data.user.email).toBe('teacher.new@test-school.test');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(typeof res.body.tempPassword).toBe('string');
    expect(res.body.tempPassword.length).toBeGreaterThan(8);
  });

  // Real bug this covers: an admin adding a staff member with a photo saw
  // it silently dropped — createStaffSchema never accepted photoUrl at all
  // (only the staff member's own self-service PATCH /me and the admin's
  // PATCH /:id did), so it never made it into the created StaffProfile and
  // never showed up anywhere on the admin side afterwards.
  it('SCHOOL_ADMIN can set a photo at staff-creation time, and it is returned immediately and on a later GET', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ photoUrl: 'https://example.test/uploads/t1/bilal.jpg' }));

    expect(res.status).toBe(201);
    expect(res.body.data.photoUrl).toBe('https://example.test/uploads/t1/bilal.jpg');

    const get = await request(app)
      .get(`/api/staff/${res.body.data.id}`)
      .set(authHeader(accessToken));
    expect(get.body.data.photoUrl).toBe('https://example.test/uploads/t1/bilal.jpg');
  });

  it('leaves photoUrl null when none is provided at creation (unchanged default behaviour)', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    expect(res.status).toBe(201);
    expect(res.body.data.photoUrl).toBeNull();
  });

  it('rejects an invalid photoUrl at creation time (400)', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ photoUrl: 'not-a-url' }));

    expect(res.status).toBe(400);
  });

  it('employeeCode increments per tenant across multiple staff', async () => {
    const { accessToken } = await signupSchool(app);

    const first = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const second = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ email: 'accountant.new@test-school.test', role: 'ACCOUNTANT', designation: 'Accountant' }));

    expect(first.body.data.employeeCode).toBe('TS-EMP-000001');
    expect(second.body.data.employeeCode).toBe('TS-EMP-000002');
  });

  it('rejects a duplicate email within the same tenant', async () => {
    const { accessToken } = await signupSchool(app);
    await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    const dup = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    expect(dup.status).toBe(409);
  });

  it('the new staff member can log in with the returned temp password', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('TEACHER');
  });

  it('TEACHER cannot create staff (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'existing.teacher@test-school.test',
      role: 'TEACHER',
    });
    void accessToken;

    const res = await request(app).post('/api/staff').set(authHeader(teacher.accessToken)).send(staffPayload());
    expect(res.status).toBe(403);
  });

  it('ACCOUNTANT can list staff but cannot create staff', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'existing.accountant@test-school.test',
      role: 'ACCOUNTANT',
    });

    const list = await request(app).get('/api/staff').set(authHeader(accountant.accessToken));
    expect(list.status).toBe(200);
    // The founding SCHOOL_ADMIN has their own StaffProfile too (created at
    // signup), plus the one TEACHER created above.
    expect(list.body.data).toHaveLength(2);

    const create = await request(app)
      .post('/api/staff')
      .set(authHeader(accountant.accessToken))
      .send(staffPayload({ email: 'another@test-school.test' }));
    expect(create.status).toBe(403);
  });

  it('an existing SCHOOL_ADMIN can create ANOTHER SCHOOL_ADMIN for their own tenant, and the new admin has full admin access', async () => {
    const { accessToken, tenant } = await signupSchool(app);

    const create = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(
        staffPayload({
          email: 'second.admin@test-school.test',
          fullName: 'Second Admin',
          role: 'SCHOOL_ADMIN',
          designation: 'Vice Principal',
        }),
      );
    expect(create.status).toBe(201);
    expect(create.body.data.user.role).toBe('SCHOOL_ADMIN');
    expect(typeof create.body.tempPassword).toBe('string');

    const secondAdminToken = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'second.admin@test-school.test', password: create.body.tempPassword });
    expect(secondAdminToken.status).toBe(200);

    // The new SCHOOL_ADMIN has the same WRITE_ROLES access as the original
    // one — e.g. can itself create staff (including a third admin).
    const thirdCreate = await request(app)
      .post('/api/staff')
      .set(authHeader(secondAdminToken.body.accessToken))
      .send(staffPayload({ email: 'third.admin@test-school.test', role: 'SCHOOL_ADMIN' }));
    expect(thirdCreate.status).toBe(201);

    // The founding tenant-signup admin has their own StaffProfile too
    // (created at signup — see auth.service.ts), so all 3 admins show up.
    const list = await request(app).get('/api/staff').set(authHeader(accessToken));
    const adminEmails = list.body.data
      .filter((s: { user: { role: string; email: string } }) => s.user.role === 'SCHOOL_ADMIN')
      .map((s: { user: { email: string } }) => s.user.email);
    expect(adminEmails).toHaveLength(3);
    expect(adminEmails).toEqual(
      expect.arrayContaining([
        'admin@test-school.test',
        'second.admin@test-school.test',
        'third.admin@test-school.test',
      ]),
    );
  });
});

describe('Staff listing, search & updates', () => {
  it('lists staff with pagination and search by designation/name', async () => {
    const { accessToken } = await signupSchool(app);
    await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(
        staffPayload({
          email: 'front.desk@test-school.test',
          fullName: 'Ayesha Malik',
          role: 'FRONT_DESK',
          designation: 'Receptionist',
        }),
      );

    const search = await request(app)
      .get('/api/staff')
      .query({ search: 'Bilal' })
      .set(authHeader(accessToken));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].user.fullName).toBe('Bilal Ahmed');

    const all = await request(app).get('/api/staff').set(authHeader(accessToken));
    // The founding admin's own StaffProfile + the 2 created above.
    expect(all.body.meta.total).toBe(3);
  });

  it('updates a staff member designation and status', async () => {
    const { accessToken } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    const update = await request(app)
      .patch(`/api/staff/${created.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ designation: 'Head of Department', status: 'ON_LEAVE' });

    expect(update.status).toBe(200);
    expect(update.body.data.designation).toBe('Head of Department');
    expect(update.body.data.status).toBe('ON_LEAVE');
  });

  it('cannot access another tenant staff record (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });

    const created = await request(app).post('/api/staff').set(authHeader(schoolA.accessToken)).send(staffPayload());

    const res = await request(app)
      .get(`/api/staff/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken));
    expect(res.status).toBe(404);
  });

  it("PATCH updates a staff member's login email and rejects a duplicate", async () => {
    const { accessToken } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const other = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ email: 'other.staff@test-school.test', designation: 'Accountant', role: 'ACCOUNTANT' }));

    const updated = await request(app)
      .patch(`/api/staff/${created.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'teacher.updated@test-school.test' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user.email).toBe('teacher.updated@test-school.test');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: 'test-school', email: 'teacher.updated@test-school.test', password: 'wrong-password' });
    expect(login.status).toBe(401);

    const conflict = await request(app)
      .patch(`/api/staff/${other.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ email: 'teacher.updated@test-school.test' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.field).toBe('email');
  });
});

// Real gap this covers: setting/adjusting a teacher's pay rate is routine
// Accountant work in a Pakistani school office, but before this the only
// way to change monthlySalary was the full staff PATCH (WRITE_ROLES,
// SCHOOL_ADMIN-only) — an Accountant had no way to do it at all.
describe('PATCH /api/staff/:id/salary — salary-only edit', () => {
  it('SCHOOL_ADMIN can update a staff member salary via the dedicated route', async () => {
    const { accessToken } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    const res = await request(app)
      .patch(`/api/staff/${created.body.data.id}/salary`)
      .set(authHeader(accessToken))
      .send({ monthlySalary: 75000 });
    expect(res.status).toBe(200);
    expect(res.body.data.monthlySalary).toBe('75000');
  });

  it('ACCOUNTANT can update a staff member salary, but nothing else about the record changes', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'salary.accountant@test-school.test',
      role: 'ACCOUNTANT',
    });

    // Sending extra fields alongside monthlySalary must not smuggle a
    // broader edit through — updateStaffSalarySchema only knows about
    // monthlySalary, so designation/fullName here are silently dropped.
    const res = await request(app)
      .patch(`/api/staff/${created.body.data.id}/salary`)
      .set(authHeader(accountant.accessToken))
      .send({ monthlySalary: 80000, designation: 'Should not change', fullName: 'Should Not Change' });
    expect(res.status).toBe(200);
    expect(res.body.data.monthlySalary).toBe('80000');
    expect(res.body.data.designation).toBe('Senior Teacher');
    expect(res.body.data.user.fullName).toBe('Bilal Ahmed');
  });

  it('ACCOUNTANT still cannot use the full staff PATCH to change other fields', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'salary.accountant2@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await request(app)
      .patch(`/api/staff/${created.body.data.id}`)
      .set(authHeader(accountant.accessToken))
      .send({ designation: 'Head of Department' });
    expect(res.status).toBe(403);
  });

  it('TEACHER and FRONT_DESK cannot update salary', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'salary.teacher@test-school.test',
      role: 'TEACHER',
    });
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'salary.frontdesk@test-school.test',
      role: 'FRONT_DESK',
    });

    const teacherRes = await request(app)
      .patch(`/api/staff/${created.body.data.id}/salary`)
      .set(authHeader(teacher.accessToken))
      .send({ monthlySalary: 90000 });
    expect(teacherRes.status).toBe(403);

    const frontDeskRes = await request(app)
      .patch(`/api/staff/${created.body.data.id}/salary`)
      .set(authHeader(frontDesk.accessToken))
      .send({ monthlySalary: 90000 });
    expect(frontDeskRes.status).toBe(403);
  });
});

describe('Payroll', () => {
  async function setupStaff(accessToken: string) {
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    return created.body.data as { id: string };
  }

  it('generates a payroll record with computed netSalary', async () => {
    const { accessToken } = await signupSchool(app);
    const staff = await setupStaff(accessToken);

    const res = await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02', allowances: 5000, deductions: 2000 });

    expect(res.status).toBe(201);
    expect(res.body.data.netSalary).toBe('63000'); // 60000 + 5000 - 2000
    expect(res.body.data.status).toBe('PENDING');
  });

  it('rejects a duplicate payroll record for the same staff + month', async () => {
    const { accessToken } = await signupSchool(app);
    const staff = await setupStaff(accessToken);

    await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02' });

    const dup = await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02' });

    expect(dup.status).toBe(409);
  });

  it('rejects a payroll record whose deductions exceed salary + allowances', async () => {
    const { accessToken } = await signupSchool(app);
    const staff = await setupStaff(accessToken);

    const res = await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02', deductions: 999999 });

    expect(res.status).toBe(400);
  });

  it('marks a payroll record as paid, and replaying mark-paid stays idempotent', async () => {
    const { accessToken } = await signupSchool(app);
    const staff = await setupStaff(accessToken);
    const gen = await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02' });

    const pay1 = await request(app)
      .patch(`/api/staff/payroll/${gen.body.data.id}/mark-paid`)
      .set(authHeader(accessToken));
    expect(pay1.status).toBe(200);
    expect(pay1.body.data.status).toBe('PAID');

    const pay2 = await request(app)
      .patch(`/api/staff/payroll/${gen.body.data.id}/mark-paid`)
      .set(authHeader(accessToken));
    expect(pay2.status).toBe(200);
    expect(pay2.body.data.status).toBe('PAID');
  });

  it('lists payroll records filtered by month and staffProfileId', async () => {
    const { accessToken } = await signupSchool(app);
    const staff = await setupStaff(accessToken);
    await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-01' });
    await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02' });

    const res = await request(app)
      .get('/api/staff/payroll')
      .query({ month: '2026-02', staffProfileId: staff.id })
      .set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].month).toBe('2026-02');
  });

  it('FRONT_DESK cannot access payroll endpoints (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const staff = await setupStaff(accessToken);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd2@test-school.test',
      role: 'FRONT_DESK',
    });

    const res = await request(app)
      .post('/api/staff/payroll/generate')
      .set(authHeader(frontDesk.accessToken))
      .send({ staffProfileId: staff.id, month: '2026-02' });
    expect(res.status).toBe(403);
  });

  describe('Bulk generate', () => {
    it('generates a payroll record for every active staff member in one call', async () => {
      const { accessToken } = await signupSchool(app);
      // signupSchool's own SCHOOL_ADMIN already has a StaffProfile, plus
      // two more staff created here — three active staff in total.
      await setupStaff(accessToken);
      await request(app)
        .post('/api/staff')
        .set(authHeader(accessToken))
        .send(staffPayload({ email: 'accountant.bulk@test-school.test', role: 'ACCOUNTANT', designation: 'Accountant' }));

      const res = await request(app)
        .post('/api/staff/payroll/bulk-generate')
        .set(authHeader(accessToken))
        .send({ month: '2026-03' });

      expect(res.status).toBe(201);
      expect(res.body.data.generated).toBe(3);
      expect(res.body.data.skipped).toBe(0);

      const list = await request(app)
        .get('/api/staff/payroll')
        .query({ month: '2026-03', limit: 100 })
        .set(authHeader(accessToken));
      expect(list.body.data).toHaveLength(3);
      expect(list.body.data.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    });

    it('skips staff who already have a payroll record for that month, without erroring', async () => {
      const { accessToken } = await signupSchool(app);
      const staff = await setupStaff(accessToken);
      await request(app)
        .post('/api/staff/payroll/generate')
        .set(authHeader(accessToken))
        .send({ staffProfileId: staff.id, month: '2026-03', allowances: 1000 });

      const res = await request(app)
        .post('/api/staff/payroll/bulk-generate')
        .set(authHeader(accessToken))
        .send({ month: '2026-03' });

      expect(res.status).toBe(201);
      expect(res.body.data.skipped).toBeGreaterThanOrEqual(1); // the pre-generated staff member
      expect(res.body.data.generated).toBe(1); // just the founding SCHOOL_ADMIN

      // The pre-existing record (with its allowances) is untouched, not overwritten.
      const list = await request(app)
        .get('/api/staff/payroll')
        .query({ month: '2026-03', staffProfileId: staff.id })
        .set(authHeader(accessToken));
      expect(list.body.data[0].allowances).toBe('1000');
    });

    it('FRONT_DESK cannot bulk-generate payroll (403)', async () => {
      const { tenant } = await signupSchool(app);
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'fd-bulk@test-school.test',
        role: 'FRONT_DESK',
      });

      const res = await request(app)
        .post('/api/staff/payroll/bulk-generate')
        .set(authHeader(frontDesk.accessToken))
        .send({ month: '2026-03' });
      expect(res.status).toBe(403);
    });
  });
});

describe('GET/PATCH /api/staff/me — self-service staff profile', () => {
  it("a TEACHER can read their own staff profile and set their own photo", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    const before = await request(app).get('/api/staff/me').set(authHeader(login.body.accessToken));
    expect(before.status).toBe(200);
    expect(before.body.data.employeeCode).toBe(created.body.data.employeeCode);
    expect(before.body.data.photoUrl).toBeNull();
    expect(before.body.data.user.passwordHash).toBeUndefined();

    const patch = await request(app)
      .patch('/api/staff/me')
      .set(authHeader(login.body.accessToken))
      .send({ photoUrl: 'https://example.test/uploads/t1/teacher.jpg' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.photoUrl).toBe('https://example.test/uploads/t1/teacher.jpg');

    const after = await request(app).get('/api/staff/me').set(authHeader(login.body.accessToken));
    expect(after.body.data.photoUrl).toBe('https://example.test/uploads/t1/teacher.jpg');
  });

  it("rejects an invalid photoUrl (400)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    const res = await request(app)
      .patch('/api/staff/me')
      .set(authHeader(login.body.accessToken))
      .send({ photoUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it("a TEACHER cannot edit another teacher's profile by changing photoUrl through /me (it only ever touches their own)", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacherA = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ email: 'teacher-a@test-school.test' }));
    const teacherB = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ email: 'teacher-b@test-school.test' }));
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher-b@test-school.test', password: teacherB.body.tempPassword });

    await request(app)
      .patch('/api/staff/me')
      .set(authHeader(loginB.body.accessToken))
      .send({ photoUrl: 'https://example.test/b.jpg' });

    const loginA = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher-a@test-school.test', password: teacherA.body.tempPassword });
    const meA = await request(app).get('/api/staff/me').set(authHeader(loginA.body.accessToken));
    expect(meA.body.data.photoUrl).toBeNull();
  });

  it("the founding SCHOOL_ADMIN also has a StaffProfile (created at signup, designation 'Principal') and can read/edit it via /me", async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/staff/me').set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.designation).toBe('Principal');
    expect(res.body.data.photoUrl).toBeNull();
  });

  it("a role with no StaffProfile at all (PARENT/STUDENT never get one) gets 404 from /me, not a 500", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const guardian = await request(app)
      .post('/api/guardians')
      .set(authHeader(accessToken))
      .send({ fullName: 'A Parent', relationship: 'FATHER', phone: '03001234567', email: 'parent@test-school.test' });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'parent@test-school.test', password: guardian.body.portalLogin.tempPassword });

    const res = await request(app).get('/api/staff/me').set(authHeader(login.body.accessToken));
    expect(res.status).toBe(404);
  });

  it('an unauthenticated request is rejected (401)', async () => {
    const res = await request(app).get('/api/staff/me');
    expect(res.status).toBe(401);
  });

  it("a TEACHER can self-edit their own address and emergency contact (My Profile → About tab), leaving Bio Data fields untouched", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ cnic: '35202-9999999-9' }));
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    const patch = await request(app)
      .patch('/api/staff/me')
      .set(authHeader(login.body.accessToken))
      .send({ address: 'Model Town, Lahore', emergencyContact: 'Sister - 03009998887' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.address).toBe('Model Town, Lahore');
    expect(patch.body.data.emergencyContact).toBe('Sister - 03009998887');
    // Bio Data (admin-managed) is unaffected by this self-service call.
    expect(patch.body.data.cnic).toBe('35202-9999999-9');
    expect(patch.body.data.designation).toBe('Senior Teacher');
  });

  it('rejects an empty PATCH /api/staff/me body (400 — nothing to update)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const login = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    const res = await request(app).patch('/api/staff/me').set(authHeader(login.body.accessToken)).send({});
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/staff/:id', () => {
  it('SCHOOL_ADMIN permanently deletes a staff member with no history — their login stops working', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());

    const del = await request(app).delete(`/api/staff/${created.body.data.id}`).set(authHeader(accessToken));
    expect(del.status).toBe(204);

    const getAfter = await request(app).get(`/api/staff/${created.body.data.id}`).set(authHeader(accessToken));
    expect(getAfter.status).toBe(404);

    const loginAttempt = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });
    expect(loginAttempt.status).toBe(401);
  });

  it('refuses to let a SCHOOL_ADMIN delete their own account (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const me = await request(app).get('/api/staff/me').set(authHeader(accessToken));

    const res = await request(app).delete(`/api/staff/${me.body.data.id}`).set(authHeader(accessToken));
    expect(res.status).toBe(400);
  });

  it("refuses to delete a staff member who has filed a discipline record, with a clear message, and leaves the record intact", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const teacherLogin = await request(app)
      .post('/api/auth/login')
      .send({ slug: tenant.slug, email: 'teacher.new@test-school.test', password: created.body.tempPassword });

    // Discipline-record creation is section-scoped for a TEACHER (see
    // assertTeacherCanAccessStudent in discipline.ts) — set the new
    // teacher as this section's class teacher and enroll the student into
    // it, so the report goes through as it realistically would.
    const year = await request(app)
      .post('/api/academic-years')
      .set(authHeader(accessToken))
      .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
    const cls = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 5', order: 5 });
    const section = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: cls.body.data.id,
        academicYearId: year.body.data.id,
        name: 'A',
        classTeacherId: created.body.data.user.id,
      });
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({
        fullName: 'Some Student',
        gender: 'MALE',
        dateOfBirth: '2015-01-01',
        sectionId: section.body.data.id,
        academicYearId: year.body.data.id,
      });

    const discipline = await request(app)
      .post('/api/discipline-records')
      .set(authHeader(teacherLogin.body.accessToken))
      .send({
        studentId: student.body.data.id,
        incidentDate: '2026-02-01',
        category: 'LATE_ARRIVAL',
        severity: 'MINOR',
        description: 'Late to class',
      });
    expect(discipline.status).toBe(201);

    const del = await request(app).delete(`/api/staff/${created.body.data.id}`).set(authHeader(accessToken));
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('discipline');

    const stillThere = await request(app).get(`/api/staff/${created.body.data.id}`).set(authHeader(accessToken));
    expect(stillThere.status).toBe(200);
  });

  it('deleting a second SCHOOL_ADMIN succeeds while the founding admin remains (never hits the last-admin guard)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const secondAdmin = await request(app)
      .post('/api/staff')
      .set(authHeader(accessToken))
      .send(staffPayload({ email: 'second-admin@test-school.test', role: 'SCHOOL_ADMIN' }));
    expect(secondAdmin.status).toBe(201);

    const del = await request(app).delete(`/api/staff/${secondAdmin.body.data.id}`).set(authHeader(accessToken));
    expect(del.status).toBe(204);
    void tenant;
  });

  it('only SCHOOL_ADMIN (not FRONT_DESK) can delete staff, and an unauthenticated request is rejected', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const created = await request(app).post('/api/staff').set(authHeader(accessToken)).send(staffPayload());
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const fdAttempt = await request(app)
      .delete(`/api/staff/${created.body.data.id}`)
      .set(authHeader(frontDesk.accessToken));
    expect(fdAttempt.status).toBe(403);

    const noAuth = await request(app).delete(`/api/staff/${created.body.data.id}`);
    expect(noAuth.status).toBe(401);
  });
});
