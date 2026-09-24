// Next round Part B, Task 2/3 — owns a bid's Accubid-mode pricing state
// (settings, quotes, equipment/GE lines, alternates, recap). Separate from
// useEstimatingBid on purpose: Phase A and Accubid are two different recap
// engines over the SAME saved est_bid_lines, and a bid is in exactly one
// mode at a time (EstimateSettings.pricing_mode) — this hook is only ever
// mounted while that mode is 'accubid'.
import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import {
  AccubidBidResponse, AccubidSettings, AccubidQuote, AccubidCostLine, AccubidAlternate,
  AccubidRecapResult, DEFAULT_ACCUBID_SETTINGS, EMPTY_ACCUBID_RECAP,
} from './types';

export interface UseAccubidPricingResult {
  loading: boolean;
  saving: boolean;
  error: string | null;
  settings: AccubidSettings;
  recap: AccubidRecapResult;
  totalHours: number;
  quotes: AccubidQuote[];
  costLines: AccubidCostLine[];
  alternates: AccubidAlternate[];
  saveSettings: (next: AccubidSettings) => Promise<void>;
  addQuote: (q: Omit<AccubidQuote, 'id' | 'sort'>) => Promise<void>;
  updateQuote: (id: string, patch: Partial<AccubidQuote>) => Promise<void>;
  removeQuote: (id: string) => Promise<void>;
  addCostLine: (c: Omit<AccubidCostLine, 'id' | 'sort'>) => Promise<void>;
  updateCostLine: (id: string, patch: Partial<AccubidCostLine>) => Promise<void>;
  removeCostLine: (id: string) => Promise<void>;
  addAlternate: (a: Omit<AccubidAlternate, 'id' | 'auto' | 'sourceRule' | 'sort'>) => Promise<void>;
  updateAlternate: (id: string, patch: Partial<AccubidAlternate>) => Promise<void>;
  removeAlternate: (id: string) => Promise<void>;
  reload: () => void;
}

export function useAccubidPricing(bidId: string | null): UseAccubidPricingResult {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccubidBidResponse>({
    recap: EMPTY_ACCUBID_RECAP, settings: DEFAULT_ACCUBID_SETTINGS, totalHours: 0, quotes: [], costLines: [], alternates: [],
  });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!bidId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<AccubidBidResponse>(`/estimating/${bidId}/accubid`)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => { if (!cancelled) setError(err?.crmError?.message ?? 'Could not load the Accubid recap.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bidId, reloadTick]);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  const saveSettings = useCallback(async (next: AccubidSettings) => {
    if (!bidId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.put<AccubidBidResponse>(`/estimating/${bidId}/accubid/settings`, next);
      setData(res.data);
    } catch (err) {
      setError((err as { crmError?: { message?: string } })?.crmError?.message ?? 'Could not save the crew/pricing settings.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [bidId]);

  const addQuote = useCallback(async (q: Omit<AccubidQuote, 'id' | 'sort'>) => {
    if (!bidId) return;
    await api.post(`/estimating/${bidId}/accubid/quotes`, q);
    reload();
  }, [bidId, reload]);
  const updateQuoteFn = useCallback(async (id: string, patch: Partial<AccubidQuote>) => {
    if (!bidId) return;
    await api.put(`/estimating/${bidId}/accubid/quotes/${id}`, patch);
    reload();
  }, [bidId, reload]);
  const removeQuote = useCallback(async (id: string) => {
    if (!bidId) return;
    await api.delete(`/estimating/${bidId}/accubid/quotes/${id}`);
    reload();
  }, [bidId, reload]);

  const addCostLine = useCallback(async (c: Omit<AccubidCostLine, 'id' | 'sort'>) => {
    if (!bidId) return;
    await api.post(`/estimating/${bidId}/accubid/cost-lines`, c);
    reload();
  }, [bidId, reload]);
  const updateCostLineFn = useCallback(async (id: string, patch: Partial<AccubidCostLine>) => {
    if (!bidId) return;
    await api.put(`/estimating/${bidId}/accubid/cost-lines/${id}`, patch);
    reload();
  }, [bidId, reload]);
  const removeCostLine = useCallback(async (id: string) => {
    if (!bidId) return;
    await api.delete(`/estimating/${bidId}/accubid/cost-lines/${id}`);
    reload();
  }, [bidId, reload]);

  const addAlternate = useCallback(async (a: Omit<AccubidAlternate, 'id' | 'auto' | 'sourceRule' | 'sort'>) => {
    if (!bidId) return;
    await api.post(`/estimating/${bidId}/accubid/alternates`, a);
    reload();
  }, [bidId, reload]);
  const updateAlternateFn = useCallback(async (id: string, patch: Partial<AccubidAlternate>) => {
    if (!bidId) return;
    await api.put(`/estimating/${bidId}/accubid/alternates/${id}`, patch);
    reload();
  }, [bidId, reload]);
  const removeAlternate = useCallback(async (id: string) => {
    if (!bidId) return;
    await api.delete(`/estimating/${bidId}/accubid/alternates/${id}`);
    reload();
  }, [bidId, reload]);

  return {
    loading, saving, error,
    settings: data.settings, recap: data.recap, totalHours: data.totalHours,
    quotes: data.quotes, costLines: data.costLines, alternates: data.alternates,
    saveSettings,
    addQuote, updateQuote: updateQuoteFn, removeQuote,
    addCostLine, updateCostLine: updateCostLineFn, removeCostLine,
    addAlternate, updateAlternate: updateAlternateFn, removeAlternate,
    reload,
  };
}
