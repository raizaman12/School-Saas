import { z } from 'zod';

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']).optional(),
  plan: z.enum(['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM']).optional(),
  search: z.string().max(150).optional(),
});

export const updateTenantStatusSchema = z.object({
  status: z.enum(['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED']),
  reason: z.string().max(300).optional(),
});
export type UpdateTenantStatusInput = z.infer<typeof updateTenantStatusSchema>;

export const updateTenantPlanSchema = z.object({
  plan: z.enum(['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM']),
});
export type UpdateTenantPlanInput = z.infer<typeof updateTenantPlanSchema>;
