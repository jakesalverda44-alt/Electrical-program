// Session-level caches for the two workspace reads that are identical for every
// bid. Unchanged from the pre-split PcWorkspace.tsx (Task 7, audit data #16).
import { useState, useEffect } from 'react';
import api from '../../../api/client';
import { reportError } from '../../../lib/reportError';

// Task 7 (audit data #16) — /preconstruction/costs and /estimates/unit-costs
// are the same for every bid (company-wide historical comparables and the
// admin-edited unit-cost library), but every PcWorkspace mount refetched
// both fresh. Module-level cache, keyed by URL, shared across every
// PcWorkspace instance in the tab regardless of which bid it's showing —
// "loaded once per session" per the plan.
//
// Post-review B2: the TTL alone was only ever consulted at mount, and since
// Task 7 keeps PcWorkspaceView mounted for as long as a bid stays open, an
// already-open workspace never re-checked it — a unit-cost edit in Settings
// never reached it, and "Save Estimate" would then persist prices computed
// from the stale library. resetGlobalPcCaches() is now called from
// UnitCostSection's save (the only Settings save that changes either of
// these two endpoints today), and every mounted useGlobalPcCache instance
// also re-checks freshness on window focus, so switching back to an
// already-open tab after editing costs in another tab/window catches it too.
export const GLOBAL_PC_CACHE_TTL_MS = 5 * 60 * 1000;
// A failed refetch retries on this cadence rather than leaving a mounted
// workspace stuck on a stale (or never-loaded) library indefinitely.
export const GLOBAL_PC_CACHE_RETRY_MS = 5_000;

export interface GlobalPcCacheEntry<T> {
  promise: Promise<T> | null;
  data: T | null;
  fetchedAt: number;
}
export const historicalCostsCache: GlobalPcCacheEntry<Array<Record<string, unknown>>> = { promise: null, data: null, fetchedAt: 0 };
export const unitCostLibCache: GlobalPcCacheEntry<{ global: Record<string, number>; by_project_type: Record<string, Record<string, number>> }> =
  { promise: null, data: null, fetchedAt: 0 };

// Every mounted useGlobalPcCache instance registers an invalidate callback
// here; resetGlobalPcCaches() (and the window-focus check below) calls all
// of them so a cache clear takes effect immediately for anything already on
// screen, not just the next fresh mount.
export type GlobalPcCacheInvalidator = () => void;
export const globalPcCacheInvalidators = new Set<GlobalPcCacheInvalidator>();

/** Clears both module-level caches and forces every currently-mounted
 *  PcWorkspace instance to refetch immediately. Call this from any Settings
 *  save that changes the data behind /preconstruction/costs or
 *  /estimates/unit-costs — currently only UnitCostSection's save. */
export function resetGlobalPcCaches(): void {
  historicalCostsCache.data = null; historicalCostsCache.promise = null; historicalCostsCache.fetchedAt = 0;
  unitCostLibCache.data = null; unitCostLibCache.promise = null; unitCostLibCache.fetchedAt = 0;
  globalPcCacheInvalidators.forEach(fn => fn());
}

/** Test-only alias, kept so existing tests importing this name still work. */
export const __resetGlobalPcCachesForTests = resetGlobalPcCaches;

/** Reads (and, once per TTL window across the whole session, refetches) one of
 *  the module-level caches above. Every PcWorkspace instance mounted at the
 *  same time shares the same in-flight request instead of each firing its own.
 *  A failed fetch reports via reportError and retries — it never silently
 *  leaves (or resets) `data` to an empty/null library, since the caller (the
 *  Pricing tab) treats a missing unit-cost entry as "no cost data", which
 *  prices every line at $0 with no visible signal. */
export function useGlobalPcCache<T>(cache: GlobalPcCacheEntry<T>, url: string): T | null {
  const [data, setData] = useState<T | null>(cache.data);
  // Bumped by an external invalidation (Settings save, window focus) to force
  // the fetch effect below to re-run without needing `cache`/`url` to change.
  const [gen, setGen] = useState(0);

  useEffect(() => {
    const invalidate = () => setGen(g => g + 1);
    globalPcCacheInvalidators.add(invalidate);
    return () => { globalPcCacheInvalidators.delete(invalidate); };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      const isFresh = cache.data !== null && (Date.now() - cache.fetchedAt) < GLOBAL_PC_CACHE_TTL_MS;
      if (!isFresh) setGen(g => g + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [cache]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const isFresh = cache.data !== null && (Date.now() - cache.fetchedAt) < GLOBAL_PC_CACHE_TTL_MS;
    if (isFresh) { setData(cache.data); return; }
    if (!cache.promise) {
      cache.promise = api.get<T>(url).then(res => {
        cache.data = res.data;
        cache.fetchedAt = Date.now();
        cache.promise = null;
        return res.data;
      }).catch(err => {
        cache.promise = null;
        throw err;
      });
    }
    cache.promise.then(d => { if (!cancelled) setData(d); }).catch(err => {
      if (cancelled) return;
      reportError(err, `useGlobalPcCache ${url}`);
      // Do NOT clear `data` here — a stale-but-real library beats a $0 one.
      // Retry automatically rather than waiting for the next unrelated
      // invalidation.
      retryTimer = setTimeout(() => setGen(g => g + 1), GLOBAL_PC_CACHE_RETRY_MS);
    });
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [cache, url, gen]);
  return data;
}

// Fence-tolerant JSON parse for an agent's raw output (```json ... ``` or
// bare) — shared by the Agent 2/3 structured-view render below and Task
// 5.2's "Import from AI analysis" RFI button, rather than each keeping its
