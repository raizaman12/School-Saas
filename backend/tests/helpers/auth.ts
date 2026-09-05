import type { Express } from 'express';
import request from 'supertest';

export async function signupSchool(
  app: Express,
  overrides: Partial<{
    schoolName: string;
    slug: string;
    adminFullName: string;
    adminEmail: string;
    adminPassword: string;
    plan: 'TRIAL' | 'BASIC' | 'STANDARD' | 'PREMIUM';
  }> = {},
) {
  const payload = {
    schoolName: 'Test School',
    slug: 'test-school',
    adminFullName: 'Admin User',
    adminEmail: 'admin@test-school.test',
    adminPassword: 'Passw0rd123',
    ...overrides,
  };

  const res = await request(app).post('/api/auth/signup').send(payload);
  if (res.status !== 201) {
    throw new Error(`signupSchool failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    accessToken: res.body.accessToken as string,
    tenant: res.body.tenant as { id: string; slug: string; name: string; plan: string },
    user: res.body.user as { id: string; email: string; role: string },
  };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
