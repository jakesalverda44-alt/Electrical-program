import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// List all documents — exclude file_data to keep response small
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at FROM documents ORDER BY created_at DESC'
  );
  res.json(rows);
});

// Upload with actual file binary (stored as base64 in file_data column)
router.post('/', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
  const { linked_id, linked_name, div, display_name, category } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });

  const fileData = file.buffer.toString('base64');
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, linked_id, linked_name, div, name, display_name, category, file_size, file_type, storage_url, uploaded_by, created_at`,
    [linked_id||null, linked_name||null, div||'general', file.originalname,
     display_name?.trim() || file.originalname, category||'other',
     file.size, file.mimetype||'', req.user!.name, fileData]
  );
  res.json(rows[0]);
});

// Download a document's file
router.get('/:id/download', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT name, file_type, file_data FROM documents WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const { name, file_type, file_data } = rows[0];
  if (!file_data) return res.status(404).json({ error: 'no file data' });
  const buf = Buffer.from(file_data as string, 'base64');
  res.setHeader('Content-Type', (file_type as string) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name as string)}"`);
  res.send(buf);
});

router.delete('/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM documents WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
