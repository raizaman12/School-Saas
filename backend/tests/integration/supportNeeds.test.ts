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
    .send({ name: 'Class 3', order: 3 });

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
      fullName: 'Sana Tariq',
      gender: 'FEMALE',
      dateOfBirth: '2016-03-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });

  return { section: section.body.data, student: student.body.data, classTeacher, otherTeacher };
}

describe('Learning support plans (support needs)', () => {
  it('SCHOOL_ADMIN creates a support plan and can list/fetch it', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });

    const create = await request(app)
      .post('/api/support-needs')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        category: 'LEARNING_SUPPORT',
        description: 'Difficulty with reading fluency, identified by class teacher.',
        identifiedDate: '2026-01-15',
        supportProvided: 'Extra reading time with resource teacher twice a week; simplified worksheets.',
        examAccommodations: 'Extra 20 minutes in written exams.',
      });
    expect(create.status).toBe(201);
    expect(create.body.data.category).toBe('LEARNING_SUPPORT');
    expect(create.body.data.status).toBe('ACTIVE');
    expect(create.body.data.student.fullName).toBe('Ahmed Khan');
    expect(create.body.data.reviews).toEqual([]);

    const list = await request(app).get('/api/support-needs').set(authHeader(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const detail = await request(app).get(`/api/support-needs/${create.body.data.id}`).set(authHeader(accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.supportProvided).toMatch(/resource teacher/);
  });

  it('a TEACHER can create/view support plans only for students in their own sections', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher, otherTeacher } = await setupStudentWithTeachers(accessToken, tenant);

    const byClassTeacher = await request(app)
      .post('/api/support-needs')
      .set(authHeader(classTeacher.accessToken))
      .send({
        studentId: student.id,
        category: 'ATTENTION_FOCUS_SUPPORT',
        description: 'Struggles to stay focused for full lesson periods.',
        identifiedDate: '2026-01-15',
        supportProvided: 'Preferred seating near the front; short break every 20 minutes.',
      });
    expect(byClassTeacher.status).toBe(201);

    const byOtherTeacher = await request(app)
      .post('/api/support-needs')
      .set(authHeader(otherTeacher.accessToken))
      .send({
        studentId: student.id,
        category: 'ATTENTION_FOCUS_SUPPORT',
        description: 'Should be forbidden — not this teacher\'s section.',
        identifiedDate: '2026-01-15',
        supportProvided: 'N/A',
      });
    expect(byOtherTeacher.status).toBe(403);

    const listByOther = await request(app).get('/api/support-needs').set(authHeader(otherTeacher.accessToken));
    expect(listByOther.body.data).toHaveLength(0);

    const listByClassTeacher = await request(app).get('/api/support-needs').set(authHeader(classTeacher.accessToken));
    expect(listByClassTeacher.body.data).toHaveLength(1);
  });

  it('a TEACHER can only edit plans they themselves created; SCHOOL_ADMIN can edit any', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);

    const created = await request(app)
      .post('/api/support-needs')
      .set(authHeader(accessToken)) // created by admin
      .send({
        studentId: student.id,
        category: 'VISION_SUPPORT',
        description: 'Mild visual impairment, wears glasses.',
        identifiedDate: '2026-01-15',
        supportProvided: 'Front-row seating; larger print handouts.',
      });

    const teacherEdit = await request(app)
      .patch(`/api/support-needs/${created.body.data.id}`)
      .set(authHeader(classTeacher.accessToken))
      .send({ status: 'RESOLVED' });
    expect(teacherEdit.status).toBe(403);

    const adminEdit = await request(app)
      .patch(`/api/support-needs/${created.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ status: 'UNDER_REVIEW', nextReviewDate: '2026-06-01' });
    expect(adminEdit.status).toBe(200);
    expect(adminEdit.body.data.status).toBe('UNDER_REVIEW');
  });

  it('adds a periodic review and optionally updates the plan status', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const created = await request(app)
      .post('/api/support-needs')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        category: 'SPEECH_LANGUAGE_SUPPORT',
        description: 'Stammering, mild.',
        identifiedDate: '2026-01-01',
        supportProvided: 'Weekly speech therapy session referral; patient classroom questioning.',
      });

    const review = await request(app)
      .post(`/api/support-needs/${created.body.data.id}/reviews`)
      .set(authHeader(accessToken))
      .send({
        reviewDate: '2026-04-01',
        notes: 'Noticeable improvement after 3 months of therapy.',
        updatedStatus: 'RESOLVED',
      });
    expect(review.status).toBe(201);
    expect(review.body.data.status).toBe('RESOLVED');
    expect(review.body.data.reviews).toHaveLength(1);
    expect(review.body.data.reviews[0].notes).toMatch(/improvement/);
  });

  it('a review without updatedStatus leaves the plan status unchanged', async () => {
    const { accessToken } = await signupSchool(app);
    const student = await request(app)
      .post('/api/students')
      .set(authHeader(accessToken))
      .send({ fullName: 'Ahmed Khan', gender: 'MALE', dateOfBirth: '2015-01-01' });
    const created = await request(app)
      .post('/api/support-needs')
      .set(authHeader(accessToken))
      .send({
        studentId: student.body.data.id,
        category: 'OTHER',
        description: 'General note.',
        identifiedDate: '2026-01-01',
        supportProvided: 'Monitoring.',
      });

    const review = await request(app)
      .post(`/api/support-needs/${created.body.data.id}/reviews`)
      .set(authHeader(accessToken))
      .send({ reviewDate: '2026-03-01', notes: 'Still monitoring, no change yet.' });

    expect(review.status).toBe(201);
    expect(review.body.data.status).toBe('ACTIVE'); // unchanged
  });

  it('only SCHOOL_ADMIN can delete a support plan', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);
    const created = await request(app)
      .post('/api/support-needs')
      .set(authHeader(classTeacher.accessToken))
      .send({
        studentId: student.id,
        category: 'OTHER',
        description: 'Test plan.',
        identifiedDate: '2026-01-01',
        supportProvided: 'N/A',
      });

    const teacherDelete = await request(app)
      .delete(`/api/support-needs/${created.body.data.id}`)
      .set(authHeader(classTeacher.accessToken));
    expect(teacherDelete.status).toBe(403);

    const adminDelete = await request(app)
      .delete(`/api/support-needs/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(adminDelete.status).toBe(204);
  });

  it('filters by studentId, category, and status', async () => {
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
      .post('/api/support-needs')
      .set(authHeader(accessToken))
      .send({
        studentId: s1.body.data.id,
        category: 'GIFTED_TALENTED_SUPPORT',
        description: 'Excels well beyond grade level in math.',
        identifiedDate: '2026-01-01',
        supportProvided: 'Enrichment worksheets; entered in inter-school Olympiad.',
      });
    await request(app)
      .post('/api/support-needs')
      .set(authHeader(accessToken))
      .send({
        studentId: s2.body.data.id,
        category: 'HEARING_SUPPORT',
        description: 'Mild hearing loss in left ear.',
        identifiedDate: '2026-01-01',
        supportProvided: 'Front-row seating; teacher faces class when speaking.',
      });

    const byStudent = await request(app)
      .get(`/api/support-needs?studentId=${s1.body.data.id}`)
      .set(authHeader(accessToken));
    expect(byStudent.body.data).toHaveLength(1);
    expect(byStudent.body.data[0].id).toBe(r1.body.data.id);

    const byCategory = await request(app)
      .get('/api/support-needs?category=HEARING_SUPPORT')
      .set(authHeader(accessToken));
    expect(byCategory.body.data).toHaveLength(1);
    expect(byCategory.body.data[0].category).toBe('HEARING_SUPPORT');

    const byStatus = await request(app).get('/api/support-needs?status=ACTIVE').set(authHeader(accessToken));
    expect(byStatus.body.data).toHaveLength(2);
  });

  it('FRONT_DESK is blocked entirely (403) — more sensitive than discipline records', async () => {
    const { tenant } = await signupSchool(app);
    const frontDesk = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'fd@test-school.test',
      role: 'FRONT_DESK',
    });
    const res = await request(app).get('/api/support-needs').set(authHeader(frontDesk.accessToken));
    expect(res.status).toBe(403);
  });

  it('ACCOUNTANT is blocked entirely (403)', async () => {
    const { tenant } = await signupSchool(app);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'acct@test-school.test',
      role: 'ACCOUNTANT',
    });
    const res = await request(app).get('/api/support-needs').set(authHeader(accountant.accessToken));
    expect(res.status).toBe(403);
  });
});
