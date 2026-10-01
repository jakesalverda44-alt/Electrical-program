// Level 2 learning, Task 10 — captures → candidate examples (test DB, real
// pdftoppm on a synthetic PDF). Confirm / move / delete / re-type give the
// right polarity and meaning; a legend-viewport point is skipped; an
// automatic answer is never captured; undo retires; one raster per page;
// and the 36th Street SCRIPTED harvest (the real stored unlisted:H answer
// and its 13 real placed marks, cropped from a BLANK stand-in PDF — the
// pixels are not the real sheet) gives 4 positive "surface strip light"
// candidates.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { throw new Error('Anthropic client must not be constructed in this test'); } },
}));

import { pool } from '../../db/pool';
import { dbAvailable, makeUser } from '../../test/harness';
import { buildSymbolPdf } from '../../test/fixtures/takeoff/buildSymbolPdf';
import { isPdftoppmAvailable } from '../documentPrep';
import { rasterizeGray } from '../countRender';
import { capturesFromMarkupBatch, capturesFromReview, type MarkerLike } from './capture';
import { enqueueCaptures, listExamples } from './learningDb';
import { runHarvest } from './harvest';
import { load36th0930 } from '../../test/fixtures/realrun/live0930';
import type { ReviewItem } from '../reviewItems';

let ok = false;
beforeAll(async () => { ok = (await dbAvailable()) && (await isPdftoppmAvailable()); }, 30_000);

const GEOM = { originX: 0, originY: 0, widthPt: 1728, heightPt: 1296, rotation: 0 };
async function setup(): Promise<{ bidId: string; docId: string }> {
  const u = await makeUser('owner');
  const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id, project_type) VALUES ($1,'GC','Here',$2,'retail') RETURNING id`, [`Harvest ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, u.id]);
  const bidId = rows[0].id as string;
  const pdf = buildSymbolPdf([{ mediaBox: [0, 0, 1728, 1296], symbols: [{ type: 'A', x: 400, y: 600 }, { type: 'B', x: 800, y: 600 }], texts: [] }]);
  const d = await pool.query(`INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by, content_sha256) VALUES ($1,'plan.pdf','plans','application/pdf',$2,'t','sha-test-plan') RETURNING id`, [bidId, pdf.toString('base64')]);
  const docId = d.rows[0].id as string;
  const cr = {
    version: 1, ran: true, model: 'm',
    targets: [
      { key: 'A', type: 'A', description: '2x4 LED recessed troffer', category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: 'E-0.1', symbolHint: 'rectangle' },
      { key: 'GFCI', type: 'GFCI', description: 'GFCI receptacle', category: 'device', source: 'legend', sourceSheet: 'E-0.1' },
      { key: 'DUPLEX', type: 'DUPLEX', description: 'Duplex receptacle', category: 'device', source: 'legend', sourceSheet: 'E-0.1' },
    ],
    sheets: [{ key: 'plan.pdf#1', file: 'plan.pdf', page: 1, label: 'E-1 "POWER PLAN"', status: 'counted', geometryOk: true, geometry: GEOM,
      viewports: [{ id: 'v1', number: '1', title: 'LEGEND', scale: '', kind: 'legend', rectIn: { left: 18, top: 0, width: 6, height: 6 }, bboxPt: { x0: 0, y0: 0, x1: 1, y1: 1 }, source: 'text', inPerFt: null }] }],
    types: [], marks: [], markers: { sheetDocuments: [{ sheetKey: 'plan.pdf#1', label: 'E-1', documentId: docId, pageIndex: 0 }] },
  };
  await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result, account_terms) VALUES ($1,'complete',$2,$3)`, [bidId, JSON.stringify(cr), JSON.stringify({ ruleId: 'rule-x' })]);
  return { bidId, docId };
}

const ai = (over: Partial<MarkerLike> & { id: string; documentId: string }): MarkerLike => ({ pageIndex: 0, kind: 'count', status: 'suggested', label: 'A', lineKey: null, source: 'ai_count', points: [{ x: 400, y: 600 }], ...over });

describe('the harvester', () => {
  it('confirm / move / re-type / delete → the right polarity and meaning; a legend point is skipped; one raster per page', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, docId } = await setup();
    const before = [
      ai({ id: '11111111-1111-4111-8111-111111111111', documentId: docId }),
      ai({ id: '22222222-2222-4222-8222-222222222222', documentId: docId, label: 'GFCI', points: [{ x: 800, y: 600 }] }),
      ai({ id: '33333333-3333-4333-8333-333333333333', documentId: docId, label: 'DUPLEX', points: [{ x: 600, y: 400 }] }),
      ai({ id: '44444444-4444-4444-8444-444444444444', documentId: docId, label: 'A', points: [{ x: 1500, y: 1250 }] }), // inside the legend viewport (displayed top-right)
    ];
    const caps = capturesFromMarkupBatch({
      creates: [],
      updates: [{ id: before[0].id, status: 'confirmed' }, { id: before[1].id, label: 'DUPLEX' }, { id: before[3].id, status: 'confirmed' }],
      deletes: [before[2].id],
    }, before);
    expect(caps.map(c => c.kind)).toEqual(['marker_confirm', 'marker_reclass', 'marker_confirm', 'marker_delete']);
    await enqueueCaptures(caps.map(c => ({ bidId, ...c })));
    let rasters = 0;
    const r = await runHarvest({ bidId, deps: { rasterize: async (...a) => { rasters++; return rasterizeGray(...a); } } });
    expect(rasters).toBe(1);
    expect(r).toMatchObject({ done: 3, skipped: 1, failed: 0, examples: 4 });
    const ex = (await listExamples({ limit: 50 })).filter(e => e.sourceBidId === bidId);
    const by = (k: string, pol: string) => ex.filter(e => e.sourceKind === k && e.polarity === pol);
    expect(by('marker_confirm', 'positive').map(e => [e.meaning.deviceClass, e.status])).toEqual([['fixture.troffer', 'candidate']]);
    expect(by('marker_reclass', 'positive').map(e => e.meaning.deviceClass)).toEqual(['receptacle.duplex']);
    expect(by('marker_reclass', 'negative').map(e => [e.meaning.deviceClass, e.confusedWith?.deviceClass])).toEqual([['receptacle.duplex', 'receptacle.gfci']]);
    expect(by('marker_delete', 'negative').map(e => [e.notADevice, e.confusedWith?.deviceClass])).toEqual([[true, 'receptacle.duplex']]);
    expect(ex.every(e => e.sourceDocSha === 'sha-test-plan' && e.accountRuleId === 'rule-x' && e.projectType === 'retail')).toBe(true);
    const skipped = await pool.query(`SELECT error FROM symbol_example_captures WHERE bid_id = $1 AND status = 'skipped'`, [bidId]);
    expect(skipped.rows.map(x => x.error)).toEqual(['the point is in a legend, not a plan']);
    const crop = (await listExamples({ ids: [by('marker_confirm', 'positive')[0].id], withCrop: true }))[0].crop!;
    expect(crop.subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);

  it('undo (an un-confirm) retires the example', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, docId } = await setup();
    const m = ai({ id: '55555555-5555-4555-8555-555555555555', documentId: docId });
    await enqueueCaptures(capturesFromMarkupBatch({ creates: [], updates: [{ id: m.id, status: 'confirmed' }], deletes: [] }, [m]).map(c => ({ bidId, ...c })));
    await runHarvest({ bidId });
    await enqueueCaptures(capturesFromMarkupBatch({ creates: [], updates: [{ id: m.id, status: 'suggested' }], deletes: [] }, [{ ...m, status: 'confirmed' }]).map(c => ({ bidId, ...c })));
    await runHarvest({ bidId });
    const ex = (await listExamples({ limit: 50 })).filter(e => e.sourceBidId === bidId);
    expect(ex.map(e => [e.status, e.retiredReason])).toEqual([['retired', 'source undone']]);
  }, 60_000);

  it('B2: confirm then un-confirm inside one debounce (both pending in ONE pass) leaves no candidate', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId, docId } = await setup();
    const m = ai({ id: '66666666-6666-4666-8666-666666666666', documentId: docId });
    const conf = capturesFromMarkupBatch({ creates: [], updates: [{ id: m.id, status: 'confirmed' }], deletes: [] }, [m]);
    const unconf = capturesFromMarkupBatch({ creates: [], updates: [{ id: m.id, status: 'suggested' }], deletes: [] }, [{ ...m, status: 'confirmed' }]);
    await enqueueCaptures([...conf, ...unconf].map(c => ({ bidId, ...c })));
    const r = await runHarvest({ bidId });
    expect(r.examples).toBe(0);
    expect((await listExamples({ limit: 50 })).filter(e => e.sourceBidId === bidId && e.status !== 'retired')).toEqual([]);
    const rows = await pool.query(`SELECT kind, status FROM symbol_example_captures WHERE bid_id = $1 ORDER BY id`, [bidId]);
    expect(rows.rows).toEqual([{ kind: 'marker_confirm', status: 'skipped' }, { kind: 'undo', status: 'done' }]);
  }, 60_000);

  it('B2: an unlisted answer reopened inside the debounce leaves no candidate; a re-answer AFTER the reopen still captures', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await setup();
    const item: ReviewItem = { id: 'unlisted:H', kind: 'count', title: 't', detail: 'd', type: 'H', description: 'strip', resolution: { action: 'count', qty: 2, reason: 'H strip light 4ft', by: 'Jake', at: 't' } };
    const marks = [{ x: 400, y: 600, sheetKey: 'plan.pdf#1' }, { x: 800, y: 600, sheetKey: 'plan.pdf#1' }];
    const answered = capturesFromReview(item, undefined, marks);
    expect(answered).toHaveLength(2);
    await enqueueCaptures([...answered, { kind: 'undo' as const, payload: { itemId: 'unlisted:H' } }, ...answered.slice(0, 1)].map(c => ({ bidId, ...c })));
    const r = await runHarvest({ bidId });
    // the first two captures were undone; the re-answer (after the undo) is kept
    expect(r.examples).toBe(1);
    expect((await listExamples({ limit: 50 })).filter(e => e.sourceBidId === bidId && e.status !== 'retired')).toHaveLength(1);
  }, 60_000);

  it('a capped pass reports capped so the next pass is scheduled (nit: 200-capture cap re-arm)', async (ctx) => {
    if (!ok) return ctx.skip();
    const { bidId } = await setup();
    await enqueueCaptures([{ bidId, kind: 'undo', payload: { markupId: 'a' } }, { bidId, kind: 'undo', payload: { markupId: 'b' } }]);
    expect((await runHarvest({ bidId, limit: 1 })).capped).toBe(true);
    expect((await runHarvest({ bidId, limit: 5 })).capped).toBe(false);
  });

  it('an automatic answer is never captured', () => {
    const item: ReviewItem = { id: 'unlisted:H', kind: 'count', title: 't', detail: 'd', type: 'H', description: 'strip', resolution: { action: 'count', qty: 2, reason: 'strip light 4ft', by: 'CRM (from X)', at: 't', auto: { source: 'account_memory', reason: 'r', evidence: [] } } };
    expect(capturesFromReview(item, undefined, [{ x: 1, y: 1, sheetKey: 's' }, { x: 2, y: 2, sheetKey: 's' }])).toEqual([]);
    expect(capturesFromReview({ ...item, resolution: { ...item.resolution!, auto: undefined, by: 'Jake' } }, undefined, [{ x: 1, y: 1, sheetKey: 's' }, { x: 2, y: 2, sheetKey: 's' }])).toHaveLength(2);
  });

  it('36th Street — SCRIPTED harvest (real stored unlisted:H answer + its 13 real marks, BLANK stand-in PDF): 4 positive strip candidates', async (ctx) => {
    if (!ok) return ctx.skip();
    const live = load36th0930();
    const u = await makeUser('owner');
    const { rows } = await pool.query(`INSERT INTO bids (name, gc, loc, salesperson_id, project_type) VALUES ($1,'JamesCo','Orlando',$2,'self_storage') RETURNING id`, [`36th SCRIPTED ${Date.now()}`, u.id]);
    const bidId = rows[0].id as string;
    const blank = buildSymbolPdf(Array.from({ length: 16 }, () => ({ mediaBox: [0, 0, 2592, 1728] as [number, number, number, number], symbols: [], texts: [] })));
    const d = await pool.query(`INSERT INTO documents (linked_id, name, category, file_type, file_data, uploaded_by) VALUES ($1,'36th Street Warehouse - Plan Set.pdf','plans','application/pdf',$2,'t') RETURNING id`, [bidId, blank.toString('base64')]);
    const cr = live.countResult as unknown as { markers: { sheetDocuments: Array<{ documentId: string }> }; unlisted: { tags: Array<{ tag: string; marks: Array<{ x: number; y: number; sheetKey: string }> }> } };
    for (const s of cr.markers.sheetDocuments) s.documentId = d.rows[0].id;
    await pool.query(`INSERT INTO takeoff_results (bid_id, status, count_result) VALUES ($1,'complete',$2)`, [bidId, JSON.stringify(cr)]);
    const item = (live.reviewItems as unknown as ReviewItem[]).find(i => i.id === 'unlisted:H')!;
    const marks = cr.unlisted.tags.find(t => t.tag === 'H')!.marks;
    expect(marks).toHaveLength(13);
    const caps = capturesFromReview(item, undefined, marks);
    expect(caps).toHaveLength(4);
    await enqueueCaptures(caps.map(c => ({ bidId, ...c })));
    const r = await runHarvest({ bidId });
    expect(r).toMatchObject({ done: 4, examples: 4, rasters: 1 });
    const ex = (await listExamples({ limit: 50 })).filter(e => e.sourceBidId === bidId);
    expect(ex).toHaveLength(4);
    for (const e of ex) {
      expect(e.polarity).toBe('positive');
      expect(e.meaning.description).toBe('surface strip light, 4ft');
      expect(e.meaning.deviceClass).toBe('fixture.strip');
      expect(e.meaning.category).toBe('interior_lighting');
    }
  }, 120_000);
});
