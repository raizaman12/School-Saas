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
 * an enrolled student — same cast shape as health.test.ts/supportNeeds.test.ts,
 * used to test TEACHER section-scoping on the values-read route.
 */
async function setupStudentWithTeachers(accessToken: string, tenant: { id: string; slug: string }) {
  const year = await request(app)
    .post('/api/academic-years')
    .set(authHeader(accessToken))
    .send({ name: '2025-2026', startDate: '2025-08-01', endDate: '2026-05-31', isActive: true });
  const cls = await request(app)
    .post('/api/classes')
    .set(authHeader(accessToken))
    .send({ name: 'Class 4', order: 4 });

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
      fullName: 'Zoya Farooq',
      gender: 'FEMALE',
      dateOfBirth: '2015-09-01',
      sectionId: section.body.data.id,
      academicYearId: year.body.data.id,
    });

  return { section: section.body.data, student: student.body.data, classTeacher, otherTeacher };
}

describe('Custom fields', () => {
  describe('Field definitions', () => {
    it('SCHOOL_ADMIN creates a TEXT field and it appears in the active list', async () => {
      const { accessToken } = await signupSchool(app);

      const create = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: "Father's Occupation", fieldType: 'TEXT' });
      expect(create.status).toBe(201);
      expect(create.body.data.label).toBe("Father's Occupation");
      expect(create.body.data.fieldType).toBe('TEXT');
      expect(create.body.data.active).toBe(true);

      const list = await request(app).get('/api/custom-fields').set(authHeader(accessToken));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].label).toBe("Father's Occupation");
    });

    it('rejects a SELECT field with no options', async () => {
      const { accessToken } = await signupSchool(app);

      const create = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Transport Route', fieldType: 'SELECT' });
      expect(create.status).toBe(400);
    });

    it('creates a SELECT field with options', async () => {
      const { accessToken } = await signupSchool(app);

      const create = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Transport Route', fieldType: 'SELECT', options: ['Route A', 'Route B'] });
      expect(create.status).toBe(201);
      expect(create.body.data.options).toEqual(['Route A', 'Route B']);
    });

    it('rejects a duplicate label within the same tenant', async () => {
      const { accessToken } = await signupSchool(app);

      await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });

      const dupe = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });
      expect(dupe.status).toBe(409);
    });

    it('disables (soft-deletes) a field via PATCH active:false, and it drops out of the default list', async () => {
      const { accessToken } = await signupSchool(app);

      const create = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });

      const disable = await request(app)
        .patch(`/api/custom-fields/${create.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ active: false });
      expect(disable.status).toBe(200);
      expect(disable.body.data.active).toBe(false);

      const activeOnly = await request(app).get('/api/custom-fields').set(authHeader(accessToken));
      expect(activeOnly.body.data).toHaveLength(0);

      const all = await request(app)
        .get('/api/custom-fields?includeInactive=true')
        .set(authHeader(accessToken));
      expect(all.body.data).toHaveLength(1);
    });

    it('hard-deletes a field with no values recorded, but blocks deleting one that has values', async () => {
      const { accessToken } = await signupSchool(app);

      const create = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });

      const del = await request(app)
        .delete(`/api/custom-fields/${create.body.data.id}`)
        .set(authHeader(accessToken));
      expect(del.status).toBe(204);

      const recreate = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });
      await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: recreate.body.data.id, value: 'City School' }] });

      const blockedDelete = await request(app)
        .delete(`/api/custom-fields/${recreate.body.data.id}`)
        .set(authHeader(accessToken));
      expect(blockedDelete.status).toBe(409);
    });

    it('FRONT_DESK/TEACHER/ACCOUNTANT can read definitions but not write them', async () => {
      const { tenant } = await signupSchool(app);
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'frontdesk@test-school.test',
        role: 'FRONT_DESK',
      });

      const readOk = await request(app).get('/api/custom-fields').set(authHeader(frontDesk.accessToken));
      expect(readOk.status).toBe(200);

      const writeBlocked = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(frontDesk.accessToken))
        .send({ label: 'Transport Route', fieldType: 'TEXT' });
      expect(writeBlocked.status).toBe(403);
    });
  });

  describe('Student values', () => {
    it('GET returns every active field merged with the student\'s existing answers, unanswered fields as null', async () => {
      const { accessToken } = await signupSchool(app);
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: "Father's Occupation", fieldType: 'TEXT' });
      const select = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Transport Route', fieldType: 'SELECT', options: ['Route A', 'Route B'] });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });

      await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'Businessman' }] });

      const get = await request(app)
        .get(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken));
      expect(get.status).toBe(200);
      expect(get.body.data).toHaveLength(2);
      const father = get.body.data.find((r: { fieldDefinitionId: string }) => r.fieldDefinitionId === text.body.data.id);
      const route = get.body.data.find((r: { fieldDefinitionId: string }) => r.fieldDefinitionId === select.body.data.id);
      expect(father.value).toBe('Businessman');
      expect(route.value).toBeNull();
    });

    it('rejects a NUMBER value that is not numeric, and a SELECT value not in the options list', async () => {
      const { accessToken } = await signupSchool(app);
      const number = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Siblings Count', fieldType: 'NUMBER' });
      const select = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Transport Route', fieldType: 'SELECT', options: ['Route A', 'Route B'] });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const badNumber = await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: number.body.data.id, value: 'three' }] });
      expect(badNumber.status).toBe(400);

      const badSelect = await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: select.body.data.id, value: 'Route Z' }] });
      expect(badSelect.status).toBe(400);
    });

    it('an empty-string value clears a previously-saved answer instead of storing ""', async () => {
      const { accessToken } = await signupSchool(app);
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: "Father's Occupation", fieldType: 'TEXT' });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });

      await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'Businessman' }] });

      const clear = await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: '' }] });
      expect(clear.status).toBe(200);
      expect(clear.body.data.find((r: { fieldDefinitionId: string }) => r.fieldDefinitionId === text.body.data.id).value).toBeNull();
    });

    it('a disabled field keeps its stored value visible in the merged view', async () => {
      const { accessToken } = await signupSchool(app);
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: "Father's Occupation", fieldType: 'TEXT' });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });

      await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'Businessman' }] });

      await request(app)
        .patch(`/api/custom-fields/${text.body.data.id}`)
        .set(authHeader(accessToken))
        .send({ active: false });

      const get = await request(app)
        .get(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(accessToken));
      expect(get.body.data).toHaveLength(1);
      expect(get.body.data[0].value).toBe('Businessman');
      expect(get.body.data[0].active).toBe(false);
    });

    it('TEACHER can read values for their own section but not an unrelated section', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher, otherTeacher } = await setupStudentWithTeachers(accessToken, tenant);
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });
      await request(app)
        .put(`/api/custom-fields/students/${student.id}/values`)
        .set(authHeader(accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'City School' }] });

      const ownSection = await request(app)
        .get(`/api/custom-fields/students/${student.id}/values`)
        .set(authHeader(classTeacher.accessToken));
      expect(ownSection.status).toBe(200);

      const otherSection = await request(app)
        .get(`/api/custom-fields/students/${student.id}/values`)
        .set(authHeader(otherTeacher.accessToken));
      expect(otherSection.status).toBe(403);
    });

    it('TEACHER cannot write values (not in VALUE_WRITE_ROLES)', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const { student, classTeacher } = await setupStudentWithTeachers(accessToken, tenant);
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });

      const write = await request(app)
        .put(`/api/custom-fields/students/${student.id}/values`)
        .set(authHeader(classTeacher.accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'City School' }] });
      expect(write.status).toBe(403);
    });

    it('FRONT_DESK can write values', async () => {
      const { accessToken, tenant } = await signupSchool(app);
      const frontDesk = await createAndLoginUser(app, {
        tenantId: tenant.id,
        slug: tenant.slug,
        email: 'frontdesk@test-school.test',
        role: 'FRONT_DESK',
      });
      const text = await request(app)
        .post('/api/custom-fields')
        .set(authHeader(accessToken))
        .send({ label: 'Previous School', fieldType: 'TEXT' });
      const student = await request(app)
        .post('/api/students')
        .set(authHeader(accessToken))
        .send({ fullName: 'Bilal Ahmed', gender: 'MALE', dateOfBirth: '2015-01-01' });

      const write = await request(app)
        .put(`/api/custom-fields/students/${student.body.data.id}/values`)
        .set(authHeader(frontDesk.accessToken))
        .send({ values: [{ fieldDefinitionId: text.body.data.id, value: 'City School' }] });
      expect(write.status).toBe(200);
    });
  });
});
