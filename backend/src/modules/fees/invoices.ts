import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Invoice, InvoiceStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant, type TenantTx } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { READ_ROLES, PAYMENT_ROLES, PAYMENT_REVERSAL_ROLES } from './feeCategories';
import { getLateFeePolicy, syncInvoiceOverdueState } from './lateFee';
import { renderChallanPdf } from './challanPdf';
import {
  bulkGenerateInvoicesSchema,
  defaultersQuerySchema,
  listInvoicesQuerySchema,
  markPaidSchema,
  recordPaymentSchema,
} from './validation';

/**
 * Syncs overdue state for a batch of invoices under one fetched policy
 * (avoids one policy lookup per row). Generic over `T` so callers that
 * `include` relations (e.g. `student`) get them preserved on the result —
 * `syncInvoiceOverdueState` only touches `status`/`lateFineAmount`.
 *
 * Exported so the portal module's own fee ledger (`portal.ts`'s
 * GET /students/:studentId/fees) can apply the exact same freshness fix
 * rather than showing a parent a stale pre-fine total.
 */
export async function syncMany<T extends Invoice>(tx: TenantTx, tenantId: string, invoices: T[]): Promise<T[]> {
  const policy = await getLateFeePolicy(tx, tenantId);
  return Promise.all(
    invoices.map(async (inv) => {
      const synced = await syncInvoiceOverdueState(tx, inv, policy);
      if (synced.status === inv.status && Number(synced.lateFineAmount) === Number(inv.lateFineAmount)) return inv;
      return { ...inv, status: synced.status, lateFineAmount: synced.lateFineAmount, updatedAt: synced.updatedAt };
    }),
  );
}

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

/**
 * Every mutation route below (payments, mark-paid, revert-to-unpaid) used to
 * return a bare `tx.invoice.update(...)` row — just the Invoice columns,
 * with no `student`/`lineItems`/`payments` relations. The frontend's
 * InvoiceDetailPage takes whatever `res.invoice` it gets back and swaps it
 * straight into state (`setInvoice(res.invoice)`), then re-renders using
 * `current.student.fullName` — which crashed instantly ("Cannot read
 * properties of undefined (reading 'fullName')") the moment a payment was
 * recorded, right after the write had already succeeded. That crash was
 * exactly what looked like "mark paid, refresh, and it's unpaid again" —
 * the write was always correct; the page just broke before it could show
 * you that. Every mutation route now includes this so its response matches
 * GET /:id's shape exactly.
 */
const INVOICE_DETAIL_INCLUDE = {
  student: { select: { id: true, fullName: true, studentCode: true } },
  lineItems: { include: { feeCategory: { select: { name: true } } } },
  payments: { orderBy: { paidAt: 'desc' as const } },
};

async function generateInvoiceNumber(
  tx: import('@prisma/client').Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`
    UPDATE tenants SET "nextInvoiceSeq" = "nextInvoiceSeq" + 1
    WHERE id = ${tenantId}::uuid
    RETURNING "nextInvoiceSeq" - 1 AS seq
  `;
  return `INV-${new Date().getFullYear()}-${String(Number(rows[0].seq)).padStart(6, '0')}`;
}

/**
 * Bulk-generates one consolidated invoice per currently-enrolled active
 * student in a section, from that class's fee structure. Students who
 * already have an invoice for this `period` are skipped (not duplicated).
 * This runs synchronously for now — for a large school this is a natural
 * candidate to move behind a background job queue later (Day 8 introduces
 * job-friendly patterns); flagged here as a scaling trade-off.
 */
invoicesRouter.post('/bulk-generate', requireRole(...PAYMENT_ROLES), async (req: Request, res: Response) => {
  const input = bulkGenerateInvoicesSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const section = await tx.section.findUnique({ where: { id: input.sectionId } });
    if (!section) throw AppError.badRequest('Unknown sectionId');
    if (section.academicYearId !== input.academicYearId) {
      throw AppError.badRequest('sectionId does not belong to the given academicYearId');
    }

    const feeItems = await tx.feeStructureItem.findMany({
      where: {
        academicYearId: input.academicYearId,
        schoolClassId: section.schoolClassId,
        ...(input.feeCategoryIds ? { feeCategoryId: { in: input.feeCategoryIds } } : {}),
      },
      include: { feeCategory: true },
    });
    if (feeItems.length === 0) {
      throw AppError.badRequest('No fee structure items found for this class/year (set them up first)');
    }
    const totalAmount = feeItems.reduce((sum, item) => sum + Number(item.amount), 0);

    const students = await tx.student.findMany({
      where: { currentSectionId: input.sectionId, status: 'ACTIVE' },
    });

    const created = [];
    const skipped = [];
    for (const student of students) {
      const existing = await tx.invoice.findUnique({
        where: { studentId_period: { studentId: student.id, period: input.period } },
      });
      if (existing) {
        skipped.push({ studentId: student.id, reason: 'invoice already exists for this period' });
        continue;
      }

      const invoiceNumber = await generateInvoiceNumber(tx, tenantId);
      const invoice = await tx.invoice.create({
        data: {
          id: randomUUID(),
          tenantId,
          studentId: student.id,
          academicYearId: input.academicYearId,
          invoiceNumber,
          period: input.period,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          totalAmount,
          lineItems: {
            create: feeItems.map((item) => ({
              id: randomUUID(),
              tenantId,
              feeCategoryId: item.feeCategoryId,
              description: item.feeCategory.name,
              amount: item.amount,
            })),
          },
        },
      });
      created.push(invoice);
    }

    return { created, skipped };
  });

  res.status(201).json({
    data: { generated: result.created.length, skipped: result.skipped.length, invoices: result.created, skippedDetails: result.skipped },
  });
});

invoicesRouter.get('/', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = listInvoicesQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);

  const tenantId = req.auth!.tenantId!;
  const result = await runWithTenant(tenantId, async (tx) => {
    const where = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await Promise.all([
      tx.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { issueDate: 'desc' },
        include: { student: { select: { id: true, fullName: true, studentCode: true } } },
      }),
      tx.invoice.count({ where }),
    ]);
    return { data: await syncMany(tx, tenantId, data), total };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

/**
 * Students with an overdue/unpaid balance, optionally filtered by
 * class/section/year — the list a School Admin or Accountant chases every
 * month. Registered ahead of `/:id` so "defaulters" isn't swallowed as an
 * `:id` route param.
 */
invoicesRouter.get('/defaulters', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const query = defaultersQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const studentWhere = {
      ...(query.academicYearId ? { currentSection: { academicYearId: query.academicYearId } } : {}),
      ...(query.sectionId ? { currentSectionId: query.sectionId } : {}),
      ...(query.schoolClassId ? { currentSection: { schoolClassId: query.schoolClassId } } : {}),
    };

    // Defaulter = any non-terminal invoice past its due date, whether or
    // not a LateFeePolicy is configured — schools without a fine policy
    // still want to see who owes money past the deadline. Sync doesn't
    // change eligibility here (OVERDUE is already in the status set), so
    // it's safe to paginate at the DB level and sync only the current page.
    const where = {
      dueDate: { lt: new Date() },
      status: { in: ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'] as InvoiceStatus[] },
      student: studentWhere,
    };
    const [found, total] = await Promise.all([
      tx.invoice.findMany({
        where,
        skip,
        take,
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              studentCode: true,
              currentSection: { select: { name: true, schoolClass: { select: { name: true } } } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      }),
      tx.invoice.count({ where }),
    ]);
    const invoices = await syncMany(tx, tenantId, found);

    return {
      data: invoices.map((inv) => ({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        period: inv.period,
        dueDate: inv.dueDate,
        status: inv.status,
        totalAmount: inv.totalAmount,
        lateFineAmount: inv.lateFineAmount,
        paidAmount: inv.paidAmount,
        amountDue: Number(inv.totalAmount) + Number(inv.lateFineAmount) - Number(inv.paidAmount),
        student: inv.student,
      })),
      total,
    };
  });

  res.json({ data: result.data, meta: paginationMeta(query.page, query.limit, result.total) });
});

invoicesRouter.get('/:id', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const invoice = await runWithTenant(tenantId, async (tx) => {
    const found = await tx.invoice.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: INVOICE_DETAIL_INCLUDE,
    });
    if (!found) return null;
    const [synced] = await syncMany(tx, tenantId, [found]);
    return synced;
  });
  if (!invoice) throw AppError.notFound('Invoice not found');
  res.json({ data: invoice });
});

/** Pakistani-style 3-copy (Bank/School/Student) fee voucher PDF for one invoice. */
invoicesRouter.get('/:id/challan-pdf', requireRole(...READ_ROLES), async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId!;
  const challanData = await runWithTenant(tenantId, async (tx) => {
    const found = await tx.invoice.findUnique({
      where: { id: uuidParam(req, 'id') },
      include: {
        student: {
          select: {
            studentCode: true,
            fullName: true,
            currentSection: { select: { schoolClass: { select: { name: true } } } },
          },
        },
      },
    });
    if (!found) return null;
    const policy = await getLateFeePolicy(tx, tenantId);
    const invoice = await syncInvoiceOverdueState(tx, found, policy);
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return null;

    return {
      school: { name: tenant.name, address: tenant.address, city: tenant.city, contactPhone: tenant.contactPhone },
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        period: invoice.period,
        issueDate: invoice.issueDate.toISOString(),
        dueDate: invoice.dueDate.toISOString(),
        totalAmount: Number(invoice.totalAmount),
        lateFineAmount: Number(invoice.lateFineAmount),
        paidAmount: Number(invoice.paidAmount),
      },
      student: {
        studentCode: found.student.studentCode,
        fullName: found.student.fullName,
        className: found.student.currentSection?.schoolClass.name ?? null,
      },
    };
  });
  if (!challanData) throw AppError.notFound('Invoice not found');

  const pdfBuffer = await renderChallanPdf(challanData);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="challan-${challanData.invoice.invoiceNumber}.pdf"`);
  res.send(pdfBuffer);
});

/** Record a payment against an invoice. Idempotent via `idempotencyKey`. */
invoicesRouter.post('/:id/payments', requireRole(...PAYMENT_ROLES), async (req: Request, res: Response) => {
  const input = recordPaymentSchema.parse(req.body);
  const invoiceId = uuidParam(req, 'id');
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const result = await runWithTenant(tenantId, async (tx) => {
    // Idempotency: if this exact key was already used, return the original
    // payment instead of creating a duplicate — safe to retry on network errors.
    const existingPayment = await tx.payment.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } },
    });
    if (existingPayment) {
      const invoice = await tx.invoice.findUnique({
        where: { id: existingPayment.invoiceId },
        include: INVOICE_DETAIL_INCLUDE,
      });
      return { payment: existingPayment, invoice, wasIdempotentReplay: true };
    }

    const found = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!found) throw AppError.notFound('Invoice not found');
    if (found.status === 'CANCELLED') throw AppError.conflict('Cannot pay a cancelled invoice');

    // Sync overdue state/fine right before computing the balance owed, so a
    // payment made the day after an invoice tips overdue is charged against
    // the fine too — not against a stale pre-fine total.
    const policy = await getLateFeePolicy(tx, tenantId);
    const invoice = await syncInvoiceOverdueState(tx, found, policy);

    const remaining = Number(invoice.totalAmount) + Number(invoice.lateFineAmount) - Number(invoice.paidAmount);
    if (input.amount > remaining + 0.01) {
      throw AppError.badRequest(`Payment amount exceeds the remaining balance (${remaining.toFixed(2)})`);
    }

    const payment = await tx.payment.create({
      data: {
        id: randomUUID(),
        tenantId,
        invoiceId,
        studentId: invoice.studentId,
        amount: input.amount,
        method: input.method,
        referenceNumber: input.referenceNumber,
        recordedByUserId: auth.userId,
        idempotencyKey: input.idempotencyKey,
      },
    });

    const newPaidAmount = Number(invoice.paidAmount) + input.amount;
    const totalDue = Number(invoice.totalAmount) + Number(invoice.lateFineAmount);
    // A partial payment on an already-OVERDUE invoice stays OVERDUE (the
    // fine was already assessed and the balance is still late) rather than
    // reverting to PARTIALLY_PAID, which would misleadingly suggest it's
    // back on schedule.
    const newStatus = newPaidAmount >= totalDue ? 'PAID' : invoice.status === 'OVERDUE' ? 'OVERDUE' : 'PARTIALLY_PAID';
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: newPaidAmount, status: newStatus },
      include: INVOICE_DETAIL_INCLUDE,
    });

    return { payment, invoice: updatedInvoice, wasIdempotentReplay: false };
  });

  res.status(result.wasIdempotentReplay ? 200 : 201).json({
    data: { payment: result.payment, invoice: result.invoice },
  });
});

/**
 * One-click full settlement — pays off whatever balance remains (total +
 * late fine - already paid) as a single Payment record, rather than
 * requiring staff to read the remaining balance off the screen and type it
 * into the payments form themselves. Idempotent by invoice status: calling
 * this again on an already-PAID invoice is a no-op that returns it
 * unchanged (no second Payment row, no double-charge) — deliberately not
 * using recordPaymentSchema's client-supplied idempotencyKey scheme, since
 * "is this invoice already PAID" is itself a perfectly good idempotency
 * check here and one less thing the frontend has to generate/track.
 */
invoicesRouter.patch('/:id/mark-paid', requireRole(...PAYMENT_ROLES), async (req: Request, res: Response) => {
  const input = markPaidSchema.parse(req.body ?? {});
  const invoiceId = uuidParam(req, 'id');
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const result = await runWithTenant(tenantId, async (tx) => {
    const found = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!found) throw AppError.notFound('Invoice not found');
    if (found.status === 'CANCELLED') throw AppError.conflict('Cannot pay a cancelled invoice');
    if (found.status === 'PAID') {
      const withRelations = await tx.invoice.findUnique({ where: { id: invoiceId }, include: INVOICE_DETAIL_INCLUDE });
      return { invoice: withRelations!, payment: null, wasNoop: true };
    }

    // Same freshness fix as /:id/payments — a fine assessed today shouldn't
    // be missed just because it wasn't yet reflected on the row we loaded.
    const policy = await getLateFeePolicy(tx, tenantId);
    const invoice = await syncInvoiceOverdueState(tx, found, policy);

    const remaining = Number(invoice.totalAmount) + Number(invoice.lateFineAmount) - Number(invoice.paidAmount);
    if (remaining <= 0.01) {
      // Fully covered already (rounding edge case) — just flip the status,
      // no payment to record.
      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID' },
        include: INVOICE_DETAIL_INCLUDE,
      });
      return { invoice: updated, payment: null, wasNoop: true };
    }

    const payment = await tx.payment.create({
      data: {
        id: randomUUID(),
        tenantId,
        invoiceId,
        studentId: invoice.studentId,
        amount: remaining,
        method: input.method,
        referenceNumber: input.referenceNumber,
        recordedByUserId: auth.userId,
        idempotencyKey: randomUUID(),
      },
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: Number(invoice.paidAmount) + remaining, status: 'PAID' },
      include: INVOICE_DETAIL_INCLUDE,
    });

    return { invoice: updatedInvoice, payment, wasNoop: false };
  });

  res.status(200).json({ data: { invoice: result.invoice, payment: result.payment } });
});

/**
 * Undo a mistaken "mark fully paid" (or any payment that happened to
 * finish the invoice off) — Accountant-only (see PAYMENT_REVERSAL_ROLES),
 * since this is a correction to the books, not a routine collection
 * action. Only deletes the single most recent payment and recomputes
 * paidAmount/status from what's left, rather than wiping the whole
 * history: an invoice that was already PARTIALLY_PAID before that last
 * payment finished it off goes back to PARTIALLY_PAID with its earlier
 * payments intact, not all the way to zero. Refuses anything that isn't
 * currently PAID — there's nothing to "undo" on an invoice that was never
 * marked paid, and CANCELLED invoices are handled by their own flow.
 */
invoicesRouter.patch(
  '/:id/revert-to-unpaid',
  requireRole(...PAYMENT_REVERSAL_ROLES),
  async (req: Request, res: Response) => {
    const invoiceId = uuidParam(req, 'id');
    const tenantId = req.auth!.tenantId!;

    const invoice = await runWithTenant(tenantId, async (tx) => {
      const found = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!found) throw AppError.notFound('Invoice not found');
      if (found.status !== 'PAID') throw AppError.conflict('Only a fully paid invoice can be reverted');

      const lastPayment = await tx.payment.findFirst({
        where: { invoiceId },
        orderBy: { paidAt: 'desc' },
      });

      let newPaidAmount = Number(found.paidAmount);
      if (lastPayment) {
        await tx.payment.delete({ where: { id: lastPayment.id } });
        newPaidAmount = Math.max(0, newPaidAmount - Number(lastPayment.amount));
      } else {
        // No payment on file at all (e.g. data imported already-marked-paid)
        // — nothing to delete, just clear the paid amount.
        newPaidAmount = 0;
      }

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { paidAmount: newPaidAmount, status: newPaidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID' },
        include: INVOICE_DETAIL_INCLUDE,
      });
    });

    res.status(200).json({ data: { invoice } });
  },
);

/** A student's full fee ledger: invoices, payments, and running balance. */
invoicesRouter.get(
  '/students/:studentId/ledger',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const studentId = uuidParam(req, 'studentId');

    const tenantId = req.auth!.tenantId!;
    const ledger = await runWithTenant(tenantId, async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw AppError.notFound('Student not found');

      const found = await tx.invoice.findMany({
        where: { studentId },
        include: { lineItems: true, payments: true },
        orderBy: { issueDate: 'asc' },
      });
      const invoices = await syncMany(tx, tenantId, found);

      const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
      const totalFines = invoices.reduce((sum, inv) => sum + Number(inv.lateFineAmount), 0);
      const totalPaid = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);

      return {
        student: { id: student.id, fullName: student.fullName, studentCode: student.studentCode },
        invoices,
        summary: { totalBilled, totalFines, totalPaid, balance: totalBilled + totalFines - totalPaid },
      };
    });

    res.json({ data: ledger });
  },
);
