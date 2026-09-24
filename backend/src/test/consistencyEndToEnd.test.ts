// Review fixes B1 / S8 / N3 — the consistency check end to end on CLEARLY
// SYNTHETIC data, against the real test database: pass 1 counted 4, pass 2
// found 2 more (SUGGESTED markers, created by "Consistency check").
//   * "keep the counted number" keeps pass 1's 4;
//   * "confirm the found marks" ADDS the confirmed suggestions to the kept
//     count (4 + 1 confirmed = 5) — never the bid-wide confirmed tally;
//   * the estimator's confirmation logs a `consistency_accept` event, never
//     a gap-fill one;
//   * a supplement pass keeps the check (priorSheetResult).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { writeGapFillMarkers } from '../estimating/aiMarkers';
import { buildReviewItems, enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import { priorSheetResult, type CountResult } from '../ai/countingStage';
import type { CountSheet } from '../ai/countSheets';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `ConsistencyE2E Test ${Date.now()}`, gc: `ConsistencyE2E GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 50_000 })
    .expect(200);
  return res.body.id as string;
}
async function insertPlanDoc(bidId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
     VALUES ($1,$2,'elec','plan.pdf','plan.pdf','plans',10,'application/pdf','test',$3) RETURNING id`,
    [bidId, `ConsistencyE2E ${bidId}`, Buffer.from('fake pdf bytes').toString('base64')]
  );
  return rows[0].id as string;
}

const KEY = 'XA';
const sheetKey = 'plan.pdf#1';
function cr(): CountResult {
  return {
    version: 2, ran: true, model: 'm',
    targets: [{ type: 'XA', key: KEY, description: 'synthetic strip fixture', symbolHint: '', wattage: 10, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: 'E-3', headsPerPole: null, emergency: false }],
    targetNotes: [], skippedSheets: [],
    sheets: [{ key: sheetKey, file: 'plan.pdf', page: 1, label: 'E-3', role: 'building', focus: 'lighting', level: '', status: 'counted', calls: 2, tiles: 1, geometryOk: true, geometry: { widthPt: 792, heightPt: 612, originX: 0, originY: 0, rotation: 0 }, mergedDuplicates: 0, rejected: 0, notes: [], unreadable: [] }],
    types: [{ key: KEY, type: 'XA', description: 'synthetic strip fixture', category: 'interior_lighting', count: 4, heads: null, status: 'counted', reason: '', sheets: [{ sheetKey, label: 'E-3', count: 4, used: true, eligible: true }], flags: [], wattage: 10 }],
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [],
    marks: [100, 200, 300, 400].map(x => ({ sheetKey, typeKey: KEY, x, y: 100 })),
    evidence: {
      model: 'm', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, calls: 0, cached: 0, errors: [],
      pages: [], typicals: [], expansions: [], unmappedTypical: [], tables: [], families: [], symbolDefinitions: [], circuitRows: 0, scheduleOwned: [], panelsExpected: 0, panelsUnread: [],
      consistency: {
        entries: [{ sheetKey, sheetLabel: 'E-3', typeKey: KEY, why: 'high count', first: 4, second: 6, agreed: 4, onlyFirst: 0, onlySecond: 2, agreement: 1 }],
        suggested: [{ typeKey: KEY, sheetKey, x: 500, y: 100, pass: 'second' }, { typeKey: KEY, sheetKey, x: 600, y: 100, pass: 'second' }],
        notReseen: [], calls: 1, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tiles: 1, cached: 0, warnings: [],
      },
    },
  } as unknown as CountResult;
}

async function setup() {
  const u = await makeUser('owner');
  const bidId = await createBid(u.token);
  const documentId = await insertPlanDoc(bidId);
  const c = cr();
  const items = buildReviewItems(c);
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result, review_items, review_status) VALUES ($1,'agent1_complete',$2,$3,'needs_review')`,
    [bidId, JSON.stringify(c), JSON.stringify(items)]);
  const w = await writeGapFillMarkers(bidId, c, c.evidence!.consistency!.suggested, [{ file: 'plan.pdf', documentId, size: 10 }], null, 'Consistency check');
  return { u, bidId, c, item: items.find(i => i.id === `consistency:${KEY}`)!, ids: w.writtenIds };
}

describe('consistency check end to end (B1 / S8 / N3)', () => {
  it('"confirm the found marks" adds the ONE confirmed suggestion to the kept 4 = 5; a consistency_accept event is logged', async (ctx) => {
    if (!ok) return ctx.skip();
    const { u, bidId, c, item, ids } = await setup();
    expect(ids.length).toBe(2);
    const { rows: m } = await pool.query(`SELECT created_by, status FROM est_markups WHERE bid_id = $1`, [bidId]);
    expect(m.every(r => r.created_by === 'Consistency check' && r.status === 'suggested')).toBe(true);
    await request(app).post(`/api/estimating/${bidId}/markups/batch`).set(auth(u.token)).send({ creates: [], updates: [{ id: ids[0], status: 'confirmed' }], deletes: [] }).expect(200);
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token)).send({ itemIds: [item.id], action: 'markers' }).expect(200);
    expect(res.body.items.find((i: ReviewItem) => i.id === item.id).resolution).toMatchObject({ action: 'markers', qty: 5 });
    const { rows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
    expect(enforcedCounts(c, rows[0].review_items as ReviewItem[]).byType.get(KEY)).toBe(5);
    let events: Array<{ event_kind: string }> = [];
    for (let i = 0; i < 40 && !events.length; i++) {
      events = (await pool.query(`SELECT event_kind FROM takeoff_labeled_events WHERE bid_id = $1 AND event_kind IN ('consistency_accept', 'gapfill_accept')`, [bidId])).rows;
      if (!events.length) await new Promise(r => setTimeout(r, 50));
    }
    expect(events.map(e => e.event_kind)).toEqual(['consistency_accept']);
  });

  it('"keep the counted number" keeps pass 1\'s 4', async (ctx) => {
    if (!ok) return ctx.skip();
    const { u, bidId, c, item } = await setup();
    await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token))
      .send({ itemIds: [item.id], action: 'confirm', reason: 'checked the plans — the suggested marks are text' }).expect(200);
    const { rows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
    expect(enforcedCounts(c, rows[0].review_items as ReviewItem[]).byType.get(KEY)).toBe(4);
  });

  it('a supplement pass keeps the earlier sheet\'s check (its entries, suggestions) — the same item, the same answer', () => {
    const c = cr();
    const sheet = { key: sheetKey, file: 'plan.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING', label: 'E-3', role: 'building', focus: 'lighting', level: '' } as CountSheet;
    const r = priorSheetResult(sheet, c);
    expect(r.consistency).toEqual(c.evidence!.consistency!.entries);
    expect(r.consistencySuggested!.length).toBe(2);
  });
});

describe('review fix S12 — a supplement on a run counted before consolidation never doubles', () => {
  it('the old run counted DUPLEX and "DUPLEX RECEPTACLE / FLOOR" on the same 3 symbols (+1 DUPLEX elsewhere): 4, not 7', async () => {
    const { remapAliasMarks } = await import('../ai/countingStage');
    const prior = cr();
    prior.marks = [
      ...[100, 200, 300].map(x => ({ sheetKey, typeKey: 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE', x, y: 100 })),
      ...[102, 199, 301, 700].map(x => ({ sheetKey, typeKey: 'DUPLEX', x, y: 101 })),
    ];
    const sheet = { key: sheetKey, file: 'plan.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING', label: 'E-3', role: 'building', focus: 'lighting', level: '' } as CountSheet;
    const r = priorSheetResult(sheet, prior);
    const dropped = remapAliasMarks([r], new Map([['DUPLEX', 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE']]));
    expect(dropped).toBe(3);
    expect(r.placed.map(p => [p.typeKey, p.x])).toEqual([
      ['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 100], ['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 200], ['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 300], ['DUPLEX RECEPTACLE / FLOOR RECEPTACLE', 700],
    ]);
  });
});

describe('Round 2 fix S15 — confirmed consistency markers are never added again after a re-run', () => {
  it('70 + 3 confirmed = 73; a re-run whose first pass finds 72 (2 of the 3 among them) -> 73, not 75', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    const documentId = await insertPlanDoc(bidId);
    const grid = (n: number) => Array.from({ length: n }, (_, i) => ({ sheetKey, typeKey: KEY, x: 50 + (i % 10) * 60, y: 50 + Math.floor(i / 10) * 45 }));
    const extra = [{ x: 50, y: 500 }, { x: 110, y: 500 }, { x: 170, y: 500 }];
    const runOf = (marks: ReturnType<typeof grid>, suggested: Array<{ x: number; y: number }>) => {
      const c = cr();
      c.types[0].count = marks.length;
      c.marks = marks;
      c.evidence!.consistency!.entries = [{ sheetKey, sheetLabel: 'E-3', typeKey: KEY, why: 'high count', first: marks.length, second: marks.length + suggested.length, agreed: marks.length, onlyFirst: 0, onlySecond: suggested.length, agreement: 1 }];
      c.evidence!.consistency!.suggested = suggested.map(p => ({ typeKey: KEY, sheetKey, ...p, pass: 'second' as const }));
      (c as unknown as { markers: unknown }).markers = { sheetDocuments: [{ sheetKey, label: 'E-3', documentId, pageIndex: 0 }] };
      return c;
    };
    // Run 1: 70 counted, 3 suggested; the estimator confirms all 3 -> 73.
    const c1 = runOf(grid(70), extra);
    const items1 = buildReviewItems(c1);
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result, review_items, review_status) VALUES ($1,'agent1_complete',$2,$3,'needs_review')`, [bidId, JSON.stringify(c1), JSON.stringify(items1)]);
    const w = await writeGapFillMarkers(bidId, c1, c1.evidence!.consistency!.suggested, [{ file: 'plan.pdf', documentId, size: 10 }], null, 'Consistency check');
    await pool.query(`UPDATE est_markups SET status = 'confirmed' WHERE id = ANY($1::uuid[])`, [w.writtenIds]);
    const id1 = items1.find(i => i.id.startsWith('consistency:'))!.id;
    const r1 = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token)).send({ itemIds: [id1], action: 'markers' }).expect(200);
    expect(r1.body.items.find((i: ReviewItem) => i.id === id1).resolution.qty).toBe(73);
    // Run 2 (re-run): the first pass finds 72 — the 70 plus two of the three.
    const c2 = runOf([...grid(70), { sheetKey, typeKey: KEY, x: 52, y: 501 }, { sheetKey, typeKey: KEY, x: 109, y: 499 }], [{ x: 400, y: 600 }]);
    const items2 = buildReviewItems(c2);
    await pool.query('UPDATE takeoff_results SET count_result = $1, review_items = $2 WHERE bid_id = $3', [JSON.stringify(c2), JSON.stringify(items2), bidId]);
    const id2 = items2.find(i => i.id.startsWith('consistency:'))!.id;
    const r2 = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`).set(auth(u.token)).send({ itemIds: [id2], action: 'markers' }).expect(200);
    expect(r2.body.items.find((i: ReviewItem) => i.id === id2).resolution.qty).toBe(73);
  });
});
