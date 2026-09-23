// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) } };
});

import { useEstimatingBid } from './useEstimatingBid';
import { EMPTY_RECAP, DEFAULT_SETTINGS, EstimatingBidResponse } from './types';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const initialResponse: EstimatingBidResponse = {
  lines: [{ id: 'l1', category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA', source: 'manual' }],
  settings: DEFAULT_SETTINGS,
  recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 100 } },
  proposed: false,
  savedGrandTotal: 100,
};

describe('useEstimatingBid — hydration', () => {
  it('hydrates lines/settings/recap/proposed from the initial GET, exactly once', async () => {
    get.mockResolvedValue({ data: initialResponse });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lines).toEqual(initialResponse.lines);
    expect(result.current.recap.totals.grandTotal).toBe(100);
    expect(result.current.proposed).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('fix round 1 / S1: is NOT dirty when the initial response is a proposed (unsaved) mapping the estimator hasn\'t touched yet', async () => {
    // The old behavior forced dirty=true the instant a proposed mapping
    // loaded, which fired useUnsavedGuard (PcWorkspaceView) and forced a
    // save before the estimator had done anything — an unsaved SERVER
    // suggestion is not the same thing as unsaved ESTIMATOR work.
    get.mockResolvedValue({ data: { ...initialResponse, proposed: true } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposed).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('fix round 1 / S1: a proposed mapping DOES become dirty once the estimator actually edits a line', async () => {
    get.mockResolvedValue({ data: { ...initialResponse, proposed: true } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dirty).toBe(false);
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 42 }))); });
    expect(result.current.dirty).toBe(true);
  });

  it('falls back to safe empty defaults for a malformed/generic response instead of crashing (regression: a blanket test mock returning { data: [] } for every GET)', async () => {
    get.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lines).toEqual([]);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.current.recap).toEqual(EMPTY_RECAP);
    expect(result.current.proposed).toBe(false);
    expect(result.current.dirty).toBe(false);
  });
});

describe('useEstimatingBid — live recalc', () => {
  it('debounces edits into a single POST /price call after 400ms, updating the recap', async () => {
    get.mockResolvedValue({ data: initialResponse });
    post.mockResolvedValue({ data: { recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 250 } } } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 20 }))); });
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 25 }))); }); // a second edit within the debounce window

    expect(post).not.toHaveBeenCalled(); // not yet — still debouncing
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1)); // only ONE request for both edits
    expect(post).toHaveBeenCalledWith('/estimating/bid1/price', expect.objectContaining({
      lines: expect.arrayContaining([expect.objectContaining({ qty: 25 })]),
    }));
    await waitFor(() => expect(result.current.recap.totals.grandTotal).toBe(250));
  });

  it('marks the bid dirty once a line is edited away from the persisted snapshot', async () => {
    get.mockResolvedValue({ data: initialResponse });
    post.mockResolvedValue({ data: { recap: EMPTY_RECAP } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dirty).toBe(false);
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 99 }))); });
    expect(result.current.dirty).toBe(true);
  });

  it('fix round 1 / S8: a stale (older) /price response arriving after a newer one never overwrites the recap', async () => {
    get.mockResolvedValue({ data: initialResponse });
    let resolveFirst!: (v: { data: { recap: typeof EMPTY_RECAP } }) => void;
    let resolveSecond!: (v: { data: { recap: typeof EMPTY_RECAP } }) => void;
    const firstPromise = new Promise(res => { resolveFirst = res; });
    const secondPromise = new Promise(res => { resolveSecond = res; });
    post.mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First edit -> debounced request #1 fires.
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 11 }))); });
    await act(async () => { vi.advanceTimersByTime(400); });
    // Second edit, far enough later that it's a SEPARATE debounced request, not a coalesced one.
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 22 }))); });
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    // The NEWER request (#2) resolves first; the OLDER one (#1) resolves after.
    await act(async () => { resolveSecond({ data: { recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 22 } } } }); });
    await waitFor(() => expect(result.current.recap.totals.grandTotal).toBe(22));
    await act(async () => { resolveFirst({ data: { recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 11 } } } }); });
    // The stale #1 response must NOT clobber #2's already-applied recap.
    expect(result.current.recap.totals.grandTotal).toBe(22);
  });
});

describe('useEstimatingBid — save', () => {
  it('PUTs the current lines/settings, updates the recap, clears proposed and dirty', async () => {
    get.mockResolvedValue({ data: { ...initialResponse, proposed: true } });
    put.mockResolvedValue({ data: { recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 500 } } } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Fix round 1 / S1: dirty now reflects a REAL edit, not merely being a
    // proposed mapping — make one so save() has genuine unsaved work to clear.
    expect(result.current.dirty).toBe(false);
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 12 }))); });
    expect(result.current.dirty).toBe(true);

    await act(async () => { await result.current.save(); });

    expect(put).toHaveBeenCalledWith('/estimating/bid1', {
      lines: initialResponse.lines.map(l => ({ ...l, qty: 12 })),
      settings: initialResponse.settings,
    });
    expect(result.current.recap.totals.grandTotal).toBe(500);
    expect(result.current.proposed).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('sets saveError and stays dirty when the save fails', async () => {
    get.mockResolvedValue({ data: initialResponse });
    put.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 55 }))); });

    await act(async () => { await result.current.save().catch(() => {}); });
    expect(result.current.saveError).toBe('boom');
    expect(result.current.dirty).toBe(true);
  });
});

describe('useEstimatingBid — sync-takeoff', () => {
  it('POSTs sync-takeoff, replaces lines with the response, updates the recap and clears proposed', async () => {
    get.mockResolvedValue({ data: { ...initialResponse, proposed: true } });
    const newLines = [{ id: 'l2', category: 'Interior Lighting', description: 'Troffer', qty: 5, unit: 'EA' as const, source: 'takeoff' as const }];
    post.mockResolvedValue({
      data: { added: 1, updated: 0, vanished: 0, lines: newLines, recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 300 } } },
    });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let syncResult: { added: number; updated: number; vanished: number } | null = null;
    await act(async () => { syncResult = await result.current.syncTakeoff(); });

    expect(post).toHaveBeenCalledWith('/estimating/bid1/sync-takeoff');
    expect(syncResult).toEqual({ added: 1, updated: 0, vanished: 0 });
    expect(result.current.lines).toEqual(newLines);
    expect(result.current.recap.totals.grandTotal).toBe(300);
    expect(result.current.proposed).toBe(false);
    expect(result.current.dirty).toBe(false);
  });
});
