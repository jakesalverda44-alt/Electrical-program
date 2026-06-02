import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (_req, res) => {
  try {
    const [bidsR, gensR, wonR, actR] = await Promise.all([
      pool.query('SELECT * FROM bids ORDER BY created_at DESC'),
      pool.query('SELECT * FROM generator_proposals ORDER BY created_at DESC'),
      pool.query('SELECT * FROM won_jobs ORDER BY date_won DESC'),
      pool.query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 10'),
    ]);
    res.json({
      bids: bidsR.rows,
      gens: gensR.rows,
      wonJobs: wonR.rows,
      activity: actR.rows,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
