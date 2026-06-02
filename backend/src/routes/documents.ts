import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM documents ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { linked_id, linked_name, div, name, display_name, category, file_size, file_type } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [linked_id||null, linked_name||null, div||'general', name.trim(),
     display_name||name.trim(), category||'other', Number(file_size)||0,
     file_type||'', req.user!.name]
  );
  res.json(rows[0]);
});

router.delete('/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM documents WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
