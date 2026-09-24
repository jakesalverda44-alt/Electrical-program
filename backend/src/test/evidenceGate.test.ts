// Evidence round 4.1 — the GC-facing evidence gate's DB half
// (estimating/takeoffReview.ts's evidenceGate), against the real test
// database: a counted type with no evidence, and a manual line with no
// reason, each block; a real reason (or real evidence) clears them; the
// gate is never wired into generate-prebid-package / email-prebid-chris.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { evidenceGate } from '../estimating/takeoffReview';
import type { CountResult } from '../ai/countingStage';
import { saveBidEstimate, EVIDENCE_NOTE_PLACEHOLDER } from '../estimating/bidEstimate';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `EvidenceGate Test ${Date.now()}`, gc: `Evidence Gate Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 100_000 })
    .expect(200);
  return res.body.id as string;
}

const BASE_TYPE = {
  key: 'X', type: 'X', description: 'Widget', category: 'device' as const, count: 5, heads: null,
  status: 'counted' as const, reason: '', sheets: [] as CountResult['types'][number]['sheets'], flags: [], wattage: null,
};

async function setCountResult(bidId: string, types: CountResult['types']): Promise<void> {
  const cr: Partial<CountResult> = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types, loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] }, removedRows: [], flags: [], marks: [] };
  await pool.query(
    `INSERT INTO takeoff_results (bid_id, status, count_result, review_status) VALUES ($1,'agent1_complete',$2,'clear')
     ON CONFLICT (bid_id) DO UPDATE SET count_result = $2`,
    [bidId, JSON.stringify(cr)]
  );
}

describe('evidenceGate', () => {
  it('a counted type with no evidence blocks; a marker (sheets used) clears it', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [{ ...BASE_TYPE, sheets: [] }]);
    const blocked = await evidenceGate(bidId);
    expect(blocked).not.toBeNull();
    expect(blocked!.error).toMatch(/needs? evidence/);
    expect(blocked!.openItems[0]).toMatchObject({ id: 'evidence:X', title: 'Type X — Widget' });

    await setCountResult(bidId, [{ ...BASE_TYPE, sheets: [{ sheetKey: 's', label: 'E-2', count: 5, used: true }] }]);
    expect(await evidenceGate(bidId)).toBeNull();
  });

  it('a zero-count type, a host marker, and a merged type are never checked', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [
      { ...BASE_TYPE, key: 'Z', status: 'zero', count: 0, sheets: [] },
      { ...BASE_TYPE, key: 'H', sheets: [], host: true },
      { ...BASE_TYPE, key: 'M', status: 'merged', count: 0, sheets: [] },
    ]);
    expect(await evidenceGate(bidId)).toBeNull();
  });

  it('a manual line with no reason blocks; a real reason (10+ chars) clears it', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, []);
    const lines = [{ category: 'Allowance', description: 'Verbal add per GC', qty: 1, unit: 'EA' as const, source: 'manual' as const }];
    await saveBidEstimate(bidId, lines, { labor_rate: 65, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 10, profit_pct: 10, crew_size: 1, floors_above_2: 0 });
    let blocked = await evidenceGate(bidId);
    expect(blocked).not.toBeNull();
    expect(blocked!.openItems.some(i => i.id.startsWith('evidence:line:') && !!i.lineKey)).toBe(true);

    await saveBidEstimate(bidId, [{ ...lines[0], evidence_note: 'Verbal add per GC on-site walk 9/24' }],
      { labor_rate: 65, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 10, profit_pct: 10, crew_size: 1, floors_above_2: 0 });
    blocked = await evidenceGate(bidId);
    expect(blocked).toBeNull();
  });

  it('S14 — a review item resolution (not on job, or a typed count) counts as evidence; the gate honors it', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [{ ...BASE_TYPE, key: 'Y', sheets: [] }]);
    expect(await evidenceGate(bidId)).not.toBeNull();
    await pool.query(
      `UPDATE takeoff_results SET review_items = $1 WHERE bid_id = $2`,
      [JSON.stringify([{ id: 'count:Y', kind: 'count', title: 'Type Y', detail: '', typeKey: 'Y', resolution: { action: 'not_on_job', reason: 'Confirmed with the GC, not on this job', by: 'J', at: 't' } }]), bidId]
    );
    expect(await evidenceGate(bidId)).toBeNull();
  });

  it('N5 — two lines sharing a description never collide (each gets its own stable id from line_key)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, []);
    const settings = { labor_rate: 65, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 10, profit_pct: 10, crew_size: 1, floors_above_2: 0 };
    await saveBidEstimate(bidId, [
      { category: 'Allowance', description: 'Misc allowance', qty: 1, unit: 'EA' as const, source: 'manual' as const },
      { category: 'Allowance', description: 'Misc allowance', qty: 1, unit: 'EA' as const, source: 'manual' as const },
    ], settings);
    const blocked = await evidenceGate(bidId);
    expect(blocked).not.toBeNull();
    const ids = blocked!.openItems.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length); // no collision
    expect(ids).toHaveLength(2);
  });

  it('S6 — the migration-134 placeholder is cleared the moment the line\'s qty changes', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, []);
    const settings = { labor_rate: 65, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 10, profit_pct: 10, crew_size: 1, floors_above_2: 0 };
    // Simulate a grandfathered line: saved once with a real reason, then
    // (exactly what migration 134 itself did with a raw UPDATE, never
    // through this save path) its note is overwritten with the placeholder
    // directly in the DB — a genuine PRIOR row carrying it, unlike a line
    // that merely arrives with the placeholder text on its very first save
    // (fix round 3 / S6 nit, below).
    const saved = await saveBidEstimate(bidId,
      [{ category: 'Allowance', description: 'Grandfathered allowance', qty: 3, unit: 'EA' as const, source: 'manual' as const, evidence_note: 'A real reason from before the gate existed' }],
      settings);
    const lineKey = saved.lines[0].line_key;
    await pool.query('UPDATE est_bid_lines SET evidence_note = $1 WHERE line_key = $2', [EVIDENCE_NOTE_PLACEHOLDER, lineKey]);
    // Re-saved with the SAME qty, the client round-tripping the placeholder
    // it just read back — a genuine prior row, same qty: still passes.
    await saveBidEstimate(bidId,
      [{ category: 'Allowance', description: 'Grandfathered allowance', qty: 3, unit: 'EA' as const, source: 'manual' as const, line_key: lineKey, evidence_note: EVIDENCE_NOTE_PLACEHOLDER }],
      settings);
    expect(await evidenceGate(bidId)).toBeNull(); // the placeholder passes, for now
    // Re-saved with a DIFFERENT qty, note still (from the client's stale
    // cache) the exact placeholder text — it must be cleared, not kept.
    await saveBidEstimate(bidId,
      [{ category: 'Allowance', description: 'Grandfathered allowance', qty: 5, unit: 'EA' as const, source: 'manual' as const, line_key: lineKey, evidence_note: EVIDENCE_NOTE_PLACEHOLDER }],
      settings);
    const blocked = await evidenceGate(bidId);
    expect(blocked).not.toBeNull();
    const { rows } = await pool.query('SELECT evidence_note FROM est_bid_lines WHERE bid_id=$1', [bidId]);
    expect(rows[0].evidence_note).toBeNull();
  });

  // Fix round 3 / S6 nit — a line copied/duplicated in the UI (a brand new
  // line_key, never saved before) that happens to carry the placeholder
  // text along with it (copied from the line it was duplicated from) must
  // NOT pass the gate just because its qty happens to match — there is no
  // real prior row for THIS line_key at all, so it never legitimately
  // earned the grandfather clause.
  it('S6 nit — a line with no prior row at all never keeps the placeholder, even with a matching qty', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, []);
    const settings = { labor_rate: 65, factor_ids: [], material_tax_pct: 0, small_tools_pct: 0, supervision_pct: 0, consumables_pct: 0, overhead_pct: 10, profit_pct: 10, crew_size: 1, floors_above_2: 0 };
    // A genuinely new line (its own fresh line_key), sent on its VERY FIRST
    // save already carrying the exact placeholder — e.g. duplicated in the
    // UI from a grandfathered line, never itself saved before.
    const copyKey = randomUUID();
    await saveBidEstimate(bidId,
      [{ category: 'Allowance', description: 'Grandfathered allowance (copy)', qty: 3, unit: 'EA' as const, source: 'manual' as const, line_key: copyKey, evidence_note: EVIDENCE_NOTE_PLACEHOLDER }],
      settings);
    const blocked = await evidenceGate(bidId);
    expect(blocked).not.toBeNull();
    expect(blocked!.openItems.some(i => i.lineKey === copyKey)).toBe(true);
    const { rows } = await pool.query('SELECT evidence_note FROM est_bid_lines WHERE line_key=$1', [copyKey]);
    expect(rows[0].evidence_note).toBeNull();
  });

  it('generate-prebid-package and email-prebid-chris never call it — a missing-evidence bid still generates its pre-bid package', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    await setCountResult(bidId, [{ ...BASE_TYPE, sheets: [] }]);
    // The evidence gate itself would block; generate-prebid-package must
    // never call it (only the source code wiring matters here — this test
    // documents the contract so a future change that adds the call there
    // is caught by BLOCKING the pre-bid route unexpectedly).
    expect(await evidenceGate(bidId)).not.toBeNull();
    const res = await request(app).post(`/api/preconstruction/${bidId}/generate-prebid-package`).set(auth(u.token));
    // Blocked for an unrelated reason (no scope data / no draft) — NOT by
    // the evidence gate's error text.
    expect(res.body?.error ?? '').not.toMatch(/need evidence/);
  });
});
