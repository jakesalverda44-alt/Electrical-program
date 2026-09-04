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

// Server-side source of truth for Content-Type: the client's declared
// multipart mimetype is attacker-controlled (audit: Security #6, High — upload
// plans.pdf with `Content-Type: text/html` and it used to be served back as
// HTML, inline, on our own origin). Every extension accepted by any upload
// filter above must have an entry here; storeDocument.ts uses this — never the
// client-declared multer mimetype — for what gets stored and served.
export const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  // CAD drafting formats — no browser can render these as an image, so they
  // must never carry an "image/*" type: documents.ts's inline check is a bare
  // `type.startsWith('image/')`, and `.dwg`/`.dxf`'s previous (unofficial)
  // "image/vnd.*" types tripped it, contrary to the allowlist's intent even
  // though nothing could actually exploit it (post-review, non-blocker T5).
  '.dwg': 'application/acad',
  '.dxf': 'application/dxf',
  '.dwf': 'model/vnd.dwf',
  '.dwfx': 'model/vnd.dwfx+xps',
  '.rvt': 'application/octet-stream',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
};

/** Maps a filename's extension to a server-controlled MIME type. Unknown/missing
 * extensions fall back to application/octet-stream (never inlined by the serve
 * route — see documents.ts). */
export function mimeTypeForFilename(filename: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

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
