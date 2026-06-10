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
    // 'signed' is set automatically by the customer's signature; both 'sent'
    // (paper/verbal award) and 'signed' advance to 'awarded'.
    nextStageMap: { building: 'sent', sent: 'awarded', signed: 'awarded' },
    guardMove: (g, stage) => stage === 'signed' && g.stage !== 'signed' && !g.signed_at
      ? {
          title: 'Signed is automatic',
          sub: 'Send the proposal — when the customer signs it online, the card moves here on its own.',
        }
      : null,
    wonToast: wonJob => ({
      title: '🎉 Job won!',
      sub: `${wonJob.salesperson_name} · ${moneyFull(wonJob.value)} · ${wonJob.customer}`,
      action: onNav ? { label: 'View in Projects →', onClick: () => onNav('gen-projects') } : undefined,
    }),
  });

  return { moveToStage, advance, pendingDeclined: pendingConfirm, cancelDeclined: cancelConfirm };
}
