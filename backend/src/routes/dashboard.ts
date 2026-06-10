import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { withDueDays } from '../utils/dueDate';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scope = ownScopeId(req.user!);
    const [bidsR, gensR, wonR, actR] = await Promise.all([
      scope
        ? pool.query(`SELECT b.*, COALESCE((SELECT SUM(amount) FROM project_change_orders WHERE project_id=b.id AND status='approved'),0) AS co_approved_total, wj.date_won FROM bids b LEFT JOIN won_jobs wj ON wj.proposal_id=b.id AND wj.deleted_at IS NULL WHERE b.deleted_at IS NULL AND b.closed_at IS NULL AND b.salesperson_id=$1 ORDER BY b.created_at DESC`, [scope])
        : pool.query(`SELECT b.*, COALESCE((SELECT SUM(amount) FROM project_change_orders WHERE project_id=b.id AND status='approved'),0) AS co_approved_total, wj.date_won FROM bids b LEFT JOIN won_jobs wj ON wj.proposal_id=b.id AND wj.deleted_at IS NULL WHERE b.deleted_at IS NULL AND b.closed_at IS NULL ORDER BY b.created_at DESC`),
      scope
        ? pool.query('SELECT gp.*, wj.date_won FROM generator_proposals gp LEFT JOIN won_jobs wj ON wj.proposal_id=gp.id AND wj.deleted_at IS NULL WHERE gp.deleted_at IS NULL AND gp.salesperson_id=$1 ORDER BY gp.created_at DESC', [scope])
        : pool.query('SELECT gp.*, wj.date_won FROM generator_proposals gp LEFT JOIN won_jobs wj ON wj.proposal_id=gp.id AND wj.deleted_at IS NULL WHERE gp.deleted_at IS NULL ORDER BY gp.created_at DESC'),
      scope
        ? pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL AND salesperson_id = $1 ORDER BY date_won DESC', [scope])
        : pool.query('SELECT * FROM won_jobs WHERE deleted_at IS NULL ORDER BY date_won DESC'),
      pool.query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 10'),
    ]);
    res.json({
      bids: bidsR.rows.map(withDueDays),
      gens: gensR.rows,
      wonJobs: wonR.rows,
      activity: actR.rows,
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;