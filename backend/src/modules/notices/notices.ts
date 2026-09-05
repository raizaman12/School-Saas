import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { teacherSectionIds } from '../../lib/teacherScope';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { createNoticeSchema, updateNoticeSchema, listNoticesQuerySchema } from './validation';

export const noticesRouter = Router();
noticesRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
// A TEACHER may only publish a SECTION-audience notice for a section
// they're associated with — either as class teacher OR as the subject
// teacher of at least one subject taught there (see teacherSectionIds();
// checked in the handler below). This is deliberately broader than "class
// teacher only": a school has one homeroom/class teacher per section but
// several subject teachers, and each of THEM needs to be able to post a
// section notice too — e.g. a Math teacher announcing a quiz to their own
// section-subject's course-card Announcement tab (see portal.ts's
// GET .../courses/:sectionSubjectId/announcements, which reads exactly
// this kind of notice). ALL_STAFF and ALL_GUARDIANS notices are
// school-wide and stay SCHOOL_ADMIN-only.
const WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

const noticeInclude = {
  section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
  publishedByUser: { select: { id: true, fullName: true } },
  recipients: {
    include: {
      user: { select: { id: true, fullName: true, role: true } },
    },
  },
} as const;

/**
 * Resolves the entity-oriented recipient lists on an INDIVIDUAL-audience
 * notice into concrete `userId`s, enforcing who may be targeted:
 *  - SCHOOL_ADMIN may target any student/guardian/staff in the tenant.
 *  - TEACHER may only target students/guardians belonging to a section they
 *    are the class teacher of, and may never target staff — matching the
 *    existing rule that a TEACHER's write access never reaches school-wide
 *    or cross-staff scope.
 * Throws a clean, specific AppError (rather than a raw FK violation) when a
 * chosen student/guardian has no provisioned portal login yet.
 */
async function resolveIndividualRecipients(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  input: { recipientStudentIds?: string[]; recipientGuardianIds?: string[]; recipientStaffUserIds?: string[] },
): Promise<string[]> {
  const userIds = new Set<string>();
  // Computed once (not per-recipient) — every section this TEACHER is
  // either the class teacher OR a subject teacher of. Unused, and never
  // queried, for a non-TEACHER caller.
  const allowedSectionIds = auth.role === 'TEACHER' ? new Set(await teacherSectionIds(tx, auth.userId)) : null;

  if (input.recipientStaffUserIds?.length) {
    if (auth.role === 'TEACHER') {
      throw AppError.forbidden('Teachers cannot send individual notices to staff members');
    }
    const staffUsers = await tx.user.findMany({
      where: { id: { in: input.recipientStaffUserIds } },
      select: { id: true, role: true },
    });
    const found = new Map(staffUsers.map((u) => [u.id, u]));
    for (const id of input.recipientStaffUserIds) {
      const user = found.get(id);
      if (!user) throw AppError.badRequest(`Unknown staff user: ${id}`);
      if (user.role === 'PARENT' || user.role === 'STUDENT') {
        throw AppError.badRequest(`User ${id} is not a staff member`);
      }
      userIds.add(id);
    }
  }

  if (input.recipientStudentIds?.length) {
    const students = await tx.student.findMany({
      where: { id: { in: input.recipientStudentIds } },
      select: { id: true, fullName: true, userId: true, currentSectionId: true },
    });
    const found = new Map(students.map((s) => [s.id, s]));
    for (const id of input.recipientStudentIds) {
      const student = found.get(id);
      if (!student) throw AppError.badRequest(`Unknown student: ${id}`);
      if (allowedSectionIds) {
        if (!student.currentSectionId || !allowedSectionIds.has(student.currentSectionId)) {
          throw AppError.forbidden(`You do not have access to student ${student.fullName}`);
        }
      }
      if (!student.userId) {
        throw AppError.badRequest(`${student.fullName} does not have a portal login yet`);
      }
      userIds.add(student.userId);
    }
  }

  if (input.recipientGuardianIds?.length) {
    const guardians = await tx.guardian.findMany({
      where: { id: { in: input.recipientGuardianIds } },
      select: {
        id: true,
        fullName: true,
        userId: true,
        students: { select: { student: { select: { currentSectionId: true } } } },
      },
    });
    const found = new Map(guardians.map((g) => [g.id, g]));
    for (const id of input.recipientGuardianIds) {
      const guardian = found.get(id);
      if (!guardian) throw AppError.badRequest(`Unknown guardian: ${id}`);
      if (allowedSectionIds) {
        const childSectionIds = guardian.students.map((s) => s.student.currentSectionId).filter(Boolean);
        const allowed = childSectionIds.some((sectionId) => allowedSectionIds.has(sectionId!));
        if (!allowed) throw AppError.forbidden(`You do not have access to guardian ${guardian.fullName}`);
      }
      if (!guardian.userId) {
        throw AppError.badRequest(`${guardian.fullName} does not have a portal login yet`);
      }
      userIds.add(guardian.userId);
    }
  }

  return Array.from(userIds);
}

noticesRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listNoticesQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const auth = req.auth!;

  const result = await runWithTenant(auth.tenantId, async (tx) => {
    const where: Prisma.NoticeWhereInput = {
      ...(query.audience ? { audiences: { has: query.audience } } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      // A notice whose ONLY audience is INDIVIDUAL (e.g. a one-to-one note
      // to a specific teacher) is private by nature and must not leak to
      // every other staff member just because they hold a READ_ROLES role.
      // A notice that combines INDIVIDUAL with a broad audience (e.g.
      // SECTION + a couple of named add-ons) is already visible to that
      // broad audience, so the carve-out doesn't apply — see
      // `individualOnly` on the Notice model. SCHOOL_ADMIN always sees
      // everything (oversight); anyone else only sees individual-only
      // notices they published themselves or were explicitly named on.
      ...(auth.role !== 'SCHOOL_ADMIN'
        ? {
            OR: [
              { individualOnly: false },
              { publishedByUserId: auth.userId },
              { recipients: { some: { userId: auth.userId } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      tx.notice.findMany({
        where,
        include: noticeInclude,
        orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
        skip,
        take,
      }),
      tx.notice.count({ where }),
    ]);
    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

const BROAD_AUDIENCES = ['ALL_STAFF', 'ALL_GUARDIANS', 'ALL_STUDENTS'] as const;

/**
 * Publishes a notice — `audiences` may combine any mix of ALL_STAFF /
 * ALL_GUARDIANS / ALL_STUDENTS / SECTION / INDIVIDUAL in one call (e.g.
 * ["ALL_STUDENTS", "ALL_GUARDIANS"] to reach every student AND every
 * guardian with one announcement). ALL_STAFF / ALL_GUARDIANS / ALL_STUDENTS
 * are school-wide and restricted to SCHOOL_ADMIN. SECTION may also be
 * published by any TEACHER associated with that section — its class
 * teacher or any of its subject teachers (see teacherSectionIds()).
 * INDIVIDUAL may be published by either role, subject to the
 * recipient-scoping rules in `resolveIndividualRecipients`.
 */
noticesRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createNoticeSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const notice = await runWithTenant(tenantId, async (tx) => {
    let recipientUserIds: string[] = [];

    if (auth.role !== 'SCHOOL_ADMIN' && input.audiences.some((a) => BROAD_AUDIENCES.includes(a as (typeof BROAD_AUDIENCES)[number]))) {
      throw AppError.forbidden('Only a school admin can publish a school-wide notice');
    }

    if (input.audiences.includes('SECTION')) {
      const section = await tx.section.findUnique({ where: { id: input.sectionId } });
      if (!section) throw AppError.badRequest('Section not found');
      if (auth.role === 'TEACHER') {
        const allowedSectionIds = await teacherSectionIds(tx, auth.userId);
        if (!allowedSectionIds.includes(section.id)) {
          throw AppError.forbidden('You do not teach this section');
        }
      }
    }

    if (input.audiences.includes('INDIVIDUAL')) {
      recipientUserIds = await resolveIndividualRecipients(tx, auth, input);
    }

    const individualOnly = input.audiences.length === 1 && input.audiences[0] === 'INDIVIDUAL';

    return tx.notice.create({
      data: {
        id: randomUUID(),
        tenantId,
        title: input.title,
        body: input.body,
        audiences: input.audiences,
        individualOnly,
        tone: input.tone,
        sectionId: input.sectionId,
        isPinned: input.isPinned,
        publishedByUserId: auth.userId,
        ...(recipientUserIds.length > 0
          ? {
              recipients: {
                create: recipientUserIds.map((userId) => ({ id: randomUUID(), tenantId, userId })),
              },
            }
          : {}),
      },
      include: noticeInclude,
    });
  });

  res.status(201).json({ data: notice });
});

noticesRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = updateNoticeSchema.parse(req.body);
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.notice.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Notice not found');
    if (auth.role === 'TEACHER' && existing.publishedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only edit notices you published');
    }

    return tx.notice.update({ where: { id: existing.id }, data: input, include: noticeInclude });
  });

  res.json({ data: updated });
});

noticesRouter.delete('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const auth = req.auth!;

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.notice.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Notice not found');
    if (auth.role === 'TEACHER' && existing.publishedByUserId !== auth.userId) {
      throw AppError.forbidden('You can only delete notices you published');
    }
    await tx.notice.delete({ where: { id: existing.id } });
  });

  res.status(204).send();
});
