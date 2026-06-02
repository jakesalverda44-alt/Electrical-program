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
  if (!customer?.trim()) return res.status(400).json({ error: 'Customer required' });
  const user = req.user!;
  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (customer, loc, mfr, model, kw, amount, tax, addons, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [customer.trim(), (loc || '').trim() || '—', mfr, model, Number(kw) || 0,
     Number(amount) || 0, Number(tax) || 0, Number(addons) || 0, user.id, user.name]
  );
  res.json(rows[0]);
});

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  const valid = ['building', 'sent', 'awarded', 'declined'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cur } = await client.query(
      'SELECT * FROM generator_proposals WHERE id=$1', [req.params.id]
    );
    if (!cur.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const gen = cur[0];

    const { rows } = await client.query(
      'UPDATE generator_proposals SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
      [stage, req.params.id]
    );

    let wonJob = null;
    if (stage === 'awarded' && gen.stage !== 'awarded') {
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
         VALUES ($1,$2,$3,'Generator',$4,$5)
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [gen.salesperson_name, gen.customer, gen.id, gen.amount, gen.salesperson_id || null]
      );
      wonJob = wj[0] || null;
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ('awarded','gen',$1)`,
        [`${gen.customer} awarded — ${gen.salesperson_name}`]
      );
    } else if (stage !== gen.stage) {
      const labels: Record<string, string> = {
        building: 'Building', sent: 'Proposal Sent', declined: 'Declined',
      };
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ($1,'gen',$2)`,
        [stage === 'declined' ? 'lost' : stage === 'sent' ? 'sent' : 'new',
         `${gen.customer} moved to ${labels[stage] || stage}`]
      );
    }

    await client.query('COMMIT');
    res.json({ gen: rows[0], wonJob });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

export default router;
