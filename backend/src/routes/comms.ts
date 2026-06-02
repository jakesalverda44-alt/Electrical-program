import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM communications ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { kind, div, subject, body, linked_id, linked_name } = req.body;
  if (!kind?.trim() || !subject?.trim()) return res.status(400).json({ error: 'kind and subject required' });
  const author = req.user!.name;
  const { rows } = await pool.query(
    `INSERT INTO communications (kind, div, subject, body, linked_id, linked_name, author)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [kind, div || 'general', subject.trim(), (body||'').trim(), linked_id||null, linked_name||null, author]
  );
  res.json(rows[0]);
});

export default router;
