import React, { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid } from '../../types';
import { ELEC_STAGES, ElecStageKey } from './constants';
import api from '../../api/client';

interface QualResult { score: number; reasons: string[]; gcWinRate: number | null; gcWon: number; gcLost: number; dueDays: number; }

function moneyFull(n: number | null) {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

const LOSS_REASONS = ['Budget','Competitor','No Award','Scope Change','Timeline','Relationship','Other'];

interface Props {
  bid: Bid;
  pendingLost: boolean;
  onStage: (stage: ElecStageKey, extra?: { loss_reason?: string; competitor?: string }) => void;
  onCancelLost: () => void;
  onClose: () => void;
  onOpenPreconstruction: (id: string) => void;
  onBidEdited: (bid: Bid) => void;
}

export default function DetailDrawer({ bid, pendingLost, onStage, onCancelLost, onClose, onOpenPreconstruction, onBidEdited }: Props) {
  const isTerminal = bid.stage === 'awarded' || bid.stage === 'lost';
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qualifying, setQualifying] = useState(false);
  const [qualResult, setQualResult] = useState<QualResult | null>(null);
  const [winProb, setWinProb] = useState<{ pct: number; label: string } | null>(null);

  useEffect(() => {
    api.get(`/bids/${bid.id}/qualify`).then(({ data }) => {
      const pct = data.gcWinRate !== null ? data.gcWinRate : Math.round((data.score / 10) * 100);
      const label = data.gcWinRate !== null
        ? `${pct}% with ${bid.gc} (${data.gcWon}W / ${data.gcLost}L)`
        : `${pct}% est. — no prior history with ${bid.gc}`;
      setWinProb({ pct, label });
    }).catch(() => {});
  }, [bid.id]);

  const runQualify = async () => {
    setQualifying(true);
    try {
      const { data } = await api.get(`/bids/${bid.id}/qualify`);
      setQualResult(data);
    } finally {
      setQualifying(false);
    }
  };
  const [lossReason, setLossReason] = useState(LOSS_REASONS[0]);
  const [competitor, setCompetitor] = useState('');
  const [form, setForm] = useState({
    name: bid.name,
    gc: bid.gc,
    loc: bid.loc,
    amount: bid.amount != null ? String(bid.amount) : '',
    due: bid.due,
    sheets: bid.sheets ? String(bid.sheets) : '',
    contact: bid.contact ?? '',
  });

  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    if (!form.name.trim() || !form.gc.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/bids/${bid.id}`, {
        name: form.name,
        gc: form.gc,
        loc: form.loc,
        amount: form.amount === '' ? null : form.amount,
        due: form.due,
        sheets: form.sheets === '' ? null : form.sheets,
        contact: form.contact,
      });
      onBidEdited(data);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const INPUT: React.CSSProperties = {
    width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
    color: 'var(--text)', background: 'var(--surface2)',
    border: '1px solid var(--border2)', borderRadius: 8,
    padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Electrical Bid</div>
            <div className="drawer-title">{bid.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isTerminal && (
              <button className="btn ghost" style={{ height: 30, fontSize: 12, padding: '0 10px' }}
                onClick={() => { setEditMode(e => !e); setForm({ name: bid.name, gc: bid.gc, loc: bid.loc, amount: bid.amount != null ? String(bid.amount) : '', due: bid.due, sheets: bid.sheets ? String(bid.sheets) : '', contact: bid.contact ?? '' }); }}>
                <Icon name={editMode ? 'x' : 'gear'} size={13} stroke={2}/>{editMode ? 'Cancel' : 'Edit'}
              </button>
            )}
            <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
          </div>
        </div>

        <div className="drawer-body">
          {editMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Project Name', key: 'name' as const, required: true },
                { label: 'General Contractor', key: 'gc' as const, required: true },
                { label: 'Location', key: 'loc' as const },
                { label: 'Bid Amount (USD)', key: 'amount' as const, type: 'number' },
                { label: 'Due Date', key: 'due' as const },
                { label: 'Plan Sheets', key: 'sheets' as const, type: 'number' },
                { label: 'Contact', key: 'contact' as const },
              ].map(({ label, key, required, type }) => (
                <div key={key}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{label}</div>
                  <input style={INPUT} type={type ?? 'text'} value={form[key]} onChange={setField(key)} required={required} placeholder={required ? label : undefined}/>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn" onClick={handleSave} disabled={saving || !form.name.trim() || !form.gc.trim()} style={{ flex: 1 }}>
                  <Icon name="check" size={14} stroke={2.2}/>{saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="dtl-amt">{moneyFull(bid.amount)}</div>

              <div className="dtl-stage-label">Stage</div>
              <div className="dtl-stages">
                {ELEC_STAGES.map(s => {
                  const isActive = bid.stage === s.key;
                  return (
                    <button
                      key={s.key}
                      className={'dtl-stage' + (isActive ? ' on' : '')}
                      style={isActive ? {
                        background: s.color, borderColor: s.color,
                        color: s.key === 'due' ? '#11192a' : '#fff',
                      } : undefined}
                      onClick={() => onStage(s.key)}
                      title={s.key === 'lost' && !isActive ? 'Mark as lost (requires confirmation)' : undefined}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {pendingLost && (
                <div className="lost-confirm" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                    <Icon name="x" size={14} stroke={2}/>Mark this bid as lost?
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
                    <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={onCancelLost}>Cancel</button>
                    <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px', background: 'var(--red)', borderColor: 'var(--red)' }}
                      onClick={() => onStage('lost', { loss_reason: lossReason, competitor: competitor || undefined })}>
                      Confirm Lost
                    </button>
                  </div>
                </div>
              )}

              {winProb && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Win Probability</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: winProb.pct >= 60 ? 'var(--green)' : winProb.pct >= 40 ? 'var(--amber)' : '#E06A6A' }}>{winProb.pct}%</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border2)', borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
                    <div style={{ height: '100%', width: winProb.pct + '%', borderRadius: 3, transition: 'width .4s',
                      background: winProb.pct >= 60 ? 'var(--green)' : winProb.pct >= 40 ? 'var(--amber)' : '#E06A6A' }}/>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{winProb.label}</div>
                </div>
              )}

              <div className="dtl-section">
                <div className="dtl-row"><span className="dtl-k">General Contractor</span><span className="dtl-v">{bid.gc}</span></div>
                <div className="dtl-row"><span className="dtl-k">Location</span><span className="dtl-v">{bid.loc}</span></div>
                <div className="dtl-row"><span className="dtl-k">Bid amount</span><span className="dtl-v num">{moneyFull(bid.amount)}</span></div>
                <div className="dtl-row"><span className="dtl-k">Due</span><span className="dtl-v">{bid.due}</span></div>
                <div className="dtl-row"><span className="dtl-k">Drawing sheets</span><span className="dtl-v">{bid.sheets || '—'}</span></div>
                <div className="dtl-row"><span className="dtl-k">Contact</span><span className="dtl-v">{bid.contact || '—'}</span></div>
                <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{bid.salesperson_name}</span></div>
                {bid.loss_reason && <div className="dtl-row"><span className="dtl-k">Loss Reason</span><span className="dtl-v">{bid.loss_reason}</span></div>}
                {bid.competitor && <div className="dtl-row"><span className="dtl-k">Awarded To</span><span className="dtl-v">{bid.competitor}</span></div>}
              </div>

              {/* Bid qualification score */}
              <div style={{ marginTop: 12 }}>
                {qualResult ? (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Bid Score</span>
                      <button onClick={() => setQualResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 2 }}>
                        <Icon name="x" size={13} stroke={2}/>
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{
                        width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 20, fontWeight: 900, flexShrink: 0,
                        background: qualResult.score >= 7 ? 'var(--green-soft)' : qualResult.score >= 5 ? 'var(--amber-soft)' : 'rgba(224,106,106,.12)',
                        color: qualResult.score >= 7 ? 'var(--green)' : qualResult.score >= 5 ? 'var(--amber)' : '#E06A6A',
                      }}>
                        {qualResult.score}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                          {qualResult.score >= 8 ? 'Strong bid' : qualResult.score >= 6 ? 'Moderate' : qualResult.score >= 4 ? 'Challenging' : 'Low priority'}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>out of 10</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {qualResult.reasons.map((r, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ color: 'var(--text3)', marginTop: 1 }}>·</span>{r}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <button className="btn ghost" disabled={qualifying} onClick={runQualify}
                    style={{ width: '100%', justifyContent: 'center', fontSize: 12.5 }}>
                    <Icon name="spark" size={13} stroke={2}/>{qualifying ? 'Scoring…' : 'Score This Bid'}
                  </button>
                )}
              </div>

              {!isTerminal && (
                <button
                  className="btn ghost"
                  style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)', marginTop: 4 }}
                  onClick={() => { onClose(); onOpenPreconstruction(bid.id); }}
                >
                  <Icon name="sparkle" size={14} stroke={2}/>Open in Preconstruction
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
