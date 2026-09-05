import { z } from 'zod';

const dateStringSchema = z.coerce.date();

// Mirrors the DisciplineCategory/Severity/Action enums in schema.prisma —
// see that file's doc comment for why these are shaped around what a
// Pakistani school's conduct register actually needs, not a generic/US
// behavior-code taxonomy.
const disciplineCategorySchema = z.enum([
  'UNIFORM_VIOLATION',
  'LATE_ARRIVAL',
  'MISSED_HOMEWORK',
  'DISRUPTIVE_BEHAVIOR',
  'DISRESPECT_TO_STAFF',
  'BULLYING',
  'FIGHTING',
  'CHEATING',
  'PROPERTY_DAMAGE',
  'UNAUTHORIZED_ABSENCE',
  'MOBILE_PHONE_VIOLATION',
  'OTHER',
]);

const disciplineSeveritySchema = z.enum(['MINOR', 'MODERATE', 'MAJOR']);

const disciplineActionSchema = z.enum([
  'NONE',
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'DETENTION',
  'PARENT_CALLED',
  'PARENT_MEETING_REQUIRED',
  'SUSPENSION',
  'REFERRED_TO_PRINCIPAL',
]);

export const createDisciplineRecordSchema = z.object({
  studentId: z.string().uuid(),
  incidentDate: dateStringSchema,
  category: disciplineCategorySchema,
  severity: disciplineSeveritySchema,
  description: z.string().min(2, 'Required').max(2000),
  actionTaken: disciplineActionSchema.optional(),
  actionNotes: z.string().max(1000).optional(),
  // Set directly when the reporter already informed the guardian
  // themselves (e.g. a phone call made before logging this).
  guardianNotified: z.boolean().optional(),
  // Convenience: also dispatch a real notification (SMS/WhatsApp — see
  // discipline.ts) to the student's guardian(s) right now, and set
  // guardianNotified/guardianNotifiedAt automatically if it succeeds.
  // Independent of the guardianNotified flag above, which just records a
  // fact; this one triggers an action.
  notifyGuardianNow: z.boolean().optional(),
});
export type CreateDisciplineRecordInput = z.infer<typeof createDisciplineRecordSchema>;

export const updateDisciplineRecordSchema = z.object({
  incidentDate: dateStringSchema.optional(),
  category: disciplineCategorySchema.optional(),
  severity: disciplineSeveritySchema.optional(),
  description: z.string().min(2).max(2000).optional(),
  actionTaken: disciplineActionSchema.optional(),
  actionNotes: z.string().max(1000).optional(),
  guardianNotified: z.boolean().optional(),
  resolved: z.boolean().optional(),
  resolvedNote: z.string().max(1000).optional(),
});

export const listDisciplineRecordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  category: disciplineCategorySchema.optional(),
  severity: disciplineSeveritySchema.optional(),
  resolved: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});
