import type { Prisma } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import type { AuthContext } from '../../middleware/auth';

/** The studentId linked to a STUDENT-role portal user, or null if unlinked. */
export async function resolveOwnStudentId(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
): Promise<string | null> {
  const student = await tx.student.findUnique({ where: { userId: auth.userId }, select: { id: true } });
  return student?.id ?? null;
}

/** All studentIds linked (as guardian) to a PARENT-role portal user. */
export async function resolveGuardianChildIds(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
): Promise<string[]> {
  const guardian = await tx.guardian.findUnique({ where: { userId: auth.userId }, select: { id: true } });
  if (!guardian) return [];
  const links = await tx.studentGuardian.findMany({
    where: { guardianId: guardian.id },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/** Throws 403 unless `studentId` is one this PARENT/STUDENT portal user may view. */
export async function assertStudentAccess(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  studentId: string,
): Promise<void> {
  if (auth.role === 'STUDENT') {
    const ownId = await resolveOwnStudentId(tx, auth);
    if (ownId !== studentId) throw AppError.forbidden('You do not have access to this student');
    return;
  }
  if (auth.role === 'PARENT') {
    const childIds = await resolveGuardianChildIds(tx, auth);
    if (!childIds.includes(studentId)) throw AppError.forbidden('You do not have access to this student');
    return;
  }
  throw AppError.forbidden('You do not have access to this student');
}

/**
 * Resolves one "course" (a section-subject) for the course-card portal
 * views (Announcement/Course Material/Assessment/Grades/Attendance tabs) —
 * throws 404 unless it belongs to `studentId`'s CURRENT section. Deliberately
 * scoped to the current section only, same as GET
 * /portal/students/:studentId/courses below: a student who has been
 * promoted/transferred sees last year's grades through the exam report-card
 * route (unaffected by this), not through a stale course card for a
 * section they've since left. Caller must already have run
 * assertStudentAccess() for `studentId` — this only checks the
 * section-subject itself.
 */
export async function assertAccessibleSectionSubject(
  tx: Prisma.TransactionClient,
  studentId: string,
  sectionSubjectId: string,
) {
  const student = await tx.student.findUnique({ where: { id: studentId }, select: { currentSectionId: true } });
  if (!student?.currentSectionId) throw AppError.notFound('Course not found for this student');

  const sectionSubject = await tx.sectionSubject.findUnique({
    where: { id: sectionSubjectId },
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, fullName: true } },
      section: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
    },
  });
  if (!sectionSubject || sectionSubject.sectionId !== student.currentSectionId) {
    throw AppError.notFound('Course not found for this student');
  }
  return sectionSubject;
}
