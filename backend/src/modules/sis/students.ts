import { Router } from 'express';
import { randomUUID } from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { assertCanAddStudent } from '../../lib/planLimits';
import { singleCsvUpload } from '../../lib/upload';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { deriveTenantCode } from '../../utils/tenantCode';
import { createStudentLogin } from '../portal/provisioning';
import { renderAdmissionFormPdf } from './admissionFormPdf';
import { teacherSectionIds } from '../../lib/teacherScope';
import {
  createStudentSchema,
  updateStudentSchema,
  listStudentsQuerySchema,
  enrollStudentSchema,
  bulkImportStudentRowSchema,
} from './validation';
import type { Prisma } from '@prisma/client';

export const studentsRouter = Router();
studentsRouter.use(requireAuth);

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK'] as const;
// Deleting a student cascades to every attendance/fee/exam/homework record
// tied to them (see the Cascade FKs in schema.prisma) — irreversible, so
// it's restricted more tightly than ordinary edits.
const DELETE_ROLES = ['SCHOOL_ADMIN'] as const;

/**
 * Self-service "my own bio-data" — STUDENT role only, self-scoped by
 * userId, never gated by READ_ROLES (which deliberately excludes STUDENT —
 * a student has no business browsing the roster). Registered before every
 * other route (in particular GET /:id) so "/me" can never be swallowed by
 * that route's :id param — mirrors staffRouter.get('/me')'s same ordering
 * comment. Returns the fields the portal's My Profile → Bio Data tab needs
 * (personal detail + family detail via guardians); none of this is
 * editable here — see PATCH /api/auth/me for what IS self-editable
 * (phone, email, address, emergencyContact).
 */
studentsRouter.get('/me', async (req: Request, res: Response) => {
  if (req.auth!.role !== 'STUDENT') {
    throw AppError.forbidden('Only a student account has a linked student record');
  }
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const student = await runWithTenant(tenantId, (tx) =>
    tx.student.findUnique({
      where: { userId },
      include: {
        currentSection: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
        guardians: { include: { guardian: true } },
        healthProfile: { select: { bloodGroup: true } },
        user: { select: { id: true, email: true, loginId: true } },
      },
    }),
  );

  if (!student) throw AppError.notFound('No student record is linked to this account');
  res.json({ data: student });
});

/**
 * Pre-check before insert/update, matching this codebase's established
 * convention (see feeCategories.ts's duplicate-name check) of surfacing a
 * clean 409 via AppError rather than letting a raw Prisma P2002 unique-
 * constraint violation bubble up as an unhandled 500.
 */
async function assertRollNumberFree(
  tx: Prisma.TransactionClient,
  sectionId: string,
  rollNumber: string,
  excludeStudentId?: string,
) {
  // `findFirst` rather than `findUnique` on the compound key — RLS already
  // scopes this query to the current tenant, so there's no need to supply
  // tenantId explicitly (and no clean way to get it into a `findUnique`'s
  // compound-key `where` without threading it through every call site).
  const existing = await tx.student.findFirst({ where: { currentSectionId: sectionId, rollNumber } });
  if (existing && existing.id !== excludeStudentId) {
    throw AppError.conflict(`Roll number "${rollNumber}" is already assigned to another student in this section`);
  }
}

/**
 * A B-Form/CNIC is a real government-issued ID — two different students
 * sharing one is always a data-entry mistake, so it's unique tenant-wide
 * (unlike rollNumber, which is only unique per-section). Skipped when the
 * value is empty since the field itself is optional (schools often admit
 * before the paperwork is on file).
 */
async function assertCnicFree(
  tx: Prisma.TransactionClient,
  bFormOrCnic: string,
  excludeStudentId?: string,
) {
  const existing = await tx.student.findFirst({ where: { bFormOrCnic } });
  if (existing && existing.id !== excludeStudentId) {
    throw AppError.conflict(
      `A student with B-Form/CNIC "${bFormOrCnic}" already exists (${existing.fullName})`,
      { field: 'bFormOrCnic' },
    );
  }
}

async function generateStudentCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  admissionDate: Date,
): Promise<string> {
  const rows = await tx.$queryRaw<{ seq: bigint; code: string; name: string }[]>`
    UPDATE tenants SET "nextStudentSeq" = "nextStudentSeq" + 1
    WHERE id = ${tenantId}::uuid
    RETURNING "nextStudentSeq" - 1 AS seq, code, name
  `;
  const seq = Number(rows[0].seq);
  const year = admissionDate.getFullYear();
  const prefix = rows[0].code || deriveTenantCode(rows[0].name);
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

studentsRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listStudentsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId;

  const result = await runWithTenant(tenantId, async (tx) => {
    let allowedSectionIds: string[] | null = null;
    if (req.auth!.role === 'TEACHER') {
      allowedSectionIds = await teacherSectionIds(tx, req.auth!.userId);
      if (query.sectionId && !allowedSectionIds.includes(query.sectionId)) {
        throw AppError.forbidden('You do not have access to this section');
      }
    }

    const where: Prisma.StudentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sectionId
        ? { currentSectionId: query.sectionId }
        : allowedSectionIds
          ? { currentSectionId: { in: allowedSectionIds } }
          : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { studentCode: { contains: query.search, mode: 'insensitive' } },
              { rollNumber: { contains: query.search, mode: 'insensitive' } },
              { bFormOrCnic: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      tx.student.findMany({
        where,
        skip,
        take,
        orderBy: { fullName: 'asc' },
        include: {
          currentSection: {
            select: { id: true, name: true, schoolClass: { select: { name: true } } },
          },
          user: { select: { id: true, email: true, loginId: true } },
        },
      }),
      tx.student.count({ where }),
    ]);

    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

studentsRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  const student = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: {
        currentSection: { select: { id: true, name: true, schoolClass: { select: { name: true } } } },
        guardians: { include: { guardian: true } },
        enrollments: {
          include: { section: { select: { name: true } }, academicYear: { select: { name: true } } },
          orderBy: { enrolledAt: 'desc' },
        },
        user: { select: { id: true, email: true, loginId: true } },
      },
    });
    if (!student) return null;

    if (req.auth!.role === 'TEACHER') {
      const allowed = await teacherSectionIds(tx, req.auth!.userId);
      if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
        throw AppError.forbidden('You do not have access to this student');
      }
    }

    return student;
  });

  if (!student) throw AppError.notFound('Student not found');
  res.json({ data: student });
});

interface CreateStudentRecordInput {
  fullName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: Date;
  admissionDate?: Date;
  bFormOrCnic?: string;
  address?: string;
  city?: string;
  contactPhone?: string;
  rollNumber?: string;
  sectionId?: string;
  academicYearId?: string;
  email?: string;
  photoUrl?: string;
}

/**
 * The actual "create one student" logic, shared by the single-student
 * POST / route below and bulkImportStudents()'s per-row loop — extracted so
 * bulk import gets exactly the same plan-limit check, roll-number/CNIC
 * uniqueness checks, student-code generation, enrollment, and optional
 * portal-login auto-provisioning as a single admission through the normal
 * form, instead of a second, drifting copy of this logic.
 */
async function createStudentRecord(
  tx: Prisma.TransactionClient,
  tenantId: string,
  createdByUserId: string,
  input: CreateStudentRecordInput,
) {
  await assertCanAddStudent(tx, tenantId);

  if (input.sectionId) {
    const section = await tx.section.findUnique({ where: { id: input.sectionId } });
    if (!section) throw AppError.badRequest('Unknown sectionId');
    if (input.academicYearId && section.academicYearId !== input.academicYearId) {
      throw AppError.badRequest('sectionId does not belong to the given academicYearId');
    }
  }

  if (input.sectionId && input.rollNumber) {
    await assertRollNumberFree(tx, input.sectionId, input.rollNumber);
  }

  if (input.bFormOrCnic) {
    await assertCnicFree(tx, input.bFormOrCnic);
  }

  const admissionDate = input.admissionDate ?? new Date();
  const studentCode = await generateStudentCode(tx, tenantId, admissionDate);

  const created = await tx.student.create({
    data: {
      id: randomUUID(),
      tenantId,
      studentCode,
      fullName: input.fullName,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      admissionDate,
      bFormOrCnic: input.bFormOrCnic,
      address: input.address,
      city: input.city,
      contactPhone: input.contactPhone,
      rollNumber: input.sectionId ? input.rollNumber : undefined,
      currentSectionId: input.sectionId,
      photoUrl: input.photoUrl,
    },
  });

  if (input.sectionId && input.academicYearId) {
    await tx.enrollment.create({
      data: {
        id: randomUUID(),
        tenantId,
        studentId: created.id,
        sectionId: input.sectionId,
        academicYearId: input.academicYearId,
      },
    });
  }

  // Auto-provision a student portal login for every admission — the login
  // is always ID-based (the student's own studentCode, see
  // createStudentLogin's doc comment), so it no longer needs an email to
  // exist at all: a school kid without their own Gmail/mobile still gets
  // a working portal account. An email, when supplied, is wired up too
  // (either works to log in) and also gets the credentials emailed out.
  const provisioned = await createStudentLogin(tx, tenantId, created.id, {
    email: input.email,
    createdByUserId,
  });
  return {
    student: provisioned.student,
    portalLogin: { email: provisioned.email, loginId: provisioned.loginId, tempPassword: provisioned.tempPassword },
  };
}

studentsRouter.post('/', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createStudentSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  if (input.sectionId && !input.academicYearId) {
    throw AppError.badRequest('academicYearId is required when sectionId is provided');
  }

  const result = await runWithTenant(tenantId, (tx) =>
    createStudentRecord(tx, tenantId, req.auth!.userId, input),
  );

  res.status(201).json({
    data: result.student,
    ...(result.portalLogin
      ? {
          // Returned once, at creation time — never retrievable again. Also
          // emailed to the student directly.
          portalLogin: result.portalLogin,
        }
      : {}),
  });
});

interface BulkImportRowResult {
  row: number;
  status: 'created' | 'error';
  studentCode?: string;
  fullName?: string;
  error?: string;
}

/**
 * Bulk-admits students from a CSV so a front-desk admin migrating from a
 * paper register or a spreadsheet doesn't have to re-type each one through
 * the single-student form. Expected header row (order doesn't matter):
 * fullName, gender, dateOfBirth, admissionDate, bFormOrCnic, address, city,
 * contactPhone, rollNumber, className, sectionName, email — see
 * bulkImportStudentRowSchema's doc comment for what each column means and
 * which are optional.
 *
 * Each row runs in its OWN runWithTenant() transaction (not one transaction
 * for the whole file), matching PowerSchool's own Data Import Manager
 * behavior: one bad row (a duplicate CNIC, an unknown class name, a missing
 * required field) fails and is reported back with its row number and
 * reason, but doesn't roll back the rows before or after it. A school
 * re-uploading the same file after fixing the reported rows will cleanly
 * skip everything that already succeeded (roll-number/CNIC uniqueness
 * checks reject the already-created rows as duplicates), so it's safe to
 * just fix-and-retry rather than needing an all-or-nothing re-import.
 */
studentsRouter.post(
  '/bulk-import',
  requireRole(...WRITE_ROLES),
  singleCsvUpload('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file uploaded — expected multipart/form-data field "file"');
    }
    const tenantId = req.auth!.tenantId!;

    let rawRows: Record<string, string>[];
    try {
      rawRows = parseCsv(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch (err) {
      throw AppError.badRequest(`Could not parse CSV: ${(err as Error).message}`);
    }

    if (rawRows.length === 0) {
      throw AppError.badRequest('CSV has no data rows');
    }
    if (rawRows.length > 2000) {
      throw AppError.badRequest(`CSV has ${rawRows.length} rows — the limit per import is 2000`);
    }

    const results: BulkImportRowResult[] = [];
    let created = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      // csv-parse gives every column as a string, including "" for a blank
      // cell in an optional column — the zod schema's .optional() only
      // treats `undefined` as absent, so blank cells need to become
      // `undefined` before validation, not fail it as an empty string.
      const rawRow = rawRows[i];
      const cleaned: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawRow)) {
        if (value !== '') cleaned[key] = value;
      }

      const parsed = bulkImportStudentRowSchema.safeParse(cleaned);
      if (!parsed.success) {
        results.push({
          row: rowNumber,
          status: 'error',
          error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        });
        continue;
      }
      const row = parsed.data;

      if ((row.className && !row.sectionName) || (row.sectionName && !row.className)) {
        results.push({
          row: rowNumber,
          status: 'error',
          fullName: row.fullName,
          error: 'className and sectionName must both be provided together, or both left blank',
        });
        continue;
      }

      try {
        const outcome = await runWithTenant(tenantId, async (tx) => {
          let sectionId: string | undefined;
          let academicYearId: string | undefined;

          if (row.className && row.sectionName) {
            const activeYear = await tx.academicYear.findFirst({ where: { isActive: true } });
            if (!activeYear) {
              throw AppError.badRequest('No active academic year is configured for this school');
            }
            const section = await tx.section.findFirst({
              where: {
                name: row.sectionName,
                academicYearId: activeYear.id,
                schoolClass: { name: row.className },
              },
            });
            if (!section) {
              throw AppError.badRequest(
                `No section "${row.sectionName}" in class "${row.className}" for the active academic year`,
              );
            }
            sectionId = section.id;
            academicYearId = activeYear.id;
          }

          return createStudentRecord(tx, tenantId, req.auth!.userId, {
            fullName: row.fullName,
            gender: row.gender,
            dateOfBirth: row.dateOfBirth,
            admissionDate: row.admissionDate,
            bFormOrCnic: row.bFormOrCnic,
            address: row.address,
            city: row.city,
            contactPhone: row.contactPhone,
            rollNumber: row.rollNumber,
            sectionId,
            academicYearId,
            email: row.email,
          });
        });

        created += 1;
        results.push({
          row: rowNumber,
          status: 'created',
          studentCode: outcome.student.studentCode,
          fullName: outcome.student.fullName,
        });
      } catch (err) {
        results.push({
          row: rowNumber,
          status: 'error',
          fullName: row.fullName,
          error: err instanceof AppError ? err.message : 'Unexpected error creating this row',
        });
      }
    }

    res.status(207).json({
      data: {
        totalRows: rawRows.length,
        created,
        failed: rawRows.length - created,
        results,
      },
    });
  },
);

studentsRouter.patch('/:id', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const { email, ...input } = updateStudentSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const studentId = uuidParam(req, 'id');

  const updated = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.student.findUnique({ where: { id: studentId } });
    if (!existing) throw AppError.notFound('Student not found');

    if (input.rollNumber && existing.currentSectionId) {
      await assertRollNumberFree(tx, existing.currentSectionId, input.rollNumber, existing.id);
    }

    if (input.bFormOrCnic) {
      await assertCnicFree(tx, input.bFormOrCnic, existing.id);
    }

    if (email !== undefined) {
      if (!existing.userId) {
        throw AppError.badRequest(
          'This student has no portal login yet — create one first, then its email can be edited.',
        );
      }
      const emailTaken = await tx.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
      if (emailTaken && emailTaken.id !== existing.userId) {
        throw AppError.conflict('A user with this email already exists', { field: 'email' });
      }
      await tx.user.update({ where: { id: existing.userId }, data: { email } });
    }

    return tx.student.update({
      where: { id: studentId },
      data: input,
      include: { user: { select: { id: true, email: true, loginId: true } } },
    });
  });

  res.json({ data: updated });
});

studentsRouter.delete('/:id', requireRole(...DELETE_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;
  const studentId = uuidParam(req, 'id');

  await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.student.findUnique({ where: { id: studentId } });
    if (!existing) throw AppError.notFound('Student not found');

    // Student -> User is onDelete: SetNull (not Cascade — deleting a login
    // shouldn't take the whole student record with it), so the reverse
    // isn't automatic either: deleting the student alone would leave an
    // orphaned, still-loggable-in portal account behind. Remove the login
    // explicitly first.
    if (existing.userId) {
      await tx.user.delete({ where: { id: existing.userId } });
    }

    // Cascades to enrollments, attendance, invoices/payments, exam marks,
    // homework submissions, discipline records, learning support plans,
    // health profile/log entries, custom field values, elective-subject
    // enrollments, and guardian links — see the onDelete: Cascade FKs
    // pointing at Student in schema.prisma. Irreversible.
    await tx.student.delete({ where: { id: studentId } });
  });

  res.status(204).send();
});

/** Enroll (or transfer) a student into a section for an academic year. */
studentsRouter.post('/:id/enroll', requireRole(...WRITE_ROLES), async (req: Request, res: Response) => {
  const input = enrollStudentSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const student = await tx.student.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!student) throw AppError.notFound('Student not found');

    const section = await tx.section.findUnique({ where: { id: input.sectionId } });
    if (!section) throw AppError.badRequest('Unknown sectionId');
    if (section.academicYearId !== input.academicYearId) {
      throw AppError.badRequest('sectionId does not belong to the given academicYearId');
    }

    const existingEnrollment = await tx.enrollment.findUnique({
      where: { studentId_academicYearId: { studentId: uuidParam(req, 'id'), academicYearId: input.academicYearId } },
    });

    const enrollment = existingEnrollment
      ? await tx.enrollment.update({
          where: { id: existingEnrollment.id },
          data: { sectionId: input.sectionId, status: 'ACTIVE' },
        })
      : await tx.enrollment.create({
          data: {
            id: randomUUID(),
            tenantId,
            studentId: uuidParam(req, 'id'),
            sectionId: input.sectionId,
            academicYearId: input.academicYearId,
          },
        });

    await tx.student.update({ where: { id: uuidParam(req, 'id') }, data: { currentSectionId: input.sectionId } });

    return enrollment;
  });

  res.status(200).json({ data: result });
});

async function loadAdmissionFormForPdf(tx: Prisma.TransactionClient, studentId: string) {
  const student = await tx.student.findUnique({
    where: { id: studentId },
    include: {
      currentSection: { select: { schoolClassId: true, academicYearId: true, schoolClass: { select: { name: true } } } },
      guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
    },
  });
  if (!student) return null;

  const tenant = await tx.tenant.findUnique({ where: { id: student.tenantId } });
  if (!tenant) return null;

  const [feeItems, invoices] = await Promise.all([
    student.currentSection
      ? tx.feeStructureItem.findMany({
          where: {
            schoolClassId: student.currentSection.schoolClassId,
            academicYearId: student.currentSection.academicYearId,
          },
          include: { feeCategory: { select: { name: true } } },
          orderBy: { feeCategory: { name: 'asc' } },
        })
      : Promise.resolve([]),
    tx.invoice.findMany({ where: { studentId } }),
  ]);

  const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
  const totalFines = invoices.reduce((sum, inv) => sum + Number(inv.lateFineAmount), 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);

  return {
    school: {
      name: tenant.name,
      address: tenant.address,
      city: tenant.city,
      contactPhone: tenant.contactPhone,
      logoUrl: tenant.logoUrl,
    },
    student: {
      studentCode: student.studentCode,
      fullName: student.fullName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth.toISOString(),
      admissionDate: student.admissionDate.toISOString(),
      bFormOrCnic: student.bFormOrCnic,
      contactPhone: student.contactPhone,
      address: student.address,
      city: student.city,
      className: student.currentSection?.schoolClass.name ?? null,
      rollNumber: student.rollNumber,
      photoUrl: student.photoUrl,
    },
    guardians: student.guardians.map((g) => ({
      fullName: g.guardian.fullName,
      relationship: g.guardian.relationship,
      cnic: g.guardian.cnic,
      phone: g.guardian.phone,
      email: g.guardian.email,
      occupation: g.guardian.occupation,
      isPrimary: g.isPrimary,
    })),
    fees: {
      structureItems: feeItems.map((item) => ({
        categoryName: item.feeCategory.name,
        amount: Number(item.amount),
        frequency: item.frequency,
      })),
      ledger: { totalBilled: totalBilled + totalFines, totalPaid, balance: totalBilled + totalFines - totalPaid },
    },
  };
}

/** Printable admission-form PDF: student + all guardian details, enrollment date, and fee details — the full paperwork packet a school hands out at admission time. */
studentsRouter.get(
  '/:id/admission-form/pdf',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId!;
    const studentId = uuidParam(req, 'id');

    const data = await runWithTenant(tenantId, async (tx) => {
      if (req.auth!.role === 'TEACHER') {
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student) return null;
        const allowed = await teacherSectionIds(tx, req.auth!.userId);
        if (!student.currentSectionId || !allowed.includes(student.currentSectionId)) {
          throw AppError.forbidden('You do not have access to this student');
        }
      }
      return loadAdmissionFormForPdf(tx, studentId);
    });
    if (!data) throw AppError.notFound('Student not found');

    const pdfBuffer = await renderAdmissionFormPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="admission-form-${data.student.studentCode}.pdf"`);
    res.send(pdfBuffer);
  },
);
