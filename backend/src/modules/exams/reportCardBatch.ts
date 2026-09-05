import { Router } from 'express';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import archiver from 'archiver';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { storagePath } from '../../lib/storage';
import { logger } from '../../lib/logger';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { buildReportCard } from './exams';
import { renderReportCardPdf } from './reportCardPdf';
import { createReportCardBatchSchema } from './validation';

const READ_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER', 'ACCOUNTANT'] as const;
// Batch-generating a whole class's report cards spins up a background job
// that renders one PDF per student and zips them — a heavy, tenant-wide
// write action, not a read. Every other module in this codebase reserves
// that kind of action for SCHOOL_ADMIN (see exams.ts/gradingBands.ts's
// identically-named constant); this endpoint had been left on READ_ROLES,
// which let a TEACHER or ACCOUNTANT kick off a full-class batch job.
const ADMIN_ROLES = ['SCHOOL_ADMIN'] as const;

export const reportCardBatchRouter = Router();
reportCardBatchRouter.use(requireAuth);

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60);
}

/**
 * Runs entirely outside the request/response cycle — kicked off via
 * `setImmediate` right after the job row is created, so the HTTP request
 * that triggered it returns immediately with a job id to poll. No
 * Redis/BullMQ exists in this deployment (single-VPS pm2 — see
 * docs/DEPLOYMENT.md), so "background job" here just means "don't await
 * this before responding", not a separate worker process. If the process
 * restarts mid-batch the job is simply left PROCESSING forever — acceptable
 * for v1 (a school re-triggers), flagged here as a durability trade-off
 * worth revisiting if this ever needs multi-instance/queue-backed retries.
 */
async function processBatch(jobId: string, tenantId: string): Promise<void> {
  try {
    const job = await runWithTenant(tenantId, (tx) =>
      tx.reportCardBatchJob.update({ where: { id: jobId }, data: { status: 'PROCESSING' } }),
    );

    const sections = await runWithTenant(tenantId, (tx) =>
      tx.section.findMany({
        where: { schoolClassId: job.classId, ...(job.sectionId ? { id: job.sectionId } : {}) },
      }),
    );
    const students = await runWithTenant(tenantId, (tx) =>
      tx.student.findMany({
        where: { currentSectionId: { in: sections.map((s) => s.id) }, status: 'ACTIVE' },
        orderBy: { fullName: 'asc' },
      }),
    );

    await runWithTenant(tenantId, (tx) =>
      tx.reportCardBatchJob.update({ where: { id: jobId }, data: { totalCount: students.length } }),
    );

    const zipPath = await storagePath('report-card-batches', `${jobId}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const archiveDone = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });
    archive.pipe(output);

    let processedCount = 0;
    const usedNames = new Set<string>();
    for (const student of students) {
      const reportCard = await runWithTenant(tenantId, (tx) => buildReportCard(tx, job.examId, student.id));
      const pdfBuffer = await renderReportCardPdf(reportCard);

      let name = `${sanitizeFilenamePart(student.studentCode)}-${sanitizeFilenamePart(student.fullName)}.pdf`;
      // Defensive de-dupe: sanitization could theoretically collapse two
      // distinct names to the same string, which would silently drop one
      // PDF from the zip (archiver last-write-wins on duplicate entry names).
      if (usedNames.has(name)) name = `${student.id}-${name}`;
      usedNames.add(name);
      archive.append(pdfBuffer, { name });

      processedCount += 1;
      await runWithTenant(tenantId, (tx) =>
        tx.reportCardBatchJob.update({ where: { id: jobId }, data: { processedCount } }),
      );
    }

    await archive.finalize();
    await archiveDone;

    await runWithTenant(tenantId, (tx) =>
      tx.reportCardBatchJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          resultFileUrl: `/api/exams/report-card-batches/${jobId}/download`,
          completedAt: new Date(),
        },
      }),
    );
  } catch (err) {
    logger.error('Report card batch job failed', { jobId, err: (err as Error)?.message });
    await runWithTenant(tenantId, (tx) =>
      tx.reportCardBatchJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: (err as Error)?.message?.slice(0, 500) ?? 'Unknown error' },
      }),
    ).catch(() => {
      // If even the failure-status update fails (e.g. DB unreachable), the
      // job is stuck PENDING/PROCESSING — logged above; nothing more we can
      // safely do from a background task with no request to report back to.
    });
  }
}

reportCardBatchRouter.post(
  '/:examId/report-card-batches',
  requireRole(...ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const input = createReportCardBatchSchema.parse(req.body);
    const examId = uuidParam(req, 'examId');
    const tenantId = req.auth!.tenantId!;
    const auth = req.auth!;

    const job = await runWithTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) throw AppError.notFound('Exam not found');

      const schoolClass = await tx.schoolClass.findUnique({ where: { id: input.classId } });
      if (!schoolClass) throw AppError.badRequest('Unknown classId');

      if (input.sectionId) {
        const section = await tx.section.findUnique({ where: { id: input.sectionId } });
        if (!section || section.schoolClassId !== input.classId) {
          throw AppError.badRequest('Unknown sectionId for this class');
        }
      }

      return tx.reportCardBatchJob.create({
        data: {
          id: randomUUID(),
          tenantId,
          classId: input.classId,
          sectionId: input.sectionId,
          examId,
          requestedByUserId: auth.userId,
        },
      });
    });

    // Fire-and-forget: intentionally not awaited so the request returns
    // immediately with a job id to poll (see processBatch's doc comment).
    setImmediate(() => {
      processBatch(job.id, tenantId).catch((err) =>
        logger.error('Unhandled error kicking off report card batch', { jobId: job.id, err }),
      );
    });

    res.status(202).json({ data: job });
  },
);

reportCardBatchRouter.get(
  '/report-card-batches/:jobId',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const job = await runWithTenant(req.auth!.tenantId, (tx) =>
      tx.reportCardBatchJob.findUnique({ where: { id: uuidParam(req, 'jobId') } }),
    );
    if (!job) throw AppError.notFound('Report card batch job not found');
    res.json({ data: job });
  },
);

reportCardBatchRouter.get(
  '/report-card-batches/:jobId/download',
  requireRole(...READ_ROLES),
  async (req: Request, res: Response) => {
    const job = await runWithTenant(req.auth!.tenantId, (tx) =>
      tx.reportCardBatchJob.findUnique({ where: { id: uuidParam(req, 'jobId') } }),
    );
    if (!job) throw AppError.notFound('Report card batch job not found');
    if (job.status !== 'COMPLETED') {
      throw AppError.conflict(`Batch is not ready yet (status: ${job.status})`);
    }

    const zipPath = await storagePath('report-card-batches', `${job.id}.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="report-cards-${job.id}.zip"`);
    const stream = createReadStream(zipPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not read batch file' } });
    });
    stream.pipe(res);
  },
);
