import { z } from 'zod';

export const noticeAudienceSchema = z.enum(['ALL_STAFF', 'ALL_GUARDIANS', 'ALL_STUDENTS', 'SECTION', 'INDIVIDUAL']);
export const noticeToneSchema = z.enum(['GENERAL', 'IMPORTANT', 'URGENT', 'EVENT', 'HOLIDAY']);

// Entity-oriented (not raw userIds) so the admin-facing UI stays "pick named
// students/guardians/staff" — the backend resolves each to a concrete
// User.id and can give a clean, specific validation error per entity
// (e.g. "this student doesn't have a portal login yet") rather than a
// generic "invalid userId".
export const createNoticeSchema = z
  .object({
    title: z.string().min(2).max(200),
    body: z.string().min(2).max(5000),
    // One or more audiences at once — e.g. ["ALL_STUDENTS", "ALL_GUARDIANS"]
    // to reach both in a single notice, or ["SECTION", "INDIVIDUAL"] to
    // combine a whole section with a couple of named add-ons.
    audiences: z
      .array(noticeAudienceSchema)
      .min(1, 'Choose at least one audience')
      .max(5)
      .transform((arr) => Array.from(new Set(arr))),
    tone: noticeToneSchema.default('GENERAL'),
    sectionId: z.string().uuid().optional(),
    recipientStudentIds: z.array(z.string().uuid()).max(200).optional(),
    recipientGuardianIds: z.array(z.string().uuid()).max(200).optional(),
    recipientStaffUserIds: z.array(z.string().uuid()).max(200).optional(),
    isPinned: z.boolean().default(false),
  })
  .refine((v) => (v.audiences.includes('SECTION') ? !!v.sectionId : true), {
    message: 'sectionId is required when audiences includes SECTION',
    path: ['sectionId'],
  })
  .refine((v) => (!v.audiences.includes('SECTION') ? !v.sectionId : true), {
    message: 'sectionId must be omitted unless audiences includes SECTION',
    path: ['sectionId'],
  })
  .refine(
    (v) =>
      v.audiences.includes('INDIVIDUAL')
        ? (v.recipientStudentIds?.length ?? 0) +
            (v.recipientGuardianIds?.length ?? 0) +
            (v.recipientStaffUserIds?.length ?? 0) >
          0
        : true,
    {
      message:
        'At least one recipient (student, guardian, or staff member) is required when audiences includes INDIVIDUAL',
      path: ['recipientStudentIds'],
    },
  )
  .refine(
    (v) =>
      !v.audiences.includes('INDIVIDUAL')
        ? !v.recipientStudentIds?.length && !v.recipientGuardianIds?.length && !v.recipientStaffUserIds?.length
        : true,
    {
      message: 'Recipients must be omitted unless audiences includes INDIVIDUAL',
      path: ['recipientStudentIds'],
    },
  );
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

export const updateNoticeSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  body: z.string().min(2).max(5000).optional(),
  isPinned: z.boolean().optional(),
  tone: noticeToneSchema.optional(),
});
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;

export const listNoticesQuerySchema = z.object({
  audience: noticeAudienceSchema.optional(),
  sectionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
