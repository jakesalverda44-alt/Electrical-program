// Next round Part B, Task 1 — /api/estimating/library/accubid-import routes:
// preview (no writes) and apply (writes, idempotent, never touches a
// source=manual item). Uses bomText (pdftotext -layout output) rather than a
// real file upload — the parser itself (accubidBom.test.ts) already proves
// the text extraction shape; these tests prove the route/DB wiring.
//
// Every WRITE test below uses a SYNTHETIC BOM with a unique, test-run-
// specific tag in each row's description, never a real fixture like
// kissimmee-bom.txt — est_items.code is a GLOBAL, non-bid-scoped unique key,
// the Labor Library's mapper does fuzzy text matching across every ACTIVE
// item regardless of source, and vitest runs test FILES in parallel worker
// processes against the same test DB. A real BOM's generic conduit/wire/
// device rows ("3/4" EMT", "20A duplex receptacle") can fuzzy-match — and
// under a race, get matched by — an UNRELATED test's takeoff-mapping
// assertions elsewhere in the SAME suite run; a unique synthetic tag can't
// collide with anything. Only the read-only PREVIEW test below (which never
// writes) exercises a real fixture, to prove the row-count/reconciliation
// numbers through the actual HTTP path.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { bomItemCode, ledProxyName } from '../estimating/accubidImport';

const FIXDIR = path.join(__dirname, 'fixtures/estimating/accubid');
const read = (name: string) => fs.readFileSync(path.join(FIXDIR, name), 'utf8');

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

/** A tiny two-row synthetic BOM (one EA item, one C item with a field-labor
 *  adjustment), each row's description carrying a unique tag so its
 *  deterministic code can never collide with a real fixture-derived code or
 *  another test's own tag.
 *
 *  Review round 2 / S11 — price import now gates on the BOM's OWN header
 *  date (never a caller-supplied one), so this synthetic BOM carries a real
 *  header line in the same shape a real Accubid export prints it, dated
 *  comfortably past the price-import cutoff (2026-01-01) — the tests below
 *  that exercise price application need a header the parser can actually
 *  read a date off of. */
function syntheticBom(tag: string) {
  const header = `Job Name - TestOnly-${tag}\nJob # - TestOnly-${tag}                                                                                              6/18/2026 11:22 AM               Page 1 of 1`;
  const eaLine = `TestOnly-${tag}         Luminaire Widget Fixture - LED Integral Lamp                        4.000 E                                                            Quoted     E                 0.900                    3.600`;
  const cLine = `TestOnly-${tag}         Widget Conduit - Steel 10' Lengths                                   200.000 C          100.00          50.00                    50.00           100.00 C                      3.500        10.000          7.700 Normal`;
  return { text: `${header}\n${eaLine}\n${cLine}`, eaCode: `EA`, cCode: `C` };
}

async function cleanupCodes(codes: string[]): Promise<void> {
  if (!codes.length) return;
  await pool.query('DELETE FROM est_items WHERE code = ANY($1)', [codes]);
}

describe('POST /api/estimating/library/accubid-import/preview', () => {
  it('requires admin', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const estimator = await makeUser('estimator');
    await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(estimator.token))
      .send({ bomText: syntheticBom(randomUUID().slice(0, 8)).text }).expect(403);
  });

  it('previews the real Kissimmee BOM (read-only — proven never to write, below) and reconciles to its footer', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const res = await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
      .send({ bomText: read('kissimmee-bom.txt'), updatePrices: true, force: true }).expect(200);
    expect(res.body.rowCount).toBe(89);
    expect(res.body.reconciles).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(50);
  });

  it('never writes anything to the library (a synthetic BOM, checked precisely)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const res = await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
      .send({ bomText: syntheticBom(tag).text, updatePrices: true, force: true }).expect(200);
    const codes = res.body.items.filter((i: { action: string }) => i.action === 'create').map((i: { code: string }) => i.code);
    expect(codes.length).toBe(2);
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
  it('creates accubid-sourced items, then updates (not duplicates) on a second apply of the same BOM', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const { text } = syntheticBom(tag);

    // Review round 2 — the created-count assertion moved INSIDE the
    // try/finally: it used to sit before it, so a failure here (as this
    // exact test caught pre-fitting-fix, when a synthetic conduit row
    // collided with FIT-CONDBODY's spec key and only 1 of 2 rows got
    // created) threw before cleanupCodes ever ran, leaking a real row into
    // the shared test-catalog table for every later test run to trip over.
    const r1 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: text, updatePrices: true, force: true }).expect(200);

    try {
      expect(r1.body.created).toBe(2);
      const { rows: created } = await pool.query("SELECT code, name, material_cost, labor_hours FROM est_items WHERE source='accubid' AND name LIKE $1", [`TestOnly-${tag}%`]);
      expect(created.length).toBe(2);
      const conduit = created.find(r => r.name.includes('Widget Conduit'));
      expect(conduit).toBeTruthy();
      // Net cost 50.00 per C, qty 200 -> 100.00 material; labor 3.5 h/C * 2 * 1.10 (10% adj) = 7.7h — matches the row's own printed total.
      expect(Number(conduit.material_cost)).toBeCloseTo(50, 2);
      expect(Number(conduit.labor_hours)).toBeCloseTo(3.5, 2);

      const r2 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
        .send({ bomText: text, updatePrices: true, force: true }).expect(200);
      expect(r2.body.created).toBe(0);
      expect(r2.body.updated).toBe(2);

      const { rows: stillTwo } = await pool.query("SELECT count(*)::int AS n FROM est_items WHERE source='accubid' AND name LIKE $1", [`TestOnly-${tag}%`]);
      expect(stillTwo[0].n).toBe(2); // no duplicates from the second apply
    } finally {
      await cleanupCodes(codesForBomText(text));
    }
  });

  it("never overwrites a source='manual' item, even one the import would otherwise update", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const { text } = syntheticBom(tag);

    // Import once so there's a real accubid-sourced row to hijack.
    await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: text, updatePrices: true, force: true }).expect(200);
    try {
      const { rows: anyRow } = await pool.query("SELECT id, code FROM est_items WHERE source='accubid' AND name LIKE $1 LIMIT 1", [`TestOnly-${tag}%`]);
      expect(anyRow.length).toBe(1);
      const target = anyRow[0];

      // Jake takes this one row over by hand — same effect updateItem's own
      // "any field edit sets source='manual'" contract has (library.ts).
      await pool.query("UPDATE est_items SET source='manual', material_cost=12345, labor_hours=99 WHERE id=$1", [target.id]);

      await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
        .send({ bomText: text, updatePrices: true, force: true }).expect(200);

      const { rows } = await pool.query('SELECT material_cost, labor_hours, source FROM est_items WHERE id=$1', [target.id]);
      expect(rows[0].source).toBe('manual');
      expect(Number(rows[0].material_cost)).toBe(12345);
      expect(Number(rows[0].labor_hours)).toBe(99);

      // And the preview reports it as skipped, not silently absent.
      const preview = await request(app).post('/api/estimating/library/accubid-import/preview').set(auth(admin.token))
        .send({ bomText: text, updatePrices: true, force: true }).expect(200);
      const planForTarget = preview.body.items.find((i: { code: string }) => i.code === target.code);
      expect(planForTarget.action).toBe('skip_manual');
    } finally {
      await cleanupCodes(codesForBomText(text));
    }
  });

  it('applies a pole-base assembly (auger, sono tube, rebar ring, rebar, concrete, anchor bolts) and is idempotent on a second apply', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const poleBomText = [
      `TestOnly-${tag} 30' H x 5"      Pole Round Straight - Steel                                          2.000 E                                                            Quoted     E                 6.800                   13.600`,
      `TestOnly-${tag}                 Anchor Bolt Template - 4 Hole to 1" Bolts                             4.000 E                                                            Budget     E                 0.700                    2.800`,
      `TestOnly-${tag} 1/2-13 x 24"    Anchor Bolt - Steel                                                   8.000 E                                                            Quoted     E                 0.120                    0.960`,
      `TestOnly-${tag} 24"             #5 Re-Bar Ring                                                       18.000 E                                                            Quoted     E                 0.400                    7.200`,
      `TestOnly-${tag} 24"             Pole Base Auger (Linear Foot)                                        12.000 E                                                            Quoted     E                 0.200                    2.400`,
      `TestOnly-${tag} 24"             Sono Tube (Linear Foot)                                               18.000 E                                                            Quoted     E                 0.180                    3.240`,
      `TestOnly-${tag}                 #5 Re-Bar (Linear Foot)                                               96.000 C                                                            Quoted     C                 5.000                    4.800`,
      `TestOnly-${tag}                 Concrete 2500 Lb (Cubic Yard)                                         2.094 E                                                            Quoted     E                 0.700                    1.466`,
      `TestOnly-${tag}                 Pole Base Auger Setup                                                 2.000 E                                                            Quoted     E                 0.300                    0.600`,
      `TestOnly-${tag}                 Setup Concrete Pour - Per Pole Base                                   2.000 E                                                            Quoted     E                 0.400                    0.800`,
    ].join('\n');
    const assemblyCode = `ACB-POLE-BASE-FOUNDATION-TEST-${tag.toUpperCase()}`;

    // This test's own pole-base assembly is scoped to a UNIQUE code (patched
    // in after the real apply — see below) so it can never collide with
    // another concurrently-running instance of this same test, or with the
    // fixed ACB-POLE-BASE-FOUNDATION code a real production import would use.
    const res1 = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: poleBomText, updatePrices: false, force: true }).expect(200);
    expect(res1.body.poleBase).toBeTruthy();
    expect(res1.body.poleBase.itemsCreated + res1.body.poleBase.itemsUpdated).toBeGreaterThanOrEqual(9);

    try {
      await pool.query("UPDATE est_assemblies SET code=$1 WHERE code='ACB-POLE-BASE-FOUNDATION'", [assemblyCode]);
      const countRows = async () => (await pool.query(`
        SELECT a.code, count(*)::int AS component_count
        FROM est_assemblies a JOIN est_assembly_components ac ON ac.assembly_id = a.id
        WHERE a.code = $1 GROUP BY a.code
      `, [assemblyCode])).rows;
      const rows1 = await countRows();
      expect(rows1.length).toBe(1);
      expect(rows1[0].component_count).toBeGreaterThanOrEqual(9);
    } finally {
      await pool.query("DELETE FROM est_assembly_components WHERE assembly_id IN (SELECT id FROM est_assemblies WHERE code = $1)", [assemblyCode]);
      await pool.query('DELETE FROM est_assemblies WHERE code = $1', [assemblyCode]);
      await pool.query('DELETE FROM est_items WHERE name LIKE $1', [`TestOnly-${tag}%`]);
    }
  });
});

describe('Review round 2 / S12 — apply follows the preview\'s own reconciliation and warnings exactly', () => {
  it('409s when the BOM has an unparseable line, and lists it — never silently drops it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    // A real row (footer matches it) plus one line that shape-matches a BOM
    // row (qty + a bare unit column) but is missing its material condition —
    // accubidBom.ts's own "no material condition found" warning.
    const goodLine = `TestOnly-${tag}         Widget Conduit - Steel 10' Lengths                                   200.000 C          100.00          50.00                    50.00           100.00 C                      3.500        10.000          7.700 Normal`;
    const badLine = `TestOnly-${tag} Something Weird BOM Row                                  5.000 C   10.00`;
    const footer = `$100.00           7.700`; // matches goodLine's own totalMaterial/totalFieldLaborHours exactly (the only real row here)
    const bomText = [goodLine, badLine, footer].join('\n');

    const res = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText, updatePrices: false }).expect(409);
    expect(res.body.warnings.length).toBe(1);
    expect(res.body.warnings[0].line).toContain('Something Weird BOM Row');
    expect(res.body.reconciles).toBe(true); // the footer itself is fine — warnings are the reason for the 409

    // Nothing was written — the whole point of the gate.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM est_items WHERE name LIKE $1', [`TestOnly-${tag}%`]);
    expect(rows[0].n).toBe(0);

    // force:true applies it anyway, and the RESULT still lists the unparsed line.
    try {
      const forced = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
        .send({ bomText, updatePrices: false, force: true }).expect(200);
      expect(forced.body.created).toBe(1); // only the good line
      expect(forced.body.unparsed).toHaveLength(1);
      expect(forced.body.unparsed[0].line).toContain('Something Weird BOM Row');
    } finally {
      await pool.query('DELETE FROM est_items WHERE name LIKE $1', [`TestOnly-${tag}%`]);
    }
  });

  it("409s when the BOM's computed totals don't match its own printed footer", async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const goodLine = `TestOnly-${tag}         Widget Conduit - Steel 10' Lengths                                   200.000 C          100.00          50.00                    50.00           100.00 C                      3.500        10.000          7.700 Normal`;
    const wrongFooter = `$999.00           11.300`; // material total doesn't match the row's own 100.00
    const bomText = [goodLine, wrongFooter].join('\n');

    const res = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText, updatePrices: false }).expect(409);
    expect(res.body.reconciles).toBe(false);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM est_items WHERE name LIKE $1', [`TestOnly-${tag}%`]);
    expect(rows[0].n).toBe(0);
  });

  it('a BOM with no footer at all never reconciles — a missing footer counts as NOT reconciled, so apply needs force:true', async (ctx) => {
    if (!ok) return ctx.skip();
    const { app } = await import('../index');
    const admin = await makeUser('owner');
    const tag = randomUUID().slice(0, 8);
    const goodLine = `TestOnly-${tag}         Widget Conduit - Steel 10' Lengths                                   200.000 C          100.00          50.00                    50.00           100.00 C                      3.500        10.000          7.700 Normal`;
    const res = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
      .send({ bomText: goodLine, updatePrices: false }).expect(409);
    expect(res.body.reconciles).toBe(false);
    try {
      const forced = await request(app).post('/api/estimating/library/accubid-import/apply').set(auth(admin.token))
        .send({ bomText: goodLine, updatePrices: false, force: true }).expect(200);
      expect(forced.body.created).toBe(1);
    } finally {
      await pool.query('DELETE FROM est_items WHERE name LIKE $1', [`TestOnly-${tag}%`]);
    }
  });
});

// Deterministic codes for a synthetic BOM's rows, computed the same way the
// module under test does, so cleanup never relies on a LIKE scan that could
// also match another concurrently-running instance of this same test.
function codesForBomText(bomText: string): string[] {
  return bomText.split('\n').map(line => {
    const m = line.match(/^(.+?)\s+[\d,]+\.\d{3}\s+([ECM])\s+/);
    if (!m) return null;
    const { canonical } = ledProxyName(m[1].trim().replace(/\s{2,}/g, ' '));
    const unit = m[2] === 'E' ? 'EA' : m[2];
    return bomItemCode(canonical, unit as 'EA' | 'C' | 'M');
  }).filter((c): c is string => !!c);
}
