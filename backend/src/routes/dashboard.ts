import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { parseDueDays } from '../utils/dueDate';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scope = ownScopeId(req.user!);
    const [bidsR, gensR, wonR, actR] = await Promise.all([
      scope
        ? pool.query('SELECT * FROM bids WHERE deleted_at IS NULL AND salesperson_id = $1 ORDER BY created_at DESC', [scope])
        : pool.query('SELECT * FROM bids WHERE deleted_at IS NULL ORDER BY created_at DESC'),
      scope
        ? pool.query('SELECT * FROM generator_proposals WHERE deleted_at IS NULL AND salesperson_id = $1 ORDER BY created_at DESC', [scope])
        : pool.query('SELECT * FROM generator_proposals WHERE deleted_at IS NULL ORDER BY created_at DESC'),
      scope
        ? pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL AND salesperson_id = $1 ORDER BY date_won DESC', [scope])
        : pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL ORDER BY date_won DESC'),
      pool.query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 10'),
    ]);
    res.json({
      bids: bidsR.rows.map((r: Record<string, unknown>) => ({ ...r, due_days: parseDueDays(String(r.due || '')) })),
      gens: gensR.rows,
      wonJobs: wonR.rows,
      activity: actR.rows,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
