// Next round Part B, Task 4 — POST /api/estimating/calibration/bom: the
// per-category hours comparison against Chris's real BOMs, read-only.
//
// Deliberately uses a SYNTHETIC one-row BOM text with a unique, test-run-
// specific description (never a real fixture like kissimmee-bom.txt) and
// inserts a matching library item directly — est_items.code is a GLOBAL,
// non-bid-scoped unique key, and vitest runs test FILES in parallel worker
// processes against the same test DB, so two files both importing the same
// real Kissimmee BOM concurrently (this file vs
// estimatingAccubidImportRoutes.test.ts) would race each other's row counts.
// A unique synthetic row can never collide with anything another file does.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { bomItemCode } from '../estimating/accubidImport';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

function syntheticBomLine(tag: string, laborUnit: number): { line: string; code: string } {
  // Same row shape accubidBom.test.ts already proves the parser handles —
  // qty 100.000 C, no cost fields, just a labor unit and total field labor.
  const description = `TestOnly-${tag} Conduit - EMT 10' Lengths`;
  const line = `${description}                                          100.000 C                                                                               C                     ${laborUnit.toFixed(3)}                       ${laborUnit.toFixed(3)} Normal`;
  return { line, code: bomItemCode(description, 'C') };
}

describe('POST /api/estimating/calibration/bom', () => {
  it('requires admin', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/calibration/bom').set(auth(estimator.token))
      .send({ bomTexts: [syntheticBomLine('x', 3.2).line] }).expect(403);
  });

  it('reports zero drift once the library exactly matches the BOM\'s own hours', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const { line, code } = syntheticBomLine(tag, 3.2);
    await pool.query(
      `INSERT INTO est_items (code, name, category, unit, material_cost, labor_hours, source, active)
       VALUES ($1,'test item','Branch Power','C',0,3.2,'accubid',true)`,
      [code]
    );
    try {
      const res = await request(app).post('/api/estimating/calibration/bom').set(auth(admin.token))
        .send({ bomTexts: [line] }).expect(200);
      expect(res.body.totalMatchedRows).toBe(1);
      expect(res.body.totalUnmatchedRows).toBe(0);
      expect(res.body.totalChrisHours).toBeCloseTo(3.2, 3);
      expect(res.body.totalEngineHours).toBeCloseTo(3.2, 3);
      const gap = res.body.categoryGaps.find((g: { category: string }) => g.category === 'Branch Power');
      expect(gap).toBeTruthy();
      expect(Math.abs(gap.suggestedAdjustmentPct)).toBeLessThan(0.01);
    } finally {
      await pool.query('DELETE FROM est_items WHERE code=$1', [code]);
    }
  });

  it('reports the drift when the library disagrees with the BOM (a doubled catalog rate)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const { line, code } = syntheticBomLine(tag, 4.0); // Chris's real hours
    await pool.query(
      `INSERT INTO est_items (code, name, category, unit, material_cost, labor_hours, source, active)
       VALUES ($1,'test item','Branch Power','C',0,2.0,'accubid',true)`, // engine's own rate is HALF
      [code]
    );
    try {
      const res = await request(app).post('/api/estimating/calibration/bom').set(auth(admin.token))
        .send({ bomTexts: [line] }).expect(200);
      const gap = res.body.categoryGaps.find((g: { category: string }) => g.category === 'Branch Power');
      expect(gap.suggestedAdjustmentPct).toBeCloseTo(100, 0); // chris/engine - 1 = 4/2 - 1 = 100%
    } finally {
      await pool.query('DELETE FROM est_items WHERE code=$1', [code]);
    }
  });

  it('rejects a request with nothing to compare', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    await request(app).post('/api/estimating/calibration/bom').set(auth(admin.token)).send({}).expect(400);
  });
});
