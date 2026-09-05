import type { Prisma } from '@prisma/client';

/**
 * Section IDs a TEACHER should be able to see/act on: sections they are the
 * class teacher for (`Section.classTeacherId`) UNION sections where they've
 * been assigned to teach a specific subject (`SectionSubject.teacherId`) —
 * e.g. a Math teacher who isn't anyone's class teacher but still teaches
 * Math to Class 9-A needs to see that section's students and mark
 * attendance for their own periods.
 *
 * This is the single source of truth for that scoping — every module that
 * used to duplicate a class-teacher-only version of this helper
 * (students.ts, guardians.ts, transferCertificates.ts) and attendance.ts's
 * own single-section check should use this instead.
 */
export async function teacherSectionIds(tx: Prisma.TransactionClient, teacherId: string): Promise<string[]> {
  const [classTeacherSections, subjectSections] = await Promise.all([
    tx.section.findMany({ where: { classTeacherId: teacherId }, select: { id: true } }),
    tx.sectionSubject.findMany({ where: { teacherId }, select: { sectionId: true } }),
  ]);
  const ids = new Set<string>();
  for (const s of classTeacherSections) ids.add(s.id);
  for (const s of subjectSections) ids.add(s.sectionId);
  return Array.from(ids);
}

/**
 * The inverse of `teacherSectionIds`: every TEACHER userId who should be
 * able to see/act on a given section — its class teacher (if any) UNION
 * every teacher assigned to teach a subject there. Used to route something
 * student-scoped (e.g. a leave request) to "every teacher who teaches this
 * student", not just their class teacher.
 */
export async function teacherIdsForSection(tx: Prisma.TransactionClient, sectionId: string): Promise<string[]> {
  const [section, subjectAssignments] = await Promise.all([
    tx.section.findUnique({ where: { id: sectionId }, select: { classTeacherId: true } }),
    tx.sectionSubject.findMany({ where: { sectionId, teacherId: { not: null } }, select: { teacherId: true } }),
  ]);
  const ids = new Set<string>();
  if (section?.classTeacherId) ids.add(section.classTeacherId);
  for (const s of subjectAssignments) {
    if (s.teacherId) ids.add(s.teacherId);
  }
  return Array.from(ids);
}
