import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { signupSchool, authHeader } from '../helpers/auth';
import { prisma } from '../../src/lib/prisma';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

// A malformed route-param id used to reach Prisma raw and crash into a 500
// ("invalid input syntax for type uuid") instead of a clean validation
// error — see src/utils/params.ts's uuidParam(). One representative route
// per module family is enough to prove the shared helper is actually wired
// in everywhere, not just in the module it was first noticed in.
describe('Malformed route-param IDs return 400, not 500', () => {
  it('GET /api/students/:id', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/students/not-a-uuid').set(authHeader(accessToken));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/invoices/:id', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app).get('/api/invoices/not-a-uuid').set(authHeader(accessToken));
    expect(res.status).toBe(400);
  });

  it('GET /api/exams/:examId/report-card/:studentId', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .get('/api/exams/not-a-uuid/report-card/also-not-a-uuid')
      .set(authHeader(accessToken));
    expect(res.status).toBe(400);
  });

  it('a well-formed but non-existent UUID still cleanly 404s (not a validation error)', async () => {
    const { accessToken } = await signupSchool(app);
    const res = await request(app)
      .get('/api/students/00000000-0000-0000-0000-000000000000')
      .set(authHeader(accessToken));
    expect(res.status).toBe(404);
  });
});
