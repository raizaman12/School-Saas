import { z } from 'zod';

const dateStringSchema = z.coerce.date();

const bloodGroupSchema = z.enum([
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
  'UNKNOWN',
]);

const healthLogOutcomeSchema = z.enum([
  'RETURNED_TO_CLASS',
  'SENT_HOME',
  'TAKEN_TO_HOSPITAL',
  'PARENT_CALLED_TO_COLLECT',
]);

// Every field is optional — a school may know the blood group but not the
// family doctor's number, or vice versa. This is a create-or-update
// (upsert) payload, not a strict "all fields required" form.
export const upsertHealthProfileSchema = z.object({
  bloodGroup: bloodGroupSchema.optional(),
  allergies: z.string().max(1000).optional(),
  chronicConditions: z.string().max(1000).optional(),
  currentMedications: z.string().max(1000).optional(),
  emergencyMedicalNotes: z.string().max(2000).optional(),
  emergencyContactName: z.string().max(150).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  doctorName: z.string().max(150).optional(),
  doctorPhone: z.string().max(30).optional(),
});
export type UpsertHealthProfileInput = z.infer<typeof upsertHealthProfileSchema>;

export const createHealthLogEntrySchema = z.object({
  studentId: z.string().uuid(),
  visitDate: dateStringSchema,
  complaint: z.string().min(2, 'Required').max(1000),
  actionTaken: z.string().min(2, 'Required').max(1000),
  outcome: healthLogOutcomeSchema.optional(),
  guardianNotified: z.boolean().optional(),
  // Same convenience pattern as discipline.ts's notifyGuardianNow — send a
  // real SMS/WhatsApp to the guardian(s) right now instead of the staff
  // member separately going to the Notifications tab.
  notifyGuardianNow: z.boolean().optional(),
});
export type CreateHealthLogEntryInput = z.infer<typeof createHealthLogEntrySchema>;

export const updateHealthLogEntrySchema = z.object({
  visitDate: dateStringSchema.optional(),
  complaint: z.string().min(2).max(1000).optional(),
  actionTaken: z.string().min(2).max(1000).optional(),
  outcome: healthLogOutcomeSchema.optional(),
  guardianNotified: z.boolean().optional(),
});
export type UpdateHealthLogEntryInput = z.infer<typeof updateHealthLogEntrySchema>;

export const listHealthLogEntriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().uuid().optional(),
  outcome: healthLogOutcomeSchema.optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});
export type ListHealthLogEntriesQuery = z.infer<typeof listHealthLogEntriesQuerySchema>;
