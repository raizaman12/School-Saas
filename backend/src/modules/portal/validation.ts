import { z } from 'zod';

export const createGuardianLoginSchema = z.object({
  email: z.string().email().optional(), // falls back to the guardian's own email if present
});

export const createStudentLoginSchema = z.object({
  // Optional — a student now always gets an ID-based login
  // (Student.studentCode, dashes/case ignored — see lib/loginId.ts and
  // createStudentLogin's doc comment); email is purely an optional extra
  // to also receive the credentials by mail when one happens to exist.
  email: z.string().email().max(255).optional(),
});

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const portalAttendanceQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const portalNoticesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Default (false): a fully-PAID invoice drops out of the parent/student's
// fee list entirely — once settled there's nothing left to act on, and
// a growing pile of old paid challans just buries the ones still owed.
// ?includePaid=true asks for the full history back (e.g. a "view past
// payments" link) — the summary totals are unaffected either way, they're
// always computed from every invoice regardless of this filter.
export const portalFeesQuerySchema = z.object({
  includePaid: z.coerce.boolean().default(false),
});
