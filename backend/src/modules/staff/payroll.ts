import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { bulkGeneratePayrollSchema, generatePayrollSchema, listPayrollQuerySchema } from './validation';
import { READ_ROLES } from './staff';

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

const PAYROLL_WRITE_ROLES = ['SCHOOL_ADMIN', 'ACCOUNTANT'] as const;

const payrollInclude = {
  staffProfile: {
    select: {
      id: true,
      employeeCode: true,
      designation: true,
      user: { select: { fullName: true } },
    },
  },
} satisfies Prisma.PayrollRecordInclude;

payrollRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listPayrollQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId;

  const result = await runWithTenant(tenantId, async (tx) => {
    const where: Prisma.PayrollRecordWhereInput = {
      ...(query.month ? { month: query.month } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.staffProfileId ? { staffProfileId: query.staffProfileId } : {}),
    };

    const [data, total] = await Promise.all([
      tx.payrollRecord.findMany({
        where,
        skip,
        take,
        orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
        include: payrollInclude,
      }),
      tx.payrollRecord.count({ where }),
    ]);

    return { data, total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

payrollRouter.post('/generate', requireRole(...PAYROLL_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = generatePayrollSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const record = await runWithTenant(tenantId, async (tx) => {
    const staff = await tx.staffProfile.findUnique({ where: { id: input.staffProfileId } });
    if (!staff) throw AppError.badRequest('Unknown staffProfileId');
    if (staff.status === 'TERMINATED') {
      throw AppError.badRequest('Cannot generate payroll for a terminated staff member');
    }

    const existing = await tx.payrollRecord.findUnique({
      where: { staffProfileId_month: { staffProfileId: staff.id, month: input.month } },
    });
    if (existing) {
      throw AppError.conflict('Payroll for this staff member and month already exists', {
        payrollRecordId: existing.id,
      });
    }

    const basicSalary = Number(staff.monthlySalary);
    const netSalary = basicSalary + input.allowances - input.deductions;
    if (netSalary < 0) throw AppError.badRequest('Net salary cannot be negative');

    return tx.payrollRecord.create({
      data: {
        id: randomUUID(),
        tenantId,
        staffProfileId: staff.id,
        month: input.month,
        basicSalary,
        allowances: input.allowances,
        deductions: input.deductions,
        netSalary,
      },
      include: payrollInclude,
    });
  });

  res.status(201).json({ data: record });
});

/**
 * Generates one payroll record per active (non-TERMINATED) staff member for
 * a given month in a single call — the bulk counterpart of POST /generate,
 * for "it's the 1st of the month" instead of repeating that form once per
 * employee. Staff who already have a record for this month are skipped
 * (not duplicated), same semantics as invoices' own bulk-generate.
 *
 * Runs with allowances=deductions=0 for everyone, since those are
 * per-person by nature and this is a whole-school action. For the rare
 * staff member who needs either this month: generate everyone else first,
 * then handle that one person with POST /generate before running this —
 * or bulk-generate for everyone (this run skips no one but them, since
 * they had no record yet either), then adjust their PayrollRecord's
 * allowances/deductions directly.
 */
payrollRouter.post('/bulk-generate', requireRole(...PAYROLL_WRITE_ROLES), async (req: Request, res: Response) => {
  const input = bulkGeneratePayrollSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const staffList = await tx.staffProfile.findMany({ where: { status: { not: 'TERMINATED' } } });

    let generated = 0;
    let skipped = 0;
    for (const staff of staffList) {
      const existing = await tx.payrollRecord.findUnique({
        where: { staffProfileId_month: { staffProfileId: staff.id, month: input.month } },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const basicSalary = Number(staff.monthlySalary);
      await tx.payrollRecord.create({
        data: {
          id: randomUUID(),
          tenantId,
          staffProfileId: staff.id,
          month: input.month,
          basicSalary,
          allowances: 0,
          deductions: 0,
          netSalary: basicSalary,
        },
      });
      generated++;
    }

    return { generated, skipped };
  });

  res.status(201).json({ data: result });
});

payrollRouter.patch(
  '/:id/mark-paid',
  requireRole(...PAYROLL_WRITE_ROLES),
  async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;

    const record = await runWithTenant(tenantId, async (tx) => {
      const existing = await tx.payrollRecord.findUnique({ where: { id: uuidParam(req, 'id') } });
      if (!existing) throw AppError.notFound('Payroll record not found');
      if (existing.status === 'PAID') return existing; // idempotent — already paid

      return tx.payrollRecord.update({
        where: { id: existing.id },
        data: { status: 'PAID', paidAt: new Date() },
        include: payrollInclude,
      });
    });

    res.json({ data: record });
  },
);
