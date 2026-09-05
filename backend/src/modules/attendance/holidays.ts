import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { createHolidaySchema, listHolidaysQuerySchema } from './validation';

export const holidaysRouter = Router();
holidaysRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;

/**
 * Whether `date` has no class for the whole school — either a declared
 * `Holiday` row covering it, or a weekly off day per `Tenant.weeklyOffDays`
 * (default: Sunday only). Shared by attendance.ts (block marking, flag the
 * roster) and portal.ts (the parent/student "No class today" state) so the
 * two surfaces can never disagree about what counts as a non-working day.
 *
 * `date` must be a UTC-midnight Date (the same shape `dateOnlySchema`
 * produces) — comparisons below rely on that.
 */
export async function isNonWorkingDay(
  tx: Prisma.TransactionClient,
  tenantId: string,
  date: Date,
): Promise<{ isNonWorkingDay: boolean; reason: 'HOLIDAY' | 'WEEKLY_OFF' | null; label: string | null }> {
  const holiday = await tx.holiday.findFirst({
    where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: 'asc' },
  });
  if (holiday) {
    return { isNonWorkingDay: true, reason: 'HOLIDAY', label: holiday.name };
  }

  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { weeklyOffDays: true } });
  const dayOfWeek = date.getUTCDay();
  if (tenant?.weeklyOffDays.includes(dayOfWeek)) {
    const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return { isNonWorkingDay: true, reason: 'WEEKLY_OFF', label: WEEKDAY_NAMES[dayOfWeek] };
  }

  return { isNonWorkingDay: false, reason: null, label: null };
}

/** List declared holidays, optionally within a date range — used by the calendar-management UI. */
holidaysRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listHolidaysQuerySchema.parse(req.query);
  const tenantId = req.auth!.tenantId!;

  const holidays = await runWithTenant(tenantId, (tx) =>
    tx.holiday.findMany({
      where: {
        ...(query.from ? { endDate: { gte: query.from } } : {}),
        ...(query.to ? { startDate: { lte: query.to } } : {}),
      },
      orderBy: { startDate: 'asc' },
    }),
  );

  res.json({ data: holidays });
});

holidaysRouter.post('/', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const input = createHolidaySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const holiday = await runWithTenant(tenantId, (tx) =>
    tx.holiday.create({
      data: {
        id: randomUUID(),
        tenantId,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    }),
  );

  res.status(201).json({ data: holiday });
});

holidaysRouter.delete('/:id', requireRole(...ADMIN_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const id = uuidParam(req, 'id');

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.holiday.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Holiday not found');
    await tx.holiday.delete({ where: { id } });
  });

  res.status(204).send();
});
