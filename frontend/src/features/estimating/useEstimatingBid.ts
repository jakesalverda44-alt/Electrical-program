// Task 9/10 — owns a bid's estimating state (lines, settings, recap,
// proposed) so the Labor & Pricing step and the Bid Summary panel always
// show the same numbers, without either needing to re-fetch independently.
// The plan describes this as "shared via context" — a plain hook owned by
// the caller (PcWorkspaceView, alongside everything else it already owns:
// ws, aiResults, savedEstimate) achieves the same sharing with one fewer
// moving part, and matches how the rest of that component is built.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { EstimateLine, EstimateSettings, EstimatingBidResponse, PricingRecap, SyncTakeoffResponse, EMPTY_RECAP, DEFAULT_SETTINGS } from './types';

const PRICE_DEBOUNCE_MS = 400;

export interface UseEstimatingBidResult {
  loading: boolean;
  lines: EstimateLine[];
  settings: EstimateSettings;
  recap: PricingRecap;
  proposed: boolean;
  dirty: boolean;
  saving: boolean;
  syncing: boolean;
  pricing: boolean;
  saveError: string | null;
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  save: () => Promise<void>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number } | null>;
  reload: () => void;
}

function linesEqual(a: EstimateLine[], b: EstimateLine[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function settingsEqual(a: EstimateSettings, b: EstimateSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useEstimatingBid(bidId: string): UseEstimatingBidResult {
  const { data, loading: initialLoading, reload } = useApi<EstimatingBidResponse>(`/estimating/${bidId}`);

  const [lines, setLinesState] = useState<EstimateLine[]>([]);
  const [settings, setSettingsState] = useState<EstimateSettings>(DEFAULT_SETTINGS);
  const [recap, setRecap] = useState<PricingRecap>(EMPTY_RECAP);
  const [proposed, setProposed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  // The last lines/settings the server actually priced/saved — dirty compares against this.
  const persistedRef = useRef<{ lines: EstimateLine[]; settings: EstimateSettings } | null>(null);
  const priceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  // Hydrate once per bid from the initial GET. Defensive against a malformed/
  // generic response (e.g. a test's blanket `get` mock returning `{ data: [] }`
  // for every URL, not just this one) — falls back to safe empty defaults
  // rather than letting `undefined.length` crash the render.
  useEffect(() => {
    if (!data || hydratedRef.current) return;
    hydratedRef.current = true;
    const lines = Array.isArray(data.lines) ? data.lines : [];
    const nextSettings = data.settings ?? DEFAULT_SETTINGS;
    setLinesState(lines);
    setSettingsState(nextSettings);
    setRecap(data.recap ?? EMPTY_RECAP);
    setProposed(!!data.proposed);
    persistedRef.current = { lines, settings: nextSettings };
  }, [data]);

  // Bid changed (e.g. navigated to a different bid within the same mounted tree) — re-hydrate.
  useEffect(() => {
    hydratedRef.current = false;
    persistedRef.current = null;
  }, [bidId]);

  const setLines = useCallback((updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => {
    setLinesState(prev => (typeof updater === 'function' ? (updater as (p: EstimateLine[]) => EstimateLine[])(prev) : updater));
  }, []);
  const setSettings = useCallback((updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => {
    setSettingsState(prev => (typeof updater === 'function' ? (updater as (p: EstimateSettings) => EstimateSettings)(prev) : updater));
  }, []);

  // Live recalc: debounce 400ms -> POST /price. Never fires before hydration,
  // never fires while a save/sync is in flight (those already return a fresh recap).
  useEffect(() => {
    if (!hydratedRef.current || saving || syncing) return;
    if (priceTimerRef.current) clearTimeout(priceTimerRef.current);
    priceTimerRef.current = setTimeout(() => {
      setPricing(true);
      api.post<{ recap: PricingRecap }>(`/estimating/${bidId}/price`, { lines, settings })
        .then(({ data: res }) => { if (aliveRef.current) setRecap(res.recap); })
        .catch(() => { /* live recalc is best-effort; the next edit or an explicit Save will retry */ })
        .finally(() => { if (aliveRef.current) setPricing(false); });
    }, PRICE_DEBOUNCE_MS);
    return () => { if (priceTimerRef.current) clearTimeout(priceTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, settings, bidId]);

  const dirty = !persistedRef.current
    ? proposed && lines.length > 0
    : (proposed && lines.length > 0)
      || !linesEqual(lines, persistedRef.current.lines)
      || !settingsEqual(settings, persistedRef.current.settings);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: res } = await api.put<{ recap: PricingRecap }>(`/estimating/${bidId}`, { lines, settings });
      if (!aliveRef.current) return;
      setRecap(res.recap);
      setProposed(false);
      persistedRef.current = { lines, settings };
    } catch (err) {
      if (aliveRef.current) setSaveError(err instanceof Error ? err.message : 'Save failed');
      throw err;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, lines, settings]);

  const syncTakeoff = useCallback(async () => {
    setSyncing(true);
    try {
      const { data: res } = await api.post<SyncTakeoffResponse>(`/estimating/${bidId}/sync-takeoff`);
      if (!aliveRef.current) return null;
      setLinesState(res.lines);
      setRecap(res.recap);
      // sync-takeoff writes to est_bid_lines directly — the bid now has saved
      // lines regardless of whether it did before.
      setProposed(false);
      persistedRef.current = { lines: res.lines, settings };
      return { added: res.added, updated: res.updated, vanished: res.vanished };
    } finally {
      if (aliveRef.current) setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, settings]);

  return {
    loading: initialLoading && !hydratedRef.current,
    lines, settings, recap, proposed, dirty, saving, syncing, pricing, saveError,
    setLines, setSettings, save, syncTakeoff, reload,
  };
}
