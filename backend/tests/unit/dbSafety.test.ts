import { PrismaClient } from '@prisma/client';
import { checkRlsIsEnforced } from '../../src/lib/dbSafety';

/**
 * Covers the exact failure mode that motivated this check: the app server
 * accidentally connecting as the migration/owner role (which has
 * BYPASSRLS) instead of the least-privilege app role — see dbSafety.ts's
 * doc comment for the real incident this guards against.
 */
describe('checkRlsIsEnforced', () => {
  it('reports safe for the normal least-privilege app-role connection', async () => {
    const appClient = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const result = await checkRlsIsEnforced(appClient);
      expect(result).toEqual({ safe: true });
    } finally {
      await appClient.$disconnect();
    }
  });

  it('flags the migration/owner role as unsafe — it has BYPASSRLS', async () => {
    const ownerUrl = process.env.DATABASE_MIGRATE_URL;
    if (!ownerUrl) throw new Error('DATABASE_MIGRATE_URL must be set in .env.test for this test');

    const ownerClient = new PrismaClient({ datasourceUrl: ownerUrl });
    try {
      const result = await checkRlsIsEnforced(ownerClient);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('BYPASSRLS');
      expect(result.reason).toContain('school_saas_owner');
    } finally {
      await ownerClient.$disconnect();
    }
  });
});
