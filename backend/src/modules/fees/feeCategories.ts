import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { createFeeCategorySchema, createFeeStructureItemSchema } from './validation';

export const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'ACCOUNTANT'] as const;
export const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;
export const PAYMENT_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT', 'FRONT_DESK'] as const;

/**
 * Undoing a mark-paid/payment is deliberately narrower than PAYMENT_ROLES
 * (which also lets Front Desk and School Admin record payments) — reversing
 * a completed payment is a correction with real bookkeeping consequences,
 * not a routine collection task, so only Accountant gets the "undo" button.
 */
export const PAYMENT_REVERSAL_ROLES = ['ACCOUNTANT'] as const;

/**
 * Deliberately its own group, not a widening of ADMIN_ROLES — ADMIN_ROLES
 * also gates the late fee policy (lateFeePolicy.ts), which an Accountant
 * setting up this term's fee categories/structure has no business
 * touching. Building the fee structure (categories + per-class amounts)
 * is routine Accountant work in a Pakistani school office, alongside
 * collecting fees (PAYMENT_ROLES) — it was previously SCHOOL_ADMIN-only
 * for no functional reason.
 */
export const STRUCTURE_WRITE_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT'] as const;

export const feeCategoriesRouter = Router();
feeCategoriesRouter.use(requireAuth);

feeCategoriesRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const categories = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.feeCategory.findMany({ orderBy: { name: 'asc' } }),
  );
  res.json({ data: categories });
});

feeCategoriesRouter.post('/', requireRole(...STRUCTURE_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createFeeCategorySchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  // Case-insensitive: "Tuition Fee" and "tuition fee" are the same
  // category to a school office, even though they're distinct strings —
  // without this, near-duplicate categories quietly pile up and split
  // the same fee across two rows in every dropdown that lists categories.
  const existing = await runWithTenant(tenantId, (tx) =>
    tx.feeCategory.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } }),
  );
  if (existing) throw AppError.conflict('A fee category with that name already exists');

  const category = await runWithTenant(tenantId, (tx) =>
    tx.feeCategory.create({ data: { id: randomUUID(), tenantId, ...input } }),
  );
  res.status(201).json({ data: category });
});

export const feeStructureRouter = Router();
feeStructureRouter.use(requireAuth);

feeStructureRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const { academicYearId, schoolClassId } = req.query as Record<string, string | undefined>;
  const items = await runWithTenant(req.auth!.tenantId, (tx) =>
    tx.feeStructureItem.findMany({
      where: {
        ...(academicYearId ? { academicYearId } : {}),
        ...(schoolClassId ? { schoolClassId } : {}),
      },
      include: {
        feeCategory: true,
        schoolClass: { select: { id: true, name: true } },
        academicYear: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
  res.json({ data: items });
});

feeStructureRouter.post('/', requireRole(...STRUCTURE_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = createFeeStructureItemSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const item = await runWithTenant(tenantId, async (tx) => {
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId } });
    if (!year) throw AppError.badRequest('Unknown academicYearId');

    const schoolClass = await tx.schoolClass.findUnique({ where: { id: input.schoolClassId } });
    if (!schoolClass) throw AppError.badRequest('Unknown schoolClassId');

    const category = await tx.feeCategory.findUnique({ where: { id: input.feeCategoryId } });
    if (!category) throw AppError.badRequest('Unknown feeCategoryId');

    const existing = await tx.feeStructureItem.findUnique({
      where: {
        academicYearId_schoolClassId_feeCategoryId: {
          academicYearId: input.academicYearId,
          schoolClassId: input.schoolClassId,
          feeCategoryId: input.feeCategoryId,
        },
      },
    });
    if (existing) {
      throw AppError.conflict('A fee structure item already exists for this class/category/year');
    }

    return tx.feeStructureItem.create({ data: { id: randomUUID(), tenantId, ...input } });
  });

  res.status(201).json({ data: item });
});
