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
  createDisciplineRecordSchema,
  updateDisciplineRecordSchema,
  listDisciplineRecordsQuerySchema,
} from './validation';

export const disciplineRouter = Router();
disciplineRouter.use(requireAuth);

// FRONT_DESK reads (a parent asking about their child's file at the office)
// but doesn't log incidents themselves — that's a class-teacher/admin
// judgment call, not a front-desk task. ACCOUNTANT has no reason to see
// this at all (unlike attendance/fees, conduct isn't billing-relevant).
const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;
// Deleting an official conduct record is tightly held — same reasoning as
// DELETE_ROLES on students.ts.
const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

const disciplineRecordInclude = {
  student: { select: { id: true, fullName: true, studentCode: true, currentSectionId: true } },
  reportedByUser: { select: { id: true, fullName: true } },
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

disciplineRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listDisciplineRecordsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    let allowedSectionIds: string[] | null = null;
    if (auth.role === 'TEACHER') {
      allowedSectionIds = await teacherSectionIds(tx, auth.userId);
    }

    const where: Prisma.DisciplineRecordWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.resolved !== undefined ? { resolved: query.resolved } : {}),
      ...(query.from || query.to
        ? { incidentDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(allowedSectionIds ? { student: { currentSectionId: { in: allowedSectionIds } } } : {}),
    };

    const [data, total] = await Promise.all([
      tx.disciplineRecord.findMany({
        where,
        include: disciplineRecordInclude,
        orderBy: { incidentDate: 'desc' },
        skip,
        take,
      }),
      tx.disciplineRecord.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

disciplineRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const auth = req.auth!;

  const record = await runWithTenant(auth.tenantId, async (tx) => {
    const found = await tx.disciplineRecord.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: disciplineRecordInclude,
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

  if (!record) throw AppError.notFound('Discipline record not found');
  res.json({ data: record });
});

disciplineRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createDisciplineRecordSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const record = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: input.studentId } });
    if (!student) throw AppError.badRequest('Unknown studentId');

    if (auth.role === 'TEACHER') {
      await assertTeacherCanAccessStudent(tx, auth.userId, input.studentId);
    }

    const created = await tx.disciplineRecord.create({
      data: {
        id: randomUUID(),
        tenantId,
        studentId: input.studentId,
        incidentDate: input.incidentDate,
        category: input.category,
        severity: input.severity,
        description: input.description,
        actionTaken: input.actionTaken ?? 'NONE',
        actionNotes: input.actionNotes,
        reportedByUserId: auth.userId,
        guardianNotified: input.guardianNotified ?? false,
      },
      include: disciplineRecordInclude,
    });

    // Convenience path: also actually message the guardian(s) on file
    // (real SMS/WhatsApp if configured — see notifications/providers —
    // otherwise simulated same as everywhere else) rather than the admin
    // having to separately go compose a message in the Notifications tab.
    // Every linked guardian is notified, not just the primary one — for a
    // discipline incident, most Pakistani parents expect both a mother and
    // father on file to be informed, not just whoever is marked primary.
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
          subject: `Discipline notice — ${student.fullName}`,
          body: `${student.fullName}: a conduct incident (${input.category.replaceAll('_', ' ').toLowerCase()}) was logged on ${input.incidentDate.toISOString().slice(0, 10)}. ${input.description}`,
          relatedEntityType: 'DisciplineRecord',
          relatedEntityId: created.id,
          createdByUserId: auth.userId,
        });
        if (result.status === 'SENT') anySent = true;
      }

      if (anySent) {
        return tx.disciplineRecord.update({
          where: { id: created.id },
          data: { guardianNotified: true, guardianNotifiedAt: new Date() },
          include: disciplineRecordInclude,
        });
      }
    }

    return created;
  });

  res.status(201).json({ data: record });
});

disciplineRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateDisciplineRecordSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.disciplineRecord.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Discipline record not found');

    // A TEACHER may only edit records they themselves reported — same
    // restriction homework.ts applies to editing a homework item.
    if (auth.role === 'TEACHER' && existing.reportedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only edit discipline records you reported');
    }

    return tx.disciplineRecord.update({
      where: { id: uuidParam(req, 'id') },
      data: {
        ...input,
        ...(input.resolved && !existing.resolved ? { resolvedAt: new Date() } : {}),
        ...(input.resolved === false ? { resolvedAt: null } : {}),
        ...(input.guardianNotified && !existing.guardianNotified ? { guardianNotifiedAt: new Date() } : {}),
      },
      include: disciplineRecordInclude,
    });
  });

  res.json({ data: updated });
});

disciplineRouter.delete('/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.disciplineRecord.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Discipline record not found');
    await tx.disciplineRecord.delete({ where: { id: uuidParam(req, 'id') } });
  });

  res.status(204).send();
});
