import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { DayOfWeek, Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import {
  createTimetableSlotSchema,
  updateTimetableSlotSchema,
  listTimetableQuerySchema,
} from './validation';

export const timetableRouter = Router();
timetableRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN'] as const;

const SLOT_INCLUDE = {
  sectionSubject: {
    include: {
      subject: true,
      teacher: { select: { id: true, fullName: true } },
      section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
    },
  },
} satisfies Prisma.TimetableSlotInclude;

timetableRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listTimetableQuerySchema.parse(req.query);

  const slots = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.timetableSlot.findMany({
      where: query.sectionId ? { sectionSubject: { sectionId: query.sectionId } } : {},
      include: SLOT_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
  );
  res.json({ data: slots });
});

/** A teacher's own weekly timetable across all sections they teach. */
timetableRouter.get('/me', requireRole('TEACHER'), async (req: Request, res: Response) => {
  const slots = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.timetableSlot.findMany({
      where: { sectionSubject: { teacherId: req.auth!.userId } },
      include: SLOT_INCLUDE,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    }),
  );
  res.json({ data: slots });
});

/**
 * Shared by POST (new slot) and PATCH (edited slot) — `excludeSlotId` lets
 * an edit's own row be ignored when checking for a conflict against itself.
 */
async function assertNoSlotConflict(
  tx: Prisma.TransactionClient,
  params: {
    excludeSlotId?: string;
    sectionId: string;
    teacherId: string | null;
    dayOfWeek: DayOfWeek;
    startTime: Date;
    endTime: Date;
  },
) {
  // Rule 1: the section itself can't have two overlapping periods on the same day.
  const sectionSlots = await tx.timetableSlot.findMany({
    where: {
      dayOfWeek: params.dayOfWeek,
      sectionSubject: { sectionId: params.sectionId },
      ...(params.excludeSlotId ? { id: { not: params.excludeSlotId } } : {}),
    },
  });
  const sectionConflict = sectionSlots.some(
    (s) => params.startTime < s.endTime && params.endTime > s.startTime,
  );
  if (sectionConflict) {
    throw AppError.conflict('This section already has a class scheduled during that time');
  }

  // Rule 2: the teacher can't be double-booked across different sections at the same time.
  if (params.teacherId) {
    const teacherSlots = await tx.timetableSlot.findMany({
      where: {
        dayOfWeek: params.dayOfWeek,
        sectionSubject: { teacherId: params.teacherId },
        ...(params.excludeSlotId ? { id: { not: params.excludeSlotId } } : {}),
      },
    });
    const teacherConflict = teacherSlots.some(
      (s) => params.startTime < s.endTime && params.endTime > s.startTime,
    );
    if (teacherConflict) {
      throw AppError.conflict('This teacher is already scheduled for another class at that time');
    }
  }
}

timetableRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createTimetableSlotSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const created = await runWithTenant(tenantId, async (tx) => {
    const sectionSubject = await tx.sectionSubject.findUnique({
      where: { id: input.sectionSubjectId },
    });
    if (!sectionSubject) throw AppError.badRequest('Unknown sectionSubjectId');

    await assertNoSlotConflict(tx, {
      sectionId: sectionSubject.sectionId,
      teacherId: sectionSubject.teacherId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    return tx.timetableSlot.create({
      data: {
        id: randomUUID(),
        tenantId,
        sectionSubjectId: input.sectionSubjectId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        roomNumber: input.roomNumber,
      },
      include: SLOT_INCLUDE,
    });
  });

  res.status(201).json({ data: created });
});

/**
 * Edit an existing slot's day/time/room, or reassign it to a different
 * section-subject entirely — re-runs both conflict checks (section-level
 * and, if applicable, teacher-level) against the merged (existing + input)
 * values, excluding the slot's own row.
 */
timetableRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateTimetableSlotSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const slotId = uuidParam(req, 'id');

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.timetableSlot.findUnique({
      where: { id: slotId },
      include: { sectionSubject: true },
    });
    if (!existing) throw AppError.notFound('Timetable slot not found');

    let sectionSubject = existing.sectionSubject;
    if (input.sectionSubjectId && input.sectionSubjectId !== existing.sectionSubjectId) {
      const nextSectionSubject = await tx.sectionSubject.findUnique({
        where: { id: input.sectionSubjectId },
      });
      if (!nextSectionSubject) throw AppError.badRequest('Unknown sectionSubjectId');
      sectionSubject = nextSectionSubject;
    }

    const dayOfWeek = input.dayOfWeek ?? existing.dayOfWeek;
    const startTime = input.startTime ?? existing.startTime;
    const endTime = input.endTime ?? existing.endTime;
    if (!(endTime > startTime)) {
      throw AppError.badRequest('endTime must be after startTime');
    }

    await assertNoSlotConflict(tx, {
      excludeSlotId: slotId,
      sectionId: sectionSubject.sectionId,
      teacherId: sectionSubject.teacherId,
      dayOfWeek,
      startTime,
      endTime,
    });

    return tx.timetableSlot.update({
      where: { id: slotId },
      data: {
        sectionSubjectId: sectionSubject.id,
        dayOfWeek,
        startTime,
        endTime,
        ...(input.roomNumber !== undefined ? { roomNumber: input.roomNumber } : {}),
      },
      include: SLOT_INCLUDE,
    });
  });

  res.json({ data: updated });
});

timetableRouter.delete('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.timetableSlot.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Timetable slot not found');
    await tx.timetableSlot.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});
