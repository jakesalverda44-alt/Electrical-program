import { useState, useCallback } from 'react';
import api from '../api/client';
import { WonJob, Toast } from '../types';

// Shared kanban stage-change logic for the electrical (bids) and generator
// (gens) pipelines, which were ~identical: a confirmation guard for the
// negative terminal stage, an optimistic update, a PATCH to the stage
// endpoint, won-job handling, and rollback on failure. The two domains differ
// only in endpoint/labels/extra fields, supplied via config. Thin per-domain
// wrappers (usePipeline / useGenPipeline) keep their original return shapes so
// callers are unaffected.

interface StageItem { id: string; stage: string }

interface StageResponse {
  wonJob?: WonJob;
  [key: string]: unknown;
}

interface UseStagePipelineConfig<T extends StageItem, K extends string> {
  items: T[];
  setItems: (fn: (prev: T[]) => T[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
  /** API path segment, e.g. 'bids' or 'gens'. */
  endpoint: string;
  /** Key under which the updated record is returned, e.g. 'bid' or 'gen'. */
  responseKey: string;
  /** Stage that requires inline confirmation before applying (e.g. 'lost'). */
  confirmStage: K;
  /** Positive progression used by the advance button, ending at 'awarded'
   *  (excludes the negative terminal stage). */
  advanceOrder: K[];
  /** Optimistic patch to apply before the server responds. Defaults to { stage }. */
  buildPatch?: (stage: K, extra?: Record<string, unknown>) => Partial<T>;
  /** Toast shown when a move produces a won job. */
  wonToast: (wonJob: WonJob) => Toast;
}

export function useStagePipeline<T extends StageItem, K extends string>(cfg: UseStagePipelineConfig<T, K>) {
  const { items, setItems, setWonJobs, showToast, endpoint, responseKey, confirmStage, advanceOrder, buildPatch, wonToast } = cfg;
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);

  const moveToStage = useCallback(async (id: string, stage: K, extra?: Record<string, unknown>) => {
    // Confirmation guard for the negative terminal stage.
    if (stage === confirmStage && pendingConfirm !== id) {
      setPendingConfirm(id);
      return;
    }
    setPendingConfirm(null);

    // Optimistic update.
    const prev = items.find(i => i.id === id);
    const patch = buildPatch ? buildPatch(stage, extra) : ({ stage } as unknown as Partial<T>);
    setItems(list => list.map(i => i.id === id ? { ...i, ...patch } : i));

    try {
      const { data } = await api.patch<StageResponse>(`/${endpoint}/${id}/stage`, { stage, ...extra });
      // Sync with server response (derived fields may be recalculated).
      setItems(list => list.map(i => i.id === id ? { ...(data[responseKey] as T), stage } : i));

      if (data.wonJob) {
        const wonJob = data.wonJob;
        setWonJobs(list => list.some(j => j.proposal_id === id) ? list : [wonJob, ...list]);
        showToast(wonToast(wonJob));
      }
    } catch {
      // Roll back on failure.
      if (prev) setItems(list => list.map(i => i.id === id ? prev : i));
      showToast({ title: 'Failed to update stage', sub: 'Changes reverted' });
    }
  }, [items, setItems, setWonJobs, showToast, endpoint, responseKey, confirmStage, buildPatch, wonToast, pendingConfirm]);

  const advance = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const idx = advanceOrder.indexOf(item.stage as K);
    if (idx < 0 || idx >= advanceOrder.length - 1) return; // already at 'awarded' or off-track
    moveToStage(id, advanceOrder[idx + 1]);
  }, [items, advanceOrder, moveToStage]);

  const cancelConfirm = useCallback(() => setPendingConfirm(null), []);

  return { moveToStage, advance, pendingConfirm, cancelConfirm };
}
