import { memo } from 'react';
import Icon from '../../../components/Icon';
import { PcWorkspace } from '../constants';
import { AppSettings, checkAIPermission } from '../../../hooks/useAppSettings';
import { AiResults, SetWorkspace, NO_PLANS_SELECTED_MSG, RESOLVE_REVISIONS_MSG } from './shared';
import type { AnalysisProgress } from './useAiPoller';
import { runButtonLabel } from './useSheetCheck';

interface BidTabProps {
  ws: PcWorkspace;
  set: SetWorkspace;
  aiResults: AiResults;
  runAI: () => void;
  resumeAI: () => void;
  rerunAI: () => void;
  settings?: AppSettings;
  userRole?: string;
  /** Stop analysis — live pipeline progress and the Stop button. */
  progress?: AnalysisProgress | null;
  stopAnalysis?: () => void;
  stopping?: boolean;
  /** Next round A3 — referenced sheets missing and not skipped (sheet check). */
  missingSheets?: number;
  /** Review S5 — plans are uploaded on the Overview; the no-plans message links there. */
  onGoOverview?: () => void;
}

function BidTab({ ws, set, aiResults, runAI, resumeAI, rerunAI, settings, userRole, progress, stopAnalysis, stopping, missingSheets = 0, onGoOverview }: BidTabProps) {
  const status = aiResults?.status as string | undefined;
  const stopped = !ws.aiRunning && status === 'cancelled';
  const failed = !ws.aiRunning && status === 'error';
  const pct = progress?.step && progress?.of ? Math.min(100, Math.round((progress.step / progress.of) * 100)) : null;
  return (
    <div style={{ padding: '20px 24px' }}>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr">
          <span className="panel-title">
            <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
              <Icon name="sparkle" size={15} stroke={1.8}/>
            </span>
            AI Takeoff Engine
          </span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6 }}>
            Add the plan set on the bid Overview (Plans &amp; Job Profile), then run the 3-agent AI pipeline: Agent 1 reads drawings, Agent 2 builds scope & estimate, Agent 3 runs QA review. Results appear in the Plan Review tab.
          </p>
          {settings && userRole && !checkAIPermission('run_analysis', userRole, settings) ? (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="shield" size={16} stroke={1.8}/>
              AI analysis is not enabled for your role. Contact an administrator.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: ws.aiLog.length ? 16 : 0 }}>
              <button className="btn" onClick={() => runAI()} disabled={ws.aiRunning || ws.aiDone || stopped || failed} style={{ fontSize: 13 }} data-testid="run-ai-takeoff">
                <Icon name="spark" size={14} stroke={1.9}/>
                {ws.aiDone ? 'Takeoff Complete' : ws.aiRunning ? 'Running…' : stopped ? 'Stopped' : runButtonLabel(missingSheets)}
              </button>
              {!ws.aiRunning && !ws.aiDone && !!aiResults?.agent1_output && (
                <button className="btn ghost" onClick={resumeAI} style={{ fontSize: 13, color: 'var(--blue)' }}
                  title="Skip re-reading plans — reuse saved Agent 1 output and run Agents 2 & 3 only">
                  <Icon name="arrow" size={14} stroke={2}/> Resume from Agent 2
                </button>
              )}
            </div>
          )}
          {ws.aiRunning && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }} data-testid="ai-progress">
              <div style={{ flex: 1 }}>
                <div style={{ height: 4, background: 'var(--border2)', borderRadius: 2, overflow: 'hidden' }}>
                  {pct != null ? (
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--blue)', borderRadius: 2, transition: 'width .4s' }}/>
                  ) : (
                    <div style={{ height: '100%', width: '60%', background: 'var(--blue)', borderRadius: 2,
                      animation: 'pcprogress 2.5s ease-in-out infinite alternate' }}/>
                  )}
                </div>
                {progress?.label && (
                  <div data-testid="ai-progress-label" style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>{progress.label}</div>
                )}
              </div>
              {stopAnalysis && (
                <button className="btn ghost" onClick={stopAnalysis} disabled={stopping} data-testid="stop-analysis"
                  style={{ fontSize: 12.5, color: 'var(--red)', borderColor: 'rgba(224,106,106,.45)', flexShrink: 0 }}
                  title="Stops the AI run; you'll need to re-run. Tokens already used are still billed.">
                  {stopping ? 'Stopping…' : 'Stop analysis'}
                </button>
              )}
            </div>
          )}
          {ws.aiLog.length > 0 && (
            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
              {ws.aiLog.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('✓') ? 'var(--green)' : line.startsWith('✗') ? 'var(--red)' : 'var(--text2)' }}>
                  {line}
                </div>
              ))}
              {ws.aiRunning && <div style={{ color: 'var(--blue)' }}>▌</div>}
            </div>
          )}
          {onGoOverview && (ws.aiLog.includes(NO_PLANS_SELECTED_MSG) || ws.aiLog.includes(RESOLVE_REVISIONS_MSG)) && (
            <button type="button" className="btn ghost" data-testid="go-overview-plans" onClick={onGoOverview}
              style={{ marginTop: 10, height: 28, fontSize: 12 }}>
              {ws.aiLog.includes(RESOLVE_REVISIONS_MSG) ? 'Resolve plan revisions on the Overview →' : 'Add plans on the Overview →'}
            </button>
          )}
          {stopped && (
            <div data-testid="ai-stopped" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>
              Stopped{aiResults?.raw_response ? ` — ${String(aiResults.raw_response)}` : ''}. Nothing from this run was saved; re-run the analysis to continue.
            </div>
          )}
          {(ws.aiDone || stopped || failed) && !ws.aiRunning && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              {ws.aiDone && (
                <button className="btn ghost" onClick={() => set({ activeTab: 'takeoff' })} style={{ fontSize: 13 }}>
                  View Results <Icon name="arrow" size={13} stroke={2}/>
                </button>
              )}
              <button className="btn ghost" onClick={rerunAI} data-testid="rerun-analysis"
                style={{ fontSize: 13, color: 'var(--red)', borderColor: 'rgba(224,106,106,.35)' }}
                title="Clear the previous run's outputs (your own work is kept) and run a fresh AI analysis">
                {missingSheets > 0 ? runButtonLabel(missingSheets).replace(/^Run/, 'Re-run') : 'Re-run Analysis'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(BidTab);
