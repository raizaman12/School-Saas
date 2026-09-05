import { randomUUID } from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { ownerDb } from './db';
import { hashPassword } from '../../src/lib/password';

/**
 * Creates a platform-level SUPER_ADMIN user directly (tenantId NULL — there's
 * no self-service signup for platform staff) and logs them in through the
 * real /api/auth/platform-login endpoint.
 */
export async function createAndLoginSuperAdmin(app: Express, opts: { email: string; fullName?: string } = { email: 'super@platform.test' }) {
  const password = 'Passw0rd123';
  await ownerDb.user.create({
    data: {
      id: randomUUID(),
      tenantId: null,
      email: opts.email,
      passwordHash: await hashPassword(password),
      fullName: opts.fullName ?? 'Platform Admin',
      role: 'SUPER_ADMIN',
    },
  });

  const res = await request(app).post('/api/auth/platform-login').send({ email: opts.email, password });
  if (res.status !== 200) {
    throw new Error(`createAndLoginSuperAdmin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { accessToken: res.body.accessToken as string, user: res.body.user };
}
