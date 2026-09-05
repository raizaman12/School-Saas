import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

describe('X-Request-Id correlation', () => {
  it('mints a fresh id when the client sends none', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('echoes back a client-supplied id (upstream proxy correlation)', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'my-custom-trace-id-123');
    expect(res.headers['x-request-id']).toBe('my-custom-trace-id-123');
  });

  it('two separate requests get two different minted ids', async () => {
    const res1 = await request(app).get('/health');
    const res2 = await request(app).get('/health');
    expect(res1.headers['x-request-id']).not.toBe(res2.headers['x-request-id']);
  });
});
