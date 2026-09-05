import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .optional();

// Same YYYY-MM-DD parsing as dateOnlySchema above, but required — used by
// the datesheet builder below, where "when is this paper" is the entire
// point of the screen rather than an optional extra.
const requiredDateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

// Mirrors academics/validation.ts's own timeStringSchema (HH:MM 24h,
// stored at the Prisma @db.Time epoch date) — not imported from there since
// exam papers and timetable lectures are unrelated concepts that just
// happen to both need a wall-clock time.
const examTimeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected time in HH:MM (24h) format')
  .transform((val) => new Date(`1970-01-01T${val}:00.000Z`));

export const createExamSchema = z.object({
  academicYearId: z.string().uuid(),
  name: z.string().min(1).max(100),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
});
export type CreateExamInput = z.infer<typeof createExamSchema>;

// Admin-only follow-up edit — currently just the marks-submission deadline.
// `null` explicitly clears a previously-set deadline (distinct from
// `undefined`, which leaves it untouched) — z.coerce isn't used here since
// an empty string from a cleared date input should mean "no deadline", not
// "invalid date".
export const updateExamSchema = z.object({
  resultsDeadline: z
    .union([dateOnlySchema, z.null()])
    .optional(),
});
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const createExamSubjectSchema = z
  .object({
    sectionSubjectId: z.string().uuid(),
    maxMarks: z.coerce.number().int().min(1).max(1000),
    passingMarks: z.coerce.number().int().min(0).max(1000),
    // Optional here (this single-subject route predates the datesheet
    // builder below) — a subject can still be added without a date/time
    // and filled in later via the bulk datesheet screen.
    examDate: dateOnlySchema,
    startTime: examTimeStringSchema.optional(),
  })
  .refine((v) => v.passingMarks <= v.maxMarks, {
    message: 'passingMarks cannot exceed maxMarks',
    path: ['passingMarks'],
  });
export type CreateExamSubjectInput = z.infer<typeof createExamSubjectSchema>;

/**
 * Builds (or edits) a whole class's exam datesheet in one call — every
 * subject that section is examined in, each with its own paper date/time
 * and max/passing marks — instead of an admin adding one sectionSubject to
 * the exam at a time with no date at all. Upserted per-subject on the
 * backend (see exams.ts's /:examId/subjects/bulk handler), so re-running
 * this with adjusted dates is how an admin edits an already-built
 * datesheet too, not just how they create one the first time.
 */
export const bulkSetDatesheetSchema = z.object({
  sectionId: z.string().uuid(),
  subjects: z
    .array(
      z
        .object({
          sectionSubjectId: z.string().uuid(),
          examDate: requiredDateOnlySchema,
          startTime: examTimeStringSchema.optional(),
          maxMarks: z.coerce.number().int().min(1).max(1000),
          passingMarks: z.coerce.number().int().min(0).max(1000),
        })
        .refine((v) => v.passingMarks <= v.maxMarks, {
          message: 'passingMarks cannot exceed maxMarks',
          path: ['passingMarks'],
        }),
    )
    .min(1)
    .max(50),
});
export type BulkSetDatesheetInput = z.infer<typeof bulkSetDatesheetSchema>;

// A School Admin replaces the *entire* band set in one call rather than
// editing individual bands — grading scales are small (5-8 rows) and
// almost always edited as a whole ("switch to a 7-band O-Level scale"),
// so partial CRUD would just add API surface without a real use case.
export const replaceGradingBandsSchema = z.object({
  bands: z
    .array(
      z.object({
        grade: z.string().min(1).max(10),
        minPercentage: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(20)
    .refine((bands) => new Set(bands.map((b) => b.grade)).size === bands.length, {
      message: 'Grade names must be unique',
    }),
});
export type ReplaceGradingBandsInput = z.infer<typeof replaceGradingBandsSchema>;

export const createReportCardBatchSchema = z.object({
  classId: z.string().uuid(),
  // Optional narrowing to one section — omitted/undefined means "every
  // section of this class" (the original behavior, unchanged).
  sectionId: z.string().uuid().optional(),
});
export type CreateReportCardBatchInput = z.infer<typeof createReportCardBatchSchema>;

export const enterMarksSchema = z.object({
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marksObtained: z.coerce.number().min(0).nullable(),
        remarks: z.string().max(255).optional(),
      }),
    )
    .min(1)
    .max(300),
});
export type EnterMarksInput = z.infer<typeof enterMarksSchema>;

/**
 * A teacher's own quick in-class test (quiz, class test, etc.) — deliberately
 * separate from Exam/ExamSubject: a teacher creates one directly from their
 * subject's Grades tab, with no admin involvement, and its marks never feed
 * into computeSectionExamResults/buildReportCard (see classTests.ts's doc
 * comment). sectionSubjectId is required at creation (unlike
 * createExamSubjectSchema, where the exam already fixes which subjects
 * exist) since a class test has no parent "exam" to hang off of.
 */
export const createClassTestSchema = z
  .object({
    sectionSubjectId: z.string().uuid(),
    name: z.string().min(1).max(100),
    maxMarks: z.coerce.number().int().min(1).max(1000),
    passingMarks: z.coerce.number().int().min(0).max(1000),
  })
  .refine((v) => v.passingMarks <= v.maxMarks, {
    message: 'passingMarks cannot exceed maxMarks',
    path: ['passingMarks'],
  });
export type CreateClassTestInput = z.infer<typeof createClassTestSchema>;

// Same shape as enterMarksSchema — a separate export so the two features
// (formal exam marks vs. a teacher's own class tests) can evolve
// independently even though today they're identical.
export const enterClassTestMarksSchema = enterMarksSchema;
export type EnterClassTestMarksInput = z.infer<typeof enterClassTestMarksSchema>;
