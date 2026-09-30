import React, { memo } from 'react';
import Icon from '../../../components/Icon';
import { PcWorkspace } from '../constants';
import { AiResults } from './shared';

interface RfisTabProps {
  ws: PcWorkspace;
  aiResults: AiResults;
  newRfi: string;
  setNewRfi: (v: string) => void;
  rfiSubmitting: boolean;
  addRfi: () => void;
  importRfisFromAnalysis: () => void;
  submitOpenRfis: () => void;
  /** Fix round S5 — edit an RFI still in draft. Editing makes it the
   *  estimator's own (origin 'manual'), so a re-run keeps it. */
  editRfi?: (id: string, question: string) => void;
  /** UI cleanup round 1 — RFI step state. */
  analysisRunning: boolean;
  pendingAiRfiCount: number;
  noRfis: boolean;
  setNoRfis: (v: boolean) => void;
  onGoTakeoff?: () => void;
}

function RfisTab({ ws, aiResults, newRfi, setNewRfi, rfiSubmitting, addRfi, importRfisFromAnalysis, submitOpenRfis, editRfi,
  analysisRunning, pendingAiRfiCount, noRfis, setNoRfis, onGoTakeoff }: RfisTabProps) {
  const draftCount = ws.rfis.filter(r => !r.submitted).length;
  const openCount = draftCount;
  const hasAnalysis = !!aiResults?.agent2_output;
  // Round 1 — one status banner, the first that applies.
  const bannerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 14, borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--amber-soft)', color: 'var(--text)' };
  const n = pendingAiRfiCount;
  let banner: React.ReactNode = null;
  if (analysisRunning) {
    banner = <div data-testid="rfi-status-running" style={bannerStyle}>RFIs will appear when the takeoff finishes.</div>;
  } else if (noRfis) {
    banner = (
      <div data-testid="rfi-status-none" style={{ ...bannerStyle, background: 'var(--surface)' }}>
        <span>Marked “No RFIs” for this bid.</span>
        <button type="button" className="btn ghost" data-testid="rfi-no-rfis-undo" onClick={() => setNoRfis(false)} style={{ fontSize: 13 }}>Undo</button>
      </div>
    );
  } else if (n > 0) {
    banner = (
      <div data-testid="rfi-status-suggested" style={bannerStyle}>
        <span>{`The AI suggested ${n} RFI${n === 1 ? '' : 's'} — review & import`}</span>
        <button type="button" className="btn" data-testid="rfi-import-suggested" onClick={importRfisFromAnalysis} style={{ fontSize: 13 }}>Import {n} RFI{n === 1 ? '' : 's'}</button>
      </div>
    );
  } else if (!hasAnalysis) {
    banner = (
      <div data-testid="rfi-status-no-takeoff" style={{ ...bannerStyle, background: 'var(--surface)' }}>
        <span>The AI suggests RFIs once the takeoff has run.</span>
        {onGoTakeoff && <button type="button" className="est-link-btn" data-testid="rfi-go-takeoff" onClick={onGoTakeoff}>Finish the Takeoff step first →</button>}
      </div>
    );
  }
  return (
    <div style={{ padding: '20px 24px' }}>
      {banner}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input style={{ flex: 1, minWidth: 200, font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '9px 12px', outline: 'none' }}
          value={newRfi} onChange={e => setNewRfi(e.target.value)} placeholder="Enter RFI question…"
          onKeyDown={e => e.key === 'Enter' && addRfi()}/>
        <button className="btn" onClick={addRfi} style={{ fontSize: 13 }}>
          <Icon name="plus" size={14} stroke={2.2}/> Add RFI
        </button>
        {/* Task 5.2 — real import from Agent 2's rfis[], not a fake
            keyword-matched suggestion. */}
        <button className="btn ghost" onClick={importRfisFromAnalysis} disabled={!hasAnalysis}
          style={{ fontSize: 13, color: 'var(--blue)' }}>
          <Icon name="sparkle" size={14} stroke={1.9}/> Import from AI analysis
        </button>
        {/* Task 5.1 — a single batch action drafts ONE Outlook email
            listing every currently-open RFI (no more per-row fake
            "submit"). */}
        {!noRfis && !analysisRunning && draftCount === 0 && (
          <button type="button" className="btn ghost" data-testid="rfi-no-rfis" onClick={() => setNoRfis(true)} style={{ fontSize: 13 }}>
            {ws.rfis.length === 0 ? 'No RFIs for this bid' : 'No more RFIs'}
          </button>
        )}
        {openCount > 0 && (
          <button className="btn" onClick={submitOpenRfis} disabled={rfiSubmitting} style={{ fontSize: 13 }}>
            <Icon name="send" size={14} stroke={1.9}/> {rfiSubmitting ? 'Drafting…' : `Submit ${openCount} Open RFI${openCount === 1 ? '' : 's'} to GC`}
          </button>
        )}
      </div>
      {ws.rfis.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No RFIs yet</div>
      ) : (
        <div className="panel">
          <div className="table-scroll">
          <table className="ctable">
            <thead><tr><th>#</th><th>Question</th><th>Status</th></tr></thead>
            <tbody>
              {ws.rfis.map((r, i) => (
                <tr key={r.id}>
                  <td className="sub">{i + 1}</td>
                  <td style={{ fontSize: 13 }}>
                    {editRfi && !r.submitted ? (
                      <input value={r.question} onChange={e => editRfi(r.id, e.target.value)} data-testid={`rfi-question-${r.id}`}
                        aria-label={`RFI ${i + 1} question`}
                        style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '3px 6px', outline: 'none', boxSizing: 'border-box' }}/>
                    ) : r.question}
                    {r.origin === 'ai' && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: 'var(--text3)' }} title="Imported from the AI analysis — cleared by a re-run unless sent, answered or edited">AI</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                      background: r.submitted ? 'var(--blue-soft)' : 'var(--amber-soft)',
                      color: r.submitted ? 'var(--blue)' : 'var(--amber)', textTransform: 'uppercase' }}>
                      {r.submitted ? 'Submitted' : 'Draft'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(RfisTab);
