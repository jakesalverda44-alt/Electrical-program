// AI comparison trigger + poll for the Pre-Bid tab. Runs on demand only (never on
// upload); result is cached server-side to ai_comparison and re-fetched for free via
// GET /prebid. A 503 means no Anthropic key is configured for this deployment and must
// be surfaced immediately rather than spun on — the backend gates this synchronously.
import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';

interface AiComparison {
  majorDifferences?: string[];
  costDrivers?: string[];
  missingScope?: string[];
  notes?: string;
}

const POLL_MS = 2500;

export default function PreBidAnalyze({ bidId, compId, compName, initialAgainst, initialStatus, initialComparison, initialError }: {
  bidId: string; compId: string; compName: string;
  initialAgainst?: string | null;
  initialStatus?: string | null;
  initialComparison?: AiComparison | null;
  initialError?: string | null;
}) {
  const forThisComp = initialAgainst === compId;
  const [status, setStatus] = useState<string | null>(forThisComp ? (initialStatus ?? null) : null);
  const [comparison, setComparison] = useState<AiComparison | null>(forThisComp ? (initialComparison ?? null) : null);
  const [errMsg, setErrMsg] = useState<string | null>(forThisComp ? (initialError ?? null) : null);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A different comparable was selected — this component gets a new `compId` but React
  // may reuse the instance, so state has to be reset explicitly rather than relying on
  // a fresh mount.
  useEffect(() => {
    const match = initialAgainst === compId;
    setStatus(match ? (initialStatus ?? null) : null);
    setComparison(match ? (initialComparison ?? null) : null);
    setErrMsg(match ? (initialError ?? null) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compId]);

  // The request itself (and its cancellation) belongs to useApi; the interval
  // only decides when to ask again. A transient poll failure is still ignored —
  // useApi parks it in `error` and we do not read it here.
  const { data: polled, reload: repoll } = useApi<{
    scope?: {
      ai_comparison_against?: string | null; ai_status?: string | null;
      ai_comparison?: AiComparison | null; ai_error?: string | null;
    } | null;
  }>(`/preconstruction/${bidId}/prebid`, { enabled: status === 'running' });

  useEffect(() => {
    if (status !== 'running') return undefined;
    timerRef.current = setInterval(repoll, POLL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status, repoll]);

  useEffect(() => {
    const sc = polled?.scope;
    if (!sc || sc.ai_comparison_against !== compId) return;
    setStatus(sc.ai_status ?? null);
    setComparison(sc.ai_comparison ?? null);
    setErrMsg(sc.ai_error ?? null);
  }, [polled, compId]);

  const start = async () => {
    setStarting(true);
    setErrMsg(null);
    try {
      await api.post(`/preconstruction/${bidId}/prebid-analyze?against=${compId}`);
      setStatus('running');
      setComparison(null);
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      setStatus('error');
      setErrMsg(
        response?.status === 503
          ? (response.data?.error || 'AI is not configured for this deployment.')
          : (response?.data?.error || 'Could not start the analysis.')
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-hdr"><span className="panel-title">Analyze differences</span></div>
      <div style={{ padding: '10px 16px', fontSize: 13 }}>
        <button onClick={start} disabled={starting || status === 'running'}
          style={{ padding: '6px 14px', fontSize: 13, cursor: (starting || status === 'running') ? 'default' : 'pointer' }}>
          {status === 'running' ? 'Analyzing…' : `Analyze against ${compName}`}
        </button>

        {status === 'error' && errMsg && (
          <div style={{ marginTop: 10, color: 'var(--amber)' }}>{errMsg}</div>
        )}

        {status === 'complete' && comparison && (
          <div style={{ marginTop: 12 }}>
            {!!comparison.majorDifferences?.length && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Major differences</div>
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {comparison.majorDifferences.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </>
            )}
            {!!comparison.costDrivers?.length && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Cost drivers</div>
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {comparison.costDrivers.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </>
            )}
            {!!comparison.missingScope?.length && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Missing scope / risks</div>
                <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {comparison.missingScope.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </>
            )}
            {comparison.notes && (
              <div style={{ color: 'var(--muted)', marginTop: 4 }}>{comparison.notes}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
