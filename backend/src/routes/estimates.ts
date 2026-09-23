import { Router } from 'express';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';

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
router.get('/:bidId', requireAuth, async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const { rows } = await pool.query(
    'SELECT * FROM bid_estimates WHERE bid_id = $1',
    [req.params.bidId]
  );
  res.json(rows[0] || null);
});

// Fix round 1 / S2+S9 — the flat-rate estimate engine this route wrote
// (line_items priced straight off the unit-cost library, no labor hours/
// factors/library items) is retired. The new engine
// (estimating/bidEstimate.ts's saveBidEstimate(), PUT /api/estimating/:bidId)
// is the one real save path now — same bid_estimates/bids.amount columns,
// computed by pricing.ts instead of this route's own ad hoc qty*unit_cost
// math. Grepped every caller before removing the handler body: the frontend
// had exactly one (PcWorkspaceView.tsx's saveEstimate(), deleted in the same
// fix-round commit as this route change) and one backend test
// (estimates.confidence.test.ts, rewritten to assert 410 instead of the
// round-trip it used to exercise — that same confidence-round-trip coverage
// now exists for the new engine in estimatingComposeBidDataFix.test.ts).
// GET /:bidId (above) is UNCHANGED — PcWorkspaceView.tsx's overhead_pct/
// profit_pct/estimate_overrides hydration effect still reads it as one of
// two candidate sources (the other being bid_workspaces), so it stays live.
router.put('/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  res.status(410).json({
    error: 'This endpoint is retired. Use PUT /api/estimating/:bidId (the labor/material estimating engine) instead.',
  });
});

export default router;
