// The AI results poller, lifted out of PcWorkspace.tsx unchanged (audit code
// #10). Owns both recursive setTimeout loops, their shared cancellation flag
// and the mount-time reconnect, so the parent never has to think about them
// again — it just calls pollForResults()/pollAgent4() and renders pollTimedOut.
import { useEffect, useRef, useState } from 'react';
import api from '../../../api/client';
import { reportError } from '../../../lib/reportError';
import { Toast } from '../../../types';
import { SetWorkspace } from './shared';
import { analysisErrorMessage, buildScopeFromAgent2 } from './parsing';

// A stuck 'running' status used to poll every 3s for the rest of the session
// (audit data #5). Ten minutes is well past the pipeline's real worst case.
// Takeoff accuracy — the counting stage (Agent 1C, Opus on every electrical
// plan sheet at 300 DPI, 3 sheets at a time) adds minutes to a run; 30 min
// covers a large set without polling forever.
export const POLL_DEADLINE_MS = 30 * 60 * 1000;
export const POLL_TIMEOUT_MESSAGE = 'Analysis timed out — check status in the Plan Review tab.';

interface UseAiPollerArgs {
  bidId: string;
  set: SetWorkspace;
  setAiResults: (data: Record<string, unknown> | null) => void;
  setAgent4Running: (running: boolean) => void;
  showToast: (t: Toast) => void;
}

export function useAiPoller({ bidId, set, setAiResults, setAgent4Running, showToast }: UseAiPollerArgs) {
  const pollRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agent4PollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Polling ───────────────────────────────────────────────────────────
  // Both loops are recursive setTimeouts whose continuation runs after an
  // `await`. The effect cleanup only ever cleared the pending timeout, so
  // unmounting mid-flight let the continuation schedule a NEW timeout that
  // nothing owned — an un-cancellable request every 3s for the rest of the
  // session (audit data #5). `pollCancelled` is checked after every await,
  // and a hard deadline stops a stuck 'running' status polling forever.
  const pollCancelled = useRef(false);
  const [pollTimedOut, setPollTimedOut] = useState<null | 'analysis' | 'proposal'>(null);

  const pollForResults = (startMs = Date.now(), shownAgent2 = false, shownAgent3 = false, failStreak = 0, shownCounting = false) => {
    pollRef.current = setTimeout(async () => {
      if (pollCancelled.current) return;
      if (Date.now() - startMs > POLL_DEADLINE_MS) {
        setPollTimedOut('analysis');
        set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${POLL_TIMEOUT_MESSAGE}`] }));
        return;
      }
      try {
        const { data } = await api.get(`/preconstruction/${bidId}/results`);
        if (pollCancelled.current) return;
        let nextA2 = shownAgent2, nextA3 = shownAgent3;
        let nextCounting = shownCounting;
        if (data?.status === 'counting' && !shownCounting) {
          nextCounting = true;
          set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Counting fixtures, devices and equipment on each plan sheet…'] }));
        }
        if (!shownAgent2 && (data?.status === 'agent2_running' || data?.status === 'agent2_complete')) {
          set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 2 of 3: Building scope & estimate…'] }));
          nextA2 = true;
        }
        if (!shownAgent3 && (data?.status === 'agent2_complete' || data?.status === 'agent3_running')) {
          set(prev => ({ aiLog: [...(prev.aiLog ?? []), 'Agent 3 of 3: Running QA review & risk assessment…'] }));
          nextA3 = true;
        }
        if (data?.status === 'complete') {
          setAiResults(data);
          const scopeFill = buildScopeFromAgent2(data?.agent2_output);
          set(prev => {
            // Only write sections the estimator hasn't already got text in. The pre-bid
            // package lands before analysis runs and its scope is the better source, so
            // the AI must not clobber it. The explicit "Import from AI Takeoff" button
            // still overwrites — that one is a deliberate choice.
            const merged = { ...prev.scope };
            let filled = 0;
            for (const [k, v] of Object.entries(scopeFill)) {
              if (!(merged[k] ?? '').trim()) { merged[k] = v; filled++; }
            }
            return {
              aiRunning: false, aiDone: true,
              scope: filled ? merged : prev.scope,
              aiLog: [...(prev.aiLog ?? []), filled
                ? '✓ Analysis complete — Scope of Work auto-filled. See Plan Review tab.'
                : '✓ Analysis complete — see Plan Review tab.'],
            };
          });
        } else if (data?.status === 'error') {
          setAiResults(data);
          set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), `✗ ${analysisErrorMessage(data)}`] }));
        } else {
          pollForResults(startMs, nextA2, nextA3, 0, nextCounting);
        }
      } catch {
        if (pollCancelled.current) return;
        // Retry up to 5 times before giving up — handles transient connection drops
        if (failStreak < 5) {
          pollForResults(startMs, shownAgent2, shownAgent3, failStreak + 1, shownCounting);
        } else {
          set(prev => ({ aiRunning: false, aiLog: [...(prev.aiLog ?? []), '✗ Could not reach server after several retries. The analysis may still be running — check the Plan Review tab in a minute.'] }));
        }
      }
    }, 3000);
  };

  const pollAgent4 = (startMs = Date.now(), failStreak = 0) => {
    agent4PollRef.current = setTimeout(async () => {
      if (pollCancelled.current) return;
      if (Date.now() - startMs > POLL_DEADLINE_MS) {
        setPollTimedOut('proposal');
        setAgent4Running(false);
        return;
      }
      try {
        const { data } = await api.get(`/preconstruction/${bidId}/results`);
        if (pollCancelled.current) return;
        const status = data?.agent4_status as string | undefined;
        if (status === 'complete') {
          setAiResults(data);
          setAgent4Running(false);
          showToast({ title: 'Proposal generated', sub: 'Review the preview and download the .docx' });
        } else if (status === 'error') {
          setAiResults(data);
          setAgent4Running(false);
          const errMsg = (data?.agent4_error as string | undefined) ?? 'Failed to generate proposal';
          showToast({ variant: 'error', title: 'Agent 4 error', sub: errMsg });
        } else {
          pollAgent4(startMs, 0);
        }
      } catch {
        if (pollCancelled.current) return;
        if (failStreak < 5) pollAgent4(startMs, failStreak + 1);
        else {
          setAgent4Running(false);
          showToast({ variant: 'error', title: 'Agent 4 error', sub: 'Could not reach server. The proposal may still be generating — check back in a moment.' });
        }
      }
    }, 3000);
  };

  useEffect(() => {
    pollCancelled.current = false;
    setPollTimedOut(null);
    const RUNNING_STATUSES = ['running', 'agent1_complete', 'counting', 'agent2_running', 'agent2_complete', 'agent3_running'];
    api.get(`/preconstruction/${bidId}/results`).then(r => {
      if (pollCancelled.current || !r.data) return;
      setAiResults(r.data);
      // Reconnect polling if a pipeline was in progress when the page was refreshed
      if (RUNNING_STATUSES.includes(r.data?.status)) {
        const shownA2 = ['agent2_running', 'agent2_complete', 'agent3_running'].includes(r.data.status);
        const shownA3 = r.data.status === 'agent3_running';
        set({ aiRunning: true, aiLog: ['Analysis in progress — reconnecting…'] });
        pollForResults(Date.now(), shownA2, shownA3);
      }
      // Reconnect Agent 4 poll if it was running when page was refreshed
      if (r.data?.agent4_status === 'running') {
        setAgent4Running(true);
        pollAgent4();
      }
    })
      // Reconnects a pipeline that was already running when the page reloaded.
      // optional: failing leaves the tab looking idle, recoverable by reopening.
      .catch(err => reportError(err, 'PcWorkspace results reconnect'));
    return () => {
      // Both the pending timeout AND the in-flight continuation: clearing the
      // timeout alone is what let an orphaned loop survive an unmount.
      pollCancelled.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
      if (agent4PollRef.current) clearTimeout(agent4PollRef.current);
    };
  }, [bidId]);


  return { pollTimedOut, pollForResults, pollAgent4 };
}
