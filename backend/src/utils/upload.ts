import multer from 'multer';
import path from 'path';

/**
 * Rejected by an upload filter. Carries status 400 so the global error handler
 * returns a clean, user-facing message instead of a generic 500.
 */
export class UnsupportedFileTypeError extends Error {
  status = 400;
  constructor(filename: string) {
    const ext = path.extname(filename || '').toLowerCase() || 'this file';
    super(`Unsupported file type (${ext}). Please upload an allowed format.`);
    this.name = 'UnsupportedFileTypeError';
  }
}

// Documents hub: plans, contracts, proposals, permits, invoices, photos, etc.
const DOCUMENT_EXTS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.tif', '.tiff',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.ppt', '.pptx',
  '.zip', '.dwg', '.dxf', '.dwf', '.dwfx', '.rvt',
  '.eml', '.msg',
]);

// AI takeoff input: drawing sets, images, and zip archives (expanded server-side).
const DRAWING_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.zip']);

// Signed proposal upload: PDF only.
const PDF_EXTS = new Set(['.pdf']);

function extensionFilter(allowed: Set<string>): multer.Options['fileFilter'] {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.has(ext)) cb(null, true);
    else cb(new UnsupportedFileTypeError(file.originalname || 'file'));
  };
}

const MB = 1024 * 1024;

/** General document uploads (50MB) restricted to common document/image/plan types. */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * MB },
  fileFilter: extensionFilter(DOCUMENT_EXTS),
});

/** Signed-proposal PDF upload (15MB, PDF only). */
export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * MB },
  fileFilter: extensionFilter(PDF_EXTS),
});

/** AI takeoff drawings/images (50MB each, up to 50 files). */
export const drawingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * MB, files: 50 },
  fileFilter: extensionFilter(DRAWING_EXTS),
});

const SCREENSHOT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);

/** Lead screenshot intake: images only, 10MB, filtered by MIME type. */
export const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * MB },
  fileFilter: (_req, file, cb) => {
    if (SCREENSHOT_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new UnsupportedFileTypeError(file.originalname || 'file'));
  },
});
