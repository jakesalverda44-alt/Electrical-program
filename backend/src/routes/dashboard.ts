import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { withDueDays } from '../utils/dueDate';

const router = Router();

// Task 4 (audit data #11) — the old query correlated a SUM(amount) subquery
// per bids row (EXPLAIN ANALYZE showed the subplan running once per bid,
// loops=26) and joined won_jobs via `wj.proposal_id = b.id::text`, a
// text↔uuid mismatch that forced a nested-loop-with-seq-scan instead of an
// index/hash join. The CTE below aggregates project_change_orders once
// (grouped, not per-row), and the join condition casts wj.proposal_id to
// uuid (the plan's instruction — retyping the won_jobs.proposal_id column
// itself is out of scope, a full-table rewrite) so it compares directly
// against bids.id's native type. The `~` regex guard keeps a malformed
// proposal_id (never seen in either DB today, but proposal_id has no format
// constraint at the schema level) from throwing a cast error and 500ing the
// whole dashboard — it just won't match, same as today's silent non-match
// for anything that isn't a real bid id. Response shape (columns) unchanged.
const BIDS_WITH_CO_AND_WON = `
  WITH co_totals AS (
    SELECT project_id, SUM(amount) AS total
      FROM project_change_orders
     WHERE status = 'approved'
     GROUP BY project_id
  )
  SELECT b.*, COALESCE(co.total, 0) AS co_approved_total, wj.date_won
    FROM bids b
    LEFT JOIN co_totals co ON co.project_id = b.id
    LEFT JOIN won_jobs wj ON wj.proposal_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND wj.proposal_id::uuid = b.id AND wj.deleted_at IS NULL
   WHERE b.deleted_at IS NULL AND b.closed_at IS NULL`;

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scope = ownScopeId(req.user!);
    const [bidsR, gensR, wonR, actR] = await Promise.all([
      scope
        ? pool.query(`${BIDS_WITH_CO_AND_WON} AND b.salesperson_id=$1 ORDER BY b.created_at DESC`, [scope])
        : pool.query(`${BIDS_WITH_CO_AND_WON} ORDER BY b.created_at DESC`),
      scope
        ? pool.query('SELECT gp.*, wj.date_won FROM generator_proposals gp LEFT JOIN won_jobs wj ON wj.proposal_id=gp.id::text AND wj.deleted_at IS NULL WHERE gp.deleted_at IS NULL AND gp.salesperson_id=$1 ORDER BY gp.created_at DESC', [scope])
        : pool.query('SELECT gp.*, wj.date_won FROM generator_proposals gp LEFT JOIN won_jobs wj ON wj.proposal_id=gp.id::text AND wj.deleted_at IS NULL WHERE gp.deleted_at IS NULL ORDER BY gp.created_at DESC'),
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