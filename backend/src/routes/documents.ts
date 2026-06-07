import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
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

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { linked_id } = req.query as { linked_id?: string };
  const where = linked_id ? 'WHERE deleted_at IS NULL AND linked_id = $1' : 'WHERE deleted_at IS NULL';
  const params = linked_id ? [linked_id] : [];
  const { rows } = await pool.query(
    `SELECT id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at FROM documents ${where} ORDER BY created_at DESC`,
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

router.get('/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT name, file_type, file_data, storage_url FROM documents WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const { name, file_type, file_data, storage_url } = rows[0];
  if (storage_url) return res.redirect(storage_url as string);
  if (!file_data) return res.status(404).json({ error: 'no file data' });
  const buf = Buffer.from(file_data as string, 'base64');
  res.setHeader('Content-Type', (file_type as string) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name as string)}"`);
  res.send(buf);
}));

// View a document inline (browser preview) regardless of where it's stored.
// Drive view links aren't publicly accessible, so Drive-stored files stream through
// the service account; DB-stored files stream from base64; other URLs redirect.
router.get('/:id/view', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT name, file_type, file_data, storage_url FROM documents WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const { name, file_type, file_data, storage_url } = rows[0];

  if (storage_url) {
    const m = /\/file\/d\/([^/]+)/.exec(storage_url as string);
    if (m) {
      const media = await getFileMedia(m[1]);
      if (media) {
        res.setHeader('Content-Type', media.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name as string)}"`);
        media.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
        return media.stream.pipe(res);
      }
    }
    return res.redirect(storage_url as string);
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
// the browser is not). Used for in-app image previews. Any authenticated staff user may
// read — acceptable for an internal CRM.
router.get('/drive-file/:fileId', requireAuth, asyncHandler(async (req, res) => {
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
