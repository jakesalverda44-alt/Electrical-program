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
  onAwarded?: (gen: Gen) => void;
}

export function useGenPipeline({ gens, setGens, setWonJobs, showToast, onNav, onAwarded }: UseGenPipelineProps) {
  const { moveToStage, advance, pendingConfirm, cancelConfirm } = useStagePipeline<Gen, GenStageKey>({
    items: gens, setItems: setGens, setWonJobs, showToast,
    endpoint: 'gens', responseKey: 'gen', confirmStage: 'declined',
    advanceOrder: ['building', 'sent', 'awarded'],
    // 'signed' is set automatically by the customer's signature. 'sent' advances
    // straight to 'awarded' for a deal won on paper with no e-signature; a signed
    // proposal is awarded by countersigning instead, handled on the card and drawer.
    nextStageMap: { building: 'sent', sent: 'awarded' },
    guardMove: (g, stage) => {
      if (stage === 'signed' && g.stage !== 'signed' && !g.signed_at) {
        return {
          title: 'Signed is automatic',
          sub: 'Send the proposal — when the customer signs it online, the card moves here on its own.',
        };
      }
      // Dragging a signed card onto Awarded would book the won job and supersede the
      // group's other options without a signature or a warning. Awarding a signed
      // contract goes through countersigning, which does both.
      if (stage === 'awarded' && g.signed_at && !g.countersigned_at) {
        return {
          title: 'Countersign to award this',
          sub: 'Open the proposal and use Countersign & award — it executes the contract and books the job.',
        };
      }
      return null;
    },
    wonToast: wonJob => ({
      title: '🎉 Job won!',
      sub: `${wonJob.salesperson_name} · ${moneyFull(wonJob.value)} · ${wonJob.customer}`,
      action: onNav ? { label: 'View in Projects →', onClick: () => onNav('generators/jobs') } : undefined,
    }),
    onMoved: (gen, stage, prevStage) => {
      if (stage === 'awarded' && prevStage !== 'awarded') onAwarded?.(gen);
    },
    // Awarding a gen auto-supersedes any other still-open options in the same
    // group server-side; merge those rows in so the board reflects it without
    // a refetch.
    onSynced: data => {
      const superseded = data.superseded as Gen[] | undefined;
      if (superseded?.length) {
        setGens(prev => prev.map(g => superseded.find(s => s.id === g.id) ?? g));
      }
    },
  });

  return { moveToStage, advance, pendingDeclined: pendingConfirm, cancelDeclined: cancelConfirm };
}
