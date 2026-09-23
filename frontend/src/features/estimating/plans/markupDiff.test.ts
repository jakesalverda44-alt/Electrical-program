// Estimating Phase B, Task 5 — exhaustive tests for markupDiff.ts.
import { describe, it, expect } from 'vitest';
import { diffMarkups, isEmptyBatch } from './markupDiff';
import { MarkupDraft } from './markupHistory';

function draft(id: string, over: Partial<MarkupDraft> = {}): MarkupDraft {
  return {
    id, documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count',
    points: [{ x: 1, y: 1 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null,
    ...over,
  };
}

describe('diffMarkups', () => {
  it('a brand-new markup (not in synced) is a create', () => {
    const batch = diffMarkups([], [draft('a')]);
    expect(batch.creates).toEqual([draft('a')]);
    expect(batch.updates).toEqual([]);
    expect(batch.deletes).toEqual([]);
  });

  it('a markup present in both, unchanged, produces nothing (never a no-op update)', () => {
    const batch = diffMarkups([draft('a')], [draft('a')]);
    expect(isEmptyBatch(batch)).toBe(true);
  });

  it('a markup present in both with different content is an update', () => {
    const batch = diffMarkups([draft('a', { label: 'old' })], [draft('a', { label: 'new' })]);
    expect(batch.updates).toEqual([draft('a', { label: 'new' })]);
    expect(batch.creates).toEqual([]);
  });

  it('a markup in synced but no longer in current is a delete', () => {
    const batch = diffMarkups([draft('a')], []);
    expect(batch.deletes).toEqual(['a']);
  });

  it('handles a mixed batch: one create, one update, one delete, one unchanged', () => {
    const synced = [draft('unchanged'), draft('to-update', { label: 'old' }), draft('to-delete')];
    const current = [draft('unchanged'), draft('to-update', { label: 'new' }), draft('brand-new')];
    const batch = diffMarkups(synced, current);
    expect(batch.creates.map(m => m.id)).toEqual(['brand-new']);
    expect(batch.updates.map(m => m.id)).toEqual(['to-update']);
    expect(batch.deletes).toEqual(['to-delete']);
  });

  it('a points-only change (drag) is detected as an update', () => {
    const synced = [draft('a', { points: [{ x: 1, y: 1 }] })];
    const current = [draft('a', { points: [{ x: 9, y: 9 }] })];
    const batch = diffMarkups(synced, current);
    expect(batch.updates.length).toBe(1);
  });

  it('a lineKey-only change (reassign) is detected as an update', () => {
    const synced = [draft('a', { lineKey: 'L1' })];
    const current = [draft('a', { lineKey: 'L2' })];
    expect(diffMarkups(synced, current).updates.length).toBe(1);
  });

  it('both empty inputs produce an empty batch', () => {
    expect(isEmptyBatch(diffMarkups([], []))).toBe(true);
  });
});

describe('isEmptyBatch', () => {
  it('is true only when all three arrays are empty', () => {
    expect(isEmptyBatch({ creates: [], updates: [], deletes: [] })).toBe(true);
    expect(isEmptyBatch({ creates: [draft('a')], updates: [], deletes: [] })).toBe(false);
    expect(isEmptyBatch({ creates: [], updates: [draft('a')], deletes: [] })).toBe(false);
    expect(isEmptyBatch({ creates: [], updates: [], deletes: ['a'] })).toBe(false);
  });
});
