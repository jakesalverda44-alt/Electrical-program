// Estimating Phase B, Task 7 (deferral closed) — suggestedMarkerFlow.ts.
import { describe, it, expect } from 'vitest';
import { draftsFromTagCandidates } from './suggestedMarkerFlow';
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
