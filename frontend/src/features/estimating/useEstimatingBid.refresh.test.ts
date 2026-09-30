// @vitest-environment happy-dom
// An open Estimating page must follow takeoff review answers, quotes and cost
// lines changed elsewhere in the bid, and must never save (or overwrite
// unsaved edits with) a stale proposal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), delete: vi.fn() } };
});

import { useEstimatingBid } from './useEstimatingBid';
import { useAccubidPricing } from './useAccubidPricing';
import { signalEstimateStale } from './estimateSignals';
import { EMPTY_RECAP, DEFAULT_SETTINGS, EstimatingBidResponse, EstimateLine, EMPTY_ACCUBID_RECAP, DEFAULT_ACCUBID_SETTINGS, AccubidBidResponse } from './types';

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const line = (id: string, qty: number): EstimateLine => ({ id, category: 'Branch Power', description: `Item ${id}`, qty, unit: 'EA', source: 'takeoff' });
const proposedV1: EstimatingBidResponse = {
  lines: [line('proposed-0', 5), line('proposed-1', 7)],
  settings: DEFAULT_SETTINGS,
  recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 100 } },
  proposed: true,
  savedGrandTotal: null,
};
const proposedV2: EstimatingBidResponse = { ...proposedV1, lines: [line('proposed-0', 5)], recap: { ...EMPTY_RECAP, totals: { ...EMPTY_RECAP.totals, grandTotal: 555 } } };

describe('takeoff answers changing the server behind an open estimate', () => {
  it('an untouched proposal re-hydrates from the server after a review-answer signal', async () => {
    get.mockResolvedValueOnce({ data: proposedV1 }).mockResolvedValue({ data: proposedV2 });
    post.mockResolvedValue({ data: { recap: proposedV1.recap, accubid: null } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lines).toHaveLength(2);
    await act(async () => { signalEstimateStale('bid1'); });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(result.current.recap.totals.grandTotal).toBe(555);
    expect(result.current.dirty).toBe(false);
    expect(result.current.serverChanged).toBe(false);
  });

  it('a signal for another bid is ignored', async () => {
    get.mockResolvedValue({ data: proposedV1 });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    get.mockClear();
    await act(async () => { signalEstimateStale('other-bid'); });
    expect(get).not.toHaveBeenCalled();
  });

  it('with unsaved edits nothing is overwritten: the notice flag is raised, and rehydrate discards the edits', async () => {
    get.mockResolvedValueOnce({ data: proposedV1 }).mockResolvedValue({ data: proposedV2 });
    post.mockResolvedValue({ data: { recap: proposedV1.recap, accubid: null } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 99 }))); });
    await act(async () => { signalEstimateStale('bid1'); });
    await waitFor(() => expect(result.current.serverChanged).toBe(true));
    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0].qty).toBe(99);
    act(() => { result.current.rehydrate(); });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(result.current.serverChanged).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('Save on a stale untouched proposal refreshes it instead of PUTting the old lines', async () => {
    get.mockResolvedValueOnce({ data: proposedV1 }).mockResolvedValue({ data: proposedV2 });
    post.mockResolvedValue({ data: { recap: proposedV1.recap, accubid: null } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await expect(result.current.save()).rejects.toThrow(/answers changed/); });
    expect(put).not.toHaveBeenCalled();
    expect(result.current.lines).toHaveLength(1);
  });

  it('Save on a stale proposal WITH edits is blocked and raises the notice', async () => {
    get.mockResolvedValueOnce({ data: proposedV1 }).mockResolvedValue({ data: proposedV2 });
    post.mockResolvedValue({ data: { recap: proposedV1.recap, accubid: null } });
    const { result } = renderHook(() => useEstimatingBid('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { result.current.setLines(prev => prev.map(l => ({ ...l, qty: 99 }))); });
    await act(async () => { await expect(result.current.save()).rejects.toThrow(/answers changed/); });
    expect(put).not.toHaveBeenCalled();
    expect(result.current.serverChanged).toBe(true);
    expect(result.current.lines[0].qty).toBe(99);
  });

  it('the sidebar re-prices the current proposal lines after a quote is added through useAccubidPricing', async () => {
    const acb = (sellingPrice: number): AccubidBidResponse => ({ recap: { ...EMPTY_ACCUBID_RECAP, sellingPrice }, settings: DEFAULT_ACCUBID_SETTINGS, totalHours: 1, quotes: [], costLines: [], alternates: [] });
    const accubidProposal: EstimatingBidResponse = { ...proposedV1, settings: { ...DEFAULT_SETTINGS, pricing_mode: 'accubid' }, accubid: acb(1000) };
    get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/accubid') ? acb(1000) : accubidProposal }));
    post.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/quotes') ? { id: 'q1' } : { recap: proposedV1.recap, accubid: acb(1800) } }));
    const { result } = renderHook(() => ({ bid: useEstimatingBid('bid1'), pricing: useAccubidPricing('bid1') }));
    await waitFor(() => expect(result.current.bid.loading).toBe(false));
    await waitFor(() => expect(result.current.pricing.loading).toBe(false));
    expect(result.current.bid.accubid?.recap.sellingPrice).toBe(1000);
    await act(async () => { await result.current.pricing.addQuote({ description: 'Fixtures', amount: 800, taxPct: 0, markupPct: 0, status: 'firm', vendor: null } as never); });
    await waitFor(() => expect(result.current.bid.accubid?.recap.sellingPrice).toBe(1800));
    const priceCall = post.mock.calls.find(c => String(c[0]).endsWith('/price'));
    expect(priceCall?.[1].lines).toHaveLength(2); // the proposal's own lines, not zero
  });
});
