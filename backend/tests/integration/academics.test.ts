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

async function setup(accessToken: string) {
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
  return { year: year.body.data, schoolClass: cls.body.data, section: section.body.data };
}

describe('Subjects', () => {
  it('creates subjects and rejects duplicates', async () => {
    const { accessToken } = await signupSchool(app);
    const create = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics', code: 'MATH' });
    expect(create.status).toBe(201);

    const dup = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });
    expect(dup.status).toBe(409);

    const list = await request(app).get('/api/subjects').set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(1);
  });
});

describe('Section-subject assignment', () => {
  it('assigns a subject+teacher to a section and rejects duplicate assignment', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setup(accessToken);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher@test-school.test',
      role: 'TEACHER',
    });
    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });

    const assign = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
    expect(assign.status).toBe(201);

    const dup = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id });
    expect(dup.status).toBe(409);
  });

  it('rejects assigning a non-TEACHER user as the subject teacher', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setup(accessToken);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'acc@test-school.test',
      role: 'ACCOUNTANT',
    });
    const subject = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });

    const res = await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: accountant.user.id });
    expect(res.status).toBe(400);
  });
});

describe('Timetable', () => {
  async function seedSectionSubject(app_: typeof app, accessToken: string, tenant: { id: string; slug: string }) {
    const { section } = await setup(accessToken);
    const teacher = await createAndLoginUser(app_, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: `teacher-${Date.now()}-${Math.random()}@test-school.test`,
      role: 'TEACHER',
    });
    const subject = await request(app_)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Mathematics' });
    const sectionSubject = await request(app_)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });
    return { section, teacher, sectionSubject: sectionSubject.body.data };
  }

  it('creates a timetable slot and lists it by section', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, sectionSubject } = await seedSectionSubject(app, accessToken, tenant);

    const slot = await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({
        sectionSubjectId: sectionSubject.id,
        dayOfWeek: 'MONDAY',
        startTime: '08:00',
        endTime: '08:45',
        roomNumber: '101',
      });
    expect(slot.status).toBe(201);

    const list = await request(app)
      .get(`/api/timetable?sectionId=${section.id}`)
      .set(authHeader(accessToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('rejects endTime before/equal to startTime with 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);

    const res = await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '08:00' });
    expect(res.status).toBe(400);
  });

  it('rejects an overlapping slot for the SAME section on the same day', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);

    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

    const overlap = await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:30', endTime: '09:15' });
    expect(overlap.status).toBe(409);

    // Back-to-back (no overlap) is fine.
    const backToBack = await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:45', endTime: '09:30' });
    expect(backToBack.status).toBe(201);
  });

  it('rejects double-booking the SAME teacher across two different sections at an overlapping time', async () => {
    const { accessToken, tenant } = await signupSchool(app);

    // Section A with Teacher X teaching Math
    const { section: sectionA, year } = await setup(accessToken);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacherx@test-school.test',
      role: 'TEACHER',
    });
    const math = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
    const ssA = await request(app)
      .post(`/api/sections/${sectionA.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: math.body.data.id, teacherId: teacher.user.id });

    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ssA.body.data.id, dayOfWeek: 'TUESDAY', startTime: '10:00', endTime: '10:45' });

    // Section B, same teacher X also teaching Science there, overlapping time -> must be rejected
    const cls2 = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 6', order: 6 });
    const sectionB = await request(app)
      .post('/api/sections')
      .set(authHeader(accessToken))
      .send({ schoolClassId: cls2.body.data.id, academicYearId: year.id, name: 'A' });
    const science = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Science' });
    const ssB = await request(app)
      .post(`/api/sections/${sectionB.body.data.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: science.body.data.id, teacherId: teacher.user.id });

    const conflict = await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ssB.body.data.id, dayOfWeek: 'TUESDAY', startTime: '10:15', endTime: '11:00' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toMatch(/teacher/i);
  });

  it("a TEACHER can fetch their own timetable via /timetable/me", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher } = await seedSectionSubject(app, accessToken, tenant);

    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'WEDNESDAY', startTime: '11:00', endTime: '11:45' });

    const mine = await request(app).get('/api/timetable/me').set(authHeader(teacher.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
  });

  describe('PATCH /api/timetable/:id', () => {
    it("edits a slot's time/room without touching its sectionSubject", async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);
      const slot = await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

      const patched = await request(app)
        .patch(`/api/timetable/${slot.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ startTime: '09:00', endTime: '09:45', roomNumber: '202' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.roomNumber).toBe('202');
    });

    it('rejects a PATCH that would create a section-time conflict with another slot', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);
      await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });
      const second = await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '09:00', endTime: '09:45' });

      // Moving the second slot to overlap the first must be rejected.
      const patched = await request(app)
        .patch(`/api/timetable/${second.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ startTime: '08:15', endTime: '09:00' });
      expect(patched.status).toBe(409);
    });

    it('allows a PATCH that only shrinks/moves a slot within its own current position (no false self-conflict)', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);
      const slot = await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

      const patched = await request(app)
        .patch(`/api/timetable/${slot.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ startTime: '08:05', endTime: '08:40' });
      expect(patched.status).toBe(200);
    });

    it('rejects endTime before/equal to startTime on PATCH with 400', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { sectionSubject } = await seedSectionSubject(app, accessToken, tenant);
      const slot = await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

      const patched = await request(app)
        .patch(`/api/timetable/${slot.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ startTime: '09:00', endTime: '08:00' });
      expect(patched.status).toBe(400);
    });

    it('404s for an unknown slot id', async () => {
      const { accessToken } = await signupSchool(app);
      const res = await request(app)
        .patch('/api/timetable/00000000-0000-0000-0000-000000000000')
        .set(authHeader(accessToken))
        .send({ roomNumber: '303' });
      expect(res.status).toBe(404);
    });

    it('403s for a non-admin (TEACHER)', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { sectionSubject, teacher } = await seedSectionSubject(app, accessToken, tenant);
      const slot = await request(app)
        .post('/api/timetable')
        .set(authHeader(accessToken))
        .send({ sectionSubjectId: sectionSubject.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

      const res = await request(app)
        .patch(`/api/timetable/${slot.body.data.id}`)
        .set(authHeader(teacher.accessToken))
        .send({ roomNumber: '303' });
      expect(res.status).toBe(403);
    });
  });
});
