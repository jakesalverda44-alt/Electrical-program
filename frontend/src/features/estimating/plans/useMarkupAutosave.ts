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
  /** Fix round 1 / B3(d) — installs `baseline` as the confirmed-synced
   *  snapshot WITHOUT diffing/sending anything, and returns to 'idle'. The
   *  caller MUST call this exactly once, synchronously in the same effect
   *  that first populates `markups` with real hydrated data — see
   *  PlansWorkspace.tsx's own hydration effect. Without it, this hook's
   *  own "first render establishes the baseline" heuristic locks in
   *  whatever `markups` was on ITS OWN first render (typically `[]`,
   *  before the GET for existing markups has even resolved), so hydrating
   *  the real list moments later reads as N brand-new creates — a full
   *  re-POST of every existing markup on every open. */
  reset: (baseline: MarkupDraft[]) => void;
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

  // Fix round 1 / S5 — "when a 4xx names an item, drop or quarantine that
  // item instead of retrying the whole diff" (generalized here to "a 200
  // that names an item in `skipped`", since the batch route itself now
  // reports per-item rejections in a 200 rather than 4xx-ing the whole
  // request — see routes/estimating.ts's own S5 fix). Before this, a
  // permanently-bad item (an out-of-range value the B8 popover can now
  // actually produce) got RE-SENT on every single debounce/retry forever
  // — harmless to other items (S5's backend fix means they still save
  // fine alongside it), but it pinned `status` at 'error' permanently and
  // hammered the server with the same doomed request indefinitely. Keyed
  // by id -> the exact JSON of what was rejected (creates/updates) or the
  // sentinel 'delete'; if the user later changes that SAME item (edits
  // its value, or it's no longer in the diff at all — deleted, or
  // resynced some other way), the entry no longer matches and it's
  // retried normally. Only a byte-for-byte repeat of an already-rejected
  // value is suppressed.
  const quarantineRef = useRef<Map<string, string>>(new Map());

  const attempt = useCallback(async () => {
    if (inFlightRef.current) {
      rerunRequestedRef.current = true;
      return;
    }
    const rawBatch = diffMarkups(syncedRef.current, markupsRef.current);

    // Drop anything quarantined at the EXACT value that was rejected;
    // anything else in the diff (including a quarantined id whose value
    // has since changed) goes through normally. Also garbage-collects any
    // quarantine entry for an id no longer in the diff at all — it's
    // either synced now or gone, nothing left to suppress.
    const liveIds = new Set([...rawBatch.creates, ...rawBatch.updates].map(m => m.id).concat(rawBatch.deletes));
    for (const id of quarantineRef.current.keys()) {
      if (!liveIds.has(id)) quarantineRef.current.delete(id);
    }
    const isQuarantined = (id: string, valueKey: string) => quarantineRef.current.get(id) === valueKey;
    const batch = {
      creates: rawBatch.creates.filter(m => !isQuarantined(m.id, JSON.stringify(m))),
      updates: rawBatch.updates.filter(m => !isQuarantined(m.id, JSON.stringify(m))),
      deletes: rawBatch.deletes.filter(id => !isQuarantined(id, 'delete')),
    };

    if (isEmptyBatch(batch)) {
      if (aliveRef.current) {
        if (quarantineRef.current.size > 0) {
          // Nothing NEW to send, but something is still stuck — keep
          // showing an error rather than a false "Saved" while a
          // quarantined marker sits unresolved.
          setStatus('error');
          setError(`${quarantineRef.current.size} marker${quarantineRef.current.size === 1 ? '' : 's'} could not be saved and will not be retried automatically — edit or delete ${quarantineRef.current.size === 1 ? 'it' : 'them'} to try again.`);
        } else {
          setStatus('saved');
        }
      }
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
      // Quarantine every item the server just named in `skipped`, keyed
      // to the exact value that was sent — see quarantineRef's own
      // comment above.
      for (const s of data.skipped) {
        const createOrUpdate = [...batch.creates, ...batch.updates].find(m => m.id === s.id);
        if (createOrUpdate) quarantineRef.current.set(s.id, JSON.stringify(createOrUpdate));
        else if (batch.deletes.includes(s.id)) quarantineRef.current.set(s.id, 'delete');
      }
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

  // Fix round 1 / B3(d) — see UseMarkupAutosaveResult.reset's own comment.
  // Cancels any in-flight debounce timer too (a reset always means "the
  // caller just replaced the whole draft list wholesale" — a pending diff
  // computed against the OLD baseline is meaningless once the baseline
  // itself has moved).
  const reset = useCallback((baseline: MarkupDraft[]) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    syncedRef.current = baseline;
    initializedRef.current = true;
    quarantineRef.current.clear(); // Fix round 1 / S5 — a fresh baseline discards any stale quarantine.
    if (aliveRef.current) { setStatus('idle'); setError(null); }
  }, []);

  // Never lose a markup: the guard is armed for anything not yet
  // confirmed by the server (pending debounce, in-flight save, OR a
  // failed attempt still needing a retry) — 'saved'/'idle' are the only
  // safe-to-leave states.
  useUnsavedGuard(status === 'pending' || status === 'saving' || status === 'error');

  return { status, error, retryNow, reset };
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
