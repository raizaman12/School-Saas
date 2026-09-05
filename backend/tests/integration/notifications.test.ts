import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb, ownerDb } from '../helpers/db';
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

async function setupSectionWithGuardian(accessToken: string) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 3', order: 3 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const student = await request(app)
    .post('/api/students')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Zainab Ali',
      gender: 'FEMALE',
      dateOfBirth: '2016-03-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });
  const guardian = await request(app)
    .post('/api/guardians')
    .set(authHeader(accessToken))
    .send({
      fullName: 'Ali Raza',
      relationship: 'FATHER',
      phone: '03001112222',
      email: 'ali.raza@example.com',
      studentId: student.body.data.id,
      isPrimary: true,
    });

  return { year: year.body.data, section: section.body.data, student: student.body.data, guardian: guardian.body.data };
}

describe('Channel status', () => {
  it('reports every external channel as simulated when no real provider credentials are configured (test env)', async () => {
    const { accessToken } = await signupSchool(app);

    const res = await request(app).get('/api/notifications/channel-status').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.SMS).toEqual({ live: false, provider: 'none (simulated)' });
    expect(res.body.data.WHATSAPP).toEqual({ live: false, provider: 'none (simulated)' });
    expect(res.body.data.EMAIL).toEqual({ live: false, provider: 'none (simulated)' });
  });

  it('is visible to any role allowed to send notifications, not just SCHOOL_ADMIN', async () => {
    const { tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.status@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app).get('/api/notifications/channel-status').set(authHeader(teacher.accessToken));
    expect(res.status).toBe(200);
  });
});

describe('Direct notifications', () => {
  it('sends an IN_APP notification to a specific user and it appears in their inbox', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.notif@test-school.test',
      role: 'TEACHER',
    });

    const send = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'IN_APP', recipientUserId: teacher.user.id, subject: 'Meeting', body: 'Staff meeting at 3pm' });

    expect(send.status).toBe(201);
    expect(send.body.data.status).toBe('SENT');

    const inbox = await request(app).get('/api/notifications').set(authHeader(teacher.accessToken));
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0].body).toBe('Staff meeting at 3pm');
    expect(inbox.body.meta.unreadCount).toBe(1);
  });

  it('sends an SMS notification resolving the phone number from the recipient user profile', async () => {
    // SMS/WhatsApp is a Standard-plan-and-up feature (see config/plans.ts)
    // — TRIAL/BASIC get 0 SMS credits, so this test needs a plan that has
    // quota to exercise the actual send path rather than the quota block.
    const { accessToken, tenant } = await signupSchool(app, { plan: 'STANDARD' });
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd.notif@test-school.test',
      role: 'FRONT_DESK',
    });
    await ownerDb.user.update({ where: { id: frontDesk.user.id }, data: { phone: '03009998888' } });

    const send = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'SMS', recipientUserId: frontDesk.user.id, body: 'Your shift starts at 8am' });

    expect(send.status).toBe(201);
    expect(send.body.data.status).toBe('SENT');
    expect(send.body.data.recipientPhone).toBe('03009998888');
    expect(send.body.data.providerMessageId).toMatch(/^local-/);
  });

  it('rejects SMS with no phone available (recipient has none on file)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd.nophone@test-school.test',
      role: 'FRONT_DESK',
    });

    const send = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'SMS', recipientUserId: frontDesk.user.id, body: 'no phone on file' });

    expect(send.status).toBe(400);
  });

  it('blocks SMS on a plan with no SMS credits (TRIAL), recording a FAILED notification rather than sending', async () => {
    const { accessToken, tenant } = await signupSchool(app); // defaults to TRIAL (0 SMS credits)
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd.quota@test-school.test',
      role: 'FRONT_DESK',
    });
    await ownerDb.user.update({ where: { id: frontDesk.user.id }, data: { phone: '03001234567' } });

    const send = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'SMS', recipientUserId: frontDesk.user.id, body: 'blocked by plan' });

    // Still a 201 — the attempt is recorded (audit trail), just not delivered.
    expect(send.status).toBe(201);
    expect(send.body.data.status).toBe('FAILED');
    expect(send.body.data.errorMessage).toMatch(/not available on your current plan/i);
  });

  it('rejects IN_APP without a recipientUserId (validation)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'IN_APP', body: 'missing recipient' });
    expect(res.status).toBe(400);
  });

  it('marking a notification as read is idempotent and only the owner can do it', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher.read@test-school.test',
      role: 'TEACHER',
    });
    const other = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other.read@test-school.test',
      role: 'TEACHER',
    });

    const send = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(accessToken))
      .send({ channel: 'IN_APP', recipientUserId: teacher.user.id, body: 'read me' });
    const notifId = send.body.data.id;

    const deniedRead = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set(authHeader(other.accessToken));
    expect(deniedRead.status).toBe(403);

    const read1 = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set(authHeader(teacher.accessToken));
    expect(read1.status).toBe(200);
    expect(read1.body.data.readAt).not.toBeNull();

    const read2 = await request(app)
      .patch(`/api/notifications/${notifId}/read`)
      .set(authHeader(teacher.accessToken));
    expect(read2.status).toBe(200);

    const inbox = await request(app).get('/api/notifications').set(authHeader(teacher.accessToken));
    expect(inbox.body.meta.unreadCount).toBe(0);
  });

  it('FRONT_DESK cannot send notifications on behalf of... wait STUDENT/PARENT roles cannot send (403)', async () => {
    // No STUDENT/PARENT login path exists yet (Day 9), so we assert the role
    // gate itself by checking a role outside SEND_ROLES is rejected via a
    // directly-created STUDENT user.
    const { tenant } = await signupSchool(app);
    const student = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'student.notif@test-school.test',
      role: 'STUDENT',
    });

    const res = await request(app)
      .post('/api/notifications/send')
      .set(authHeader(student.accessToken))
      .send({ channel: 'IN_APP', recipientUserId: student.user.id, body: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('Broadcasts', () => {
  it('broadcasts an SMS to all guardians of students in a section', async () => {
    // Standard-plan-and-up feature — see the SMS credit note above.
    const { accessToken } = await signupSchool(app, { plan: 'STANDARD' });
    const { section } = await setupSectionWithGuardian(accessToken);

    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set(authHeader(accessToken))
      .send({
        channel: 'SMS',
        target: 'SECTION_GUARDIANS',
        sectionId: section.id,
        body: 'PTM scheduled for Friday',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalRecipients).toBe(1);
    expect(res.body.data.sent).toBe(1);
    expect(res.body.data.failed).toBe(0);
  });

  it('rejects IN_APP broadcasts to SECTION_GUARDIANS (guardians may have no login)', async () => {
    const { accessToken } = await signupSchool(app);
    const { section } = await setupSectionWithGuardian(accessToken);

    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set(authHeader(accessToken))
      .send({ channel: 'IN_APP', target: 'SECTION_GUARDIANS', sectionId: section.id, body: 'x' });

    expect(res.status).toBe(400);
  });

  it('broadcasts an IN_APP announcement to all staff with a given role', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher1.bc@test-school.test',
      role: 'TEACHER',
    });
    const teacher2 = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher2.bc@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set(authHeader(accessToken))
      .send({ channel: 'IN_APP', target: 'STAFF_ROLE', role: 'TEACHER', body: 'School closed tomorrow' });

    expect(res.status).toBe(201);
    expect(res.body.data.totalRecipients).toBe(2);
    expect(res.body.data.sent).toBe(2);

    const inbox = await request(app).get('/api/notifications').set(authHeader(teacher2.accessToken));
    expect(inbox.body.data[0].body).toBe('School closed tomorrow');
  });

  it('tenant isolation: broadcasting by role only reaches that tenant staff', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a-notif', adminEmail: 'admin@a-notif.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b-notif', adminEmail: 'admin@b-notif.test' });
    await createAndLoginUser(app, {
      tenantId: schoolB.tenant.id,
      slug: schoolB.tenant.slug,
      email: 'teacher.b@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/notifications/broadcast')
      .set(authHeader(schoolA.accessToken))
      .send({ channel: 'IN_APP', target: 'STAFF_ROLE', role: 'TEACHER', body: 'x' });

    expect(res.status).toBe(201);
    expect(res.body.data.totalRecipients).toBe(0);
  });
});
