import { Gen, WonJob, Toast } from '../../types';
import { GenStageKey } from './constants';
import { moneyFull } from '../../lib/money';
import { useStagePipeline } from '../../hooks/useStagePipeline';

interface UseGenPipelineProps {
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
  onNav?: (v: string) => void;
}

export function useGenPipeline({ gens, setGens, setWonJobs, showToast, onNav }: UseGenPipelineProps) {
  const { moveToStage, advance, pendingConfirm, cancelConfirm } = useStagePipeline<Gen, GenStageKey>({
    items: gens, setItems: setGens, setWonJobs, showToast,
    endpoint: 'gens', responseKey: 'gen', confirmStage: 'declined',
    advanceOrder: ['building', 'sent', 'awarded'],
    wonToast: wonJob => ({
      title: '🎉 Job won!',
      sub: `${wonJob.salesperson_name} · ${moneyFull(wonJob.value)} · ${wonJob.customer}`,
      action: onNav ? { label: 'View in Projects →', onClick: () => onNav('gen-projects') } : undefined,
    }),
  });

  return { moveToStage, advance, pendingDeclined: pendingConfirm, cancelDeclined: cancelConfirm };
}
