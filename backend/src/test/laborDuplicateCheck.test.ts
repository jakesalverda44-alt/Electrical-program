// Next round A7 — the blocking duplicate check in Labor & Pricing: the
// re-run reset review's repro (kept "Duplex receptacle" 34 unbound, a fresh
// "Duplex receptacle, 20A" 30 from the new takeoff) blocks the save and the
// proposal until the estimator resolves it.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth, type TestUser } from './harness';
import { laborDuplicatePairs, type DupLine } from '../estimating/duplicateLines';
import { takeoffGate } from '../estimating/takeoffReview';

const RUN = '11111111-2222-3333-4444-555555555555';

describe('laborDuplicatePairs (pure)', () => {
  const kept: DupLine = { line_key: 'k1', category: 'Branch Power', description: 'Duplex receptacle', unit: 'EA', qty: 34, source: 'takeoff', recheck_run_id: RUN, recheck_reason: 'no_confident_match' };
  const fresh: DupLine = { line_key: 'n1', category: 'Branch Power', description: 'Duplex receptacle, 20A', unit: 'EA', qty: 30, source: 'takeoff' };
  it('the review repro is a pair', () => {
    expect(laborDuplicatePairs([kept, fresh])).toEqual([expect.objectContaining({ keptKey: 'k1', newKey: 'n1', keptQty: 34, newQty: 30 })]);
  });
  it('not a pair: a bound line, a different unit, a feeder, an excluded line, a different size, a "keep both" decision', () => {
    expect(laborDuplicatePairs([{ ...kept, recheck_reason: null }, fresh])).toEqual([]);
    expect(laborDuplicatePairs([kept, { ...fresh, unit: 'LF' }])).toEqual([]);
    expect(laborDuplicatePairs([kept, { ...fresh, category: 'Service & Distribution', description: 'Feeder to receptacle panel' }])).toEqual([]);
    expect(laborDuplicatePairs([kept, { ...fresh, excluded: true }])).toEqual([]);
    expect(laborDuplicatePairs([
      { ...kept, category: 'Interior Lighting', description: "8' LED strip" },
      { ...fresh, category: 'Interior Lighting', description: "4' LED strip" },
    ])).toEqual([]);
    expect(laborDuplicatePairs([{ ...kept, dup_ok: { with: ['n1'], reason: 'Different rooms — both are real' } }, fresh])).toEqual([]);
    // The re-run review's repro: a GFCI is not the kept plain duplex.
    expect(laborDuplicatePairs([kept, { ...fresh, description: 'GFCI receptacle, weather-resistant' }])).toEqual([]);
  });
});

let ok = false; let user: TestUser;
beforeAll(async () => { ok = await dbAvailable(); if (ok) user = await makeUser('owner'); }, 30_000);

async function bidWithPair(): Promise<{ bidId: string; keptKey: string; newKey: string }> {
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, salesperson_id) VALUES ($1, 'GC', $2) RETURNING id`, [`Dup ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, user.id]);
  const bidId = rows[0].id as string;
  const { rows: k } = await pool.query(
    `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, takeoff_key, source, qty_overridden, qty_source, recheck_run_id, recheck_reason)
     VALUES ($1, 0, 'Branch Power', 'Duplex receptacle', 34, 'EA', 'Power||6.1', 'takeoff', true, 'manual', $2, 'no_confident_match') RETURNING line_key`, [bidId, RUN]);
  const { rows: n } = await pool.query(
    `INSERT INTO est_bid_lines (bid_id, sort, category, description, qty, unit, takeoff_key, source)
     VALUES ($1, 1, 'Branch Power', 'Duplex receptacle, 20A', 30, 'EA', 'Power||6.4', 'takeoff') RETURNING line_key`, [bidId]);
  return { bidId, keptKey: k[0].line_key, newKey: n[0].line_key };
}

describe('Labor & Pricing: a possible duplicate blocks the save and the proposal', () => {
  it('GET lists it; saving 409s; the proposal gate blocks', async () => {
    if (!ok) return;
    const { bidId, keptKey, newKey } = await bidWithPair();
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(user.token));
    expect(got.status).toBe(200);
    expect(got.body.duplicates).toEqual([expect.objectContaining({ keptKey, newKey })]);
    const save = await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({ lines: got.body.lines, settings: got.body.settings });
    expect(save.status).toBe(409);
    expect(save.body.error).toMatch(/^Possible duplicate: "Duplex receptacle" \(34 EA, kept from the previous run\) and "Duplex receptacle, 20A" \(30 EA, new takeoff line\)/);
    const gate = await takeoffGate(bidId);
    expect(gate?.error).toMatch(/Labor & Pricing has a possible duplicate/);
  });

  it('resolved: remove the new line -> saves; or keep both with a reason (round-trips; short reasons do not count)', async () => {
    if (!ok) return;
    const a = await bidWithPair();
    const gotA = await request(app).get(`/api/estimating/${a.bidId}`).set(auth(user.token));
    const removed = await request(app).put(`/api/estimating/${a.bidId}`).set(auth(user.token))
      .send({ lines: gotA.body.lines.filter((l: { line_key: string }) => l.line_key !== a.newKey), settings: gotA.body.settings });
    expect(removed.status).toBe(200);
    expect(await takeoffGate(a.bidId)).toBeNull();

    const b = await bidWithPair();
    const gotB = await request(app).get(`/api/estimating/${b.bidId}`).set(auth(user.token));
    const withShort = gotB.body.lines.map((l: { line_key: string }) => l.line_key === b.keptKey ? { ...l, dup_ok: { with: [b.newKey], reason: 'meh' } } : l);
    expect((await request(app).put(`/api/estimating/${b.bidId}`).set(auth(user.token)).send({ lines: withShort, settings: gotB.body.settings })).status).toBe(409);
    const withReason = gotB.body.lines.map((l: { line_key: string }) => l.line_key === b.keptKey ? { ...l, dup_ok: { with: [b.newKey], reason: 'Different rooms — both are real' } } : l);
    const kept = await request(app).put(`/api/estimating/${b.bidId}`).set(auth(user.token)).send({ lines: withReason, settings: gotB.body.settings });
    expect(kept.status).toBe(200);
    expect(kept.body.lines.find((l: { line_key: string }) => l.line_key === b.keptKey).dup_ok).toMatchObject({ with: [b.newKey], reason: 'Different rooms — both are real' });
    expect(await takeoffGate(b.bidId)).toBeNull();
  });
});

it('ran against the test database (not skipped)', () => { expect(ok).toBe(true); });

describe('fix round S10 — the duplicate gate', () => {
  const kept = (description: string, category = 'Exterior Site Lighting'): DupLine => ({ line_key: 'k', category, description, unit: 'EA', qty: 3, source: 'takeoff', recheck_run_id: RUN, recheck_reason: 'no_confident_match' });
  const fresh = (description: string, category = 'Exterior Site Lighting'): DupLine => ({ line_key: 'n', category, description, unit: 'EA', qty: 3, source: 'takeoff' });
  it.each([
    ['Pole light S1', 'S1 site pole'],
    ['Fixture type C', 'Type C'],
  ])('catches %s vs %s', (a, b) => {
    expect(laborDuplicatePairs([kept(a, 'Interior Lighting'), fresh(b, 'Interior Lighting')])).toHaveLength(1);
  });
  it.each([
    ['2x4 LED troffer', '2x2 LED troffer', 'Interior Lighting'],
    ['Duplex receptacle', 'Quad receptacle', 'Branch Power'],
    ['USB receptacle', 'Duplex receptacle', 'Branch Power'],
    ['Type A1 strip', 'Type A2 strip', 'Interior Lighting'],
  ])('no false pair: %s vs %s', (a, b, cat) => {
    expect(laborDuplicatePairs([kept(a, cat), fresh(b, cat)])).toEqual([]);
  });
});

describe('fix round S10 — "remove the new line" is a tombstone that survives a sync', () => {
  it('the new takeoff line is excluded (not deleted); sync keeps it excluded; the pair does not come back', async () => {
    if (!ok) return;
    const { bidId, newKey } = await bidWithPair();
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, agent2_output) VALUES ($1, 'complete', $2)`, [bidId, JSON.stringify({ takeoff: [
      { category: 'Branch Power', item: '6.4', spec: 'Duplex receptacle, 20A', qty: 30, unit: 'EA', confidence: 'FIRM' },
    ] })]);
    await pool.query(`UPDATE est_bid_lines SET takeoff_key='Branch Power||6.4' WHERE line_key=$1`, [newKey]);
    const got = await request(app).get(`/api/estimating/${bidId}`).set(auth(user.token));
    const lines = got.body.lines.map((l: { line_key: string }) => l.line_key === newKey ? { ...l, excluded: true, sync_excluded: false } : l);
    expect((await request(app).put(`/api/estimating/${bidId}`).set(auth(user.token)).send({ lines, settings: got.body.settings })).status).toBe(200);
    const synced = await request(app).post(`/api/estimating/${bidId}/sync-takeoff`).set(auth(user.token));
    expect(synced.status).toBe(200);
    expect(synced.body.duplicates).toEqual([]);
    const after = synced.body.lines.filter((l: { description: string }) => l.description === 'Duplex receptacle, 20A');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ line_key: newKey, excluded: true });
    expect(await takeoffGate(bidId)).toBeNull();
  });
});

