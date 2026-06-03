import { useState, useCallback } from 'react';
import api from '../../api/client';
import { Gen, WonJob, Toast } from '../../types';
import { GenStageKey } from './constants';

interface UseGenPipelineProps {
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
  onNav?: (v: string) => void;
}

export function useGenPipeline({ gens, setGens, setWonJobs, showToast, onNav }: UseGenPipelineProps) {
  const [pendingDeclined, setPendingDeclined] = useState<string | null>(null);

  const moveToStage = useCallback(async (id: string, stage: GenStageKey) => {
    if (stage === 'declined' && pendingDeclined !== id) {
      setPendingDeclined(id);
      return;
    }
    setPendingDeclined(null);

    const prev = gens.find(g => g.id === id);
    setGens(list => list.map(g => g.id === id ? { ...g, stage } : g));

    try {
      const { data } = await api.patch(`/gens/${id}/stage`, { stage });
      setGens(list => list.map(g => g.id === id ? { ...data.gen, stage } : g));

      if (data.wonJob) {
        setWonJobs(list => {
          if (list.some(j => j.proposal_id === id)) return list;
          return [data.wonJob, ...list];
        });
        const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
        showToast({
          title: '🎉 Job won!',
          sub: `${data.wonJob.salesperson_name} · ${money(data.wonJob.value)} · ${data.wonJob.customer}`,
          action: onNav ? { label: 'View in Projects →', onClick: () => onNav('gen-projects') } : undefined,
        });
      }
    } catch {
      if (prev) setGens(list => list.map(g => g.id === id ? prev : g));
      showToast({ title: 'Failed to update stage', sub: 'Changes reverted' });
    }
  }, [gens, setGens, setWonJobs, showToast, pendingDeclined, onNav]);

  const advance = useCallback((id: string) => {
    const ORDER: GenStageKey[] = ['building', 'sent', 'awarded'];
    const gen = gens.find(g => g.id === id);
    if (!gen) return;
    const idx = ORDER.indexOf(gen.stage as GenStageKey);
    if (idx < 0 || idx >= ORDER.length - 1) return;
    moveToStage(id, ORDER[idx + 1]);
  }, [gens, moveToStage]);

  const cancelDeclined = useCallback(() => setPendingDeclined(null), []);

  return { moveToStage, advance, pendingDeclined, cancelDeclined };
}
