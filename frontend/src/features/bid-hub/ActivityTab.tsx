import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { Bid } from '../../types';
import api from '../../api/client';

// Ported from features/pipeline/DetailDrawer.tsx L236-296 (lifecycle timeline +
// lost-reason/competitor form). The timeline is read-only and unchanged. The
// lost-reason form used to be an inline pre-confirmation gate shown at the
// moment a "Lost" stage pill was clicked; here it's a standalone editor,
// available whenever the bid is already in the Lost stage, that PATCHes the
// same /bids/:id/stage endpoint the drawer used.

const LOSS_REASONS = ['Budget', 'Competitor', 'No Award', 'Scope Change', 'Timeline', 'Relationship', 'Other'];

function fmtTs(ts?: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const INPUT: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)',
  border: '1px solid var(--border2)', borderRadius: 8,
  padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};

interface ActivityProps { bid: Bid; onBidUpdated: (bid: Bid) => void; }

export default function ActivityTab({ bid, onBidUpdated }: ActivityProps) {
  const [lossReason, setLossReason] = useState(bid.loss_reason || LOSS_REASONS[0]);
  const [competitor, setCompetitor] = useState(bid.competitor || '');
  const [saving, setSaving] = useState(false);

  const saveLossDetails = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/bids/${bid.id}/stage`, { stage: 'lost', loss_reason: lossReason, competitor: competitor || undefined });
      onBidUpdated(data.bid ?? data);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Lifecycle timeline with real timestamps */}
      <div>
        <div className="dtl-stage-label">Lifecycle</div>
        <div style={{ marginTop: 8 }}>
          {(() => {
            const steps: { label: string; done: boolean; when: string | null; lost?: boolean }[] = [
              { label: 'Added',     done: true, when: fmtTs(bid.created_at) },
              { label: 'Submitted', done: bid.stage === 'submitted' || bid.stage === 'awarded', when: fmtTs(bid.submitted_at) },
            ];
            if (bid.stage === 'lost') {
              steps.push({ label: 'Lost', done: true, lost: true, when: bid.loss_reason ? `Reason: ${bid.loss_reason}` : null });
            } else {
              steps.push({ label: 'Awarded', done: bid.stage === 'awarded', when: fmtTs(bid.awarded_at) });
              if (bid.stage === 'awarded') {
                steps.push({ label: 'Closed', done: !!bid.closed_at, when: fmtTs(bid.closed_at) });
              }
            }
            return steps.map((s, i, arr) => {
              const dot = s.lost ? 'var(--red)' : 'var(--green)';
              return (
                <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                      background: s.done ? dot : 'transparent', border: '2px solid ' + (s.done ? dot : 'var(--border2)') }}/>
                    {i < arr.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 14, background: s.done ? 'var(--green)' : 'var(--border)' }}/>}
                  </div>
                  <div style={{ paddingBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.done ? 'var(--text)' : 'var(--text3)' }}>{s.label}</div>
                    {s.when && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{s.when}</div>}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Loss reason / competitor — recorded once a bid is marked Lost from the Overview tab. */}
      {bid.stage === 'lost' && (
        <div className="dtl-section" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
            <Icon name="x" size={14} stroke={2}/>Lost bid details
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Loss Reason</div>
              <select value={lossReason} onChange={e => setLossReason(e.target.value)} style={{ ...INPUT, cursor: 'pointer' } as React.CSSProperties}>
                {LOSS_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Awarded To (optional)</div>
              <input style={INPUT} value={competitor} onChange={e => setCompetitor(e.target.value)} placeholder="Competitor name"/>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px' }} disabled={saving} onClick={saveLossDetails}>
              {saving ? 'Saving…' : 'Save Details'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
