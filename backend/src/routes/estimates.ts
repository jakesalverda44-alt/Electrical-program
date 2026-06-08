import { Router } from 'express';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/estimates/unit-costs — return parsed unit cost library
router.get('/unit-costs', requireAuth, async (_req, res) => {
  const raw = await getSetting('unit_cost_library');
  try {
    res.json(raw ? JSON.parse(raw) : { global: {}, by_project_type: {} });
  } catch {
    res.json({ global: {}, by_project_type: {} });
  }
});

// PUT /api/estimates/unit-costs — write unit cost library (admin only)
router.put('/unit-costs', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const val = JSON.stringify(req.body);
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ('unit_cost_library', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [val]
  );
  res.json({ ok: true });
});

// GET /api/estimates/:bidId — return saved estimate or null
router.get('/:bidId', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM bid_estimates WHERE bid_id = $1',
    [req.params.bidId]
  );
  res.json(rows[0] || null);
});

// PUT /api/estimates/:bidId — upsert estimate, recompute totals, sync bids.amount
router.put('/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const { line_items, overhead_pct, profit_pct } = req.body as {
    line_items: { category: string; item: string; qty: number; unit: string; unit_cost: number; total: number; overridden: boolean }[];
    overhead_pct: number;
    profit_pct: number;
  };

  // Compute subtotals per category
  const subtotals: Record<string, number> = {};
  let total_direct = 0;
  for (const li of line_items) {
    li.total = li.qty * li.unit_cost;
    subtotals[li.category] = (subtotals[li.category] ?? 0) + li.total;
    total_direct += li.total;
  }

  const total_overhead = total_direct * (overhead_pct / 100);
  const total_profit   = (total_direct + total_overhead) * (profit_pct / 100);
  const grand_total    = total_direct + total_overhead + total_profit;

  // Count comps: awarded bids of same project_type with a saved estimate
  const { rows: bidRows } = await pool.query(
    'SELECT project_type FROM bids WHERE id = $1 AND deleted_at IS NULL',
    [bidId]
  );
  let comp_count = 0;
  if (bidRows.length && bidRows[0].project_type) {
    const { rows: comps } = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM bids b
       JOIN bid_estimates be ON be.bid_id = b.id
       WHERE b.stage = 'awarded' AND b.project_type = $1 AND b.id != $2 AND b.deleted_at IS NULL`,
      [bidRows[0].project_type, bidId]
    );
    comp_count = comps[0]?.cnt ?? 0;
  }

  const confidence = comp_count >= 3 ? 'HIGH' : comp_count >= 1 ? 'MEDIUM' : 'LOW';

  const { rows } = await pool.query(
    `INSERT INTO bid_estimates (bid_id, overhead_pct, profit_pct, line_items, subtotals,
       total_direct, total_overhead, total_profit, grand_total, comp_count, confidence, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       overhead_pct=$2, profit_pct=$3, line_items=$4::jsonb, subtotals=$5::jsonb,
       total_direct=$6, total_overhead=$7, total_profit=$8, grand_total=$9,
       comp_count=$10, confidence=$11, updated_at=now()
     RETURNING *`,
    [bidId, overhead_pct, profit_pct, JSON.stringify(line_items), JSON.stringify(subtotals),
     total_direct, total_overhead, total_profit, grand_total, comp_count, confidence]
  );

  // Sync bids.amount with grand_total
  await pool.query(
    'UPDATE bids SET amount = $1 WHERE id = $2 AND deleted_at IS NULL',
    [grand_total, bidId]
  );

  res.json(rows[0]);
});

export default router;
