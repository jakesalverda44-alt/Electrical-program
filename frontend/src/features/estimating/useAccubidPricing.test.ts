// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a), delete: (...a: unknown[]) => del(...a) } };
});

import { useAccubidPricing } from './useAccubidPricing';
import { AccubidBidResponse, DEFAULT_ACCUBID_SETTINGS, EMPTY_ACCUBID_RECAP } from './types';

beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset(); del.mockReset();
});

const initial: AccubidBidResponse = {
  recap: { ...EMPTY_ACCUBID_RECAP, sellingPrice: 1234.56 },
  settings: DEFAULT_ACCUBID_SETTINGS,
  totalHours: 10,
  quotes: [],
  costLines: [],
  alternates: [],
};

describe('useAccubidPricing — hydration', () => {
  it('loads the recap/settings/quotes/costLines/alternates from GET /:bidId/accubid', async () => {
    get.mockResolvedValue({ data: initial });
    const { result } = renderHook(() => useAccubidPricing('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recap.sellingPrice).toBe(1234.56);
    expect(result.current.settings.laborOverheadPct).toBe(38);
    expect(get).toHaveBeenCalledWith('/estimating/bid1/accubid');
  });

  it('does nothing when bidId is null', async () => {
    const { result } = renderHook(() => useAccubidPricing(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useAccubidPricing — mutations reload from the server response / a fresh GET', () => {
  it('saveSettings PUTs and installs the returned recap directly', async () => {
    get.mockResolvedValue({ data: initial });
    const updated: AccubidBidResponse = { ...initial, recap: { ...initial.recap, sellingPrice: 9999 } };
    put.mockResolvedValue({ data: updated });
    const { result } = renderHook(() => useAccubidPricing('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.saveSettings({ ...DEFAULT_ACCUBID_SETTINGS, laborOverheadPct: 45 });
    expect(put).toHaveBeenCalledWith('/estimating/bid1/accubid/settings', expect.objectContaining({ laborOverheadPct: 45 }));
    await waitFor(() => expect(result.current.recap.sellingPrice).toBe(9999));
  });

  it('addQuote POSTs then reloads', async () => {
    get.mockResolvedValueOnce({ data: initial }).mockResolvedValueOnce({ data: { ...initial, quotes: [{ id: 'q1', description: 'Switchgear', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null, sort: 0 }] } });
    post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useAccubidPricing('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.addQuote({ description: 'Switchgear', amount: 5000, taxPct: 0, markupPct: 18, status: 'budget_pending', vendor: null });
    expect(post).toHaveBeenCalledWith('/estimating/bid1/accubid/quotes', expect.objectContaining({ description: 'Switchgear' }));
    await waitFor(() => expect(result.current.quotes).toHaveLength(1));
  });

  it('removeAlternate DELETEs then reloads', async () => {
    get.mockResolvedValue({ data: initial });
    del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useAccubidPricing('bid1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.removeAlternate('a1');
    expect(del).toHaveBeenCalledWith('/estimating/bid1/accubid/alternates/a1');
  });
});
