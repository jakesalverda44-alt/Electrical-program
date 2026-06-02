import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM won_jobs ORDER BY date_won DESC');
  res.json(rows);
});

// Called internally when a proposal is marked awarded
router.post('/record', requireAuth, async (req, res) => {
  const { salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (proposal_id) DO NOTHING
       RETURNING *`,
      [salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id || null]
    );
    res.json(rows[0] || { skipped: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
