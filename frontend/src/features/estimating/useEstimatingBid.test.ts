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
import { EMPTY_RECAP, DEFAULT_SETTINGS, EstimatingBidResponse, EstimateLine } from './types';

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

  // Phase B, Task 1 — a brand-new line gets its real, server-minted
  // line_key only once the save response is adopted; markups created
  // right after saving need this to point at without a second round trip.
  it('adopts the server\'s returned lines (with their real line_key) when present', async () => {
    get.mockResolvedValue({ data: initialResponse });
    const savedLines = [{ ...initialResponse.lines[0], line_key: 'server-minted-uuid', qty: 12 }];
    put.mockResolvedValue({ data: { recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 500 } }, lines: savedLines } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 12 }))); });

    await act(async () => { await result.current.save(); });

    expect(result.current.lines).toEqual(savedLines);
    expect(result.current.lines[0].line_key).toBe('server-minted-uuid');
    expect(result.current.dirty).toBe(false); // the adopted server lines match what was just persisted
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

  // Fix round 1 / B1 — save(linesOverride) PUTs the GIVEN array, not
  // whatever `lines` this hook's own closure captured on its last render.
  // This is what lets a caller do setLines(next) immediately followed by
  // save(next) in the SAME synchronous function (PcWorkspaceView.tsx's
  // onCreateLine) without a stale-closure race — React never re-renders
  // between those two calls, so save()'s own `lines` argument would
  // otherwise still be the PRE-setLines value.
  it('save(linesOverride) PUTs the override, not the hook\'s own (possibly stale) lines state', async () => {
    get.mockResolvedValue({ data: initialResponse });
    put.mockResolvedValue({ data: { recap: EMPTY_RECAP, lines: [{ ...initialResponse.lines[0], line_key: 'k-new', qty: 999 }] } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const overrideLines = [...initialResponse.lines, { id: 'l2', category: 'Branch Power', description: 'New manual line', qty: 1, unit: 'EA' as const, source: 'manual' as const }];
    await act(async () => { await result.current.save(overrideLines); });

    expect(put).toHaveBeenCalledWith('/estimating/bid1', { lines: overrideLines, settings: initialResponse.settings });
  });

  it('save(linesOverride) still adopts the server\'s returned lines when present, falling back to the override otherwise', async () => {
    get.mockResolvedValue({ data: initialResponse });
    put.mockResolvedValue({ data: { recap: EMPTY_RECAP } }); // no `lines` in the response this time
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const overrideLines = [{ id: 'l2', category: 'Branch Power', description: 'New manual line', qty: 1, unit: 'EA' as const, source: 'manual' as const }];
    await act(async () => { await result.current.save(overrideLines); });

    expect(result.current.lines).toEqual(overrideLines); // fell back to the override, not the hook's OWN stale `lines`
  });
});

describe('useEstimatingBid — installSaved (Fix round 1 / B1)', () => {
  it('installs lines/recap/savedGrandTotal directly, with no PUT/GET at all', async () => {
    get.mockResolvedValue({ data: initialResponse });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const applied = [{ ...initialResponse.lines[0], qty: 24, qty_source: 'markup' as const }];
    const recap = { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 777 } };
    act(() => { result.current.installSaved({ lines: applied, recap }); });

    expect(result.current.lines).toEqual(applied);
    expect(result.current.recap.totals.grandTotal).toBe(777);
    expect(result.current.savedGrandTotal).toBe(777);
    expect(put).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1); // only the ORIGINAL hydration GET — no re-fetch
  });

  it('clears dirty and sets the installed lines as the new persisted baseline', async () => {
    get.mockResolvedValue({ data: initialResponse });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dirty).toBe(false);

    const applied = [{ ...initialResponse.lines[0], qty: 24, qty_source: 'markup' as const }];
    act(() => { result.current.installSaved({ lines: applied, recap: EMPTY_RECAP }); });
    expect(result.current.dirty).toBe(false); // installed lines ARE the new baseline, not a divergence from it

    // Editing FROM the newly-installed baseline correctly marks dirty —
    // installSaved didn't just freeze dirty at false forever.
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 1 }))); });
    expect(result.current.dirty).toBe(true);
  });

  // This is THE reviewer's own repro (R6), now fixed: apply, then edit an
  // UNRELATED line, then save — the applied qty must survive the save,
  // not silently revert to its pre-apply value.
  it("R6 fixed: apply (installSaved), then edit an unrelated field, then save() — the applied qty survives", async () => {
    get.mockResolvedValue({ data: { ...initialResponse, lines: [
      { id: 'l1', line_key: 'k1', category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA', source: 'takeoff', qty_source: 'takeoff' },
      { id: 'l2', line_key: 'k2', category: 'Interior Lighting', description: 'Troffer', qty: 5, unit: 'EA', source: 'takeoff', qty_source: 'takeoff' },
    ] } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // "Apply" happened elsewhere (PlansWorkspace's own POST /apply-markups)
    // and its response is installed directly.
    const appliedLines: EstimateLine[] = [
      { id: 'l1', line_key: 'k1', category: 'Branch Power', description: 'Duplex', qty: 24, unit: 'EA', source: 'takeoff', qty_source: 'markup' },
      { id: 'l2', line_key: 'k2', category: 'Interior Lighting', description: 'Troffer', qty: 5, unit: 'EA', source: 'takeoff', qty_source: 'takeoff' },
    ];
    act(() => { result.current.installSaved({ lines: appliedLines, recap: EMPTY_RECAP }); });
    expect(result.current.lines[0].qty).toBe(24);

    // Now the estimator edits the OTHER (unrelated) line in Labor & Pricing.
    act(() => { result.current.setLines(prev => prev.map(l => (l.line_key === 'k2' ? { ...l, qty: 7, qty_overridden: true } : l))); });
    expect(result.current.dirty).toBe(true);

    put.mockResolvedValue({ data: { recap: EMPTY_RECAP } }); // echoes no `lines` — save() must fall back to ITS OWN live lines, not the pre-apply GET snapshot
    await act(async () => { await result.current.save(); });

    // The PUT body itself must carry the applied 24, not the pre-apply 10.
    const putBody = put.mock.calls[0][1] as { lines: { line_key: string; qty: number }[] };
    expect(putBody.lines.find(l => l.line_key === 'k1')!.qty).toBe(24);
    expect(putBody.lines.find(l => l.line_key === 'k2')!.qty).toBe(7);
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
