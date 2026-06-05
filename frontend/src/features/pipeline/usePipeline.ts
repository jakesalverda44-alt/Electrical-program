import { useState, useCallback } from 'react';
import api from '../../api/client';
import { Bid, WonJob, Toast } from '../../types';
import { ElecStageKey } from './constants';
import { moneyFull } from '../../lib/money';

interface UsePipelineProps {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
}

export function usePipeline({ bids, setBids, setWonJobs, showToast }: UsePipelineProps) {
  const [pendingLost, setPendingLost] = useState<string | null>(null);

  const moveToStage = useCallback(async (id: string, stage: ElecStageKey, extra?: { loss_reason?: string; competitor?: string }) => {
    // Confirmation guard for Lost
    if (stage === 'lost' && pendingLost !== id) {
      setPendingLost(id);
      return;
    }
    setPendingLost(null);

    // Optimistic update
    const prev = bids.find(b => b.id === id);
    const optimisticPatch = stage === 'lost'
      ? { stage, ...extra }
      : { stage, loss_reason: undefined, competitor: undefined };
    setBids(list => list.map(b => b.id === id ? { ...b, ...optimisticPatch } : b));

    try {
      const { data } = await api.patch(`/bids/${id}/stage`, { stage, ...extra });
      // Sync with server response (due_days may be recalculated)
      setBids(list => list.map(b => b.id === id ? { ...data.bid, stage } : b));

      if (data.wonJob) {
        setWonJobs(list => {
          const exists = list.some(j => j.proposal_id === id);
          if (exists) return list;
          return [data.wonJob, ...list];
        });
        showToast({
          title: 'Job won',
          sub: `${data.wonJob.salesperson_name} · ${moneyFull(data.wonJob.value)} · ${data.wonJob.customer}`,
        });
      }
    } catch {
      // Roll back on failure
      if (prev) setBids(list => list.map(b => b.id === id ? prev : b));
      showToast({ title: 'Failed to update stage', sub: 'Changes reverted' });
    }
  }, [bids, setBids, setWonJobs, showToast, pendingLost]);

  const advance = useCallback((id: string) => {
    const ELEC_ORDER: ElecStageKey[] = ['due', 'submitted', 'awarded', 'lost'];
    const bid = bids.find(b => b.id === id);
    if (!bid) return;
    const idx = ELEC_ORDER.indexOf(bid.stage as ElecStageKey);
    if (idx < 0 || idx >= ELEC_ORDER.length - 2) return; // stop before lost
    moveToStage(id, ELEC_ORDER[idx + 1]);
  }, [bids, moveToStage]);

  const cancelLost = useCallback(() => setPendingLost(null), []);

  return { moveToStage, advance, pendingLost, cancelLost };
}
