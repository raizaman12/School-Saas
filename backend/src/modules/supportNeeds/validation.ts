import { z } from 'zod';

const dateStringSchema = z.coerce.date();

// Mirrors the SupportNeedCategory/Status enums in schema.prisma — see that
// file's doc comment for why these describe "the school identified this
// need and is providing this support" rather than a clinical diagnosis.
const supportNeedCategorySchema = z.enum([
  'LEARNING_SUPPORT',
  'ATTENTION_FOCUS_SUPPORT',
  'SPEECH_LANGUAGE_SUPPORT',
  'HEARING_SUPPORT',
  'VISION_SUPPORT',
  'MOBILITY_PHYSICAL_SUPPORT',
  'SOCIAL_EMOTIONAL_SUPPORT',
  'AUTISM_SPECTRUM_SUPPORT',
  'INTELLECTUAL_DEVELOPMENTAL_SUPPORT',
  'GIFTED_TALENTED_SUPPORT',
  'OTHER',
]);

const supportNeedStatusSchema = z.enum(['ACTIVE', 'UNDER_REVIEW', 'RESOLVED', 'DISCONTINUED']);

export const createSupportNeedSchema = z.object({
  studentId: z.string().uuid(),
  category: supportNeedCategorySchema,
  description: z.string().min(2, 'Required').max(2000),
  identifiedDate: dateStringSchema,
  supportProvided: z.string().min(2, 'Required').max(2000),
  examAccommodations: z.string().max(1000).optional(),
  coordinatorUserId: z.string().uuid().optional(),
  nextReviewDate: dateStringSchema.optional(),
});
export type CreateSupportNeedInput = z.infer<typeof createSupportNeedSchema>;

export const updateSupportNeedSchema = z.object({
  category: supportNeedCategorySchema.optional(),
  description: z.string().min(2).max(2000).optional(),
  status: supportNeedStatusSchema.optional(),
  supportProvided: z.string().min(2).max(2000).optional(),
  examAccommodations: z.string().max(1000).optional(),
  coordinatorUserId: z.string().uuid().optional(),
  nextReviewDate: dateStringSchema.optional(),
});

export const listSupportNeedsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  category: supportNeedCategorySchema.optional(),
  status: supportNeedStatusSchema.optional(),
});

export const createSupportNeedReviewSchema = z.object({
  reviewDate: dateStringSchema,
  notes: z.string().min(2, 'Required').max(2000),
  updatedStatus: supportNeedStatusSchema.optional(),
});
