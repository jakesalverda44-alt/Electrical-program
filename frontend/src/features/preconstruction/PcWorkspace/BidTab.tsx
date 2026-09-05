import { memo } from 'react';
import Icon from '../../../components/Icon';
import { PcWorkspace } from '../constants';
import { AppSettings, checkAIPermission } from '../../../hooks/useAppSettings';
import { AiResults, SetWorkspace } from './shared';

interface BidTabProps {
  ws: PcWorkspace;
  set: SetWorkspace;
  aiResults: AiResults;
  runAI: () => void;
  resumeAI: () => void;
  rerunAI: () => void;
  settings?: AppSettings;
  userRole?: string;
}

function BidTab({ ws, set, aiResults, runAI, resumeAI, rerunAI, settings, userRole }: BidTabProps) {
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
            Upload electrical plan sheets in the Files tab, then run the 3-agent AI pipeline: Agent 1 reads drawings, Agent 2 builds scope & estimate, Agent 3 runs QA review. Results appear in the Plan Review tab.
          </p>
          {settings && userRole && !checkAIPermission('run_analysis', userRole, settings) ? (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="shield" size={16} stroke={1.8}/>
              AI analysis is not enabled for your role. Contact an administrator.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: ws.aiLog.length ? 16 : 0 }}>
              <button className="btn" onClick={() => runAI()} disabled={ws.aiRunning || ws.aiDone} style={{ fontSize: 13 }}>
                <Icon name="spark" size={14} stroke={1.9}/>
                {ws.aiDone ? 'Takeoff Complete' : ws.aiRunning ? 'Running…' : 'Run AI Takeoff'}
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
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 4, background: 'var(--border2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '60%', background: 'var(--blue)', borderRadius: 2,
                  animation: 'pcprogress 2.5s ease-in-out infinite alternate' }}/>
              </div>
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
          {ws.aiDone && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={() => set({ activeTab: 'takeoff' })} style={{ fontSize: 13 }}>
                View Results <Icon name="arrow" size={13} stroke={2}/>
              </button>
              <button className="btn ghost" onClick={rerunAI}
                style={{ fontSize: 13, color: 'var(--red)', borderColor: 'rgba(224,106,106,.35)' }}
                title="Delete previous results and run a fresh AI analysis">
                Re-run Analysis
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(BidTab);
