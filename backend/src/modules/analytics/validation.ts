import { z } from 'zod';

// Every trend endpoint takes the same "how many trailing months" window —
// capped at 24 (2 years) since this is meant for a quick trend chart, not
// a full historical export.
export const trendQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;

export const examPerformanceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(6),
});
export type ExamPerformanceQuery = z.infer<typeof examPerformanceQuerySchema>;
