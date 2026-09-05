import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { generateExamPaperSchema } from './validation';
import { renderExamPaperPdf, type ExamPaperPdfData } from './examPaperPdf';

export const generatedPapersRouter = Router();
generatedPapersRouter.use(requireAuth);

const ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

/**
 * Throws 403 unless the caller may generate papers for this (Class,
 * Subject). SCHOOL_ADMIN always passes — no grant row needed at all.
 * A TEACHER needs a matching ExamPaperAccessGrant.
 */
async function assertGenerateAccess(
  tx: Prisma.TransactionClient,
  auth: { role: string; userId: string },
  schoolClassId: string,
  subjectId: string,
) {
  if (auth.role === 'SCHOOL_ADMIN') return;
  const grant = await tx.examPaperAccessGrant.findUnique({
    where: { schoolClassId_subjectId_teacherId: { schoolClassId, subjectId, teacherId: auth.userId } },
  });
  if (!grant) {
    throw AppError.forbidden('You have not been granted access to generate papers for this class/subject');
  }
}

/** In-process Fisher–Yates shuffle + slice — no AI/LLM involved, per the explicit requirement. */
function pickRandom<T>(items: T[], count: number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

type BankQuestion = Awaited<ReturnType<Prisma.TransactionClient['questionBankQuestion']['findMany']>>[number];

async function pickQuestionsOfType(
  tx: Prisma.TransactionClient,
  schoolClassId: string,
  subjectId: string,
  chapters: string[] | undefined,
  type: 'MCQ' | 'SHORT_ANSWER' | 'LONG_ANSWER',
  count: number,
): Promise<BankQuestion[]> {
  if (count === 0) return [];
  const pool = await tx.questionBankQuestion.findMany({
    where: {
      schoolClassId,
      subjectId,
      type,
      ...(chapters && chapters.length > 0 ? { chapter: { in: chapters } } : {}),
    },
  });
  if (pool.length < count) {
    throw AppError.badRequest(
      `Not enough ${type.replace('_', ' ').toLowerCase()} questions in the bank for this selection`,
      { type, requested: count, available: pool.length },
    );
  }
  return pickRandom(pool, count);
}

/** Randomly assembles an immutable exam paper from the question bank — no AI/LLM involved. */
generatedPapersRouter.post('/generate', requireRole(...ROLES), async (req: Request, res: Response) => {
  const input = generateExamPaperSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;
  const auth = req.auth!;

  const paper = await runWithTenant(tenantId, async (tx) => {
    const [schoolClass, subject] = await Promise.all([
      tx.schoolClass.findUnique({ where: { id: input.schoolClassId } }),
      tx.subject.findUnique({ where: { id: input.subjectId } }),
    ]);
    if (!schoolClass) throw AppError.badRequest('Unknown schoolClassId');
    if (!subject) throw AppError.badRequest('Unknown subjectId');

    await assertGenerateAccess(tx, auth, input.schoolClassId, input.subjectId);

    const [mcqs, shorts, longs] = await Promise.all([
      pickQuestionsOfType(tx, input.schoolClassId, input.subjectId, input.chapters, 'MCQ', input.mcqCount),
      pickQuestionsOfType(
        tx,
        input.schoolClassId,
        input.subjectId,
        input.chapters,
        'SHORT_ANSWER',
        input.shortCount,
      ),
      pickQuestionsOfType(tx, input.schoolClassId, input.subjectId, input.chapters, 'LONG_ANSWER', input.longCount),
    ]);

    const ordered = [...mcqs, ...shorts, ...longs];
    const totalMarks = ordered.reduce((sum, q) => sum + q.marks, 0);

    return tx.generatedExamPaper.create({
      data: {
        id: randomUUID(),
        tenantId,
        schoolClassId: input.schoolClassId,
        subjectId: input.subjectId,
        chapters: input.chapters ?? [],
        mcqCount: input.mcqCount,
        shortCount: input.shortCount,
        longCount: input.longCount,
        totalMarks,
        generatedByUserId: auth.userId,
        questions: {
          create: ordered.map((q, i) => ({
            id: randomUUID(),
            tenantId,
            sourceQuestionId: q.id,
            type: q.type,
            questionText: q.questionText,
            chapter: q.chapter,
            marks: q.marks,
            options: q.options ?? undefined,
            correctOptionIndex: q.correctOptionIndex,
            order: i,
          })),
        },
      },
      include: {
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        questions: { orderBy: { order: 'asc' } },
      },
    });
  });

  // Includes correctOptionIndex — this response is the generating
  // teacher's own reference copy, never what's printed on the PDF.
  res.status(201).json({ data: paper });
});

/** History list — every paper previously generated for a class/subject the caller may access. */
generatedPapersRouter.get('/', requireRole(...ROLES), async (req: Request, res: Response) => {
  const schoolClassId = req.query.schoolClassId as string | undefined;
  const subjectId = req.query.subjectId as string | undefined;
  const auth = req.auth!;

  const rows = await runWithTenant(auth.tenantId, async (tx) => {
    if (schoolClassId && subjectId) {
      await assertGenerateAccess(tx, auth, schoolClassId, subjectId);
    }

    let where: Prisma.GeneratedExamPaperWhereInput = {
      ...(schoolClassId ? { schoolClassId } : {}),
      ...(subjectId ? { subjectId } : {}),
    };
    // A TEACHER without a class/subject filter only sees history for
    // class/subjects they're actually granted — never the whole tenant's.
    if (auth.role === 'TEACHER' && !(schoolClassId && subjectId)) {
      const grants = await tx.examPaperAccessGrant.findMany({ where: { teacherId: auth.userId } });
      const allowed = grants.map((g) => ({ schoolClassId: g.schoolClassId, subjectId: g.subjectId }));
      where = { ...where, OR: allowed.length > 0 ? allowed : [{ id: 'none' }] };
    }

    return tx.generatedExamPaper.findMany({
      where,
      include: {
        schoolClass: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        generatedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  res.json({ data: rows });
});

async function loadAccessCheckedPaper(tx: Prisma.TransactionClient, auth: { role: string; userId: string }, id: string) {
  const paper = await tx.generatedExamPaper.findUnique({
    where: { id },
    include: {
      schoolClass: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      questions: { orderBy: { order: 'asc' } },
    },
  });
  if (!paper) throw AppError.notFound('Exam paper not found');
  await assertGenerateAccess(tx, auth, paper.schoolClassId, paper.subjectId);
  return paper;
}

generatedPapersRouter.get('/:id', requireRole(...ROLES), async (req: Request, res: Response) => {
  const id = uuidParam(req, 'id');
  const paper = await runWithTenant(req.auth!.tenantId, (tx) => loadAccessCheckedPaper(tx, req.auth!, id));
  res.json({ data: paper });
});

generatedPapersRouter.get('/:id/pdf', requireRole(...ROLES), async (req: Request, res: Response) => {
  const id = uuidParam(req, 'id');
  const tenantId = req.auth!.tenantId!;

  const { paper, tenant } = await runWithTenant(tenantId, async (tx) => {
    const paper = await loadAccessCheckedPaper(tx, req.auth!, id);
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    return { paper, tenant };
  });

  const pdfData: ExamPaperPdfData = {
    school: tenant ? { name: tenant.name, logoUrl: tenant.logoUrl } : null,
    schoolClass: paper.schoolClass.name,
    subject: paper.subject.name,
    chapters: paper.chapters,
    totalMarks: paper.totalMarks,
    generatedAt: paper.createdAt.toISOString().slice(0, 10),
    // Explicitly stripped down to the PDF-safe shape — correctOptionIndex
    // never crosses into examPaperPdf.ts at all.
    questions: paper.questions.map((q) => ({
      type: q.type,
      questionText: q.questionText,
      marks: q.marks,
      options: (q.options as string[] | null) ?? null,
      order: q.order,
    })),
  };

  const pdfBuffer = await renderExamPaperPdf(pdfData);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="exam-paper-${paper.id}.pdf"`);
  res.send(pdfBuffer);
});
