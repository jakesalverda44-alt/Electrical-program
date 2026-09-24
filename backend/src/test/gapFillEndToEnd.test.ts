// Fix round (review a479103, B2/B3) — the full gap-fill lifecycle, on
// CLEARLY SYNTHETIC data (a small made-up bid, never Kissimmee): a
// reconciliation shortfall -> gap-fill proposes a candidate -> the crop
// check accepts it -> ONLY a SUGGESTED marker + a `gapfill:<type>` review
// item, never a count by itself -> the estimator confirms the marker in
// the Plans view (simulated: the marker row flips to 'confirmed', exactly
// what that click does) -> resolving the review item with "Use confirmed
// markers" is the ONLY thing that ever raises the count.
//
// The gap-fill/crop-check MODEL MECHANICS (real image rendering, viewport
// rejection, dedup, caching) are already covered on the real Kissimmee E-1
// crop in gapFillStage.test.ts; this test proves the REST of the lifecycle
// — the marker write, the review item, the estimator's confirmation and
// the enforced count — end to end, against the real test database.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { writeAiCountMarkers, writeGapFillMarkers } from '../estimating/aiMarkers';
import { buildReviewItems, enforcedCounts, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

async function createBid(token: string) {
  const res = await request(app).post('/api/bids').set(auth(token))
    .send({ name: `GapFillE2E Test ${Date.now()}`, gc: `GapFillE2E Test GC ${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, amount: 50_000 })
    .expect(200);
  return res.body.id as string;
}

async function insertPlanDoc(bidId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
     VALUES ($1,$2,'elec','plan.pdf','plan.pdf','plans',10,'application/pdf','test',$3) RETURNING id`,
    [bidId, `GapFillE2E ${bidId}`, Buffer.from('fake pdf bytes').toString('base64')]
  );
  return rows[0].id as string;
}

// A synthetic finding: "GFCI-EXAMPLE" schedule says 5, the plans show 4 —
// clearly made up, never claimed as a real Kissimmee (or any real job's)
// discrepancy.
const TYPE_KEY = 'GFCI-EXAMPLE';
function syntheticCountResult(documentId: string): CountResult {
  const sheetKey = 'plan.pdf#1';
  return {
    version: 2, ran: true, model: 'm',
    targets: [{ type: 'GX', key: TYPE_KEY, description: 'GFCI example receptacle', symbolHint: '', wattage: null, category: 'device', source: 'legend', sourceSheet: 'E-1', headsPerPole: null, emergency: false }],
    targetNotes: [], skippedSheets: [],
    sheets: [{ key: sheetKey, file: 'plan.pdf', page: 1, label: 'E-1', role: 'building', focus: 'power', level: '1', status: 'counted', calls: 1, tiles: 1, geometryOk: true, geometry: { widthPt: 792, heightPt: 612, rotation: 0 }, mergedDuplicates: 0, rejected: 0, notes: [], unreadable: [] }],
    types: [{ key: TYPE_KEY, type: 'GX', description: 'GFCI example receptacle', category: 'device', count: 4, heads: null, status: 'counted', reason: '', sheets: [{ sheetKey, label: 'E-1', count: 4, used: true }], flags: [], wattage: null }],
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [],
    marks: [{ sheetKey, typeKey: TYPE_KEY, x: 100, y: 100 }, { sheetKey, typeKey: TYPE_KEY, x: 200, y: 100 }, { sheetKey, typeKey: TYPE_KEY, x: 300, y: 100 }, { sheetKey, typeKey: TYPE_KEY, x: 400, y: 100 }],
    evidence: {
      model: 'm', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, calls: 0, cached: 0, errors: [],
      pages: [], typicals: [], expansions: [], unmappedTypical: [], tables: [], families: [], symbolDefinitions: [], circuitRows: 0, scheduleOwned: [], panelsExpected: 0, panelsUnread: [],
      gapFill: {
        findings: [{ typeKey: TYPE_KEY, kind: 'schedule_qty', direction: 'under', source: 'GFCI-EXAMPLE SCHEDULE (E-1)', expected: 5, actual: 4, diff: 1, reason: 'GFCI-EXAMPLE SCHEDULE lists QTY 5; the plans account for 4 — 1 short.' }],
        jobs: 1, jobsSkipped: 0, cachedJobs: 0, candidates: 1,
        suggested: [{ typeKey: TYPE_KEY, sheetKey, x: 500, y: 100, confidence: 'high', note: 'matches the confirmed example' }],
        calls: 2, usage: { input_tokens: 3000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [],
      },
    },
  } as unknown as CountResult;
}

describe('gap-fill end to end — suggest -> confirm -> count, never a count by itself (B2/B3)', () => {
  it('a real reconciled shortfall proposes a candidate; only the estimator\'s own confirmation ever raises the count', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    const documentId = await insertPlanDoc(bidId);
    const cr = syntheticCountResult(documentId);
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, count_result, review_status) VALUES ($1,'agent1_complete',$2,'needs_review')`,
      [bidId, JSON.stringify(cr)]
    );

    // 1. The review list shows ONE gapfill: item, the shortfall visible,
    // never a count change: the type's own count is still 4.
    const items = buildReviewItems(cr);
    const gfItem = items.find(i => i.id === `gapfill:${TYPE_KEY}`)!;
    expect(gfItem).toBeTruthy();
    expect(gfItem.title).toBe('Gap-fill found 1 possible GX — confirm on plans');
    expect(gfItem.actions).toEqual(['markers', 'confirm', 'count']); // B10 — never "not on this job"
    expect(reviewItemIsOpen(gfItem)).toBe(true);
    expect(cr.types[0].count).toBe(4); // untouched
    expect(enforcedCounts(cr, items).byType.get(TYPE_KEY)).toBe(4);
    await pool.query('UPDATE takeoff_results SET review_items = $1 WHERE bid_id = $2', [JSON.stringify(items), bidId]);

    // 2. The suggested mark is written as a SUGGESTED (never confirmed)
    // est_markups row, source 'gap_fill' — exactly like the counter's own
    // suggestions (written here too, the normal pipeline behavior for the
    // original 4), just tagged apart so a labeled-data consumer (5.1) can
    // always tell them apart.
    await writeAiCountMarkers(bidId, cr, [{ file: 'plan.pdf', documentId, size: 10 }]);
    const write = await writeGapFillMarkers(bidId, cr, cr.evidence!.gapFill!.suggested, [{ file: 'plan.pdf', documentId, size: 10 }]);
    expect(write.written).toBe(1);
    const { rows: markerRows } = await pool.query(`SELECT status, source, label FROM est_markups WHERE bid_id = $1 AND source = 'gap_fill'`, [bidId]);
    expect(markerRows).toEqual([{ status: 'suggested', source: 'gap_fill', label: 'GX' }]);
    const { rows: allMarkers } = await pool.query('SELECT status FROM est_markups WHERE bid_id = $1', [bidId]);
    expect(allMarkers).toHaveLength(5); // the 4 original (ai_count) + the 1 gap-fill suggestion

    // 3. The estimator reviews the sheet and confirms every marker (the
    // ordinary Plans-view confirm flow — simulated directly here as the
    // same status flip that click makes).
    await pool.query(`UPDATE est_markups SET status = 'confirmed' WHERE bid_id = $1`, [bidId]);

    // 4. "Use confirmed markers" on the gapfill: item now sees all 5
    // confirmed (confirmedMarkersForType counts every confirmed marker of
    // this type on an eligible sheet, not just gap-fill's own — the
    // estimator must confirm the whole sheet, not just the new candidate,
    // for "Use confirmed markers" to reflect the true total).
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`)
      .set(auth(u.token)).send({ itemIds: [gfItem.id], action: 'markers' }).expect(200);
    expect(res.body.items.find((i: ReviewItem) => i.id === gfItem.id).resolution).toMatchObject({ action: 'markers', qty: 5 });
    const { rows: trRows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id = $1', [bidId]);
    const finalEnforced = enforcedCounts(cr, trRows[0].review_items as ReviewItem[]);
    expect(finalEnforced.byType.get(TYPE_KEY)).toBe(5); // ONLY now, via the estimator's own confirmation
  });

  it('not confirming it leaves the type at its original count, and the review item still blocks', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    const documentId = await insertPlanDoc(bidId);
    const cr = syntheticCountResult(documentId);
    const items = buildReviewItems(cr);
    const gfItem = items.find(i => i.id === `gapfill:${TYPE_KEY}`)!;
    await writeGapFillMarkers(bidId, cr, cr.evidence!.gapFill!.suggested, [{ file: 'plan.pdf', documentId, size: 10 }]);
    // Never confirmed — the suggestion just sits there.
    expect(enforcedCounts(cr, items).byType.get(TYPE_KEY)).toBe(4);
    expect(reviewItemIsOpen(gfItem)).toBe(true);
  });
});

describe('Fix round 3 / S18 — a re-run clears gap-fill\'s suggested markers exactly like the counter\'s own', () => {
  it('a stale gap-fill suggestion from an earlier run is gone after a re-run — never confirmable, never confirmed twice', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bidId = await createBid(u.token);
    const documentId = await insertPlanDoc(bidId);
    const cr = syntheticCountResult(documentId);
    const files = [{ file: 'plan.pdf', documentId, size: 10 }];

    // Run 1: the counter's own marks, then gap-fill's ONE suggestion.
    await writeAiCountMarkers(bidId, cr, files);
    const run1 = await writeGapFillMarkers(bidId, cr, cr.evidence!.gapFill!.suggested, files);
    expect(run1.written).toBe(1);
    const run1Id = run1.writtenIds[0];

    // The estimator never confirms it. A re-run happens (a new upload, or
    // just re-running the analysis): the counter's own pass writes fresh
    // marks (source 'ai_count') AND, per S18, clears every prior SUGGESTED
    // marker — the counter's own AND gap-fill's — before this run's own
    // gap-fill pass writes its own (possibly different) suggestion.
    await writeAiCountMarkers(bidId, cr, files);
    const run2 = await writeGapFillMarkers(bidId, cr, cr.evidence!.gapFill!.suggested, files);
    expect(run2.written).toBe(1);
    const run2Id = run2.writtenIds[0];
    expect(run2Id).not.toBe(run1Id); // a fresh row, not the stale one revived

    // The stale run-1 suggestion is soft-deleted — gone from every live
    // query, so the Plans view can never surface it to be confirmed at all,
    // let alone twice.
    const { rows: staleRow } = await pool.query('SELECT deleted_at FROM est_markups WHERE id = $1', [run1Id]);
    expect(staleRow[0].deleted_at).not.toBeNull();
    const { rows: live } = await pool.query(
      `SELECT id FROM est_markups WHERE bid_id = $1 AND source = 'gap_fill' AND status = 'suggested' AND deleted_at IS NULL`,
      [bidId]
    );
    expect(live.map(r => r.id)).toEqual([run2Id]);

    // Confirming every LIVE marker (run 2's own 4 counted marks plus its 1
    // gap-fill suggestion) counts it exactly once each, even though two
    // gap-fill suggestions were ever written across the two runs.
    await pool.query(`UPDATE est_markups SET status = 'confirmed' WHERE bid_id = $1 AND deleted_at IS NULL`, [bidId]);
    const items = buildReviewItems(cr);
    const gfItem = items.find(i => i.id === `gapfill:${TYPE_KEY}`)!;
    await pool.query(
      `INSERT INTO takeoff_results (bid_id, status, count_result, review_items, review_status) VALUES ($1,'agent1_complete',$2,$3,'needs_review')`,
      [bidId, JSON.stringify(cr), JSON.stringify(items)]
    );
    const res = await request(app).post(`/api/preconstruction/${bidId}/review/resolve`)
      .set(auth(u.token)).send({ itemIds: [gfItem.id], action: 'markers' }).expect(200);
    expect(res.body.items.find((i: ReviewItem) => i.id === gfItem.id).resolution).toMatchObject({ action: 'markers', qty: 5 }); // 4 + 1, never 4 + 2
  });
});
