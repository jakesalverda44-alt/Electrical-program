// Fix round 4 / B13 + N9 — a site-lighting member of a gap-fill/reconcile
// finding answers in HEADS, but "Use confirmed markers" tallies POLE
// symbols. Through the real /review/resolve route (test DB): the tally is
// POLES; heads = poles x heads-per-pole when the schedule states it, else a
// blocking "enter heads"; a heads answer whose poles can't be derived keeps
// the item blocking until the pole count is entered.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { buildReviewItems, enforcedCounts, reviewItemIsOpen, headsMemberResolution, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

function siteCR(headsPerPole: number | null): CountResult {
  const sheetKey = 'site.pdf#1';
  return {
    version: 2, ran: true, model: 'm',
    targets: [{ type: 'S2', key: 'S2', description: 'Twin-head area light (synthetic)', symbolHint: '', wattage: null, category: 'site_lighting', source: 'fixture_schedule', sourceSheet: 'E-1', headsPerPole, emergency: false }],
    targetNotes: [], skippedSheets: [],
    sheets: [{ key: sheetKey, file: 'site.pdf', page: 1, label: 'E-1', role: 'site', focus: 'lighting', level: '', status: 'counted', calls: 1, tiles: 1, geometryOk: true, geometry: { widthPt: 792, heightPt: 612, rotation: 0 }, mergedDuplicates: 0, rejected: 0, notes: [], unreadable: [] }],
    types: [{ key: 'S2', type: 'S2', description: 'Twin-head area light (synthetic)', category: 'site_lighting', count: 1, heads: headsPerPole ? headsPerPole : null, status: 'counted', reason: '', sheets: [{ sheetKey, label: 'E-1', count: 1, used: true, eligible: true }], flags: [], wattage: null }],
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [], marks: [{ sheetKey, typeKey: 'S2', x: 100, y: 100 }],
    evidence: {
      model: 'm', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, calls: 0, cached: 0, errors: [],
      pages: [], typicals: [], expansions: [], unmappedTypical: [], tables: [], families: [], symbolDefinitions: [], circuitRows: 0, scheduleOwned: [], panelsExpected: 0, panelsUnread: [],
      gapFill: {
        findings: [{ typeKey: 'S2', kind: 'schedule_qty', direction: 'under', source: 'LUMINAIRE SCHEDULE (synthetic)', expected: 4, actual: 2, diff: 2, reason: 'schedule QTY 4 heads; the plans account for 2 — 2 short.' }],
        jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 1,
        suggested: [{ typeKey: 'S2', sheetKey, x: 300, y: 100, confidence: 'high', note: 'second pole' }],
        calls: 2, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [],
      },
    },
  } as unknown as CountResult;
}

async function setup(headsPerPole: number | null, confirmedPoles: number) {
  const u = await makeUser('owner');
  const bid = await request(app).post('/api/bids').set(auth(u.token)).send({ name: `HeadsMember ${Date.now()}`, gc: `HM GC ${Math.random().toString(36).slice(2, 8)}`, amount: 1 }).expect(200);
  const bidId = bid.body.id as string;
  const { rows } = await pool.query(`INSERT INTO documents (linked_id, name, category, file_size, file_type, uploaded_by, file_data) VALUES ($1,'site.pdf','plans',10,'application/pdf','t',$2) RETURNING id`, [bidId, Buffer.from('x').toString('base64')]);
  const cr = siteCR(headsPerPole);
  const items = buildReviewItems(cr);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result, review_items, review_status) VALUES ($1,'complete',$2,$3,'needs_review')`, [bidId, JSON.stringify(cr), JSON.stringify(items)]);
  for (let i = 0; i < confirmedPoles; i++) {
    await pool.query(`INSERT INTO est_markups (bid_id, document_id, page_index, kind, points, status, label, source, created_by) VALUES ($1,$2,0,'count',$3,'confirmed','S2','gap_fill','t')`, [bidId, rows[0].id, JSON.stringify([{ x: 100 + 200 * i, y: 100 }])]);
  }
  const item = items.find(i => i.id === 'gapfill:S2')!;
  return { u, bidId, cr, item };
}
const resolve = (bidId: string, token: string, body: Record<string, unknown>) => request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(token)).send(body);
const stored = async (bidId: string) => (await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id=$1', [bidId])).rows[0].review_items as ReviewItem[];

describe('fix round 4 / B13 — "Use confirmed markers" on a twin-head member', () => {
  it('the reviewer\'s repro: 2 confirmed pole markers on S2 (2 heads per pole) -> 2 poles, 4 heads', async (ctx) => {
    if (!ok) return ctx.skip();
    const { u, bidId, cr, item } = await setup(2, 2);
    expect(item.reconcileMembers![0]).toMatchObject({ key: 'S2', unit: 'heads', headsPerPole: 2 });
    await resolve(bidId, u.token, { itemIds: [item.id], action: 'markers', memberKey: 'S2' }).expect(200);
    const items = await stored(bidId);
    const e = enforcedCounts(cr, items).byType;
    expect([e.get('S2'), e.get('S2:heads')]).toEqual([2, 4]);
    expect(reviewItemIsOpen(items.find(i => i.id === item.id)!)).toBe(false);
  });
  it('heads per pole unknown: the tally sets the POLES and a blocking "enter heads" stays open; the heads answer completes it', async (ctx) => {
    if (!ok) return ctx.skip();
    const { u, bidId, cr, item } = await setup(null, 2);
    await resolve(bidId, u.token, { itemIds: [item.id], action: 'markers', memberKey: 'S2' }).expect(200);
    let items = await stored(bidId);
    let it = items.find(i => i.id === item.id)!;
    expect(it.reconcileMembers![0].resolution).toMatchObject({ poles: 2, needs: 'heads' });
    expect(reviewItemIsOpen(it)).toBe(true);
    expect(enforcedCounts(cr, items).byType.get('S2')).toBe(2);
    await resolve(bidId, u.token, { itemIds: [item.id], action: 'count', qty: 3, memberKey: 'S2' }).expect(200);
    items = await stored(bidId);
    it = items.find(i => i.id === item.id)!;
    expect(reviewItemIsOpen(it)).toBe(false);
    const e = enforcedCounts(cr, items).byType;
    expect([e.get('S2'), e.get('S2:heads')]).toEqual([2, 3]);
  });
});

describe('fix round 4 / N9 — a heads answer whose poles can\'t be derived asks for the pole count', () => {
  it('unknown heads per pole: heads 3 entered -> blocking "enter pole count"; 2 poles entered -> done', async (ctx) => {
    if (!ok) return ctx.skip();
    const { u, bidId, cr, item } = await setup(null, 0);
    await resolve(bidId, u.token, { itemIds: [item.id], action: 'count', qty: 3, memberKey: 'S2' }).expect(200);
    let items = await stored(bidId);
    expect(items.find(i => i.id === item.id)!.reconcileMembers![0].resolution).toMatchObject({ qty: 3, needs: 'poles' });
    expect(reviewItemIsOpen(items.find(i => i.id === item.id)!)).toBe(true);
    await resolve(bidId, u.token, { itemIds: [item.id], action: 'count', qty: 2, memberKey: 'S2' }).expect(200);
    items = await stored(bidId);
    const e = enforcedCounts(cr, items).byType;
    expect([e.get('S2'), e.get('S2:heads')]).toEqual([2, 3]);
    expect(reviewItemIsOpen(items.find(i => i.id === item.id)!)).toBe(false);
  });
  it('pure: an exact multiple derives the poles; a non-multiple asks', () => {
    expect(headsMemberResolution({ headsPerPole: 2 }, { action: 'count', qty: 6 })).toMatchObject({ qty: 6, poles: 3 });
    expect(headsMemberResolution({ headsPerPole: 2 }, { action: 'count', qty: 5 })).toMatchObject({ qty: 5, needs: 'poles' });
  });
});
