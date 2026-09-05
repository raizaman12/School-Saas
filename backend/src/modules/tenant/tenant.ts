import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { THEME_PRESETS } from '../../config/themePresets';
import { updateTenantThemeSchema } from './validation';
import { updateWeeklyOffDaysSchema } from '../attendance/validation';

export const tenantRouter = Router();

/**
 * Public, unauthenticated — the signup wizard's theme-picker step and the
 * pre-login page (which themes itself to the school it resolved from the
 * subdomain) both need this before any session exists. The color values
 * themselves are not sensitive; same trust level as the tenant-by-slug
 * lookup.
 */
tenantRouter.get('/theme-presets', (_req: Request, res: Response) => {
  res.json({ data: THEME_PRESETS });
});

/**
 * Self-service — lets a school's own admin change their dashboard/portal
 * accent color after signup (the theme picked at signup isn't permanent).
 * Scoped to the caller's own tenant via req.auth.tenantId; there's no
 * :id param, so there's no cross-tenant path to guard against.
 */
tenantRouter.patch('/theme', requireAuth, requireRole('SCHOOL_ADMIN'), async (req: Request, res: Response) => {
  const input = updateTenantThemeSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const tenant = await runWithTenant(tenantId, async (tx) => {
    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: { themeId: input.themeId },
    });

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        actorUserId: req.auth!.userId,
        action: 'tenant.theme_change',
        entityType: 'Tenant',
        entityId: tenantId,
        metadata: { themeId: input.themeId },
      },
    });

    return updated;
  });

  res.json({ data: { id: tenant.id, themeId: tenant.themeId } });
});

/**
 * Which weekday(s) have no class school-wide (default: Sunday only) — read
 * by the attendance-marking page and the parent/student portal's "No class
 * today" state (see attendance/holidays.ts's isNonWorkingDay()). Any staff
 * role can read it; only SCHOOL_ADMIN can change it below.
 */
tenantRouter.get('/weekly-off-days', requireAuth, async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const tenant = await runWithTenant(tenantId, (tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: { weeklyOffDays: true } }),
  );
  res.json({ data: { weeklyOffDays: tenant?.weeklyOffDays ?? [] } });
});

tenantRouter.patch(
  '/weekly-off-days',
  requireAuth,
  requireRole('SCHOOL_ADMIN'),
  async (req: Request, res: Response) => {
    const input = updateWeeklyOffDaysSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;

    const tenant = await runWithTenant(tenantId, async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { weeklyOffDays: input.weeklyOffDays },
      });

      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId,
          actorUserId: req.auth!.userId,
          action: 'tenant.weekly_off_days_change',
          entityType: 'Tenant',
          entityId: tenantId,
          metadata: { weeklyOffDays: input.weeklyOffDays },
        },
      });

      return updated;
    });

    res.json({ data: { weeklyOffDays: tenant.weeklyOffDays } });
  },
);
