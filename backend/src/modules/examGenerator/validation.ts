import { z } from 'zod';

export const createAccessGrantSchema = z.object({
  schoolClassId: z.string().uuid(),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid(),
});
export type CreateAccessGrantInput = z.infer<typeof createAccessGrantSchema>;

const questionTypeSchema = z.enum(['MCQ', 'SHORT_ANSWER', 'LONG_ANSWER']);

/**
 * MCQ requires 2-6 `options` and a `correctOptionIndex` within range;
 * SHORT_ANSWER/LONG_ANSWER require a `marks` value instead (MCQ's `marks`
 * is forced to 1 server-side regardless of what's posted here — see
 * questionBank.ts). Same cross-field `.refine()` idiom as
 * customFields/validation.ts's createCustomFieldDefinitionSchema.
 */
export const createQuestionSchema = z
  .object({
    schoolClassId: z.string().uuid(),
    subjectId: z.string().uuid(),
    type: questionTypeSchema,
    questionText: z.string().min(1).max(2000),
    chapter: z.string().max(150).optional(),
    marks: z.coerce.number().int().min(1).max(100).optional(),
    options: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
    correctOptionIndex: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => v.type !== 'MCQ' || (v.options && v.options.length >= 2), {
    message: 'MCQ questions require 2-6 options',
    path: ['options'],
  })
  .refine(
    (v) =>
      v.type !== 'MCQ' ||
      (v.correctOptionIndex !== undefined && v.options !== undefined && v.correctOptionIndex < v.options.length),
    {
      message: 'correctOptionIndex must point to one of the provided options',
      path: ['correctOptionIndex'],
    },
  )
  .refine((v) => v.type === 'MCQ' || v.marks !== undefined, {
    message: 'marks is required for Short Answer / Long Answer questions',
    path: ['marks'],
  });
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

// Editing a question never changes `type` — same reasoning as
// customFields/validation.ts's updateCustomFieldDefinitionSchema not
// allowing fieldType to change: a paper may already have been generated
// off a question, and this route only touches the bank copy, not any
// GeneratedExamQuestion snapshot, so type-safety of the two model shapes
// (MCQ vs Short/Long fields) is preserved by simply disallowing the switch.
export const updateQuestionSchema = z.object({
  questionText: z.string().min(1).max(2000).optional(),
  chapter: z.string().max(150).nullable().optional(),
  marks: z.coerce.number().int().min(1).max(100).optional(),
  options: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
  correctOptionIndex: z.coerce.number().int().min(0).optional(),
});
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const generateExamPaperSchema = z
  .object({
    schoolClassId: z.string().uuid(),
    subjectId: z.string().uuid(),
    chapters: z.array(z.string().min(1).max(150)).max(50).optional(),
    mcqCount: z.coerce.number().int().min(0).max(200).default(0),
    shortCount: z.coerce.number().int().min(0).max(200).default(0),
    longCount: z.coerce.number().int().min(0).max(200).default(0),
  })
  .refine((v) => v.mcqCount + v.shortCount + v.longCount > 0, {
    message: 'Request at least one question',
    path: ['mcqCount'],
  });
export type GenerateExamPaperInput = z.infer<typeof generateExamPaperSchema>;
