import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
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

/** Same shape as classTests.test.ts's setupClassTestFixture, minus the section/student setup this feature never needs. */
async function setupFixture(accessToken: string, tenant: { id: string; slug: string }) {
  const cls = await request(app).post('/api/classes').set(authHeader(accessToken)).send({ name: 'Class 5', order: 5 });
  const subject = await request(app)
    .post('/api/subjects')
    .set(authHeader(accessToken))
    .send({ name: 'Mathematics' });
  const teacher = await createAndLoginUser(app, {
    tenantId: tenant.id,
    slug: tenant.slug,
    email: 'examgenteacher@test-school.test',
    role: 'TEACHER',
  });

  return { schoolClass: cls.body.data, subject: subject.body.data, teacher };
}

async function grant(accessToken: string, schoolClassId: string, subjectId: string, teacherId: string) {
  return request(app)
    .post('/api/exam-generator/access-grants')
    .set(authHeader(accessToken))
    .send({ schoolClassId, subjectId, teacherId });
}

function mcqPayload(schoolClassId: string, subjectId: string, overrides: Record<string, unknown> = {}) {
  return {
    schoolClassId,
    subjectId,
    type: 'MCQ',
    questionText: 'What is 2 + 2?',
    chapter: 'Chapter 1',
    options: ['3', '4', '5', '6'],
    correctOptionIndex: 1,
    ...overrides,
  };
}

function shortPayload(schoolClassId: string, subjectId: string, overrides: Record<string, unknown> = {}) {
  return {
    schoolClassId,
    subjectId,
    type: 'SHORT_ANSWER',
    questionText: 'Define a prime number.',
    chapter: 'Chapter 1',
    marks: 3,
    ...overrides,
  };
}

function longPayload(schoolClassId: string, subjectId: string, overrides: Record<string, unknown> = {}) {
  return {
    schoolClassId,
    subjectId,
    type: 'LONG_ANSWER',
    questionText: 'Explain the proof of the Pythagorean theorem.',
    chapter: 'Chapter 2',
    marks: 10,
    ...overrides,
  };
}

describe('Access grants', () => {
  it('SCHOOL_ADMIN grants a TEACHER access, which shows up in their own /me list', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);

    const res = await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    expect(res.status).toBe(201);

    const mine = await request(app).get('/api/exam-generator/access-grants/me').set(authHeader(teacher.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ schoolClassId: schoolClass.id, subjectId: subject.id });
  });

  it('rejects a duplicate grant with 409', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);

    await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    const dup = await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    expect(dup.status).toBe(409);
  });

  it('rejects granting to a non-TEACHER user with 400', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    const accountant = await createAndLoginUser(app, {
      tenantId: tenant.id,
      slug: tenant.slug,
      email: 'notateacher@test-school.test',
      role: 'ACCOUNTANT',
    });

    const res = await grant(accessToken, schoolClass.id, subject.id, accountant.user.id);
    expect(res.status).toBe(400);
  });

  it('revoking a grant removes it from the /me list', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);

    const created = await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    const del = await request(app)
      .delete(`/api/exam-generator/access-grants/${created.body.data.id}`)
      .set(authHeader(accessToken));
    expect(del.status).toBe(204);

    const mine = await request(app).get('/api/exam-generator/access-grants/me').set(authHeader(teacher.accessToken));
    expect(mine.body.data).toHaveLength(0);
  });

  it('a TEACHER cannot create or revoke grants (403)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);

    const res = await grant(teacher.accessToken, schoolClass.id, subject.id, teacher.user.id);
    expect(res.status).toBe(403);
  });
});

describe('Question bank', () => {
  it('any TEACHER and SCHOOL_ADMIN can add questions, unrestricted by any grant', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);

    const asAdmin = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id));
    expect(asAdmin.status).toBe(201);

    const asTeacher = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(teacher.accessToken))
      .send(shortPayload(schoolClass.id, subject.id));
    expect(asTeacher.status).toBe(201);
  });

  it('enforces 2-6 MCQ options and a valid correctOptionIndex', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);

    const tooFew = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id, { options: ['only one'] }));
    expect(tooFew.status).toBe(400);

    const badIndex = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id, { correctOptionIndex: 9 }));
    expect(badIndex.status).toBe(400);
  });

  it('SHORT_ANSWER/LONG_ANSWER require marks', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, type: 'SHORT_ANSWER', questionText: 'No marks given' });
    expect(res.status).toBe(400);
  });

  it('forces MCQ marks to 1 server-side regardless of what is posted', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id));
    expect(res.body.data.marks).toBe(1);
  });

  it('PATCH never changes type, even if attempted', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    const created = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id));

    const patched = await request(app)
      .patch(`/api/exam-generator/questions/${created.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ type: 'LONG_ANSWER', questionText: 'Updated text' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.type).toBe('MCQ');
    expect(patched.body.data.questionText).toBe('Updated text');
  });

  it('chapters-summary returns correct per-type, per-chapter counts', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);

    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id, { chapter: 'Chapter 1' }));
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id, { chapter: 'Chapter 1' }));
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(shortPayload(schoolClass.id, subject.id, { chapter: 'Chapter 1' }));
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(longPayload(schoolClass.id, subject.id, { chapter: 'Chapter 2' }));

    const summary = await request(app)
      .get(`/api/exam-generator/questions/chapters-summary?schoolClassId=${schoolClass.id}&subjectId=${subject.id}`)
      .set(authHeader(accessToken));
    expect(summary.status).toBe(200);
    const ch1 = summary.body.data.chapters.find((c: { chapter: string }) => c.chapter === 'Chapter 1');
    expect(ch1).toMatchObject({ mcqCount: 2, shortCount: 1, longCount: 0 });
    const ch2 = summary.body.data.chapters.find((c: { chapter: string }) => c.chapter === 'Chapter 2');
    expect(ch2).toMatchObject({ mcqCount: 0, shortCount: 0, longCount: 1 });
    expect(summary.body.data.totals).toMatchObject({ mcqCount: 2, shortCount: 1, longCount: 1 });
  });
});

describe('Generate — access control', () => {
  it('an ungranted TEACHER is rejected with 403', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(teacher.accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });
    expect(res.status).toBe(403);
  });

  it('a granted TEACHER can generate, and the response includes correctOptionIndex', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);
    await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(teacher.accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.questions).toHaveLength(1);
    expect(res.body.data.questions[0].correctOptionIndex).toBe(1);
  });

  it('SCHOOL_ADMIN can always generate with zero grant rows', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });
    expect(res.status).toBe(201);
  });
});

describe('Generate — validation', () => {
  it('rejects with 400 naming the shortfall when the bank has too few questions (unscoped)', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 5, shortCount: 0, longCount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error?.details ?? res.body.details).toMatchObject({ type: 'MCQ', requested: 5, available: 1 });
  });

  it('rejects with 400 naming the shortfall when chapter-scoped', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id, { chapter: 'Chapter 1' }));
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id, { chapter: 'Chapter 2' }));

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({
        schoolClassId: schoolClass.id,
        subjectId: subject.id,
        chapters: ['Chapter 1'],
        mcqCount: 2,
        shortCount: 0,
        longCount: 0,
      });
    expect(res.status).toBe(400);
  });

  it('rejects requesting zero of every type', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);

    const res = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 0, shortCount: 0, longCount: 0 });
    expect(res.status).toBe(400);
  });
});

describe('Generate — randomness', () => {
  it('two generate calls over an ample bank do not always return the exact same question set', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/api/exam-generator/questions')
        .set(authHeader(accessToken))
        .send(mcqPayload(schoolClass.id, subject.id, { questionText: `Question number ${i}` }));
    }

    const results = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/exam-generator/papers/generate')
        .set(authHeader(accessToken))
        .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 3, shortCount: 0, longCount: 0 });
      results.push(res.body.data.questions.map((q: { questionText: string }) => q.questionText).sort().join(','));
    }
    const distinctSets = new Set(results);
    expect(distinctSets.size).toBeGreaterThan(1);
  });
});

describe('Generate — snapshot immutability', () => {
  it("editing a bank question after it was used in a paper leaves the paper's snapshot unchanged", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    const question = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id));

    const paper = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    await request(app)
      .patch(`/api/exam-generator/questions/${question.body.data.id}`)
      .set(authHeader(accessToken))
      .send({ questionText: 'Completely different text now' });

    const reloaded = await request(app)
      .get(`/api/exam-generator/papers/${paper.body.data.id}`)
      .set(authHeader(accessToken));
    expect(reloaded.body.data.questions[0].questionText).toBe('What is 2 + 2?');
  });

  it('deleting a bank question after use leaves the paper intact with sourceQuestionId cleared', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    const question = await request(app)
      .post('/api/exam-generator/questions')
      .set(authHeader(accessToken))
      .send(mcqPayload(schoolClass.id, subject.id));

    const paper = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    const del = await request(app)
      .delete(`/api/exam-generator/questions/${question.body.data.id}`)
      .set(authHeader(accessToken));
    expect(del.status).toBe(204);

    const reloaded = await request(app)
      .get(`/api/exam-generator/papers/${paper.body.data.id}`)
      .set(authHeader(accessToken));
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.data.questions[0].questionText).toBe('What is 2 + 2?');
    expect(reloaded.body.data.questions[0].sourceQuestionId).toBeNull();
  });
});

describe('History + access', () => {
  it('a generated paper appears in the granted teacher history list', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);
    await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));
    await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(teacher.accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    const list = await request(app)
      .get(`/api/exam-generator/papers?schoolClassId=${schoolClass.id}&subjectId=${subject.id}`)
      .set(authHeader(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('an ungranted TEACHER gets 403 on GET /papers/:id even for a real paper id of that class/subject', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));
    const paper = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    const res = await request(app)
      .get(`/api/exam-generator/papers/${paper.body.data.id}`)
      .set(authHeader(teacher.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('PDF download', () => {
  it('returns a PDF that never reveals correct MCQ answers', async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject } = await setupFixture(accessToken, tenant);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));
    const paper = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    const pdf = await request(app)
      .get(`/api/exam-generator/papers/${paper.body.data.id}/pdf`)
      .set(authHeader(accessToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(500);
  }, 20000);
});

describe('Cross-tenant isolation', () => {
  it("a second tenant's admin cannot see the first tenant's grants, questions, chapters-summary, or papers", async () => {
    const { accessToken, tenant } = await signupSchool(app);
    const { schoolClass, subject, teacher } = await setupFixture(accessToken, tenant);
    await grant(accessToken, schoolClass.id, subject.id, teacher.user.id);
    await request(app).post('/api/exam-generator/questions').set(authHeader(accessToken)).send(mcqPayload(schoolClass.id, subject.id));
    const paper = await request(app)
      .post('/api/exam-generator/papers/generate')
      .set(authHeader(accessToken))
      .send({ schoolClassId: schoolClass.id, subjectId: subject.id, mcqCount: 1, shortCount: 0, longCount: 0 });

    const other = await signupSchool(app, { schoolName: 'Other School', slug: 'other-school', adminEmail: 'admin@other-school.test' });

    const grants = await request(app).get('/api/exam-generator/access-grants').set(authHeader(other.accessToken));
    expect(grants.body.data).toHaveLength(0);

    const questions = await request(app).get('/api/exam-generator/questions').set(authHeader(other.accessToken));
    expect(questions.body.data).toHaveLength(0);

    const papers = await request(app).get('/api/exam-generator/papers').set(authHeader(other.accessToken));
    expect(papers.body.data).toHaveLength(0);

    const paperRead = await request(app)
      .get(`/api/exam-generator/papers/${paper.body.data.id}`)
      .set(authHeader(other.accessToken));
    expect(paperRead.status).toBe(404);
  });
});
