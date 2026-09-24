// Evidence round 5.2 — deriving an eval case's expected items from a bid's
// own confirmed counts (never an unresolved AI guess).
import { describe, it, expect } from 'vitest';
import { deriveExpectedFromConfirmedCounts } from './finishedBidEval';
import type { CountResult } from '../ai/countingStage';
import type { ReviewItem } from '../ai/reviewItems';

function cr(types: CountResult['types']): CountResult {
  return { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types,
    loadCheck: { ran: false, countedWatts: 0, circuitVA: 0, gapPct: null, discrepancy: false, perPanel: [], suspectCircuits: [] },
    removedRows: [], flags: [], marks: [] };
}
const type = (over: Partial<CountResult['types'][number]>): CountResult['types'][number] => ({
  key: 'X', type: 'X', description: '', category: 'device', count: 0, heads: null, status: 'zero', reason: '',
  sheets: [], flags: [], wattage: null, ...over,
});

describe('deriveExpectedFromConfirmedCounts', () => {
  it('a counted type with no open review item contributes its count', () => {
    const r = deriveExpectedFromConfirmedCounts(cr([type({ key: 'A', type: 'A', description: 'Troffer', status: 'counted', count: 12 })]), []);
    expect(r).toEqual([{ id: 'A', label: 'Type A — Troffer', expected: 12, types: ['A'], source: 'confirmed' }]);
  });
  it('a zero/unreadable type with no resolution contributes nothing (still open, no real answer)', () => {
    const r = deriveExpectedFromConfirmedCounts(cr([type({ key: 'B', status: 'zero', count: 0 })]), []);
    expect(r).toEqual([]);
  });
  it('a resolved count (estimator entered it, or "not on this job") is honored over the AI reading', () => {
    const item: ReviewItem = { id: 'count:B', kind: 'count', title: 'Type B', detail: '', typeKey: 'B', resolution: { action: 'count', qty: 6, by: 'J', at: 't' } };
    const r = deriveExpectedFromConfirmedCounts(cr([type({ key: 'B', type: 'B', status: 'zero', count: 0 })]), [item]);
    expect(r).toEqual([{ id: 'B', label: 'Type B', expected: 6, types: ['B'], source: 'resolved' }]);

    const njItem: ReviewItem = { id: 'count:C', kind: 'count', title: 'Type C', detail: '', typeKey: 'C', resolution: { action: 'not_on_job', reason: 'x', by: 'J', at: 't' } };
    const r2 = deriveExpectedFromConfirmedCounts(cr([type({ key: 'C', type: 'C', status: 'counted', count: 4 })]), [njItem]);
    expect(r2).toEqual([]); // "not on this job" -> null -> never in the answer key
  });
  it('a host marker and a merged type are never in the answer key', () => {
    const r = deriveExpectedFromConfirmedCounts(cr([
      { ...type({ key: 'H', status: 'counted', count: 3 }), host: true },
      type({ key: 'M', status: 'merged', count: 0 }),
    ]), []);
    expect(r).toEqual([]);
  });
});
