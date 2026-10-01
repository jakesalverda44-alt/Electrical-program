// Fewer-questions round Task 5 — a spot-check is answered only when an
// INDEPENDENT check agrees (schedule quantity column, the panel load check,
// an earlier human answer with the same count, confirmed markers). Each
// check passing and failing; Kissimmee's A/B keep theirs (no check applies).
import { describe, it, expect, beforeAll } from 'vitest';
import { buildReviewItems, spotCheckPlan, finalizeReview, AUTO_BY, type ReviewItem } from './reviewItems';
import type { CountResult } from './countingStage';
import { replayReview, type ReplayReview } from '../eval/reviewReplay';
import { isPdftoppmAvailable } from './documentPrep';

function cr(over: { scheduleQty?: number[]; table?: string; load?: Partial<NonNullable<CountResult['loadCheck']>>; wattage?: number; otherWatts?: number } = {}): CountResult {
  const marks = Array.from({ length: 24 }, (_, i) => ({ sheetKey: 'f#1', typeKey: 'A', x: i * 10, y: 5 }));
  return {
    version: 1, ran: true, model: 'm', targets: [{ key: 'A', type: 'A', description: '2x4 troffer', category: 'interior_lighting', source: 'fixture_schedule' }], targetNotes: [], sheets: [], skippedSheets: [],
    types: [{ key: 'A', type: 'A', description: '2x4 troffer', category: 'interior_lighting', count: 24, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: over.wattage ?? 40,
      ...(over.scheduleQty ? { scheduleRows: over.scheduleQty.map((q, i) => ({ sheetKey: 'f#3', sheetLabel: 'E-3 "LIGHTING"', tableId: 't', table: over.table ?? 'LIGHT FIXTURE SCHEDULE', rowIdx: i, cells: [], qty: q })) } : {}) }],
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [], ...(over.load ?? {}) },
    removedRows: [], flags: [], marks, evidence: {},
  } as unknown as CountResult;
}
const spot = (c: CountResult, o = {}) => buildReviewItems(c, [], o).find(i => i.id === 'spotcheck:A')!;

describe('independent checks', () => {
  it('none → the spot-check stays (informational, open)', () => {
    const i = spot(cr());
    expect(i.blocking).toBe(false);
    expect(i.resolution).toBeUndefined();
  });
  it('1. the fixture schedule quantity column agrees exactly → answered automatically', () => {
    const i = spot(cr({ scheduleQty: [20, 4] }));
    expect(i.resolution).toMatchObject({ action: 'confirm', by: AUTO_BY, auto: { source: 'independent_check' } });
    expect(i.resolution!.auto!.evidence[0]).toBe('LIGHT FIXTURE SCHEDULE (E-3): 20; LIGHT FIXTURE SCHEDULE (E-3): 4 = 24');
  });
  it('1. Σqty off by one → kept; a panel table → kept', () => {
    expect(spot(cr({ scheduleQty: [20, 5] })).resolution).toBeUndefined();
    expect(spot(cr({ scheduleQty: [24], table: 'PANEL A' })).resolution).toBeUndefined();
  });
  it('2. the load check within 5 % with this type ≥ 40 % of the load → answered', () => {
    const i = spot(cr({ load: { ran: true, countedWatts: 1000, circuitVA: 1020, gapPct: 0.02, discrepancy: false } }));
    expect(i.resolution?.auto?.reason).toMatch(/lighting load agrees within 2 %, and A is 96 % of it/);
  });
  it('2. share below 40 % → kept; gap over 5 % → kept; discrepancy → kept', () => {
    expect(spot(cr({ load: { ran: true, countedWatts: 3000, circuitVA: 3000, gapPct: 0, discrepancy: false } })).resolution).toBeUndefined();
    expect(spot(cr({ load: { ran: true, countedWatts: 1000, circuitVA: 1100, gapPct: 0.09, discrepancy: false } })).resolution).toBeUndefined();
    expect(spot(cr({ load: { ran: true, countedWatts: 1000, circuitVA: 1000, gapPct: 0, discrepancy: true } })).resolution).toBeUndefined();
  });
  it('4. confirmed markers ≥ the count → answered; fewer → kept', () => {
    expect(spot(cr(), { confirmedMarkers: { A: 24 } }).resolution?.auto?.reason).toBe('24 markers of A are confirmed on the plans (≥ 24 counted)');
    expect(spot(cr(), { confirmedMarkers: { A: 23 } }).resolution).toBeUndefined();
  });
  it('3. an earlier human answer with the same count → answered; another count or an automatic one → kept', () => {
    const fresh = buildReviewItems(cr(), []);
    const prev = (qty: number, auto = false): ReviewItem[] => [{ id: 'recount:A', kind: 'count', title: 'Type A — recount', detail: '', typeKey: 'A', resolution: { action: 'confirm', qty, reason: 'checked every one on E-3', by: auto ? AUTO_BY : 'Jake', at: 't', ...(auto ? { auto: { source: 'registration' as const, reason: 'r', evidence: ['e'] } } : {}) } }];
    expect(finalizeReview(fresh, { previous: prev(24) }).find(i => i.id === 'spotcheck:A')!.resolution?.auto?.evidence[0]).toMatch(/^Type A — recount: confirm 24 by Jake/);
    expect(finalizeReview(fresh, { previous: prev(23) }).find(i => i.id === 'spotcheck:A')!.resolution).toBeUndefined();
    expect(finalizeReview(fresh, { previous: prev(24, true) }).find(i => i.id === 'spotcheck:A')!.resolution).toBeUndefined();
  });
  it('3b. only a count / recount / spotcheck answer is an independent check — a typicalqty or reconcile answer with the same number is not', () => {
    const fresh = buildReviewItems(cr(), []);
    const prev = (id: string): ReviewItem[] => [{ id, kind: 'count', title: 'Typical: A', detail: '', typeKey: 'A', resolution: { action: 'count', qty: 24, reason: 'typical', by: 'Jake', at: 't' } }];
    expect(finalizeReview(fresh, { previous: prev('typicalqty:p:A') }).find(i => i.id === 'spotcheck:A')!.resolution).toBeUndefined();
    expect(finalizeReview(fresh, { previous: prev('reconcile:A') }).find(i => i.id === 'spotcheck:A')!.resolution).toBeUndefined();
    expect(finalizeReview(fresh, { previous: prev('count:A') }).find(i => i.id === 'spotcheck:A')!.resolution?.auto).toBeDefined();
  });
  it('an undone automatic spot-check answer stays open on the next run', () => {
    const fresh = buildReviewItems(cr({ scheduleQty: [24] }), []);
    const undone = fresh.map(i => (i.id === 'spotcheck:A' ? { ...i, resolution: undefined, autoDeclined: ['independent_check' as const] } : i));
    expect(finalizeReview(fresh, { previous: undone }).find(i => i.id === 'spotcheck:A')!.resolution).toBeUndefined();
  });
});

let have = false;
let k: ReplayReview;
beforeAll(async () => { have = await isPdftoppmAvailable(); if (have) k = await replayReview('kissimmee'); }, 900_000);

describe('Kissimmee 0930', () => {
  it('A and B keep their spot-checks: no schedule quantity column, the load check did not run, no earlier answers, no confirmed markers', (ctx) => {
    if (!have) return ctx.skip();
    const plan = spotCheckPlan(k.countResult);
    expect(plan.map(p => [p.typeKey, p.independent ?? null])).toEqual([['A', null], ['B', null]]);
    expect(k.countResult.loadCheck?.ran).toBe(false);
    for (const id of ['spotcheck:A', 'spotcheck:B']) expect(k.items.find(i => i.id === id)!.resolution).toBeUndefined();
  });
});
