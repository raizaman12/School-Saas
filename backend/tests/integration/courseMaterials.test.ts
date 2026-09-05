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
  // Academic year/class/subject names are unique per tenant — tag each
  // with a short random id so a test calling this helper more than once
  // (e.g. to set up two separate courses) doesn't collide on a repeated
  // "2025-2026" / "Class 5" / "Mathematics". AcademicYear.name is capped
  // at 20 chars (see validation.ts), so the tag has to stay short.
  const tag = Math.random().toString(36).slice(2, 8);
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: `Yr-${tag}`, startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: `Class 5 (${tag})`, order: 5 });
  const section = await request(app)
    .post('/api/sections')
    .set(authHeader(accessToken))
    .send({ schoolClassId: cls.body.data.id, academicYearId: year.body.data.id, name: 'A' });
  const teacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: opts.teacherEmail ?? `teacher-${tag}@test-school.test`,
    role: 'TEACHER',
  });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: `Mathematics (${tag})` });
  const sectionSubject = await request(app)
    .post(`/api/sections/${section.body.data.id}/subjects`)
    .set(authHeader(accessToken))
    .send({ subjectId: subject.body.data.id, teacherId: teacher.user.id });

  return { section: section.body.data, subject: subject.body.data, teacher, sectionSubject: sectionSubject.body.data };
}

describe('Course materials', () => {
  it('SCHOOL_ADMIN shares a material against a section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupSectionSubject(accessToken, tenant);

    const res = await request(app)
      .post('/api/course-materials')
      .set(authHeader(accessToken))
      .send({
        sectionSubjectId: sectionSubject.id,
        title: 'Chapter 3 slides',
        fileUrl: 'https://example.test/uploads/t1/notes.pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Chapter 3 slides');
    expect(res.body.data.sectionSubject.id).toBe(sectionSubject.id);
  });

  it('the assigned TEACHER can share material for their own section-subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher } = await setupSectionSubject(accessToken, tenant);

    const res = await request(app)
      .post('/api/course-materials')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.uploadedByUser.id).toBe(teacher.user.id);
  });

  it('a TEACHER not assigned to that section-subject is rejected with 403', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupSectionSubject(accessToken, tenant);
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'other-teacher@test-school.test',
      role: 'TEACHER',
    });

    const res = await request(app)
      .post('/api/course-materials')
      .set(authHeader(otherTeacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });

    expect(res.status).toBe(403);
  });

  it('rejects an unknown sectionSubjectId (400)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .post('/api/course-materials')
      .set(authHeader(accessToken))
      .send({
        sectionSubjectId: '00000000-0000-0000-0000-000000000000',
        title: 'Notes',
        fileUrl: 'https://example.test/notes.pdf',
      });
    expect(res.status).toBe(400);
  });

  it('FRONT_DESK can list but not create materials', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupSectionSubject(accessToken, tenant);
    await request(app)
      .post('/api/course-materials')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });

    const list = await request(app).get('/api/course-materials').set(authHeader(frontDesk.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const create = await request(app)
      .post('/api/course-materials')
      .set(authHeader(frontDesk.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });
    expect(create.status).toBe(403);
  });

  it('lists materials filtered by sectionSubjectId, most recent first', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject } = await setupSectionSubject(accessToken, tenant);
    const other = await setupSectionSubject(accessToken, tenant, { teacherEmail: 'other2@test-school.test' });

    await request(app)
      .post('/api/course-materials')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'For this course', fileUrl: 'https://example.test/a.pdf' });
    await request(app)
      .post('/api/course-materials')
      .set(authHeader(accessToken))
      .send({ sectionSubjectId: other.sectionSubject.id, title: 'For other course', fileUrl: 'https://example.test/b.pdf' });

    const list = await request(app)
      .get('/api/course-materials')
      .query({ sectionSubjectId: sectionSubject.id })
      .set(authHeader(accessToken));

    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].title).toBe('For this course');
  });

  it('a TEACHER can delete only material they uploaded; SCHOOL_ADMIN can delete any', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { sectionSubject, teacher } = await setupSectionSubject(accessToken, tenant, {
      teacherEmail: 'owner-teacher@test-school.test',
    });
    const otherTeacher = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'bystander-teacher@test-school.test',
      role: 'TEACHER',
    });

    const created = await request(app)
      .post('/api/course-materials')
      .set(authHeader(teacher.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });
    const materialId = created.body.data.id;

    const forbiddenDelete = await request(app)
      .delete(`/api/course-materials/${materialId}`)
      .set(authHeader(otherTeacher.accessToken));
    expect(forbiddenDelete.status).toBe(403);

    const adminDelete = await request(app)
      .delete(`/api/course-materials/${materialId}`)
      .set(authHeader(accessToken));
    expect(adminDelete.status).toBe(204);

    const gone = await request(app).get('/api/course-materials').set(authHeader(accessToken));
    expect(gone.body.data).toHaveLength(0);
  });

  it('cannot access another tenant\'s course material (tenant isolation)', async () => {
    const schoolA = await signupSchool(app, { slug: 'cm-school-a', adminEmail: 'admin@cm-a.test' });
    const schoolB = await signupSchool(app, { slug: 'cm-school-b', adminEmail: 'admin@cm-b.test' });
    const { sectionSubject } = await setupSectionSubject(schoolA.accessToken, schoolA.tenant);

    const created = await request(app)
      .post('/api/course-materials')
      .set(authHeader(schoolA.accessToken))
      .send({ sectionSubjectId: sectionSubject.id, title: 'Notes', fileUrl: 'https://example.test/notes.pdf' });

    const del = await request(app)
      .delete(`/api/course-materials/${created.body.data.id}`)
      .set(authHeader(schoolB.accessToken));
    expect(del.status).toBe(404);
  });
});
