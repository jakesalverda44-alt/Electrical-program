import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM generator_proposals ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { customer, loc, mfr, model, kw, amount, tax, addons } = req.body;
  const user = req.user!;
  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (customer, loc, mfr, model, kw, amount, tax, addons, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [customer, loc, mfr, model, kw, Number(amount)||0, Number(tax)||0, Number(addons)||0, user.id, user.name]
  );
  res.json(rows[0]);
});

router.patch('/:id/stage', requireAuth, async (req, res) => {
  const { stage } = req.body;
  const valid = ['building','sent','awarded'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const { rows } = await pool.query(
    'UPDATE generator_proposals SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [stage, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

export default router;
