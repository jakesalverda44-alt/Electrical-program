// Next round Part B, Task 1 — /api/estimating/library/accubid-import routes:
// preview (no writes) and apply (writes, idempotent, never touches a
// source=manual item). Uses bomText (pdftotext -layout output) rather than a
// real file upload — the parser itself (accubidBom.test.ts) already proves
// the text extraction shape; these tests prove the route/DB wiring.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';

const FIXDIR = path.join(__dirname, 'fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

/** Every test in this file imports the SAME real BOMs, so it always starts
 *  from a clean slate for the codes/assembly it's about to touch — otherwise
 *  a test run's leftover ACB-* rows from an earlier test in this same file
 *  (deliberately, since idempotency IS the thing under test) would make a
 *  later, unrelated test's counts depend on execution order. */
async function cleanAccubidImportRows(): Promise<void> {
  await pool.query("DELETE FROM est_assembly_components WHERE assembly_id IN (SELECT id FROM est_assemblies WHERE code='ACB-POLE-BASE-FOUNDATION')");
  await pool.query("DELETE FROM est_assemblies WHERE code='ACB-POLE-BASE-FOUNDATION'");
  await pool.query("DELETE FROM est_items WHERE code LIKE 'ACB-%' AND code NOT LIKE 'ACB-TESTONLY-%'");
}

describe('POST /api/estimating/library/accubid-import/preview', () => {
  beforeEach(async () => { if (ok) await cleanAccubidImportRows(); });

  it('requires admin', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(estimator.token))
      .send({ bomText: read('kissimmee-bom.txt') }).expect(403);
  });

  it('previews the Kissimmee BOM without writing anything to the library', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const res = await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true }).expect(200);
    expect(res.body.rowCount).toBe(89);
    expect(res.body.reconciles).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(50);
    // Scoped to exactly the codes this preview would create (never a blanket
    // global count — other test FILES run in parallel against the same
    // shared, non-bid-scoped est_items table and legitimately write their
    // own accubid-sourced rows at the same time).
    const codes = res.body.items.filter((i: { action: string }) => i.action === 'create').map((i: { code: string }) => i.code);
    expect(codes.length).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM est_items WHERE code = ANY($1)', [codes]);
    expect(rows[0].n).toBe(0);
  });

  it('rejects a request with neither a file nor bomText', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
      .send({}).expect(400);
  });
});

describe('POST /api/estimating/library/accubid-import/apply', () => {
  beforeEach(async () => { if (ok) await cleanAccubidImportRows(); });

  it('creates accubid-sourced items, then updates (not duplicates) on a second apply of the same BOM', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');

    const r1 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true, bomDate: '2026-06-18' }).expect(200);
    expect(r1.body.created).toBeGreaterThan(0);

    const { rows: created } = await pool.query("SELECT code, material_cost, labor_hours FROM est_items WHERE source='accubid' AND code LIKE 'ACB-%' AND code NOT LIKE 'ACB-TESTONLY-%'");
    expect(created.length).toBe(r1.body.created);
    const emt = created.find(r => r.code.includes('EMT') && r.code.includes('C'));
    expect(emt).toBeTruthy();

    const r2 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true, bomDate: '2026-06-18' }).expect(200);
    expect(r2.body.created).toBe(0);
    expect(r2.body.updated).toBe(r1.body.created);

    const { rows: stillOne } = await pool.query("SELECT count(*)::int AS n FROM est_items WHERE source='accubid' AND code LIKE 'ACB-%' AND code NOT LIKE 'ACB-TESTONLY-%'");
    expect(stillOne[0].n).toBe(created.length); // no duplicates from the second apply
  });

  it("never overwrites a source='manual' item, even one the import would otherwise update", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');

    // Import once so there's a real accubid-sourced row to hijack.
    await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true, bomDate: '2026-06-18' }).expect(200);
    const { rows: anyRow } = await pool.query("SELECT id, code FROM est_items WHERE source='accubid' AND code LIKE 'ACB-%' AND code NOT LIKE 'ACB-TESTONLY-%' LIMIT 1");
    expect(anyRow.length).toBe(1);
    const target = anyRow[0];

    // Jake takes this one row over by hand — same effect updateItem's own
    // "any field edit sets source='manual'" contract has (library.ts).
    await pool.query("UPDATE est_items SET source='manual', material_cost=12345, labor_hours=99 WHERE id=$1", [target.id]);

    await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true, bomDate: '2026-06-18' }).expect(200);

    const { rows } = await pool.query('SELECT material_cost, labor_hours, source FROM est_items WHERE id=$1', [target.id]);
    expect(rows[0].source).toBe('manual');
    expect(Number(rows[0].material_cost)).toBe(12345);
    expect(Number(rows[0].labor_hours)).toBe(99);

    // And the preview reports it as skipped, not silently absent.
    const preview = await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), applyPrices: true, bomDate: '2026-06-18' }).expect(200);
    const planForTarget = preview.body.items.find((i: { code: string }) => i.code === target.code);
    expect(planForTarget.action).toBe('skip_manual');
  });

  it('applies the North Port pole-base assembly (auger, sono tube, rebar ring, rebar, concrete, anchor bolts) and is idempotent on a second apply', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');

    const res1 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('north-port-bom.txt'), applyPrices: false }).expect(200);
    expect(res1.body.poleBase).toBeTruthy();
    // Every pole-base component is ALSO a plain BOM row, so the main import
    // loop (which runs first, in the same request) always creates them —
    // applyPoleBaseAssembly's own pass then just links/updates them.
    expect(res1.body.poleBase.itemsCreated + res1.body.poleBase.itemsUpdated).toBeGreaterThanOrEqual(6);

    const countRows = async () => (await pool.query(`
      SELECT a.code, count(*)::int AS component_count
      FROM est_assemblies a JOIN est_assembly_components ac ON ac.assembly_id = a.id
      WHERE a.code = 'ACB-POLE-BASE-FOUNDATION' GROUP BY a.code
    `)).rows;

    const rows1 = await countRows();
    expect(rows1.length).toBe(1);
    expect(rows1[0].component_count).toBeGreaterThanOrEqual(6);

    // Idempotent: applying the SAME BOM again updates the same 9 components,
    // never duplicates them (and the assembly itself must not be locked out
    // of future updates just because createAssembly's own default is
    // source='manual' — see accubidImport.ts's markAssemblyAccubidSource).
    const res2 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: read('north-port-bom.txt'), applyPrices: false }).expect(200);
    expect(res2.body.poleBase.itemsCreated).toBe(0);
    expect(res2.body.poleBase.itemsUpdated).toBeGreaterThan(0);
    const rows2 = await countRows();
    expect(rows2[0].component_count).toBe(rows1[0].component_count);
  });
});
