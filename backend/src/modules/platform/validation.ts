import { z } from 'zod';

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']).optional(),
  // Was a fixed z.enum(['TRIAL','BASIC','STANDARD','PREMIUM']) — plans are
  // now a DB table (see config/plans.ts), so this just filters by whatever
  // code string is passed; an unknown code simply matches zero tenants.
  plan: z.string().min(1).optional(),
  search: z.string().max(150).optional(),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']),
  reason: z.string().max(300).optional(),
});
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;

export const updateTenantPlanSchema = z.object({
  // Existence (and, for the public signup path, active-ness) is checked
  // against the plans table at the service layer — see platform/tenants.ts.
  plan: z.string().min(1),
});
export type UpdateTenantPlanInput = z.infer<typeof updateTenantPlanSchema>;

// Plan code: an uppercase, underscore-separated slug — deliberately not
// free-form text, since it's a stable machine key other rows reference
// (Tenant.plan) and gets uppercased app-side for consistency with the 4
// pre-existing codes (TRIAL/BASIC/STANDARD/PREMIUM).
const planCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Plan code must start with a letter and contain only letters, digits, and underscores')
  .transform((v) => v.toUpperCase());

export const createPlanSchema = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(1).max(100),
  priceMonthlyPKR: z.coerce.number().int().min(0),
  // Sent as null (unlimited) or a non-negative integer.
  maxStudents: z.coerce.number().int().min(0).nullable(),
  maxStaff: z.coerce.number().int().min(0).nullable(),
  maxSmsCreditsPerMonth: z.coerce.number().int().min(0).nullable(),
  features: z.array(z.string().trim().min(1)).max(50).default([]),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// Same fields as create, minus `code` (immutable after creation — it's the
// stable key Tenant.plan references) — all optional so a PATCH can send
// just the fields that changed.
export const updatePlanSchema = createPlanSchema.omit({ code: true }).partial();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
