import { z } from 'zod';

export const createSubjectSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().max(20).optional(),
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = createSubjectSchema.partial();

export const createSectionSubjectSchema = z.object({
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid().optional(),
  isElective: z.boolean().optional(),
});
export type CreateSectionSubjectInput = z.infer<typeof createSectionSubjectSchema>;

export const updateSectionSubjectSchema = z.object({
  teacherId: z.string().uuid().nullable().optional(),
  isElective: z.boolean().optional(),
});

// Bulk-set the roster of students (from the section) taking one elective
// subject — replaces the whole list each time, same "save the whole
// section at once" shape the frontend already uses elsewhere.
export const setElectiveStudentsSchema = z.object({
  studentIds: z.array(z.string().uuid()).max(500),
});
export type SetElectiveStudentsInput = z.infer<typeof setElectiveStudentsSchema>;

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected time in HH:MM (24h) format')
  .transform((val) => new Date(`1970-01-01T${val}:00.000Z`));

export const dayOfWeekSchema = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);

export const createTimetableSlotSchema = z
  .object({
    sectionSubjectId: z.string().uuid(),
    dayOfWeek: dayOfWeekSchema,
    startTime: timeStringSchema,
    endTime: timeStringSchema,
    roomNumber: z.string().max(30).optional(),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });
export type CreateTimetableSlotInput = z.infer<typeof createTimetableSlotSchema>;

export const updateTimetableSlotSchema = z
  .object({
    sectionSubjectId: z.string().uuid().optional(),
    dayOfWeek: dayOfWeekSchema.optional(),
    startTime: timeStringSchema.optional(),
    endTime: timeStringSchema.optional(),
    roomNumber: z.string().max(30).nullable().optional(),
  })
  .refine((v) => !(v.startTime && v.endTime) || v.endTime > v.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  });
export type UpdateTimetableSlotInput = z.infer<typeof updateTimetableSlotSchema>;

export const listTimetableQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
});

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const createHomeworkSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  dueDate: dateOnlySchema,
  // Uploaded up front via POST /api/uploads/document (see courseMaterials.ts
  // for the same pattern) — optional, most homework is text-only.
  attachmentUrl: z.string().url().max(500).optional(),
});
export type CreateHomeworkInput = z.infer<typeof createHomeworkSchema>;

export const updateHomeworkSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(2000).optional(),
  dueDate: dateOnlySchema.optional(),
  attachmentUrl: z.string().url().max(500).optional(),
});

export const listHomeworkQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createCourseMaterialSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  title: z.string().min(2).max(200),
  // Uploaded up front via POST /api/uploads/document, which returns the
  // public URL passed here — see that route's doc comment.
  fileUrl: z.string().url().max(500),
});
export type CreateCourseMaterialInput = z.infer<typeof createCourseMaterialSchema>;

export const listCourseMaterialQuerySchema = z.object({
  sectionSubjectId: z.string().uuid().optional(),
});
