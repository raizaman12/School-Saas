import { Router } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { writeFile } from 'fs/promises';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { singleImageUpload, singleDocumentUpload } from '../../lib/upload';
import { storagePath } from '../../lib/storage';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

// Matches the schools that actually edit student/staff photos and the
// school's own logo today (see students.ts / staff.ts WRITE_ROLES, and
// tenant.ts's theme/branding routes) — SCHOOL_ADMIN and FRONT_DESK — plus
// TEACHER, who needs this same endpoint for their own portal profile photo
// (see the self-service PATCH /api/staff/me in staff.ts). Not meant to be
// exhaustive forever; whoever needs to upload a new kind of image later
// extends this list.
const WRITE_ROLES = ['SCHOOL_ADMIN', 'FRONT_DESK', 'TEACHER'] as const;

// Course material and homework attachments are uploaded by whoever can
// author that content — SCHOOL_ADMIN or the assigned TEACHER (see
// courseMaterials.ts / homework.ts, which independently re-check that the
// TEACHER actually teaches the section-subject before accepting the URL).
const DOCUMENT_WRITE_ROLES = ['SCHOOL_ADMIN', 'TEACHER'] as const;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

/**
 * Generic image upload for anything in the app that needs a photoUrl/
 * logoUrl (student photo, staff photo, school logo/branding). Deliberately
 * not tied to one entity — the caller attaches the returned URL to
 * whichever record it's editing (e.g. PATCH /api/students/:id
 * { photoUrl: <url> }), and that route re-checks its own authorization
 * independently. Files are stored one folder per tenant under
 * STORAGE_DIR/uploads (see storagePath()) with an unguessable UUID
 * filename, and served back via the public static mount in app.ts.
 *
 * Public rather than authenticated-streaming (contrast
 * reportCardBatch.ts's download route): this app's access tokens live only
 * in memory and are sent as a Bearer header (see frontend/src/lib/api.ts),
 * never a cookie, so an auth-gated route can't be used as a plain <img
 * src="..."> anywhere without extra client-side plumbing (fetch as blob,
 * build an object URL) at every single place a photo is displayed. Student/
 * staff photos and a school's logo aren't sensitive the way CNIC or fee
 * data is, so a public URL behind an unguessable UUID is an acceptable,
 * pragmatic trade-off — the same one most SaaS apps make for avatar images.
 */
uploadsRouter.post(
  '/image',
  requireRole(...WRITE_ROLES),
  singleImageUpload('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file uploaded — expected multipart/form-data field "file"');
    }
    const tenantId = req.auth!.tenantId!;

    const ext = EXT_BY_MIME[req.file.mimetype] ?? (path.extname(req.file.originalname).slice(0, 10) || '.bin');
    const filename = `${randomUUID()}${ext}`;
    const filePath = await storagePath('uploads', tenantId, filename);
    await writeFile(filePath, req.file.buffer);

    res.status(201).json({ data: { url: `${env.APP_URL}/uploads/${tenantId}/${filename}` } });
  },
);

/**
 * Generic document upload (PDF/PPT/PPTX/DOC/DOCX) for course material and
 * homework attachments — same storage/URL scheme as /image above, just a
 * different multer filter and allowed-role set. See courseMaterials.ts and
 * homework.ts for the routes that actually attach the returned URL to a
 * record, and their own independent authorization checks.
 */
uploadsRouter.post(
  '/document',
  requireRole(...DOCUMENT_WRITE_ROLES),
  singleDocumentUpload('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw AppError.badRequest('No file uploaded — expected multipart/form-data field "file"');
    }
    const tenantId = req.auth!.tenantId!;

    const ext = EXT_BY_MIME[req.file.mimetype] ?? (path.extname(req.file.originalname).slice(0, 10) || '.bin');
    const filename = `${randomUUID()}${ext}`;
    const filePath = await storagePath('uploads', tenantId, filename);
    await writeFile(filePath, req.file.buffer);

    res.status(201).json({ data: { url: `${env.APP_URL}/uploads/${tenantId}/${filename}`, originalName: req.file.originalname } });
  },
);
