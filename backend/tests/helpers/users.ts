import { randomUUID } from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import type { UserRole } from '@prisma/client';
import { ownerDb } from './db';
import { hashPassword } from '../../src/lib/password';

/**
 * Creates a user directly via the privileged test DB connection (there's no
 * staff-management API yet — that's Day 7) and logs them in through the
 * real /api/auth/login endpoint so tests exercise the actual auth path.
 */
export async function createAndLoginUser(
  app: Express,
  opts: { tenantId: string; slug: string; email: string; role: UserRole; fullName?: string },
) {
  const password = 'Passw0rd123';
  await ownerDb.user.create({
    data: {
      id: randomUUID(),
      tenantId: opts.tenantId,
      email: opts.email,
      passwordHash: await hashPassword(password),
      fullName: opts.fullName ?? opts.email,
      role: opts.role,
    },
  });

  const res = await request(app)
    .post('/api/auth/login')
    .send({ slug: opts.slug, email: opts.email, password });

  if (res.status !== 200) {
    throw new Error(`createAndLoginUser login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { accessToken: res.body.accessToken as string, user: res.body.user };
}
