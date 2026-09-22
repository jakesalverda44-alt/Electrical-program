// Task 6 — calibration report: engine hours vs Accubid hours per bid, an
// overall ratio, and per-category gaps (read-only). Part 2, Task 11 adds
// POST /calibration/apply, which actually writes the adjustment
// (source='calibrated') — its tests are below the report tests in this file.
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

describe('POST /api/estimating/calibration/apply', () => {
  // Scoped to a test-only category so this never touches the real seed
  // library's labor_hours — applying "global" for real here would multiply
  // every one of the ~139 seeded items' hours and corrupt every other test
  // (and every future run) that depends on their known values.
  const TEST_CATEGORY = `__CalibrationApplyTest__${Date.now()}`;

  it('is admin-only', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/calibration/apply').set(auth(estimator.token))
      .send({ scope: 'global', adjustmentPct: 10 }).expect(403);
  });

  it('rejects a bad scope, a non-numeric adjustmentPct, or a missing category with 400', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    await request(app).post('/api/estimating/calibration/apply').set(auth(owner.token))
      .send({ scope: 'bogus', adjustmentPct: 10 }).expect(400);
    await request(app).post('/api/estimating/calibration/apply').set(auth(owner.token))
      .send({ scope: 'global', adjustmentPct: 'not-a-number' }).expect(400);
    await request(app).post('/api/estimating/calibration/apply').set(auth(owner.token))
      .send({ scope: 'category', adjustmentPct: 10 }).expect(400);
  });

  it('multiplies labor_hours by (1 + pct/100) and marks source=calibrated, scoped to one category only', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const owner = await makeUser('owner');
    // A second, untouched category — proves the update is scoped, without
    // depending on the rest of the (shared, never-reset) library's state,
    // which can carry source='calibrated' rows from earlier test runs.
    const OTHER_CATEGORY = `${TEST_CATEGORY}-other`;
    const created = await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `CALTEST-${Date.now()}`, name: 'Calibration test item', category: TEST_CATEGORY, unit: 'EA', material_cost: 1, labor_hours: 10 })
      .expect(200);
    const untouched = await request(app).post('/api/estimating/library/items').set(auth(owner.token))
      .send({ code: `CALTEST-OTHER-${Date.now()}`, name: 'Untouched item', category: OTHER_CATEGORY, unit: 'EA', material_cost: 1, labor_hours: 5 })
      .expect(200);

    try {
      const res = await request(app).post('/api/estimating/calibration/apply').set(auth(owner.token))
        .send({ scope: 'category', category: TEST_CATEGORY, adjustmentPct: 20 }).expect(200);
      expect(res.body.updatedCount).toBe(1);

      const lib = await request(app).get('/api/estimating/library').set(auth(owner.token)).expect(200);
      const updated = lib.body.items.find((i: { id: string }) => i.id === created.body.id);
      expect(updated.labor_hours).toBeCloseTo(12, 4); // 10 * 1.20
      expect(updated.source).toBe('calibrated');

      const other = lib.body.items.find((i: { id: string }) => i.id === untouched.body.id);
      expect(other.labor_hours).toBe(5);
      expect(other.source).toBe('manual');
    } finally {
      // Deactivate the test rows so a "global" apply in some future run never
      // touches them (applyCalibrationAdjustment only ever affects active rows).
      await request(app).put(`/api/estimating/library/items/${created.body.id}`).set(auth(owner.token)).send({ active: false });
      await request(app).put(`/api/estimating/library/items/${untouched.body.id}`).set(auth(owner.token)).send({ active: false });
    }
  });
});
