import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

// CORS_ORIGIN=http://localhost:3000 and CORS_WILDCARD_DOMAIN=localhost:3000
// in .env.test (see tests/setupEnv.ts) — these tests exercise the actual
// resolved env config, not a mock, so they'd catch a regression in either
// value as much as in app.ts's origin function itself.
describe('CORS — subdomain-per-school support', () => {
  it('allows the exact-match CORS_ORIGIN origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('allows a school subdomain of CORS_WILDCARD_DOMAIN', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://alpha-school.localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://alpha-school.localhost:3000');
  });

  it('rejects an unrelated origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://evil.com');

    // cors() surfaces a rejected origin by omitting the ACAO header rather
    // than failing the request outright (the browser is what actually
    // enforces the block) — so assert the header is absent, not a 4xx/5xx.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests with no Origin header (e.g. server-to-server, curl)', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });
});
