import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { teacherSectionIds } from '../../lib/teacherScope';
import { dispatchNotification } from '../notifications/notificationService';
import {
  upsertHealthProfileSchema,
  createHealthLogEntrySchema,
  updateHealthLogEntrySchema,
  listHealthLogEntriesQuerySchema,
} from './validation';

export const healthRouter = Router();
healthRouter.use(requireAuth);

// Same tiering reasoning as discipline.ts: FRONT_DESK and TEACHER both read
// (a teacher needs to know a student's allergies; the front office is
// usually who a parent calls or who administers first aid). ACCOUNTANT has
// no reason to see this.
const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER'] as const;
// The health *profile* (blood group/allergies/chronic conditions/emergency
// contacts) is the office's official medical-facts record, normally taken
// from a parent-submitted admission form — a TEACHER can read it but
// shouldn't edit it, same as they can't edit a student's CNIC or address.
const PROFILE_WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;
// A first-aid/clinic-visit *log entry* is the opposite: it's written by
// whoever actually attended to the student in the moment, which is very
// often the class teacher — so TEACHER is a write role here, same as
// discipline.ts's incident log.
const LOG_WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER'] as const;
const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

const healthProfileInclude = {
  student: { select: { id: true, fullName: true, studentCode: true, currentSectionId: true } },
  updatedByUser: { select: { id: true, fullName: true } },
} as const;

const healthLogEntryInclude = {
  student: { select: { id: true, fullName: true, studentCode: true, currentSectionId: true } },
  loggedByUser: { select: { id: true, fullName: true } },
} as const;

/** Throws 403 if a TEACHER caller isn't allowed to see/act on this student (not their section). */
async function assertTeacherCanAccessStudent(
  tx: Prisma.TransactionClient,
  teacherId: string,
  studentId: string,
): Promise<void> {
  const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
  if (!student) throw AppError.notFound('Student not found');
  const allowed = await teacherSectionIds(tx, teacherId);
  if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
    throw AppError.forbidden('You do not have access to this student');
  }
}

// ────────────────────────────────────────────────────────────────
// Health profile — one per student, fetched/updated by studentId directly
// rather than by its own id, since callers always think in terms of "this
// student's medical card", not a profile-record id they'd have to look up
// first.
// ────────────────────────────────────────────────────────────────

healthRouter.get('/profiles/:studentId', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const profile = await runWithTenant(auth.tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
    if (!student) throw AppError.notFound('Student not found');
    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }
    return tx.studentHealthProfile.findUnique({ where: { studentId }, include: healthProfileInclude });
  });

  // No profile yet is a normal state (most students won't have one filled
  // in until the office does it) — respond 200 with null data rather than
  // 404, so the frontend can show an empty "add health info" form instead
  // of treating this as an error.
  res.json({ data: profile });
});

healthRouter.put('/profiles/:studentId', requireRole(...PROFILE_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = upsertHealthProfileSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;
  const studentId = uuidParam(req, 'studentId');

  const profile = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: studentId } });
    if (!student) throw AppError.badRequest('Unknown studentId');

    return tx.studentHealthProfile.upsert({
      where: { studentId },
      create: {
        id: randomUUID(),
        tenantId,
        studentId,
        ...input,
        updatedByUserId: auth.userId,
      },
      update: {
        ...input,
        updatedByUserId: auth.userId,
      },
      include: healthProfileInclude,
    });
  });

  res.json({ data: profile });
});

// ────────────────────────────────────────────────────────────────
// Health log entries — first-aid/clinic-visit history, a flat resource
// list filterable by studentId, same shape as discipline-records.
// ────────────────────────────────────────────────────────────────

healthRouter.get('/log-entries', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listHealthLogEntriesQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    let allowedSectionIds: string[] | null = null;
    if (auth.role === 'TEACHER') {
      allowedSectionIds = await teacherSectionIds(tx, auth.userId);
    }

    const where: Prisma.HealthLogEntryWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.from || query.to
        ? { visitDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(allowedSectionIds ? { student: { currentSectionId: { in: allowedSectionIds } } } : {}),
    };

    const [data, total] = await Promise.all([
      tx.healthLogEntry.findMany({
        where,
        include: healthLogEntryInclude,
        orderBy: { visitDate: 'desc' },
        skip,
        take,
      }),
      tx.healthLogEntry.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

healthRouter.get('/log-entries/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;

  const entry = await runWithTenant(auth.tenantId, async (tx) => {
    const found = await tx.healthLogEntry.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: healthLogEntryInclude,
    });
    if (!found) return null;
    if (auth.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, auth.userId);
      if (!found.student.currentSectionId || !allowed.includes(found.student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }
    return found;
  });

  if (!entry) throw AppError.notFound('Health log entry not found');
  res.json({ data: entry });
});

healthRouter.post('/log-entries', requireRole(...LOG_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createHealthLogEntrySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const entry = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw AppError.badRequest('Unknown studentId');

    if (auth.role === 'TEACHER') {
      await assertTeacherCanAccessStudent(tx, auth.userId, input.studentId);
    }

    const created = await tx.healthLogEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        studentId: input.studentId,
        visitDate: input.visitDate,
        complaint: input.complaint,
        actionTaken: input.actionTaken,
        outcome: input.outcome ?? 'RETURNED_TO_CLASS',
        guardianNotified: input.guardianNotified ?? false,
        loggedByUserId: auth.userId,
      },
      include: healthLogEntryInclude,
    });

    // Same convenience path as discipline.ts's notifyGuardianNow — message
    // every linked guardian (not just the primary), and only flip
    // guardianNotified/guardianNotifiedAt if at least one send actually
    // succeeded, so a school without SMS credit still gets the visit
    // recorded rather than the whole request failing.
    if (input.notifyGuardianNow) {
      const guardianLinks = await tx.studentGuardian.findMany({
        where: { studentId: input.studentId },
        include: { guardian: true },
      });

      let anySent = false;
      for (const link of guardianLinks) {
        const result = await dispatchNotification(tx, tenantId, {
          channel: 'SMS',
          recipientPhone: link.guardian.phone,
          recipientUserId: link.guardian.userId ?? undefined,
          trustedRecipient: true,
          subject: `Health notice — ${student.fullName}`,
          body: `${student.fullName}: seen at the school office on ${input.visitDate.toISOString().slice(0, 10)} — ${input.complaint}. ${input.actionTaken}`,
          relatedEntityType: 'HealthLogEntry',
          relatedEntityId: created.id,
          createdByUserId: auth.userId,
        });
        if (result.status === 'SENT') anySent = true;
      }

      if (anySent) {
        return tx.healthLogEntry.update({
          where: { id: created.id },
          data: { guardianNotified: true, guardianNotifiedAt: new Date() },
          include: healthLogEntryInclude,
        });
      }
    }

    return created;
  });

  res.status(201).json({ data: entry });
});

healthRouter.patch('/log-entries/:id', requireRole(...LOG_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateHealthLogEntrySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.healthLogEntry.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Health log entry not found');

    // A TEACHER may only edit entries they themselves logged — same
    // restriction discipline.ts applies to editing an incident.
    if (auth.role === 'TEACHER' && existing.loggedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only edit health log entries you logged');
    }

    return tx.healthLogEntry.update({
      where: { id: uuidParam(req, 'id') },
      data: {
        ...input,
        ...(input.guardianNotified && !existing.guardianNotified ? { guardianNotifiedAt: new Date() } : {}),
      },
      include: healthLogEntryInclude,
    });
  });

  res.json({ data: updated });
});

healthRouter.delete('/log-entries/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.healthLogEntry.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Health log entry not found');
    await tx.healthLogEntry.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});
