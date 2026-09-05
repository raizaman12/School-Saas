// Isolated from the rest of the integration suite deliberately: this file
// sets COOKIE_DOMAIN before importing the app, in a jest test file's own
// private module registry, so it doesn't affect auth.test.ts's
// supertest-agent-based refresh/logout rotation tests (which break if the
// cookie carries a Domain that doesn't match the literal host supertest's
// cookie jar associates it with — see the comment in .env.test).
//
// process.env itself is a single global object shared by every test file
// in this process (Jest's --runInBand runs them sequentially in one
// process; per-file module-registry isolation does NOT extend to
// process.env), so the override is deleted again immediately after
// createApp() has read it — env.ts's parsed `env` object is a plain const
// captured at that read, so later process.env changes can't un-bake it,
// but leaving COOKIE_DOMAIN set would leak into whichever test file runs
// next and re-parses env.ts fresh.
process.env.COOKIE_DOMAIN = 'localhost';

import request from 'supertest';
import { createApp } from '../../src/app';
import { resetDb, disconnectDb } from '../helpers/db';
import { prisma } from '../../src/lib/prisma';

const app = createApp();
delete process.env.COOKIE_DOMAIN;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await disconnectDb();
  await prisma.$disconnect();
});

describe('COOKIE_DOMAIN — refresh-token cookie shared across hosts', () => {
  it('sets a Domain attribute on the refresh cookie when COOKIE_DOMAIN is configured', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      schoolName: 'Domain Test School',
      slug: 'domain-test-school',
      adminFullName: 'Domain Admin',
      adminEmail: 'admin@domaintest.test',
      adminPassword: 'Passw0rd123',
    });

    expect(res.status).toBe(201);
    // This is exactly what makes the cookie visible to a different host
    // under the same parent domain (e.g. a <slug>.localhost frontend vs.
    // the API's own host) — the entire point of COOKIE_DOMAIN.
    expect(res.headers['set-cookie']?.[0]).toMatch(/Domain=localhost/i);
  });

  // Regression coverage for the cross-tenant session leak COOKIE_DOMAIN's
  // sharing makes possible: because the refresh cookie is visible on EVERY
  // school's subdomain (not just the one that set it), a browser holding
  // School A's still-valid cookie while visiting School B's page must not
  // be silently authenticated as School A. See refreshSchema's doc comment
  // in auth.validation.ts.
  //
  // Deliberately NOT using a supertest `agent` (automatic cookie jar) here,
  // for the same reason auth.test.ts's agent-based rotation tests are kept
  // out of this file (see the file-level comment above): a Domain=localhost
  // cookie is invalid for the host supertest's in-process requests actually
  // use, so the jar silently drops it and every "later" call in the chain
  // would see no cookie at all — a false pass/fail unrelated to the logic
  // under test. Instead, the raw Set-Cookie header from signup is forwarded
  // by hand via `.set('Cookie', ...)`, exactly like the "reuse of a rotated
  // token" tests in auth.test.ts do.
  describe('expectedSlug — refusing a refresh cookie that belongs to a different school', () => {
    it('rejects a refresh when expectedSlug names a DIFFERENT school than the cookie belongs to', async () => {
      const alphaSignup = await request(app).post('/api/auth/signup').send({
        schoolName: 'School Alpha',
        slug: 'school-alpha-leak-test',
        adminFullName: 'Alpha Admin',
        adminEmail: 'admin@alphaleaktest.test',
        adminPassword: 'Passw0rd123',
      });
      const alphaCookie = alphaSignup.headers['set-cookie'];
      await request(app).post('/api/auth/signup').send({
        schoolName: 'School Beta',
        slug: 'school-beta-leak-test',
        adminFullName: 'Beta Admin',
        adminEmail: 'admin@betaleaktest.test',
        adminPassword: 'Passw0rd123',
      });

      // The browser is still holding School Alpha's refresh cookie (as if
      // from an earlier visit) and now lands on School Beta's page, which
      // correctly reports its own slug as expectedSlug.
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', alphaCookie)
        .send({ expectedSlug: 'school-beta-leak-test' });

      expect(res.status).toBe(401);
    });

    it('accepts a refresh when expectedSlug matches the cookie\'s own school', async () => {
      const signupRes = await request(app).post('/api/auth/signup').send({
        schoolName: 'School Gamma',
        slug: 'school-gamma-leak-test',
        adminFullName: 'Gamma Admin',
        adminEmail: 'admin@gammaleaktest.test',
        adminPassword: 'Passw0rd123',
      });
      const cookie = signupRes.headers['set-cookie'];

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .send({ expectedSlug: 'school-gamma-leak-test' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('still refreshes normally when no expectedSlug is sent (non-subdomain deployment)', async () => {
      const signupRes = await request(app).post('/api/auth/signup').send({
        schoolName: 'School Delta',
        slug: 'school-delta-leak-test',
        adminFullName: 'Delta Admin',
        adminEmail: 'admin@deltaleaktest.test',
        adminPassword: 'Passw0rd123',
      });
      const cookie = signupRes.headers['set-cookie'];

      const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);

      expect(res.status).toBe(200);
    });
  });
});
