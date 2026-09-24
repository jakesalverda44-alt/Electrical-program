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
import { EstimateLine, EstimateSettings, EstimatingBidResponse, PricingRecap, SyncTakeoffResponse, EMPTY_RECAP, DEFAULT_SETTINGS, type DuplicatePair } from './types';

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
  /** Next round A7 — possible duplicates from the last GET / sync / refused save. */
  duplicates: DuplicatePair[];
  /** Fix round 2 / SF3 — what's actually persisted in bid_estimates.grand_total;
   *  compare against recap.totals.grandTotal to detect drift from a library
   *  edit or calibration apply since the last save. null if never saved. */
  savedGrandTotal: number | null;
  setLines: (updater: EstimateLine[] | ((prev: EstimateLine[]) => EstimateLine[])) => void;
  setSettings: (updater: EstimateSettings | ((prev: EstimateSettings) => EstimateSettings)) => void;
  /** Fix round 1 / B1 — `linesOverride`, when given, is PUT verbatim
   *  instead of this hook's own `lines` state. Exists so a caller that
   *  just called `setLines(...)` and wants to save that EXACT array can
   *  do so without a stale-closure race: `save`'s own `lines` closure
   *  still reflects whatever it was on the LAST render, since calling
   *  `setLines` and then `save()` back-to-back in the same synchronous
   *  function never gets a re-render in between (see PcWorkspaceView.
   *  tsx's onCreateLine). */
  /** Fix round 2 / R2-S1 — resolves to remappedLineKeys (proposed-N ->
   *  real UUID, for any line whose line_key wasn't already a real one;
   *  `{}` when nothing needed remapping, e.g. every line already had a
   *  real UUID, or an older/mocked response that doesn't include the
   *  field at all). PlansWorkspace.tsx's onSaveProposedMapping uses this
   *  to remap the active line and any pending/quarantined markers away
   *  from a placeholder the instant it stops existing. */
  save: (linesOverride?: EstimateLine[]) => Promise<Record<string, string>>;
  syncTakeoff: () => Promise<{ added: number; updated: number; vanished: number; rebound?: number; unbound?: number } | null>;
  reload: () => void;
  /** Re-run reset — drop the local state and hydrate again from the server
   *  (a plain `reload` never re-hydrates past the first load). Discards
   *  unsaved edits: the caller decides when that is right. */
  rehydrate: () => void;
  /** Fix round 1 / B1 — installs a server-confirmed {lines, recap} DIRECTLY
   *  (no GET round trip) as the new live state AND the new persisted
   *  baseline — e.g. apply-markups' own response, which already contains
   *  the exact lines/recap saveBidEstimate just wrote. Call sites are
   *  expected to have already confirmed nothing else is unsaved (see
   *  PlansWorkspace.tsx's ensureLinesSavedFirst) — this always overwrites,
   *  same as `save()` itself does after ITS OWN PUT succeeds. */
  installSaved: (saved: { lines: EstimateLine[]; recap: PricingRecap }) => void;
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
  const [savedGrandTotal, setSavedGrandTotal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);

  const hydratedRef = useRef(false);
  // The last lines/settings the server actually priced/saved — dirty compares against this.
  const persistedRef = useRef<{ lines: EstimateLine[]; settings: EstimateSettings } | null>(null);
  const priceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fix round 1 / S8 — a request-sequence guard: if a second live-recalc
  // request starts before the first one's response arrives (rapid edits) and
  // the two resolve out of order, a stale response must never overwrite the
  // recap belonging to a newer edit.
  const priceSeqRef = useRef(0);
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
    setSavedGrandTotal(data.savedGrandTotal ?? null);
    setDuplicates(Array.isArray(data.duplicates) ? data.duplicates : []);
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
      const mySeq = ++priceSeqRef.current;
      api.post<{ recap: PricingRecap }>(`/estimating/${bidId}/price`, { lines, settings })
        .then(({ data: res }) => {
          // Only the MOST RECENT request may write the recap — an older,
          // slower request that resolves after a newer one must not clobber
          // it (S8).
          if (aliveRef.current && mySeq === priceSeqRef.current) setRecap(res.recap);
        })
        .catch(() => { /* live recalc is best-effort; the next edit or an explicit Save will retry */ })
        .finally(() => { if (aliveRef.current && mySeq === priceSeqRef.current) setPricing(false); });
    }, PRICE_DEBOUNCE_MS);
    return () => { if (priceTimerRef.current) clearTimeout(priceTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, settings, bidId]);

  // Fix round 1 / S1 — an unsaved PROPOSED mapping (the bid has takeoff
  // output but no saved est_bid_lines yet) is NOT by itself dirty: it's the
  // server's own suggestion, not something the estimator typed. The old
  // `(proposed && lines.length > 0)` term forced dirty=true the instant a
  // proposed mapping loaded, which fired useUnsavedGuard and forced a save
  // before the estimator had touched anything. dirty now means exactly one
  // thing: the current lines/settings differ from the last snapshot the
  // server actually returned (persistedRef, set on hydration AND on every
  // successful save/sync) — genuinely unsaved work, proposed or not.
  const dirty = !persistedRef.current
    ? false
    : !linesEqual(lines, persistedRef.current.lines) || !settingsEqual(settings, persistedRef.current.settings);

  const save = useCallback(async (linesOverride?: EstimateLine[]) => {
    // Fix round 1 / B1 — `linesOverride` (when given) is what gets PUT,
    // not the `lines` this closure captured on its last render — see
    // UseEstimatingBidResult.save's own comment for why that distinction
    // matters (a caller that just called setLines and wants THAT exact
    // array saved, with no chance of a stale-closure race).
    const linesToSave = linesOverride ?? lines;
    setSaving(true);
    setSaveError(null);
    try {
      const { data: res } = await api.put<{ recap: PricingRecap; lines?: EstimateLine[]; remappedLineKeys?: Record<string, string> }>(`/estimating/${bidId}`, { lines: linesToSave, settings });
      if (!aliveRef.current) return res.remappedLineKeys ?? {};
      setRecap(res.recap);
      setProposed(false);
      // Phase B, Task 1 — the server may have minted a fresh line_key for
      // any brand-new line; adopt its own returned lines (when present —
      // older test mocks that only stub `recap` still work, falling back
      // to the client's own lines) rather than the client's pre-save copy,
      // so a markup created against a just-saved new line has a real
      // line_key to point at without a second round trip.
      const savedLines = res.lines ?? linesToSave;
      setLinesState(savedLines);
      // Fix round 2 / SF3 — a save writes bid_estimates.grand_total from
      // exactly this recap, in the same transaction — the two can't drift
      // apart the instant this response lands.
      setSavedGrandTotal(res.recap.totals.grandTotal);
      persistedRef.current = { lines: savedLines, settings };
      // Fix round 2 / R2-S1 — see UseEstimatingBidResult.save's own doc.
      return res.remappedLineKeys ?? {};
    } catch (err) {
      const body = (err as { response?: { status?: number; data?: { error?: string; duplicates?: DuplicatePair[] } } })?.response;
      if (aliveRef.current) {
        // Next round A7 — a refused save names the possible duplicates.
        if (body?.status === 409 && Array.isArray(body.data?.duplicates)) setDuplicates(body.data!.duplicates!);
        setSaveError(body?.data?.error ?? (err instanceof Error ? err.message : 'Save failed'));
      }
      throw err;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, lines, settings]);

  // Fix round 1 / B1 — see UseEstimatingBidResult.installSaved's own
  // comment. Mirrors exactly what `save()` does with ITS OWN response,
  // for a caller (PlansWorkspace's Apply flow) whose own POST already
  // returned the fresh {lines, recap} and has no reason to PUT again.
  const installSaved = useCallback((saved: { lines: EstimateLine[]; recap: PricingRecap }) => {
    if (!aliveRef.current) return;
    setLinesState(saved.lines);
    setRecap(saved.recap);
    setProposed(false);
    setSavedGrandTotal(saved.recap.totals.grandTotal);
    persistedRef.current = { lines: saved.lines, settings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const syncTakeoff = useCallback(async () => {
    setSyncing(true);
    try {
      const { data: res } = await api.post<SyncTakeoffResponse>(`/estimating/${bidId}/sync-takeoff`);
      if (!aliveRef.current) return null;
      setLinesState(res.lines);
      setRecap(res.recap);
      setDuplicates(Array.isArray(res.duplicates) ? res.duplicates : []);
      // sync-takeoff writes to est_bid_lines directly — the bid now has saved
      // lines regardless of whether it did before.
      setProposed(false);
      // Fix round 2 / SF3 — sync-takeoff also writes bid_estimates/bids.amount
      // in the same transaction (fix round 1 / B5) from this same recap.
      setSavedGrandTotal(res.recap.totals.grandTotal);
      persistedRef.current = { lines: res.lines, settings };
      return { added: res.added, updated: res.updated, vanished: res.vanished, rebound: res.rebound, unbound: res.unbound };
    } finally {
      if (aliveRef.current) setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidId, settings]);

  const rehydrate = useCallback(() => {
    hydratedRef.current = false;
    persistedRef.current = null;
    reload();
  }, [reload]);

  return {
    loading: initialLoading && !hydratedRef.current,
    lines, settings, recap, proposed, dirty, saving, syncing, pricing, saveError, savedGrandTotal, duplicates,
    setLines, setSettings, save, syncTakeoff, reload, rehydrate, installSaved,
  };
}
