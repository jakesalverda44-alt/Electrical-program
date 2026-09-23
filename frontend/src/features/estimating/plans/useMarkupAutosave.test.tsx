// @vitest-environment happy-dom
// Estimating Phase B, Task 5 — useMarkupAutosave.ts: the debounced batch
// save, and — per the coordinator's explicit instruction — a failed batch,
// then a retry, then navigating away while the guard is armed.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, render, screen, fireEvent, cleanup } from '@testing-library/react';

const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => post(...a) } };
});

import { useMarkupAutosave, applyBatchToSnapshot } from './useMarkupAutosave';
import { MarkupDraft } from './markupHistory';
import { UnsavedGuardProvider, useConfirmLeave } from '../../../contexts/UnsavedGuardContext';

function draft(id: string, over: Partial<MarkupDraft> = {}): MarkupDraft {
  return {
    id, documentId: 'doc-1', pageIndex: 0, lineKey: null, kind: 'count',
    points: [{ x: 1, y: 1 }], drops: 0, dropFt: null, slackPct: null, status: 'confirmed', label: null,
    ...over,
  };
}

beforeEach(() => {
  post.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useMarkupAutosave — debounce + success', () => {
  it('starts idle and stays idle with no changes relative to the initial snapshot', async () => {
    const onSynced = vi.fn();
    const { result } = renderHook(() => useMarkupAutosave('bid1', [draft('a')], onSynced));
    expect(result.current.status).toBe('idle');
    expect(post).not.toHaveBeenCalled();
  });

  it('a new markup arms "pending", then fires the batch 800ms after the last change', async () => {
    post.mockResolvedValue({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    expect(result.current.status).toBe('pending');
    expect(post).not.toHaveBeenCalled(); // not yet — debounce hasn't elapsed

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/estimating/bid1/markups/batch', expect.objectContaining({
      creates: [expect.objectContaining({ id: 'a' })], updates: [], deletes: [],
    }));
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(onSynced).toHaveBeenCalledWith([draft('a')]);
  });

  it('collapses several rapid changes into ONE batch (debounce resets on each change)', async () => {
    post.mockResolvedValue({ data: { created: [], updated: [], deleted: [], skipped: [] } });
    let markups: MarkupDraft[] = [];
    const { rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(400); });
    markups = [draft('a'), draft('b')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(400); }); // 800ms since first change, only 400 since second
    expect(post).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(400); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].creates.length).toBe(2); // both a and b in ONE batch
  });
});

describe('useMarkupAutosave — failed batch, then a retry, then success', () => {
  it('a failed batch sets status=error with a message, and does not advance the synced snapshot', async () => {
    post.mockRejectedValueOnce(new Error('Network error'));
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeTruthy();
    expect(onSynced).not.toHaveBeenCalled();
  });

  it('retryNow() re-attempts immediately (no need to wait for another debounce) and can succeed', async () => {
    post.mockRejectedValueOnce(new Error('Network error'));
    post.mockResolvedValueOnce({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(post).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.retryNow(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('saved'));
    expect(post).toHaveBeenCalledTimes(2);
    expect(onSynced).toHaveBeenCalledWith([draft('a')]);
  });

  it('a retry that ALSO fails stays in error, with the latest error message', async () => {
    post.mockRejectedValueOnce(new Error('First failure'));
    post.mockRejectedValueOnce(new Error('Second failure'));
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => { result.current.retryNow(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.error).toBe('Second failure'));
    expect(result.current.status).toBe('error');
  });
});

describe('useMarkupAutosave — the unsaved guard blocks navigation while pending/saving/error', () => {
  function Harness({ markups, onNavigated }: { markups: MarkupDraft[]; onNavigated: () => void }) {
    const autosave = useMarkupAutosave('bid1', markups, () => {});
    const confirmLeave = useConfirmLeave();
    return (
      <div>
        <div data-testid="status">{autosave.status}</div>
        <button onClick={() => confirmLeave(onNavigated)}>Leave the plan viewer</button>
      </div>
    );
  }

  // The hook establishes its "synced" baseline from whatever markups are
  // passed on the FIRST render (by design — see useMarkupAutosave.ts's
  // comment: "nothing spuriously autosaves on mount"). To exercise an
  // actual pending/error/saved transition, every test here starts EMPTY
  // and then rerenders with a real local edit, exactly like a user
  // placing a marker after the viewer has already loaded.
  function setup() {
    const onNavigated = vi.fn();
    const utils = render(<UnsavedGuardProvider><Harness markups={[]} onNavigated={onNavigated}/></UnsavedGuardProvider>);
    return { onNavigated, rerender: (m: MarkupDraft[]) => utils.rerender(<UnsavedGuardProvider><Harness markups={m} onNavigated={onNavigated}/></UnsavedGuardProvider>) };
  }

  it('does NOT block navigation while idle (nothing unsaved)', () => {
    const { onNavigated } = setup();
    fireEvent.click(screen.getByText('Leave the plan viewer'));
    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('blocks navigation while a batch is PENDING (debounce armed, not yet sent)', () => {
    const { onNavigated, rerender } = setup();
    rerender([draft('a')]);
    expect(screen.getByTestId('status').textContent).toBe('pending');
    fireEvent.click(screen.getByText('Leave the plan viewer'));
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    expect(onNavigated).not.toHaveBeenCalled();
  });

  it('blocks navigation while a batch previously failed (status=error) until it succeeds', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    const { onNavigated, rerender } = setup();
    rerender([draft('a')]);

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));

    fireEvent.click(screen.getByText('Leave the plan viewer'));
    expect(screen.getByText('You have unsaved changes')).toBeTruthy();
    expect(onNavigated).not.toHaveBeenCalled();
  });

  it('once saved, navigation is no longer blocked', async () => {
    post.mockResolvedValueOnce({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [] } });
    const { onNavigated, rerender } = setup();
    rerender([draft('a')]);

    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('saved'));

    fireEvent.click(screen.getByText('Leave the plan viewer'));
    expect(onNavigated).toHaveBeenCalledTimes(1);
  });
});

describe('applyBatchToSnapshot', () => {
  it('upserts creates and updates, removes deletes, leaves everything else untouched', () => {
    const synced = [draft('a'), draft('b'), draft('c')];
    const next = applyBatchToSnapshot(synced, {
      creates: [draft('d')],
      updates: [draft('a', { label: 'changed' })],
      deletes: ['b'],
    });
    const byId = new Map(next.map(m => [m.id, m]));
    expect(byId.has('b')).toBe(false);
    expect(byId.get('a')!.label).toBe('changed');
    expect(byId.get('c')).toEqual(draft('c'));
    expect(byId.get('d')).toEqual(draft('d'));
  });
});
