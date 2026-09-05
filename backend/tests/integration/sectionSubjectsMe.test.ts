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

async function seedSection(accessToken: string, className: string, order: number, sectionName: string) {
  // Academic year names are unique per tenant (and capped at 20 chars —
  // see validation.ts) — suffix with the order number so a test seeding
  // two different sections (two different classes, still "2025-2026")
  // doesn't collide on a repeated year name.
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: `Yr-${order}`, startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: className, order });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: sectionName });
  return section.body.data;
}

describe('GET /api/section-subjects/me — a TEACHER\'s own course list', () => {
  it("lists every section-subject this TEACHER teaches, across different sections, with timetable slots", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'busy-teacher@test-school.test',
      role: 'TEACHER',
    });
    const sectionA = await seedSection(accessToken, 'Class 5', 5, 'A');
    const sectionB = await seedSection(accessToken, 'Class 6', 6, 'B');
    const math = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
    const science = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Science' });

    const ss1 = await request(app)
      .post(`/api/sections/${sectionA.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: math.body.data.id, teacherId: teacher.user.id });
    await request(app)
      .post(`/api/sections/${sectionB.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: science.body.data.id, teacherId: teacher.user.id });

    await request(app)
      .post('/api/timetable')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: ss1.body.data.id, dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '08:45' });

    const res = await request(app).get('/api/section-subjects/me').set(authHeader(teacher.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const mathCourse = res.body.data.find((c: { subject: { name: string } }) => c.subject.name === 'Mathematics');
    expect(mathCourse.section.name).toBe('A');
    expect(mathCourse.section.schoolClass.name).toBe('Class 5');
    expect(mathCourse.timetableSlots).toHaveLength(1);
    expect(mathCourse.timetableSlots[0].dayOfWeek).toBe('MONDAY');
  });

  it("never includes a section-subject assigned to a DIFFERENT teacher", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const teacherA = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher-a@test-school.test',
      role: 'TEACHER',
    });
    const teacherB = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'teacher-b@test-school.test',
      role: 'TEACHER',
    });
    const section = await seedSection(accessToken, 'Class 5', 5, 'A');
    const subject = await request(app).post('/api/subjects').set(authHeader(accessToken)).send({ name: 'Mathematics' });
    await request(app)
      .post(`/api/sections/${section.id}/subjects`)
      .set(authHeader(accessToken))
      .send({ subjectId: subject.body.data.id, teacherId: teacherA.user.id });

    const res = await request(app).get('/api/section-subjects/me').set(authHeader(teacherB.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('is forbidden for a non-TEACHER role (403)', async () => {
    const { tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    const res = await request(app).get('/api/section-subjects/me').set(authHeader(frontDesk.accessToken));
    expect(res.status).toBe(403);
  });
});
