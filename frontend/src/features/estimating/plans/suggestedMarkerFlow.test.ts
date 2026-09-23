// Estimating Phase B, Task 7 (deferral closed) — suggestedMarkerFlow.ts.
import { describe, it, expect } from 'vitest';
import { draftsFromTagCandidates, confirmAllOnSheet } from './suggestedMarkerFlow';
import { TagCandidate } from './tagSuggest';
import { MarkupDraft } from './markupHistory';

function candidate(tag: string, x: number, y: number, text = tag): TagCandidate {
  return { tag, point: { x, y }, text };
}

function existingMarkup(over: Partial<MarkupDraft> = {}): MarkupDraft {
  return {
    id: 'e1', documentId: 'doc-1', pageIndex: 0, lineKey: 'l1', kind: 'count',
    points: [{ x: 100, y: 100 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null,
    ...over,
  };
}

let idCounter = 0;
function makeId() { return `new-${++idCounter}`; }

describe('draftsFromTagCandidates', () => {
  it('produces one status="suggested" count marker per candidate, with lineKey resolved per-tag', () => {
    idCounter = 0;
    const out = draftsFromTagCandidates(
      [candidate('A1', 10, 10), candidate('B2', 20, 20)],
      'doc-1', 0,
      tag => (tag === 'A1' ? 'lineA' : null),
      [],
      makeId
    );
    expect(out).toEqual([
      { id: 'new-1', documentId: 'doc-1', pageIndex: 0, lineKey: 'lineA', kind: 'count', points: [{ x: 10, y: 10 }], drops: 0, dropFt: null, slackPct: null, status: 'suggested', label: 'A1' },
      { id: 'new-2', documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count', points: [{ x: 20, y: 20 }], drops: 0, dropFt: null, slackPct: null, status: 'suggested', label: 'B2' },
    ]);
  });

  it('skips a candidate whose point matches an EXISTING marker on the same sheet (re-running the action never duplicates)', () => {
    const existing = [existingMarkup({ points: [{ x: 10, y: 10 }] })];
    const out = draftsFromTagCandidates([candidate('A1', 10, 10)], 'doc-1', 0, () => null, existing, makeId);
    expect(out).toEqual([]);
  });

  it('a point within tolerance (sub-pixel float noise) of an existing marker still counts as a duplicate', () => {
    const existing = [existingMarkup({ points: [{ x: 10, y: 10 }] })];
    const out = draftsFromTagCandidates([candidate('A1', 10.2, 9.8)], 'doc-1', 0, () => null, existing, makeId);
    expect(out).toEqual([]);
  });

  it('a point clearly outside tolerance of an existing marker is NOT a duplicate', () => {
    const existing = [existingMarkup({ points: [{ x: 10, y: 10 }] })];
    const out = draftsFromTagCandidates([candidate('A1', 50, 50)], 'doc-1', 0, () => null, existing, makeId);
    expect(out.length).toBe(1);
  });

  it('an existing marker on a DIFFERENT sheet never blocks a candidate on this sheet', () => {
    const existing = [existingMarkup({ documentId: 'doc-2', pageIndex: 0, points: [{ x: 10, y: 10 }] })];
    const out = draftsFromTagCandidates([candidate('A1', 10, 10)], 'doc-1', 0, () => null, existing, makeId);
    expect(out.length).toBe(1);
  });

  it('an existing SUGGESTED (not just confirmed) marker also blocks a duplicate — status does not matter for dedup', () => {
    const existing = [existingMarkup({ status: 'suggested', points: [{ x: 10, y: 10 }] })];
    const out = draftsFromTagCandidates([candidate('A1', 10, 10)], 'doc-1', 0, () => null, existing, makeId);
    expect(out).toEqual([]);
  });

  it('two candidates at the SAME point within one batch (different tags matching the same text run) produce only one marker', () => {
    const out = draftsFromTagCandidates(
      [candidate('TYPE', 10, 10), candidate('A', 10, 10)],
      'doc-1', 0, () => null, [], makeId
    );
    expect(out.length).toBe(1);
  });

  it('an empty candidate list produces no drafts', () => {
    expect(draftsFromTagCandidates([], 'doc-1', 0, () => null, [], makeId)).toEqual([]);
  });
});

// Fix round 1 / S2 — the reviewer's exact scenario: hand-count 40 (here,
// simplified to one) troffers, "Suggest markers" adds MORE dashed markers
// near (but past the tight suggestion-time dedup tolerance from) each hand
// click, and "Confirm all on this sheet" used to blindly promote every
// suggested marker regardless of proximity to an already-confirmed one on
// the SAME line, doubling the rollup.
describe('confirmAllOnSheet', () => {
  function suggested(over: Partial<MarkupDraft> = {}): MarkupDraft {
    return existingMarkup({ id: 's1', status: 'suggested', ...over });
  }

  it('a suggested marker within tolerance of an ALREADY-CONFIRMED marker on the SAME line is skipped, not promoted', () => {
    const confirmed = existingMarkup({ id: 'c1', lineKey: 'l1', points: [{ x: 100, y: 100 }] });
    const near = suggested({ lineKey: 'l1', points: [{ x: 110, y: 105 }] }); // 10pt away — within the 24pt tolerance
    const result = confirmAllOnSheet([confirmed, near], 'doc-1', 0);
    expect(result.confirmedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.markers.find(m => m.id === 's1')!.status).toBe('suggested'); // untouched, not confirmed
  });

  it('a suggested marker well outside the tolerance IS promoted, even on the same line', () => {
    const confirmed = existingMarkup({ id: 'c1', lineKey: 'l1', points: [{ x: 100, y: 100 }] });
    const far = suggested({ lineKey: 'l1', points: [{ x: 500, y: 500 }] });
    const result = confirmAllOnSheet([confirmed, far], 'doc-1', 0);
    expect(result.confirmedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.markers.find(m => m.id === 's1')!.status).toBe('confirmed');
  });

  it('a nearby confirmed marker on a DIFFERENT line never blocks this one', () => {
    const confirmedOtherLine = existingMarkup({ id: 'c1', lineKey: 'l2', points: [{ x: 100, y: 100 }] });
    const near = suggested({ lineKey: 'l1', points: [{ x: 105, y: 105 }] });
    const result = confirmAllOnSheet([confirmedOtherLine, near], 'doc-1', 0);
    expect(result.confirmedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it('two adjacent genuinely-distinct suggested markers (no prior confirmed marker at all) are BOTH promoted — never deduped against each other', () => {
    const s1 = suggested({ id: 's1', lineKey: 'l1', points: [{ x: 100, y: 100 }] });
    const s2 = suggested({ id: 's2', lineKey: 'l1', points: [{ x: 105, y: 100 }] }); // 5pt apart, within tolerance of EACH OTHER, but neither is confirmed yet
    const result = confirmAllOnSheet([s1, s2], 'doc-1', 0);
    expect(result.confirmedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
  });

  it('only touches markers on the given sheet — a suggested marker on a different sheet is left alone', () => {
    const other = suggested({ id: 's-other', documentId: 'doc-2', points: [{ x: 100, y: 100 }] });
    const result = confirmAllOnSheet([other], 'doc-1', 0);
    expect(result.confirmedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.markers[0].status).toBe('suggested');
  });

  it('an already-confirmed marker on the sheet is left as-is (not double-counted, not touched)', () => {
    const confirmed = existingMarkup({ id: 'c1' });
    const result = confirmAllOnSheet([confirmed], 'doc-1', 0);
    expect(result.confirmedCount).toBe(0);
    expect(result.markers).toEqual([confirmed]);
  });

  it('the reviewer\'s exact scenario at 1:1 scale: a hand-confirmed marker plus a suggested one 10pt away on the same line rolls up as ONE, not two', () => {
    const handPlaced = existingMarkup({ id: 'hand-1', lineKey: 'lineA', points: [{ x: 200, y: 200 }] });
    const suggestedNearby = suggested({ id: 'sugg-1', lineKey: 'lineA', points: [{ x: 208, y: 195 }] });
    const result = confirmAllOnSheet([handPlaced, suggestedNearby], 'doc-1', 0);
    const confirmedOnLine = result.markers.filter(m => m.lineKey === 'lineA' && m.status === 'confirmed');
    expect(confirmedOnLine.length).toBe(1); // still just the hand-placed one
  });
});
