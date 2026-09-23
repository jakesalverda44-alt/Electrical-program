// Estimating Phase B, Task 5 — exhaustive tests for markupHistory.ts's
// undo/redo (generic) and the MarkupDraft[] mutation helpers.
import { describe, it, expect } from 'vitest';
import {
  initHistory, commit, undo, redo, canUndo, canRedo, replacePresent,
  createMarkup, updateMarkup, deleteMarkups, reassignMarkups, moveMarkup, MarkupDraft,
} from './markupHistory';

function draft(over: Partial<MarkupDraft> = {}): MarkupDraft {
  return {
    id: 'm1', documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count',
    points: [{ x: 1, y: 1 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null,
    ...over,
  };
}

describe('initHistory / commit / undo / redo — generic', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory([draft()]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('commit pushes the old present into past and installs the new one', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    const h1 = commit(h0, [draft({ id: 'a' })]);
    expect(h1.present).toEqual([draft({ id: 'a' })]);
    expect(canUndo(h1)).toBe(true);
    expect(canRedo(h1)).toBe(false);
  });

  it('undo restores the previous present and canRedo becomes true', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    const h1 = commit(h0, [draft({ id: 'a' })]);
    const h2 = undo(h1);
    expect(h2.present).toEqual([]);
    expect(canUndo(h2)).toBe(false);
    expect(canRedo(h2)).toBe(true);
  });

  it('redo re-applies what undo just removed', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    const h1 = commit(h0, [draft({ id: 'a' })]);
    const h2 = undo(h1);
    const h3 = redo(h2);
    expect(h3.present).toEqual([draft({ id: 'a' })]);
    expect(canRedo(h3)).toBe(false);
  });

  it('undo on an empty past is a no-op (never throws)', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    expect(undo(h0)).toBe(h0);
  });

  it('redo on an empty future is a no-op (never throws)', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    expect(redo(h0)).toBe(h0);
  });

  it('a new commit AFTER an undo discards the redo branch (standard editor behavior)', () => {
    const h0 = initHistory<MarkupDraft[]>([]);
    const h1 = commit(h0, [draft({ id: 'a' })]);
    const h2 = commit(h1, [draft({ id: 'a' }), draft({ id: 'b' })]);
    const h3 = undo(h2); // back to [a]
    expect(canRedo(h3)).toBe(true);
    const h4 = commit(h3, [draft({ id: 'a' }), draft({ id: 'c' })]); // a genuinely new branch
    expect(canRedo(h4)).toBe(false);
    expect(h4.present).toEqual([draft({ id: 'a' }), draft({ id: 'c' })]);
  });

  it('supports multiple undo/redo steps in sequence', () => {
    let h = initHistory<MarkupDraft[]>([]);
    h = commit(h, [draft({ id: 'a' })]);
    h = commit(h, [draft({ id: 'a' }), draft({ id: 'b' })]);
    h = commit(h, [draft({ id: 'a' }), draft({ id: 'b' }), draft({ id: 'c' })]);
    expect(h.present.length).toBe(3);
    h = undo(h);
    expect(h.present.length).toBe(2);
    h = undo(h);
    expect(h.present.length).toBe(1);
    h = undo(h);
    expect(h.present.length).toBe(0);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    h = redo(h);
    expect(h.present.length).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it('replacePresent swaps present without creating an undo step', () => {
    const h0 = initHistory<MarkupDraft[]>([draft({ id: 'a' })]);
    const h1 = replacePresent(h0, [draft({ id: 'a', label: 'server-confirmed' })]);
    expect(h1.present[0].label).toBe('server-confirmed');
    expect(canUndo(h1)).toBe(false); // no history entry was pushed
  });

  it('caps history length so a long session does not grow memory unbounded', () => {
    let h = initHistory<number>(0);
    for (let i = 1; i <= 250; i++) h = commit(h, i);
    expect(h.past.length).toBeLessThanOrEqual(200);
    // The oldest entries were dropped, not the newest.
    expect(h.past[h.past.length - 1]).toBe(249);
  });
});

describe('MarkupDraft[] mutation helpers', () => {
  it('createMarkup appends without mutating the input array', () => {
    const original = [draft({ id: 'a' })];
    const next = createMarkup(original, draft({ id: 'b' }));
    expect(next.length).toBe(2);
    expect(original.length).toBe(1); // unmutated
  });

  it('updateMarkup patches only the matching id', () => {
    const list = [draft({ id: 'a', label: 'old' }), draft({ id: 'b', label: 'other' })];
    const next = updateMarkup(list, 'a', { label: 'new' });
    expect(next.find(m => m.id === 'a')!.label).toBe('new');
    expect(next.find(m => m.id === 'b')!.label).toBe('other');
  });

  it('deleteMarkups removes every id in the set, keeps the rest', () => {
    const list = [draft({ id: 'a' }), draft({ id: 'b' }), draft({ id: 'c' })];
    const next = deleteMarkups(list, ['a', 'c']);
    expect(next.map(m => m.id)).toEqual(['b']);
  });

  it('reassignMarkups changes lineKey only on the selected ids (multi-select reassign)', () => {
    const list = [draft({ id: 'a', lineKey: 'L1' }), draft({ id: 'b', lineKey: 'L1' }), draft({ id: 'c', lineKey: 'L2' })];
    const next = reassignMarkups(list, ['a', 'b'], 'L3');
    expect(next.find(m => m.id === 'a')!.lineKey).toBe('L3');
    expect(next.find(m => m.id === 'b')!.lineKey).toBe('L3');
    expect(next.find(m => m.id === 'c')!.lineKey).toBe('L2'); // untouched
  });

  it('reassignMarkups(null) unassigns (the "unassigned markers" bucket)', () => {
    const list = [draft({ id: 'a', lineKey: 'L1' })];
    const next = reassignMarkups(list, ['a'], null);
    expect(next[0].lineKey).toBeNull();
  });

  it('moveMarkup replaces a marker\'s points (drag-to-reposition)', () => {
    const list = [draft({ id: 'a', points: [{ x: 1, y: 1 }] })];
    const next = moveMarkup(list, 'a', [{ x: 5, y: 5 }]);
    expect(next[0].points).toEqual([{ x: 5, y: 5 }]);
  });

  it('a full create -> commit -> move -> commit -> undo -> undo round trip lands back at empty', () => {
    let h = initHistory<MarkupDraft[]>([]);
    h = commit(h, createMarkup(h.present, draft({ id: 'a', points: [{ x: 1, y: 1 }] })));
    h = commit(h, moveMarkup(h.present, 'a', [{ x: 9, y: 9 }]));
    expect(h.present[0].points).toEqual([{ x: 9, y: 9 }]);
    h = undo(h);
    expect(h.present[0].points).toEqual([{ x: 1, y: 1 }]);
    h = undo(h);
    expect(h.present).toEqual([]);
  });
});
