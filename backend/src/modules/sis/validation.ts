import { z } from 'zod';

const dateStringSchema = z.coerce.date();

// Pakistani CNIC (and B-Form, which uses the identical 13-digit format for
// minors) — always 5 digits, dash, 7 digits, dash, 1 digit, e.g.
// "35202-1234567-1". Optional at the schema level (many schools admit
// students before the family has the paperwork on file), but if a value
// IS provided it must be shaped like a real CNIC/B-Form rather than
// silently accepting any string, which is what let malformed values into
// the DB before this validation existed.
// `.optional()` alone only accepts `undefined` — an empty string (what
// every uncontrolled/blank text input actually submits, since HTML forms
// don't distinguish "never touched" from "cleared") still has to pass the
// regex and previously got rejected with a confusing 400, blocking the
// exact "admit now, add the CNIC later" flow this field exists for. The
// transform below normalizes "" to undefined *before* validation so both
// count as "not provided".
const cnicSchema = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v))
  .pipe(z.string().regex(/^\d{5}-\d{7}-\d$/, 'Expected CNIC/B-Form format: 35202-1234567-1').optional());

export const createAcademicYearSchema = z
  .object({
    name: z.string().min(4).max(20),
    startDate: dateStringSchema,
    endDate: dateStringSchema,
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

export const updateAcademicYearSchema = z.object({
  name: z.string().min(4).max(20).optional(),
  startDate: dateStringSchema.optional(),
  endDate: dateStringSchema.optional(),
  isActive: z.boolean().optional(),
});

export const createSchoolClassSchema = z.object({
  name: z.string().min(1).max(50),
  order: z.coerce.number().int().min(0).max(100),
});
export type CreateSchoolClassInput = z.infer<typeof createSchoolClassSchema>;

export const updateSchoolClassSchema = createSchoolClassSchema.partial();

export const createSectionSchema = z.object({
  schoolClassId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  name: z.string().min(1).max(20),
  classTeacherId: z.string().uuid().optional(),
  roomNumber: z.string().max(30).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
});
export type CreateSectionInput = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = createSectionSchema.partial().omit({
  schoolClassId: true,
  academicYearId: true,
});

export const createStudentSchema = z.object({
  fullName: z.string().min(2).max(150),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dateOfBirth: dateStringSchema,
  admissionDate: dateStringSchema.optional(),
  bFormOrCnic: cnicSchema,
  address: z.string().max(255).optional(),
  emergencyContact: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  contactPhone: z.string().min(7).max(30).optional(),
  // Class-register display number — unique only within [currentSectionId,
  // rollNumber] (enforced at the DB level), not tenant-wide, so "Roll No.
  // 5" can exist in every section at once. Only meaningful once a
  // sectionId is also provided (or set later via the same PATCH once
  // enrolled) — a student with no section has nothing to number.
  rollNumber: z.string().max(20).optional(),
  sectionId: z.string().uuid().optional(), // if provided, enrolls immediately
  academicYearId: z.string().uuid().optional(), // required if sectionId is provided
  // Optional — the student has no dedicated email column of their own (see
  // the Student model). Every admission now gets a STUDENT portal login
  // regardless (an ID-based one, built from the studentCode — see
  // createStudentLogin's doc comment), since a school kid may have no
  // email/mobile of their own; this field, when supplied, is wired up as
  // an ALSO-valid login and used to email the credentials out too, the
  // way a university emails a new student their portal ID and password.
  email: z.string().email().max(255).optional(),
  // Uploaded up front via POST /api/uploads/image (which doesn't need the
  // student to exist yet — it just returns a public URL for whatever file
  // was picked), then passed here so the photo is on the record from
  // admission instead of requiring a separate edit right afterward.
  photoUrl: z.string().url().max(500).optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = z.object({
  fullName: z.string().min(2).max(150).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: dateStringSchema.optional(),
  bFormOrCnic: cnicSchema,
  address: z.string().max(255).optional(),
  emergencyContact: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  contactPhone: z.string().min(7).max(30).optional(),
  rollNumber: z.string().max(20).optional(),
  photoUrl: z.string().url().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED_OUT', 'EXPELLED']).optional(),
  // Edits the student's portal LOGIN email (the `User` row linked via
  // Student.userId) — the Student model has no email column of its own
  // (see createStudentSchema's `email` doc comment). Only meaningful for a
  // student who already has a portal login; the route below 400s otherwise
  // rather than silently doing nothing.
  email: z.string().email().max(255).optional(),
});

// One row of a bulk-import CSV. Mirrors createStudentSchema but swaps the
// section/academic-year UUIDs (which nobody preparing a spreadsheet at home
// would have on hand) for human-readable className/sectionName strings that
// get resolved to IDs per-row against the tenant's own classes/sections —
// see bulkImportStudents() in students.ts. academicYearId is likewise
// replaced by an implicit "use the currently active academic year" default,
// since that's what a front-desk admin importing this year's admissions
// almost always means.
export const bulkImportStudentRowSchema = z.object({
  fullName: z.string().min(2, 'fullName is required').max(150),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER'], { message: 'gender must be MALE, FEMALE, or OTHER' }),
  dateOfBirth: dateStringSchema,
  admissionDate: dateStringSchema.optional(),
  bFormOrCnic: cnicSchema,
  address: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  contactPhone: z.string().min(7).max(30).optional(),
  rollNumber: z.string().max(20).optional(),
  // Both required together — a student can only be placed in a section by
  // naming both its class and its section letter/name (e.g. "Class 5" +
  // "A"). Omit both to import the student unenrolled (added to the roster
  // but not yet placed in a class), same as createStudentSchema without a
  // sectionId.
  className: z.string().min(1).max(50).optional(),
  sectionName: z.string().min(1).max(20).optional(),
  email: z.string().email().max(255).optional(),
});
export type BulkImportStudentRow = z.infer<typeof bulkImportStudentRowSchema>;

export const listStudentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(150).optional(),
  sectionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED_OUT', 'EXPELLED']).optional(),
});

export const enrollStudentSchema = z.object({
  sectionId: z.string().uuid(),
  academicYearId: z.string().uuid(),
});

// Bulk "move to next class" — promotes every active student currently in
// one section into a target section (typically the next class, next
// academic year) in one call, rather than the front desk calling /enroll
// once per student at year-end.
export const promoteSectionSchema = z.object({
  targetSectionId: z.string().uuid(),
  targetAcademicYearId: z.string().uuid(),
  // Defaults to every currently-ACTIVE student in the source section;
  // pass a subset to hold some students back (repeaters) while promoting
  // the rest in the same call.
  studentIds: z.array(z.string().uuid()).optional(),
});
export type PromoteSectionInput = z.infer<typeof promoteSectionSchema>;

export const createTransferCertificateSchema = z.object({
  issueDate: dateStringSchema.optional(),
  lastAttendanceDate: dateStringSchema.optional(),
  reason: z.enum(['PARENT_REQUEST', 'RELOCATION', 'ACADEMIC', 'DISCIPLINARY', 'GRADUATED', 'OTHER']),
  conduct: z.string().max(50).optional(),
  remarks: z.string().max(500).optional(),
});
export type CreateTransferCertificateInput = z.infer<typeof createTransferCertificateSchema>;

export const createGuardianSchema = z.object({
  fullName: z.string().min(2).max(150),
  relationship: z.enum(['FATHER', 'MOTHER', 'GUARDIAN']),
  cnic: cnicSchema,
  phone: z.string().min(7).max(30),
  email: z.string().email().max(255).optional(),
  occupation: z.string().max(150).optional(),
  studentId: z.string().uuid().optional(), // if provided, links immediately
  isPrimary: z.boolean().optional(),
});
export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;

export const updateGuardianSchema = createGuardianSchema
  .omit({ studentId: true, isPrimary: true })
  .partial();

export const linkGuardianSchema = z.object({
  guardianId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

export const listGuardiansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(150).optional(),
});

const leaveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const createStudentLeaveRequestSchema = z
  .object({
    studentId: z.string().uuid(),
    fromDate: leaveDateSchema,
    toDate: leaveDateSchema,
    reason: z.string().min(2).max(1000),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'toDate must be on or after fromDate', path: ['toDate'] });
export type CreateStudentLeaveRequestInput = z.infer<typeof createStudentLeaveRequestSchema>;

export const reviewStudentLeaveRequestSchema = z.object({
  reviewNote: z.string().max(1000).optional(),
});

export const listStudentLeaveRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  studentId: z.string().uuid().optional(),
});
