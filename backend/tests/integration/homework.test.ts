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

async function setupSectionSubject(
  accessToken: string,
  tenant: { id: string; slug: string },
  opts: { teacherEmail?: string } = {},
) {
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
  const teacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: opts.teacherEmail ?? `teacher-${Date.now()}-${Math.random()}@test-school.test`,
    role: 'TEACHER',
  });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Mathematics' });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });

  return { section: section.body.data, subject: subject.body.data, teacher, sectionSubject: sectionSubject.body.data };
}

function homeworkPayload(sectionId: string, subjectId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sectionId,
    subjectId,
    title: 'Chapter 3 exercises',
    description: 'Complete Q1-Q10',
    dueDate: '2026-03-01',
    ...overrides,
  };
}

describe('Homework', () => {
  it('SCHOOL_ADMIN assigns homework to a section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject } = await setupSectionSubject(accessToken, tenant);

    const res = await request(app)
      .post('/api/homework')
      .set(authHeader(accessToken))
      .send(homeworkPayload(section.id, subject.id));

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Chapter 3 exercises');
    expect(res.body.data.section.id).toBe(section.id);
    expect(res.body.data.subject.id).toBe(subject.id);
  });

  it('the assigned TEACHER can assign homework for their own section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject, teacher } = await setupSectionSubject(accessToken, tenant);

    const res = await request(app)
      .post('/api/homework')
      .set(authHeader(teacher.accessToken))
      .send(homeworkPayload(section.id, subject.id));

    expect(res.status).toBe(201);
    expect(res.body.data.assignedByUser.id).toBe(teacher.user.id);
  });

  it('a TEACHER not assigned to that section-subject is rejected with 403', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject } = await setupSectionSubject(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other-teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/homework')
      .set(authHeader(otherTeacher.accessToken))
      .send(homeworkPayload(section.id, subject.id));

    expect(res.status).toBe(403);
  });

  it('rejects homework for a subject that is not assigned to the section (400)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section } = await setupSectionSubject(accessToken, tenant);
    const unassignedSubject = await request(app)
      .post('/api/subjects')
      .set(authHeader(accessToken))
      .send({ name: 'Science' });

    const res = await request(app)
      .post('/api/homework')
      .set(authHeader(accessToken))
      .send(homeworkPayload(section.id, unassignedSubject.body.data.id));

    expect(res.status).toBe(400);
  });

  it('FRONT_DESK can list but not create homework', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject } = await setupSectionSubject(accessToken, tenant);
    await request(app).post('/api/homework').set(authHeader(accessToken)).send(homeworkPayload(section.id, subject.id));
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const list = await request(app).get('/api/homework').set(authHeader(frontDesk.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const create = await request(app)
      .post('/api/homework')
      .set(authHeader(frontDesk.accessToken))
      .send(homeworkPayload(section.id, subject.id));
    expect(create.status).toBe(403);
  });

  it('lists homework filtered by sectionId, most recent due date first', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject } = await setupSectionSubject(accessToken, tenant);

    await request(app)
      .post('/api/homework')
      .set(authHeader(accessToken))
      .send(homeworkPayload(section.id, subject.id, { title: 'Earlier', dueDate: '2026-02-01' }));
    await request(app)
      .post('/api/homework')
      .set(authHeader(accessToken))
      .send(homeworkPayload(section.id, subject.id, { title: 'Later', dueDate: '2026-03-15' }));

    const list = await request(app)
      .get('/api/homework')
      .query({ sectionId: section.id })
      .set(authHeader(accessToken));

    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].title).toBe('Later');
  });

  it('a TEACHER can edit/delete only the homework they assigned; SCHOOL_ADMIN can edit/delete any', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { section, subject, teacher } = await setupSectionSubject(accessToken, tenant, {
      teacherEmail: 'owner-teacher@test-school.test',
    });
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'bystander-teacher@test-school.test',
      role: 'TEACHER',
    });

    const created = await request(app)
      .post('/api/homework')
      .set(authHeader(teacher.accessToken))
      .send(homeworkPayload(section.id, subject.id));
    const homeworkId = created.body.data.id;

    const forbiddenEdit = await request(app)
      .patch(`/api/homework/${homeworkId}`)
      .set(authHeader(otherTeacher.accessToken))
      .send({ title: 'Hijacked' });
    expect(forbiddenEdit.status).toBe(403);

    const ownEdit = await request(app)
      .patch(`/api/homework/${homeworkId}`)
      .set(authHeader(teacher.accessToken))
      .send({ title: 'Updated by owner' });
    expect(ownEdit.status).toBe(200);
    expect(ownEdit.body.data.title).toBe('Updated by owner');

    const forbiddenDelete = await request(app)
      .delete(`/api/homework/${homeworkId}`)
      .set(authHeader(otherTeacher.accessToken));
    expect(forbiddenDelete.status).toBe(403);

    const adminDelete = await request(app)
      .delete(`/api/homework/${homeworkId}`)
      .set(authHeader(accessToken));
    expect(adminDelete.status).toBe(204);

    const gone = await request(app).get('/api/homework').set(authHeader(accessToken));
    expect(gone.body.data).toHaveLength(0);
  });

  it('cannot access another tenant homework record (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'school-a', adminEmail: 'admin@a.test' });
    const schoolB = await signupSchool(app, { slug: 'school-b', adminEmail: 'admin@b.test' });
    const { section, subject } = await setupSectionSubject(schoolA.accessToken, schoolA.tenant);

    const created = await request(app)
      .post('/api/homework')
      .set(authHeader(schoolA.accessToken))
      .send(homeworkPayload(section.id, subject.id));

    const patch = await request(app)
      .patch(`/api/homework/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken))
      .send({ title: 'Nope' });
    expect(patch.status).toBe(404);

    const del = await request(app)
      .delete(`/api/homework/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken));
    expect(del.status).toBe(404);
  });
});
