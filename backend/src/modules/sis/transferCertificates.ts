import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { teacherSectionIds } from '../../lib/teacherScope';
import { createTransferCertificateSchema } from './validation';
import { renderTransferCertificatePdf } from './transferCertificatePdf';

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;

export const transferCertificatesRouter = Router();
transferCertificatesRouter.use(requireAuth);

/**
 * Throws 403 if a TEACHER caller's own sections don't include `sectionId`
 * (or the student has none) — mirrors the same scoping already applied to
 * every other per-student read in students.ts/attendance.ts, so a teacher
 * can't list/view/print a transfer certificate for a student who was never
 * in one of their sections. `currentSectionId` is left untouched by the TC
 * issue flow (only `status` flips to TRANSFERRED_OUT), so it still records
 * the student's last section for this check.
 */
async function assertTeacherCanSeeStudent(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  currentSectionId: string | null,
) {
  if (auth.role !== 'TEACHER') return;
  const allowed = await teacherSectionIds(tx, auth.userId);
  if (!currentSectionId || !allowed.includes(currentSectionId)) {
    throw AppError.forbidden('You do not have access to this student');
  }
}

async function generateTcNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    UPDATE tenants SET "nextTcSeq" = "nextTcSeq" + 1
    WHERE id = ${tenantId}::uuid
    RETURNING "nextTcSeq" - 1 AS seq
  `;
  return `TC-${new Date().getFullYear()}-${String(Number(rows[0].seq)).padStart(6, '0')}`;
}

/** Issues a new transfer/leaving certificate for a student and marks them TRANSFERRED_OUT. */
transferCertificatesRouter.post(
  '/students/:studentId/transfer-certificate',
  requireRole(...WRITE_ROLES),
  async (req: Request, res: Response) => {
    const input = createTransferCertificateSchema.parse(req.body);
    const studentId = uuidParam(req, 'studentId');
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;

    const tc = await runWithTenant(tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw AppError.notFound('Student not found');
      if (student.status === 'TRANSFERRED_OUT') {
        throw AppError.conflict('This student already has a transfer certificate issued');
      }

      const tcNumber = await generateTcNumber(tx, tenantId);
      const created = await tx.transferCertificate.create({
        data: {
          id: randomUUID(),
          tenantId,
          studentId,
          tcNumber,
          issueDate: input.issueDate ?? new Date(),
          lastAttendanceDate: input.lastAttendanceDate,
          reason: input.reason,
          conduct: input.conduct,
          remarks: input.remarks,
          issuedByUserId: auth.userId,
        },
      });

      await tx.student.update({ where: { id: studentId }, data: { status: 'TRANSFERRED_OUT' } });

      return created;
    });

    res.status(201).json({ data: tc });
  },
);

/**
 * Undoes a mistakenly-issued TC: marks it voided (kept for the audit
 * trail/tcNumber sequence rather than deleted — the frontend flags it
 * "Voided" instead of hiding it) and reverts the student's status back to
 * ACTIVE so they're no longer stuck showing as transferred out. Only the
 * most recently issued, not-yet-voided TC for that student can be voided
 * — voiding an older one while a newer TC already superseded it would
 * leave the student's status pointing at the wrong certificate.
 */
transferCertificatesRouter.post(
  '/transfer-certificates/:id/void',
  requireRole(...WRITE_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;
    const tcId = uuidParam(req, 'id');

    const result = await runWithTenant(tenantId, async (tx) => {
      const tc = await tx.transferCertificate.findUnique({ where: { id: tcId } });
      if (!tc) throw AppError.notFound('Transfer certificate not found');
      if (tc.voidedAt) throw AppError.conflict('This transfer certificate has already been voided');

      const latest = await tx.transferCertificate.findFirst({
        where: { studentId: tc.studentId, voidedAt: null },
        orderBy: { issueDate: 'desc' },
      });
      if (!latest || latest.id !== tc.id) {
        throw AppError.conflict(
          'Only the most recently issued transfer certificate for this student can be voided',
        );
      }

      const voided = await tx.transferCertificate.update({
        where: { id: tcId },
        data: { voidedAt: new Date(), voidedByUserId: auth.userId },
      });

      const student = await tx.student.update({
        where: { id: tc.studentId },
        data: { status: 'ACTIVE' },
      });

      return { tc: voided, student };
    });

    res.json({ data: result.tc, student: { id: result.student.id, status: result.student.status } });
  },
);

transferCertificatesRouter.get(
  '/students/:studentId/transfer-certificates',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const auth = req.auth!;
    const studentId = uuidParam(req, 'studentId');

    const list = await runWithTenant(req.auth!.tenantId, async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { currentSectionId: true },
      });
      if (!student) throw AppError.notFound('Student not found');
      await assertTeacherCanSeeStudent(tx, auth, student.currentSectionId);

      return tx.transferCertificate.findMany({
        where: { studentId },
        orderBy: { issueDate: 'desc' },
      });
    });
    res.json({ data: list });
  },
);

async function loadTcForPdf(
  tx: Prisma.TransactionClient,
  tcId: string,
  auth: { role: string; userId: string },
) {
  const tc = await tx.transferCertificate.findUnique({
    where: { id: tcId },
    include: {
      student: {
        include: {
          currentSection: { select: { id: true, schoolClass: { select: { name: true } } } },
          guardians: { include: { guardian: true } },
        },
      },
    },
  });
  if (!tc) return null;

  await assertTeacherCanSeeStudent(tx, auth, tc.student.currentSection?.id ?? null);

  const tenant = await tx.tenant.findUnique({ where: { id: tc.tenantId } });
  if (!tenant) return null;

  const primaryGuardianLink =
    tc.student.guardians.find((g) => g.isPrimary) ??
    tc.student.guardians.find((g) => g.guardian.relationship === 'FATHER') ??
    tc.student.guardians[0];

  return {
    school: { name: tenant.name, address: tenant.address, city: tenant.city, logoUrl: tenant.logoUrl },
    tc: {
      tcNumber: tc.tcNumber,
      issueDate: tc.issueDate.toISOString(),
      lastAttendanceDate: tc.lastAttendanceDate?.toISOString() ?? null,
      reason: tc.reason,
      conduct: tc.conduct,
      remarks: tc.remarks,
    },
    student: {
      studentCode: tc.student.studentCode,
      fullName: tc.student.fullName,
      fatherOrGuardianName: primaryGuardianLink?.guardian.fullName ?? null,
      dateOfBirth: tc.student.dateOfBirth.toISOString(),
      className: tc.student.currentSection?.schoolClass.name ?? null,
      admissionDate: tc.student.admissionDate.toISOString(),
    },
  };
}

transferCertificatesRouter.get(
  '/transfer-certificates/:id',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const auth = req.auth!;

    const tc = await runWithTenant(req.auth!.tenantId, async (tx) => {
      const found = await tx.transferCertificate.findUnique({
        where: { id: uuidParam(req, 'id') },
        include: { student: { select: { currentSectionId: true } } },
      });
      if (!found) throw AppError.notFound('Transfer certificate not found');
      await assertTeacherCanSeeStudent(tx, auth, found.student.currentSectionId);
      const { student: _student, ...rest } = found;
      return rest;
    });

    res.json({ data: tc });
  },
);

transferCertificatesRouter.get(
  '/transfer-certificates/:id/pdf',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;
    const data = await runWithTenant(tenantId, (tx) => loadTcForPdf(tx, uuidParam(req, 'id'), auth));
    if (!data) throw AppError.notFound('Transfer certificate not found');

    const pdfBuffer = await renderTransferCertificatePdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tc-${data.tc.tcNumber}.pdf"`);
    res.send(pdfBuffer);
  },
);
