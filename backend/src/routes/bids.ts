import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM bids ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, amount, due } = req.body;
  const user = req.user!;
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, amount, due, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, gc, loc, Number(amount)||0, due, user.id, user.name]
  );
  res.json(rows[0]);
});

router.patch('/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body;
  const valid = ['due','submitted','awarded','lost'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const { rows } = await pool.query(
    'UPDATE bids SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [stage, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

export default router;
