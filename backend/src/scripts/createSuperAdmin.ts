/**
 * One-off bootstrap script: creates the first platform SUPER_ADMIN account.
 *
 * There is no self-service signup for platform admins (by design — see
 * modules/platform) so a fresh production deployment has no way to reach
 * /api/platform/* or the dashboard's Platform section until one exists.
 * Run this once after the initial `prisma migrate deploy`.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='Str0ngPass!' SUPER_ADMIN_NAME="Your Name" \
 *     npx ts-node src/scripts/createSuperAdmin.ts
 *
 * (or, against a build: node dist/scripts/createSuperAdmin.js with the same env vars)
 *
 * Connects through the normal app DB role (school_saas_app, via DATABASE_URL)
 * rather than the migration/owner role — no elevated privileges are needed:
 * the `users` RLS policy already permits inserting a tenantId-NULL row from
 * a connection that never sets app.tenant_id (i.e. "platform context"),
 * which is exactly what this script is.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../lib/password';
import { passwordSchema } from '../modules/auth/auth.validation';
import { logger } from '../lib/logger';

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const fullName = process.env.SUPER_ADMIN_NAME?.trim() || 'Platform Admin';

  if (!email || !password) {
    console.error(
      'Usage: SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... [SUPER_ADMIN_NAME=...] npx ts-node src/scripts/createSuperAdmin.ts',
    );
    process.exitCode = 1;
    return;
  }

  const emailCheck = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailCheck.test(email)) {
    console.error(`"${email}" does not look like a valid email address.`);
    process.exitCode = 1;
    return;
  }

  const passwordResult = passwordSchema.safeParse(password);
  if (!passwordResult.success) {
    console.error('Password does not meet requirements:');
    for (const issue of passwordResult.error.issues) console.error(`  - ${issue.message}`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findFirst({ where: { tenantId: null, email } });
  if (existing) {
    console.error(`A platform admin with email "${email}" already exists (id: ${existing.id}). Nothing to do.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      tenantId: null,
      email,
      passwordHash,
      fullName,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  logger.info('Created SUPER_ADMIN user', { id: user.id, email: user.email });
  console.log(`✅ SUPER_ADMIN created: ${user.email} (id: ${user.id})`);
  console.log('   Log in at POST /api/auth/platform-login with this email and the password you provided.');
}

main()
  .catch((err) => {
    console.error('Failed to create SUPER_ADMIN:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
