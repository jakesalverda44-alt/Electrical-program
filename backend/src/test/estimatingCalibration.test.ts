// Task 6 — calibration report: engine hours vs Accubid hours per bid, an
// overall ratio, and per-category gaps. Read-only; applying the suggestion
// (writing source='calibrated') is Task 12 (Settings UI), out of scope here.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { computeCalibrationReport } from '../estimating/calibration';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const DEFAULT_SETTINGS = {
  labor_rate: 40, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0,
  supervision_pct: 0, consumables_pct: 0, overhead_pct: 0, profit_pct: 0, crew_size: 3,
};

async function makeBidWithBreakdown(app: import('express').Express, u: { token: string }, accubidHours: number) {
  const bid = await request(app).post('/api/bids').set(auth(u.token))
    .send({ name: `Calib ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gc: 'GC' }).expect(200);
  const bidId = bid.body.id as string;
  await pool.query(
    `INSERT INTO bid_cost_breakdown (bid_id, labor_hours) VALUES ($1,$2)
     ON CONFLICT (bid_id) DO UPDATE SET labor_hours=$2`,
    [bidId, accubidHours]
  );
  return bidId;
}

// The test DB is never reset between runs (see harness.ts), and
// computeCalibrationReport() aggregates over EVERY bid with a
// bid_cost_breakdown row. A bid this file creates would otherwise live in
// that table forever and corrupt a later run's exact-value assertions
// (overallRatio, categoryGaps) — every test cleans up the rows it inserted.
async function deleteBreakdown(...bidIds: string[]) {
  await pool.query('DELETE FROM bid_cost_breakdown WHERE bid_id = ANY($1::uuid[])', [bidIds]);
}

describe('computeCalibrationReport()', () => {
  it('computes a per-bid ratio, an overall ratio, and hours-weighted per-category gaps', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');

    // Bid 1: engine says 120h, Accubid says 100h (engine over by 20%).
    const bid1 = await makeBidWithBreakdown(app, u, 100);
    // Bid 2: engine says 80h, Accubid says 100h (engine under by 20%).
    const bid2 = await makeBidWithBreakdown(app, u, 100);
    try {
      await request(app).put(`/api/estimating/${bid1}`).set(auth(u.token)).send({
        lines: [{ category: 'Branch Power', description: 'Manual', qty: 1, unit: 'EA', labor_hours_override: 120, material_unit_override: 0, source: 'manual' }],
        settings: DEFAULT_SETTINGS,
      }).expect(200);
      await request(app).put(`/api/estimating/${bid2}`).set(auth(u.token)).send({
        lines: [{ category: 'Interior Lighting', description: 'Manual', qty: 1, unit: 'EA', labor_hours_override: 80, material_unit_override: 0, source: 'manual' }],
        settings: DEFAULT_SETTINGS,
      }).expect(200);

      const report = await computeCalibrationReport();
      const b1 = report.bids.find(b => b.bidId === bid1)!;
      const b2 = report.bids.find(b => b.bidId === bid2)!;
      expect(b1.engineHours).toBe(120);
      expect(b1.accubidHours).toBe(100);
      expect(b1.ratio).toBeCloseTo(1.2, 5);
      expect(b2.ratio).toBeCloseTo(0.8, 5);

      // Overall: (120+80) / (100+100) = 1.0 — the two errors cancel out in aggregate.
      expect(report.overallRatio).toBeCloseTo(1.0, 5);
      expect(report.suggestedGlobalAdjustmentPct).toBeCloseTo(0, 5);

      const branchGap = report.categoryGaps.find(c => c.category === 'Branch Power')!;
      const lightingGap = report.categoryGaps.find(c => c.category === 'Interior Lighting')!;
      expect(branchGap.totalEngineHours).toBe(120);
      expect(branchGap.suggestedAdjustmentPct).toBeCloseTo(20, 5);
      expect(lightingGap.totalEngineHours).toBe(80);
      expect(lightingGap.suggestedAdjustmentPct).toBeCloseTo(-20, 5);
    } finally {
      await deleteBreakdown(bid1, bid2);
    }
  });

  it('excludes a bid with an Accubid breakdown but no takeoff/saved lines to price', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithBreakdown(app, u, 50);
    try {
      const report = await computeCalibrationReport();
      expect(report.bids.find(b => b.bidId === bidId)).toBeUndefined();
    } finally {
      await deleteBreakdown(bidId);
    }
  });

  it('uses the proposed (unsaved) mapping when a bid has takeoff output but no saved lines yet', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const u = await makeUser('owner');
    const bidId = await makeBidWithBreakdown(app, u, 10);
    try {
      await pool.query(
        `INSERT INTO takeoff_results (bid_id, agent2_output, status) VALUES ($1,$2,'agent2_complete')
         ON CONFLICT (bid_id) DO UPDATE SET agent2_output=$2, status='agent2_complete'`,
        [bidId, '```json\n' + JSON.stringify({ takeoff: [
          { category: 'Branch Power', item: '20A 125V duplex receptacle, spec grade', qty: 10, unit: 'EA' },
        ] }) + '\n```']
      );

      const report = await computeCalibrationReport();
      const b = report.bids.find(x => x.bidId === bidId);
      expect(b).toBeTruthy();
      expect(b!.engineHours).toBeGreaterThan(0);
    } finally {
      await deleteBreakdown(bidId);
    }
  });
});

describe('GET /api/estimating/calibration', () => {
  it('is admin-only', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).get('/api/estimating/calibration').set(auth(estimator.token)).expect(403);
    const owner = await makeUser('owner');
    await request(app).get('/api/estimating/calibration').set(auth(owner.token)).expect(200);
  });
});
