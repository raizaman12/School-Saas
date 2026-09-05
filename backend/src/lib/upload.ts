import multer from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/AppError';

// In-memory storage — files are small (images capped well below Node's
// default buffer limits; CSVs are a single admin-driven upload, not a
// concurrent hot path), and every caller writes the buffer straight to
// storagePath() or hands it to csv-parse. No temp files to clean up.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2MB — a few thousand student rows is plenty
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20MB — a lecture-slide PPT easily runs several MB

// Course material / homework attachments — PDFs and PowerPoint slides are
// what a Pakistani classroom teacher actually shares (scanned notes,
// lecture decks); Word docs covered too since a worksheet is just as often
// a .docx as a .pdf. Deliberately not images (that's the /image endpoint)
// and not executable/archive types.
const ALLOWED_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Accept any image format (JPEG, PNG, WebP, GIF, BMP, HEIC, whatever the
    // phone/camera/scanner produced) — only reject non-image uploads.
    if (!file.mimetype.startsWith('image/')) {
      cb(AppError.badRequest(`Unsupported file type "${file.mimetype}" — please upload an image`));
      return;
    }
    cb(null, true);
  },
});

const documentMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOCUMENT_MIMES.has(file.mimetype)) {
      cb(AppError.badRequest(`Unsupported file type "${file.mimetype}" — use PDF, PPT/PPTX, or DOC/DOCX`));
      return;
    }
    cb(null, true);
  },
});

const csvMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
  // Deliberately not filtering by mimetype: browsers/OSes are wildly
  // inconsistent about what they report for .csv (text/csv,
  // application/vnd.ms-excel, application/csv, even text/plain) — a
  // filename check is more reliable, and a non-CSV file just fails to
  // parse with a clear error a few lines down instead of silently rejecting.
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      cb(AppError.badRequest('Expected a .csv file'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Wraps multer's single-file middleware so its errors flow through this
 * app's normal AppError → JSON-error-response path instead of falling
 * through to the generic 500 handler. multer calls back synchronously with
 * either a MulterError (e.g. LIMIT_FILE_SIZE) or whatever error our own
 * fileFilter passed to its callback (already an AppError above).
 */
function wrapMulter(handler: RequestHandler, maxBytesForMessage: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(AppError.badRequest(`File too large — max ${Math.round(maxBytesForMessage / (1024 * 1024))}MB`));
          return;
        }
        next(AppError.badRequest(err.message));
        return;
      }
      next(err);
    });
  };
}

export function singleImageUpload(fieldName: string): RequestHandler {
  return wrapMulter(imageMulter.single(fieldName), MAX_IMAGE_BYTES);
}

export function singleCsvUpload(fieldName: string): RequestHandler {
  return wrapMulter(csvMulter.single(fieldName), MAX_CSV_BYTES);
}

export function singleDocumentUpload(fieldName: string): RequestHandler {
  return wrapMulter(documentMulter.single(fieldName), MAX_DOCUMENT_BYTES);
}
