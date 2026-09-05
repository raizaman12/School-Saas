import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const createFeeCategorySchema = z.object({
  name: z.string().trim().min(1, 'Required').max(100),
});

export const createFeeStructureItemSchema = z.object({
  academicYearId: z.string().uuid(),
  schoolClassId: z.string().uuid(),
  feeCategoryId: z.string().uuid(),
  amount: z.coerce.number().positive().max(10_000_000),
  frequency: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL']),
});
export type CreateFeeStructureItemInput = z.infer<typeof createFeeStructureItemSchema>;

export const bulkGenerateInvoicesSchema = z.object({
  sectionId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  period: z.string().min(1).max(30),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  feeCategoryIds: z.array(z.string().uuid()).optional(),
});
export type BulkGenerateInvoicesInput = z.infer<typeof bulkGenerateInvoicesSchema>;

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'ONLINE', 'CHEQUE']),
  referenceNumber: z.string().max(100).optional(),
  idempotencyKey: z.string().min(8).max(100),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/**
 * One-click "mark fully paid" — unlike recordPaymentSchema, no `amount` is
 * taken from the caller at all; the route computes it server-side as
 * whatever balance remains, so staff never has to type/verify the exact
 * figure themselves. No idempotencyKey either: the route's own idempotency
 * comes from checking the invoice's current status instead (see
 * invoices.ts's mark-paid handler doc comment).
 */
export const markPaidSchema = z.object({
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'ONLINE', 'CHEQUE']).default('CASH'),
  referenceNumber: z.string().max(100).optional(),
});
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const upsertLateFeePolicySchema = z
  .object({
    graceDays: z.coerce.number().int().min(0).max(365).default(0),
    fineType: z.enum(['FIXED', 'PERCENTAGE']),
    // FIXED: flat Rupees. PERCENTAGE: 0-100, applied to Invoice.totalAmount.
    fineValue: z.coerce.number().positive().max(1_000_000),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.fineType !== 'PERCENTAGE' || v.fineValue <= 100, {
    message: 'fineValue must be between 0 and 100 when fineType is PERCENTAGE',
    path: ['fineValue'],
  });
export type UpsertLateFeePolicyInput = z.infer<typeof upsertLateFeePolicySchema>;

export const defaultersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  academicYearId: z.string().uuid().optional(),
  schoolClassId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
});
export type DefaultersQueryInput = z.infer<typeof defaultersQuerySchema>;
