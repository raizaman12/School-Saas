import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';

export const platformStatsRouter = Router();
platformStatsRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

/**
 * A lightweight platform-wide summary for the Super Admin dashboard.
 * Self-signup creates a live, active tenant immediately — there's no
 * "pending approval" concept in this product — so "new signups" is
 * surfaced here as a straightforward count of tenants created in the
 * last 7/30 days, which is what a Super Admin actually wants to see to
 * notice signup volume without paging through the full tenant list.
 */
platformStatsRouter.get('/', async (_req: Request, res: Response) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalTenants, byStatus, byPlan, newLast7Days, newLast30Days, recentSignups] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.tenant.groupBy({ by: ['plan'], _count: { _all: true } }),
    prisma.tenant.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, plan: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  res.json({
    data: {
      totalTenants,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      byPlan: Object.fromEntries(byPlan.map((row) => [row.plan, row._count._all])),
      newSignups: { last7Days: newLast7Days, last30Days: newLast30Days },
      recentSignups,
    },
  });
});
