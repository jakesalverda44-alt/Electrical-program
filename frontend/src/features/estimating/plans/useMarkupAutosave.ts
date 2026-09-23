// Estimating Phase B, Task 5 — debounced autosave for the markup draft
// list: 800ms after the last change, diff against the last-synced
// snapshot and POST the batch. Registers useUnsavedGuard while a batch is
// pending (debounce running or in flight) OR failed — a markup must never
// be silently lost by a tab close, an in-app navigation, or a transient
// network failure the estimator didn't notice.
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../../api/client';
import { useUnsavedGuard } from '../../../hooks/useUnsavedGuard';
import { MarkupDraft } from './markupHistory';
import { diffMarkups, isEmptyBatch } from './markupDiff';

const AUTOSAVE_DEBOUNCE_MS = 800;

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseMarkupAutosaveResult {
  status: AutosaveStatus;
  /** The error message from the most recent failed attempt, or null. */
  error: string | null;
  /** Forces an immediate attempt (bypassing the debounce) — used by the
   *  "retry" affordance the save-indicator shows on error, and by a
   *  caller that wants to flush before e.g. an explicit navigation. */
  retryNow: () => void;
}

interface BatchResponseMarkup { id: string }
interface BatchResponse {
  created: BatchResponseMarkup[];
  updated: BatchResponseMarkup[];
  deleted: string[];
  skipped: { id: string; reason: string }[];
}

/** @param markups the CURRENT draft list (markupHistory's `present`).
 *  @param onSynced called with the markups list that was just confirmed
 *    synced — the caller uses this to advance its "last synced" snapshot
 *    (kept outside this hook so a caller can also reset it on an external
 *    reload without this hook needing to know why). */
export function useMarkupAutosave(
  bidId: string,
  markups: MarkupDraft[],
  onSynced: (synced: MarkupDraft[]) => void,
): UseMarkupAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // The last snapshot the SERVER actually confirmed — diffed against the
  // live `markups` on every attempt. Starts equal to the initial markups
  // (whatever the caller hydrated from the server) so nothing spuriously
  // autosaves on mount.
  const syncedRef = useRef<MarkupDraft[]>(markups);
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      syncedRef.current = markups;
      initializedRef.current = true;
    }
    // Only the FIRST render establishes the baseline — every later change
    // to `markups` is exactly what this hook exists to detect and sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markupsRef = useRef(markups);
  markupsRef.current = markups;
  const bidIdRef = useRef(bidId);
  bidIdRef.current = bidId;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // A request already in flight — a retry or a new debounce firing while
  // one is pending waits rather than firing a second, overlapping batch.
  const inFlightRef = useRef(false);
  // True when another attempt should run again immediately after the
  // in-flight one settles (markups changed again mid-request, or a retry
  // was requested while already saving).
  const rerunRequestedRef = useRef(false);

  const attempt = useCallback(async () => {
    if (inFlightRef.current) {
      rerunRequestedRef.current = true;
      return;
    }
    const batch = diffMarkups(syncedRef.current, markupsRef.current);
    if (isEmptyBatch(batch)) {
      if (aliveRef.current) setStatus('saved');
      return;
    }

    inFlightRef.current = true;
    if (aliveRef.current) { setStatus('saving'); setError(null); }
    try {
      const { data } = await api.post<BatchResponse>(`/estimating/${bidIdRef.current}/markups/batch`, {
        creates: batch.creates.map(toWireMarkup),
        updates: batch.updates.map(toWireMarkup),
        deletes: batch.deletes,
      });
      // Fix round 1 / B3(a) — a 200 response can still carry per-item
      // `skipped` entries the server did NOT apply (e.g. re-upserting an
      // id that turned out to collide with a different bid, or an
      // update/delete for an id the server no longer has). The response
      // used to go completely unread here: the whole SENT batch was
      // folded into syncedRef unconditionally and the indicator showed
      // "Saved" for work the server had silently dropped — undo a delete
      // (or redo an undone create), and the marker reappeared on screen
      // with "Saved" showing, while the server still had it deleted.
      const skippedIds = new Set(data.skipped.map(s => s.id));
      // Only the part of the sent batch the server actually confirmed
      // becomes the new synced baseline — every markup this batch touched
      // is now synced at the value it was sent with; a create/update
      // inside `batch` came straight from markupsRef.current at
      // request-start time, so this is exactly what the server has for
      // everything EXCEPT a skipped id, which must never be folded in as
      // if it were synced (it isn't).
      const confirmedBatch = skippedIds.size === 0 ? batch : {
        creates: batch.creates.filter(m => !skippedIds.has(m.id)),
        updates: batch.updates.filter(m => !skippedIds.has(m.id)),
        deletes: batch.deletes.filter(id => !skippedIds.has(id)),
      };
      const nextSynced = applyBatchToSnapshot(syncedRef.current, confirmedBatch);
      syncedRef.current = nextSynced;
      onSyncedRef.current(nextSynced);
      if (aliveRef.current) {
        if (data.skipped.length > 0) {
          // An error state, not "saved" — the guard below stays armed,
          // and a subsequent diff/retry will naturally re-include the
          // skipped item(s) (they're absent from the new syncedRef too),
          // so a transient cause (e.g. the exact B3(a) undo race) self-
          // heals on the next attempt rather than being lost forever.
          setStatus('error');
          setError(`Could not save ${data.skipped.length} marker${data.skipped.length === 1 ? '' : 's'}: ${data.skipped.map(s => s.reason).join('; ')}`);
        } else {
          setStatus('saved');
          setError(null);
        }
      }
    } catch (err) {
      if (aliveRef.current) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not save your markups');
      }
    } finally {
      inFlightRef.current = false;
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        // Re-diff immediately — more changes arrived (or a retry was
        // requested) while this request was in flight.
        void attemptRef.current();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  // Debounce: any change to `markups` (after the initial hydration) arms
  // a pending save and, 800ms after the LAST change, fires attempt().
  useEffect(() => {
    if (!initializedRef.current) return;
    // Nothing to save yet relative to the synced baseline — stay idle
    // rather than showing a spurious "pending" the instant the hook mounts.
    if (isEmptyBatch(diffMarkups(syncedRef.current, markups))) return;
    setStatus('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void attemptRef.current(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [markups]);

  // Fix round 1 / B3(c) — flush on unmount. The debounce effect's own
  // cleanup (above) only clears the pending timer; nothing used to fire
  // the save it was about to make. A step switch or the Takeoff List/Plans
  // toggle used to unmount this hook's owner mid-debounce with 0 POSTs
  // ever sent, and a batch that had already FAILED (status='error', no
  // timer running at all) was equally abandoned. Fires attempt() directly
  // (fire-and-forget — a cleanup function can't usefully await one) so
  // the request is issued before this hook's own render tree is gone; the
  // network request itself is independent of the React component's
  // lifecycle once started, so it still completes and reaches the server
  // even though nothing here is listening to the result anymore.
  useEffect(() => () => {
    if (isEmptyBatch(diffMarkups(syncedRef.current, markupsRef.current))) return;
    void attemptRef.current();
  }, []);

  const retryNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void attemptRef.current();
  }, []);

  // Never lose a markup: the guard is armed for anything not yet
  // confirmed by the server (pending debounce, in-flight save, OR a
  // failed attempt still needing a retry) — 'saved'/'idle' are the only
  // safe-to-leave states.
  useUnsavedGuard(status === 'pending' || status === 'saving' || status === 'error');

  return { status, error, retryNow };
}

function toWireMarkup(m: MarkupDraft) {
  return {
    id: m.id, document_id: m.documentId, page_index: m.pageIndex, line_key: m.lineKey,
    kind: m.kind, points: m.points, drops: m.drops, drop_ft: m.dropFt, slack_pct: m.slackPct,
    status: m.status, label: m.label,
  };
}

/** Folds a just-sent batch into the prior synced snapshot: creates/updates
 *  upsert by id, deletes remove by id. Pure — exported for testing. */
export function applyBatchToSnapshot(
  synced: MarkupDraft[],
  batch: { creates: MarkupDraft[]; updates: MarkupDraft[]; deletes: string[] }
): MarkupDraft[] {
  const byId = new Map(synced.map(m => [m.id, m]));
  for (const m of [...batch.creates, ...batch.updates]) byId.set(m.id, m);
  for (const id of batch.deletes) byId.delete(id);
  return Array.from(byId.values());
}
