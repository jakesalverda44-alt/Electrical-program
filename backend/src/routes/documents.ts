import { Router } from 'express';
import { Readable } from 'stream';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { ownsLinkedRecord } from '../utils/ownership';
import { logger } from '../utils/logger';
import { asyncHandler } from '../utils/asyncHandler';
import { writeAudit } from '../utils/audit';
import { documentUpload } from '../utils/upload';
import { uploadFile, ensureSubfolder, getFileMedia } from '../services/googleDrive';
import { uploadToCloud, deleteFromCloud, isCloudStorageConfigured } from '../utils/cloudStorage';

const CATEGORY_TO_FOLDER: Record<string, string> = {
  plans:         'drive_plans_folder_id',
  permit:        'drive_plans_folder_id',
  contract:      'drive_contracts_folder_id',
  invoice:       'drive_contracts_folder_id',
  proposal:      'drive_estimates_folder_id',
  change_order:  'drive_change_orders_folder_id',
  submittal:     'drive_submittals_folder_id',
  rfi:           'drive_rfis_folder_id',
  photo:         'drive_photos_folder_id',
};

// Generator proposals use a different (flatter) folder layout than electrical bids.
const GEN_CATEGORY_TO_FOLDER: Record<string, string> = {
  photo:       'drive_photos_folder_id',
  contract:    'drive_contract_folder_id',
  invoice:     'drive_invoices_folder_id',
  permit:      'drive_permit_folder_id',
  engineering: 'drive_engineering_folder_id',
};

const router = Router();
const upload = documentUpload;

/**
 * Load a document the user is allowed to read. Restricted reps may only reach a
 * document they uploaded or one linked to a bid/proposal they own; managers/admins
 * may read any. Sends 404/403 and returns null when access is denied.
 */
async function loadAccessibleDocument(req: AuthRequest, res: import('express').Response, columns: string) {
  const { rows } = await pool.query(
    `SELECT ${columns}, linked_id, uploaded_by FROM documents WHERE id=$1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: 'not found' }); return null; }
  const scope = ownScopeId(req.user!);
  if (scope && rows[0].uploaded_by !== req.user!.name && !(await ownsLinkedRecord(scope, rows[0].linked_id))) {
    res.status(403).json({ error: 'You do not have access to this document' });
    return null;
  }
  return rows[0];
}

router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { linked_id } = req.query as { linked_id?: string };
  const conds = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (linked_id) { params.push(linked_id); conds.push(`linked_id = $${params.length}`); }
  // Restricted reps only see documents they uploaded or linked to a bid/proposal
  // they own; managers/admins see all. Previously any logged-in user could list
  // every document by id (data leak).
  const scope = ownScopeId(req.user!);
  if (scope) {
    params.push(scope); const pScope = params.length;
    params.push(req.user!.name); const pName = params.length;
    conds.push(
      `(uploaded_by = $${pName} OR linked_id IN (
          SELECT id::text FROM bids WHERE salesperson_id = $${pScope} AND deleted_at IS NULL
          UNION
          SELECT id::text FROM generator_proposals WHERE salesperson_id = $${pScope} AND deleted_at IS NULL
        ))`
    );
  }
  const { rows } = await pool.query(
    `SELECT id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at FROM documents WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  res.json(rows);
}));

router.post('/', requireAuth, upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  const { linked_id, linked_name, div, display_name, category } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });

  try {
    let driveFolderId: string | null = null;
    if (linked_id && div === 'elec') {
      const folderColumn = CATEGORY_TO_FOLDER[category];
      const cols = folderColumn ? `${folderColumn} AS sub_folder_id, drive_job_folder_id` : `drive_job_folder_id`;
      const { rows: bidRows } = await pool.query(`SELECT ${cols} FROM bids WHERE id=$1`, [linked_id]);
      driveFolderId = bidRows[0]?.sub_folder_id || bidRows[0]?.drive_job_folder_id || null;
    } else if (linked_id && div === 'gen') {
      const folderColumn = GEN_CATEGORY_TO_FOLDER[category];
      const cols = folderColumn ? `${folderColumn} AS sub_folder_id, drive_job_folder_id` : `drive_job_folder_id`;
      const { rows: genRows } = await pool.query(`SELECT ${cols} FROM generator_proposals WHERE id=$1`, [linked_id]);
      driveFolderId = genRows[0]?.sub_folder_id || null;
      // Photos folder may not exist yet on older gen jobs — lazily create it under the job folder.
      if (!driveFolderId && category === 'photo' && genRows[0]?.drive_job_folder_id) {
        driveFolderId = await ensureSubfolder('Photos', genRows[0].drive_job_folder_id);
        if (driveFolderId) {
          await pool.query(`UPDATE generator_proposals SET drive_photos_folder_id=$1 WHERE id=$2`, [driveFolderId, linked_id]);
        }
      }
      driveFolderId = driveFolderId || genRows[0]?.drive_job_folder_id || null;
    }

    let storageUrl: string | null = null;
    if (isCloudStorageConfigured()) {
      try {
        storageUrl = await uploadToCloud(file.buffer, file.originalname, file.mimetype);
      } catch (cloudErr) {
        logger.warn({ err: cloudErr }, '[cloudStorage] upload rejected — using Drive/DB fallback');
      }
    }

    const driveName = display_name?.trim() || file.originalname;
    const driveMime = file.mimetype || 'application/octet-stream';
    let driveFileId: string | null = null;
    if (driveFolderId) {
      try {
        driveFileId = await uploadFile(driveName, driveMime, file.buffer, driveFolderId);
      } catch (err) {
        logger.error({ err }, '[drive] upload failed');
      }
    }

    let fileData: string | null = null;
    if (!storageUrl) {
      if (driveFileId) storageUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
      else fileData = file.buffer.toString('base64');
    }

    const { rows } = await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, storage_url, file_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at`,
      [linked_id || null, linked_name || null, div || 'general', file.originalname,
       display_name?.trim() || file.originalname, category || 'other',
       file.size, file.mimetype || '', req.user!.name, storageUrl || null, fileData]
    );
    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Document upload failed');
    throw err;
  }
}));

router.get('/:id/download', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const doc = await loadAccessibleDocument(req, res, 'name, file_type, file_data, storage_url');
  if (!doc) return;
  const { name, file_type, file_data, storage_url } = doc;
  if (storage_url) return res.redirect(storage_url as string);
  if (!file_data) return res.status(404).json({ error: 'no file data' });
  const buf = Buffer.from(file_data as string, 'base64');
  res.setHeader('Content-Type', (file_type as string) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name as string)}"`);
  res.send(buf);
}));

// View a document inline (browser preview) regardless of where it's stored.
// Drive-stored files stream through the service account; cloud-stored files
// (Cloudinary) are proxied through the backend; DB-stored files stream from
// base64. Never redirect: the frontend fetches this via XHR (it needs the auth
// header), and a redirect to an external host dies on CORS before the browser
// can read a byte.
router.get('/:id/view', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const doc = await loadAccessibleDocument(req, res, 'name, file_type, file_data, storage_url');
  if (!doc) return;
  const { name, file_type, file_data, storage_url } = doc;

  if (storage_url) {
    const m = /\/file\/d\/([^/]+)/.exec(storage_url as string);
    if (m) {
      const media = await getFileMedia(m[1]);
      if (!media) return res.status(502).json({ error: 'File is stored in Google Drive but could not be fetched. Try the download button.' });
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name as string)}"`);
      media.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      return media.stream.pipe(res);
    }
    try {
      const upstream = await fetch(storage_url as string);
      if (!upstream.ok || !upstream.body) {
        logger.error({ docId: req.params.id, status: upstream.status }, '[documents] view: storage fetch failed');
        return res.status(502).json({ error: 'Could not fetch the file from storage. Try the download button.' });
      }
      // Cloudinary serves raw uploads as octet-stream; prefer the recorded type
      // so PDFs/images actually render inline instead of downloading.
      const upstreamType = upstream.headers.get('content-type');
      const contentType = (!upstreamType || upstreamType === 'application/octet-stream')
        ? ((file_type as string) || 'application/octet-stream')
        : upstreamType;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name as string)}"`);
      const stream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
      stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      return stream.pipe(res);
    } catch (err) {
      logger.error({ err, docId: req.params.id }, '[documents] view: storage proxy failed');
      return res.status(502).json({ error: 'Could not fetch the file from storage. Try the download button.' });
    }
  }
  if (file_data) {
    const buf = Buffer.from(file_data as string, 'base64');
    res.setHeader('Content-Type', (file_type as string) || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name as string)}"`);
    return res.send(buf);
  }
  res.status(404).json({ error: 'no file data' });
}));

// Proxy a Drive file's bytes through the backend (the service account is authenticated;
// the browser is not). Used for in-app image previews. Restricted reps may only proxy
// files belonging to a document they can access; if the file id isn't tracked as a
// document we fall through (it isn't tied to a rep-owned record), managers see all.
router.get('/drive-file/:fileId', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  if (scope) {
    const { rows } = await pool.query(
      `SELECT linked_id, uploaded_by FROM documents
       WHERE deleted_at IS NULL AND storage_url LIKE $1 LIMIT 1`,
      [`%${req.params.fileId}%`]
    );
    if (rows.length && rows[0].uploaded_by !== req.user!.name && !(await ownsLinkedRecord(scope, rows[0].linked_id))) {
      return res.status(403).json({ error: 'You do not have access to this file' });
    }
  }
  const media = await getFileMedia(req.params.fileId);
  if (!media) return res.status(404).json({ error: 'File not available' });
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  media.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  media.stream.pipe(res);
}));

router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    'UPDATE documents SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id, name, linked_name, storage_url',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await writeAudit(req, { action: 'delete', entityType: 'document', entityId: req.params.id, summary: `Moved document "${rows[0].name}" to Trash` });
  res.json({ ok: true });
}));

router.post('/:id/restore', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    'UPDATE documents SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found in Trash' });
  await writeAudit(req, { action: 'restore', entityType: 'document', entityId: req.params.id, summary: `Restored document "${rows[0].name}"` });
  res.json(rows[0]);
}));

router.delete('/:id/purge', requireAuth, requireAdmin, asyncHandler(async (req: AuthRequest, res) => {
  const { rows } = await pool.query('DELETE FROM documents WHERE id=$1 AND deleted_at IS NOT NULL RETURNING name', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found in Trash' });
  await writeAudit(req, { action: 'purge', entityType: 'document', entityId: req.params.id, summary: `Permanently deleted document "${rows[0].name}"` });
  res.json({ ok: true });
}));

export default router;
