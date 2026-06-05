import { Bid, WonJob, Toast } from '../../types';
import { ElecStageKey } from './constants';
import { moneyFull } from '../../lib/money';
import { useStagePipeline } from '../../hooks/useStagePipeline';

interface UsePipelineProps {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
}

export function usePipeline({ bids, setBids, setWonJobs, showToast }: UsePipelineProps) {
  const { moveToStage, advance, pendingConfirm, cancelConfirm } = useStagePipeline<Bid, ElecStageKey>({
    items: bids, setItems: setBids, setWonJobs, showToast,
    endpoint: 'bids', responseKey: 'bid', confirmStage: 'lost',
    advanceOrder: ['due', 'submitted', 'awarded'],
    // Lost carries loss_reason/competitor; moving off Lost clears them.
    buildPatch: (stage, extra) => stage === 'lost'
      ? { stage, ...extra } as Partial<Bid>
      : { stage, loss_reason: undefined, competitor: undefined } as Partial<Bid>,
    wonToast: wonJob => ({
      title: 'Job won',
      sub: `${wonJob.salesperson_name} · ${moneyFull(wonJob.value)} · ${wonJob.customer}`,
    }),
  });

  return { moveToStage, advance, pendingLost: pendingConfirm, cancelLost: cancelConfirm };
}
