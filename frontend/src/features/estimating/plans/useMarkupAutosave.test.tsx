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

// Fix round 1 / B3(a) — the response used to be completely unread: ANY 200
// (even one carrying per-item `skipped` entries the server did NOT apply)
// folded the WHOLE sent batch into syncedRef and showed "Saved".
describe('useMarkupAutosave — a 200 response with `skipped` items is treated as an error (B3(a))', () => {
  it('shows status=error (not "saved") when the response carries a skipped item, with the reason in the message', async () => {
    post.mockResolvedValueOnce({ data: { created: [], updated: [], deleted: [], skipped: [{ id: 'a', reason: 'id already belongs to a different bid' }] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/id already belongs to a different bid/);
  });

  it('does NOT fold a skipped id into the synced snapshot — onSynced never reports it as confirmed', async () => {
    post.mockResolvedValueOnce({ data: { created: [], updated: [], deleted: [], skipped: [{ id: 'a', reason: 'not found for this bid' }] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
    expect(onSynced).toHaveBeenCalledWith([]); // 'a' was skipped — never joins the synced snapshot
  });

  it('a MIXED batch confirms the non-skipped items and only reports the skipped one as failed', async () => {
    post.mockResolvedValueOnce({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [{ id: 'b', reason: 'id already belongs to a different bid' }] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = [draft('a'), draft('b')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(onSynced).toHaveBeenCalledWith([draft('a')]); // a confirmed, b withheld
  });

  // The reviewer's exact B3(a) undo scenario, exercised at the hook level:
  // delete a marker (server confirms), undo (re-create the same id) — if
  // the server STILL skipped it (e.g. the fix hadn't landed), the client
  // must show the failure, not "Saved" with the marker silently still gone.
  it('undo-a-delete that the server skips is surfaced as an error, not silently shown as saved', async () => {
    post.mockResolvedValueOnce({ data: { created: [], updated: [], deleted: ['a'], skipped: [] } }); // the delete
    post.mockResolvedValueOnce({ data: { created: [], updated: [], deleted: [], skipped: [{ id: 'a', reason: 'not found for this bid (already deleted, or never created)' }] } }); // the undo, still skipped
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [draft('a')];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    markups = []; // delete
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('saved'));

    markups = [draft('a')]; // undo
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/not found for this bid/);
  });
});

// Fix round 1 / B3(c) — F4's exact scenario: place a marker and switch
// steps within the 800ms debounce window (never sent, 0 POSTs); or a save
// already failed and the estimator navigates away without noticing.
describe('useMarkupAutosave — flush on unmount (B3(c))', () => {
  it('unmounting DURING the pending debounce (no timer has fired yet) still fires the batch', async () => {
    post.mockResolvedValueOnce({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [] } });
    let markups: MarkupDraft[] = [];
    const { rerender, unmount } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    // Advance LESS than the 800ms debounce — nothing has been sent yet.
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(post).not.toHaveBeenCalled();

    unmount(); // e.g. switching steps or the List/Plans toggle, within the debounce window
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/estimating/bid1/markups/batch', expect.objectContaining({
      creates: [expect.objectContaining({ id: 'a' })],
    }));
  });

  it('unmounting while a PREVIOUS batch is in status=error (nothing pending, no timer running) retries it', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    post.mockResolvedValueOnce({ data: { created: [{ id: 'a' }], updated: [], deleted: [], skipped: [] } });
    let markups: MarkupDraft[] = [];
    const { result, rerender, unmount } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });

    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(post).toHaveBeenCalledTimes(1);

    unmount(); // the estimator navigates away without noticing the failure
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(post).toHaveBeenCalledTimes(2); // retried on the way out
  });

  it('unmounting with NOTHING unsaved (already "saved"/"idle") sends no extra request', async () => {
    let markups: MarkupDraft[] = [];
    const { unmount } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(post).not.toHaveBeenCalled();
  });
});

// Fix round 1 / B3(d) — the reviewer's exact F1 scenario: hydrating N
// EXISTING markups (a delayed GET, arriving after this hook's own first
// render already locked in `[]` as its baseline) must not re-POST them as
// brand-new creates the instant they land.
describe('useMarkupAutosave — reset() installs a hydrated baseline without sending anything (B3(d))', () => {
  it('calling reset() with the SAME markups the hook is about to receive next render never triggers a save', async () => {
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = []; // this hook's own first render — the "stale []" baseline the bug used to lock in
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });
    expect(result.current.status).toBe('idle');

    // The delayed GET for existing markups lands: 2 pre-existing markups,
    // hydrated via reset() in the SAME effect that updates `markups` too
    // (mirroring PlansWorkspace.tsx's own hydration effect).
    const existing = [draft('m1'), draft('m2')];
    act(() => { result.current.reset(existing); });
    markups = existing;
    rerender({ m: markups });

    // Advance well past the debounce — if this were misdiagnosed as 2 new
    // creates, a batch would have fired by now.
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(post).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('reset() returns status to "idle" and clears any pending error', async () => {
    post.mockRejectedValueOnce(new Error('offline'));
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, vi.fn()), { initialProps: { m: markups } });
    markups = [draft('a')];
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => { result.current.reset([draft('a')]); });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('AFTER reset(), a genuinely NEW change still autosaves normally (reset only sets the baseline, it doesn\'t disable the hook)', async () => {
    post.mockResolvedValueOnce({ data: { created: [{ id: 'b' }], updated: [], deleted: [], skipped: [] } });
    const onSynced = vi.fn();
    let markups: MarkupDraft[] = [];
    const { result, rerender } = renderHook(({ m }: { m: MarkupDraft[] }) => useMarkupAutosave('bid1', m, onSynced), { initialProps: { m: markups } });

    const existing = [draft('a')];
    act(() => { result.current.reset(existing); });
    markups = existing;
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(post).not.toHaveBeenCalled(); // hydration alone sends nothing

    markups = [draft('a'), draft('b')]; // a genuine new marker
    rerender({ m: markups });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/estimating/bid1/markups/batch', expect.objectContaining({
      creates: [expect.objectContaining({ id: 'b' })], // only the NEW one, not 'a' again
    }));
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
