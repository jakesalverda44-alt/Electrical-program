import React, { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, WonJob } from '../../types';
import { ELEC_STAGES, ElecStageKey } from '../pipeline/constants';
import { PROJECT_TYPES, SCOPE_SECS } from '../preconstruction/constants';
import api from '../../api/client';
import { moneyFull, moneyShort } from '../../lib/money';
import { useStagePipeline } from '../../hooks/useStagePipeline';
import { useShowToast } from '../../contexts/AppContext';
import type { HubTab } from './BidHubPage';

// Ported from features/pipeline/DetailDrawer.tsx (single-scroll drawer), split
// across the Bid Hub's Overview + Activity tabs. Every API call below is
// copied verbatim from the drawer; only the surrounding layout changed.

interface QualResult { score: number; reasons: string[]; gcWinRate: number | null; gcWon: number; gcLost: number; dueDays: number; }

const LOSS_REASONS = ['Budget', 'Competitor', 'No Award', 'Scope Change', 'Timeline', 'Relationship', 'Other'];

interface OverviewProps {
  bid: Bid;
  onBidUpdated: (bid: Bid) => void;
  setBids: React.Dispatch<React.SetStateAction<Bid[]>>;
  setWonJobs: React.Dispatch<React.SetStateAction<WonJob[]>>;
  onNav: (v: string, recordId?: string) => void;
  scope: Record<string, string>;
  onGoTab: (tab: HubTab) => void;
}

const INPUT: React.CSSProperties = {
  width: '100%', font: 'inherit', fontSize: 13, fontWeight: 600,
  color: 'var(--text)', background: 'var(--surface2)',
  border: '1px solid var(--border2)', borderRadius: 8,
  padding: '8px 10px', outline: 'none', boxSizing: 'border-box',
};

function daysSince(ts?: string) {
  return ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : 0;
}

export default function OverviewTab({ bid, onBidUpdated, setBids, setWonJobs, onNav, scope, onGoTab }: OverviewProps) {
  const isTerminal = bid.stage === 'lost';
  const showToast = useShowToast();

  const { moveToStage, pendingConfirm, cancelConfirm } = useStagePipeline<Bid, ElecStageKey>({
    items: [bid],
    setItems: setBids,
    setWonJobs,
    showToast,
    endpoint: 'bids',
    responseKey: 'bid',
    confirmStage: 'lost',
    advanceOrder: ['due', 'submitted', 'awarded'],
    // Lost carries loss_reason/competitor; moving off Lost clears them.
    buildPatch: (stage, extra) => stage === 'lost'
      ? ({ stage, ...extra } as Partial<Bid>)
      : ({ stage, loss_reason: undefined, competitor: undefined } as Partial<Bid>),
    wonToast: wonJob => ({
      title: 'Job won',
      sub: `${wonJob.salesperson_name} · ${moneyFull(wonJob.value)} · ${wonJob.customer}`,
    }),
  });
  const pendingLost = pendingConfirm === bid.id;
  const [lossReason, setLossReason] = useState(LOSS_REASONS[0]);
  const [competitor, setCompetitor] = useState('');

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [qualifying, setQualifying] = useState(false);
  const [qualResult, setQualResult] = useState<QualResult | null>(null);
  const [winProb, setWinProb] = useState<{ pct: number; label: string } | null>(null);
  const [closingJob, setClosingJob] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // "Email bid to team" (send the new-bid notification after the fact).
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyEmails, setNotifyEmails] = useState('');
  const [sendingNotify, setSendingNotify] = useState(false);
  const [attachFiles, setAttachFiles] = useState(true);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [draftLink, setDraftLink] = useState<string | null>(null);
  const [teamDefaults, setTeamDefaults] = useState<{ emails: string[]; mailConfigured: boolean }>({ emails: [], mailConfigured: false });

  useEffect(() => {
    api.get('/intake/notify-defaults')
      .then(({ data }) => setTeamDefaults({ emails: data?.emails ?? [], mailConfigured: !!data?.mailConfigured }))
      .catch(() => {});
  }, []);

  const openNotify = () => {
    setNotifyEmails(notifyEmails.trim() || teamDefaults.emails.join(', '));
    setAttachFiles(true);
    setDraftLink(null);
    setNotifyOpen(true);
    api.get(`/documents?linked_id=${encodeURIComponent(bid.id)}`)
      .then(({ data }) => setFileCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setFileCount(0));
  };

  const handleNotifyTeam = async () => {
    const emails = notifyEmails.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!emails.length) return;
    setSendingNotify(true);
    try {
      const { data } = await api.post(`/bids/${bid.id}/notify-team`, { emails, attachFiles });
      setDraftLink(data.draftWebLink || '');
    } finally {
      setSendingNotify(false);
    }
  };

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

  const [form, setForm] = useState({
    name: bid.name,
    gc: bid.gc,
    loc: bid.loc,
    amount: bid.amount != null ? String(bid.amount) : '',
    due: bid.due,
    sheets: bid.sheets ? String(bid.sheets) : '',
    contact: bid.contact ?? '',
    brand: bid.brand ?? '',
    project_type: bid.project_type ?? '',
    sq_ft: bid.sq_ft != null ? String(bid.sq_ft) : '',
    date_won: bid.date_won ? String(bid.date_won).slice(0, 10) : '',
  });

  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const resetForm = () => setForm({
    name: bid.name, gc: bid.gc, loc: bid.loc,
    amount: bid.amount != null ? String(bid.amount) : '',
    due: bid.due, sheets: bid.sheets ? String(bid.sheets) : '',
    contact: bid.contact ?? '', brand: bid.brand ?? '',
    project_type: bid.project_type ?? '',
    sq_ft: bid.sq_ft != null ? String(bid.sq_ft) : '',
    date_won: bid.date_won ? String(bid.date_won).slice(0, 10) : '',
  });

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
        brand: form.brand,
        project_type: form.project_type || null,
        sq_ft: form.sq_ft === '' ? null : Number(form.sq_ft),
        ...(bid.stage === 'awarded' && form.date_won ? { date_won: form.date_won } : {}),
      });
      onBidUpdated(data.bid ?? data);
      if (data.wonJob) setWonJobs(prev => prev.map(w => w.proposal_id === bid.id ? data.wonJob : w));
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseJob = async () => {
    if (!window.confirm(`Mark "${bid.name}" as closed/complete? This will move the Drive folder to Completed Projects and remove it from the active pipeline.`)) return;
    setClosingJob(true);
    try {
      await api.post(`/bids/${bid.id}/close`);
      setBids(prev => prev.filter(b => b.id !== bid.id));
      showToast({ title: 'Job closed', sub: `${bid.name} moved to Completed Projects` });
      onNav('elec-proposals');
    } finally {
      setClosingJob(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${bid.name}" and its linked project/files/testing data? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/bids/${bid.id}`);
      setBids(prev => prev.filter(b => b.id !== bid.id));
      setWonJobs(prev => prev.filter(w => w.proposal_id !== bid.id));
      showToast({ title: 'Bid deleted', sub: bid.name });
      onNav('elec-proposals');
    } catch {
      showToast({ title: 'Delete failed', sub: 'Please try again' });
      setDeleting(false);
    }
  };

  const dueBadge = () => {
    if (bid.stage === 'submitted') {
      const age = daysSince(bid.submitted_at);
      if (age >= 30) return <span className="badge critical"><Icon name="clock" size={11} stroke={2}/>Stale · {age}d</span>;
      return <span className="badge normal">Submitted</span>;
    }
    if (bid.stage === 'awarded') return <span className="badge won"><Icon name="check" size={11} stroke={2.4}/>Won</span>;
    if (bid.stage === 'lost') return <span className="badge lost">Lost</span>;
    const u = bid.due_days <= 3 ? 'critical' : bid.due_days <= 7 ? 'urgent' : 'normal';
    return <span className={'badge ' + u}><Icon name="clock" size={11} stroke={2}/>{bid.due_days}d left</span>;
  };

  const scopeSecs = SCOPE_SECS.filter(s => (scope[s.id] ?? '').trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {!isTerminal && (
          <button className="btn ghost" style={{ height: 30, fontSize: 12, padding: '0 10px' }}
            onClick={() => { setEditMode(e => !e); resetForm(); }}>
            <Icon name={editMode ? 'x' : 'gear'} size={13} stroke={2}/>{editMode ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

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
            { label: 'Brand', key: 'brand' as const },
            { label: 'Square Footage', key: 'sq_ft' as const, type: 'number' },
          ].map(({ label, key, required, type }) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>{label}</div>
              <input style={INPUT} type={type ?? 'text'} value={form[key]} onChange={setField(key)} required={required} placeholder={required ? label : undefined}/>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Project Type</div>
            <select style={INPUT as React.CSSProperties} value={form.project_type} onChange={setField('project_type')}>
              <option value="">Select type…</option>
              {PROJECT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {bid.stage === 'awarded' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Contract Date (sales month)</div>
              <input style={INPUT} type="date" value={form.date_won} onChange={setField('date_won')}/>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn" onClick={handleSave} disabled={saving || !form.name.trim() || !form.gc.trim()} style={{ flex: 1 }}>
              <Icon name="check" size={14} stroke={2.2}/>{saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Stat row */}
          <div className="stats" style={{ gridTemplateColumns: 'repeat(5,1fr)', padding: 0 }}>
            <div className="stat">
              <div className="stat-top"><span className="stat-label">Amount</span></div>
              <div className="stat-val num" style={{ fontSize: 24 }}>{moneyShort(Number(bid.amount) + Number(bid.co_approved_total ?? 0))}</div>
            </div>
            <div className="stat">
              <div className="stat-top"><span className="stat-label">Sq Ft</span></div>
              <div className="stat-val" style={{ fontSize: 24 }}>{bid.sq_ft != null ? bid.sq_ft.toLocaleString() : '— '}</div>
            </div>
            <div className="stat">
              <div className="stat-top"><span className="stat-label">Project Type</span></div>
              <div className="stat-val" style={{ fontSize: 16 }}>{PROJECT_TYPES.find(t => t.value === bid.project_type)?.label ?? '—'}</div>
            </div>
            <div className="stat">
              <div className="stat-top"><span className="stat-label">Due</span></div>
              <div className="stat-val" style={{ fontSize: 16 }}>{bid.due || '—'}</div>
              <div className="stat-sub">{dueBadge()}</div>
            </div>
            <div className="stat">
              <div className="stat-top"><span className="stat-label">Sheets</span></div>
              <div className="stat-val" style={{ fontSize: 24 }}>{bid.sheets || '—'}</div>
            </div>
          </div>

          <div>
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
                    onClick={() => moveToStage(bid.id, s.key)}
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
                  <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={cancelConfirm}>Cancel</button>
                  <button className="btn" style={{ height: 28, fontSize: 12, padding: '0 10px', background: 'var(--red)', borderColor: 'var(--red)' }}
                    onClick={() => moveToStage(bid.id, 'lost', { loss_reason: lossReason, competitor: competitor || undefined })}>
                    Confirm Lost
                  </button>
                </div>
              </div>
            )}
          </div>

          {winProb && (
            <div style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Historical Win Rate</span>
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
            <div className="dtl-row"><span className="dtl-k">Contact</span><span className="dtl-v">{bid.contact || '—'}</span></div>
            <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{bid.salesperson_name}</span></div>
            {bid.loss_reason && <div className="dtl-row"><span className="dtl-k">Loss Reason</span><span className="dtl-v">{bid.loss_reason}</span></div>}
            {bid.competitor && <div className="dtl-row"><span className="dtl-k">Awarded To</span><span className="dtl-v">{bid.competitor}</span></div>}
          </div>

          {/* Bid qualification score */}
          <div>
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
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  A heuristic from your win-rate history with this GC and the bid timeline — not a prediction.
                </div>
              </div>
            ) : (
              <button className="btn ghost" disabled={qualifying} onClick={runQualify}
                style={{ width: '100%', justifyContent: 'center', fontSize: 12.5 }}>
                <Icon name="spark" size={13} stroke={2}/>{qualifying ? 'Scoring…' : 'Score This Bid'}
              </button>
            )}
          </div>

          {/* Scope of Work (read-only — edit in Estimating) */}
          <div className="dtl-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
              <span className="dtl-stage-label" style={{ marginBottom: 0 }}>Scope of Work</span>
              <button className="btn ghost" style={{ height: 26, fontSize: 11, padding: '0 8px' }} onClick={() => onGoTab('estimating')}>
                Edit in Estimating
              </button>
            </div>
            {scopeSecs.length ? scopeSecs.map(s => (
              <div key={s.id} className="dtl-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span className="dtl-k">{s.id}. {s.label}</span>
                <span className="dtl-v" style={{ textAlign: 'left', fontWeight: 500, whiteSpace: 'pre-wrap' }}>{scope[s.id]}</span>
              </div>
            )) : (
              <div style={{ padding: '4px 0 12px', fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }}>
                No scope yet — import a finished bid or fill it in Estimating.
              </div>
            )}
          </div>

          {/* Draft a "new bid" email to the team in Outlook (review & send yourself). */}
          {!isTerminal && (
            <div>
              {notifyOpen ? (
                draftLink !== null ? (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>
                      <Icon name="check" size={15} stroke={2.4}/>Draft created in your Outlook
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Review it in your Drafts and hit send when ready.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {draftLink && (
                        <a className="btn" href={draftLink} target="_blank" rel="noopener noreferrer" style={{ flex: 1, justifyContent: 'center', textDecoration: 'none' }}>
                          <Icon name="mail" size={14} stroke={2}/>Open draft
                        </a>
                      )}
                      <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={() => setNotifyOpen(false)}>Done</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>Draft email to team — recipients</div>
                    <textarea
                      style={{ ...INPUT, minHeight: 44, resize: 'vertical' } as React.CSSProperties}
                      value={notifyEmails}
                      onChange={e => setNotifyEmails(e.target.value)}
                      placeholder="name@company.com, name2@company.com"
                    />
                    <div style={{ fontSize: 11, color: 'var(--text3)', margin: '5px 0 10px' }}>Comma-separated. Creates a draft in your Outlook — nothing is sent until you send it.</div>
                    {fileCount != null && fileCount > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', margin: '0 0 12px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={attachFiles} onChange={e => setAttachFiles(e.target.checked)}/>
                        Attach bid files ({fileCount})
                      </label>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" style={{ flex: 1, justifyContent: 'center' }} disabled={sendingNotify || !notifyEmails.trim()} onClick={handleNotifyTeam}>
                        <Icon name="mail" size={14} stroke={2}/>{sendingNotify ? 'Creating…' : 'Create Draft'}
                      </button>
                      <button className="btn ghost" style={{ justifyContent: 'center' }} onClick={() => setNotifyOpen(false)}>Cancel</button>
                    </div>
                  </div>
                )
              ) : (
                <button
                  className="btn ghost"
                  style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)' }}
                  disabled={!teamDefaults.mailConfigured}
                  onClick={openNotify}
                  title={!teamDefaults.mailConfigured ? 'Email isn’t configured in Settings' : undefined}
                >
                  <Icon name="mail" size={14} stroke={2}/>Draft Email to Team
                </button>
              )}
            </div>
          )}

          {bid.stage === 'awarded' && !bid.closed_at && (
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', color: 'var(--green)', borderColor: 'rgba(52,197,136,.4)' }}
              disabled={closingJob}
              onClick={handleCloseJob}
            >
              <Icon name="check" size={14} stroke={2.2}/>{closingJob ? 'Closing…' : 'Close Job'}
            </button>
          )}

          <button
            className="btn ghost"
            style={{ width: '100%', justifyContent: 'center', color: '#E06A6A', borderColor: 'rgba(224,106,106,.45)' }}
            disabled={deleting}
            onClick={handleDelete}
          >
            <Icon name="x" size={14} stroke={2}/>{deleting ? 'Deleting…' : 'Delete Bid'}
          </button>

          {/* Google Drive folder links — shown when folders were auto-created on bid creation */}
          {bid.drive_job_folder_id && (
            <div className="dtl-section">
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Google Drive Folders</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { label: 'Plans & Specs',               id: bid.drive_plans_folder_id },
                  { label: 'Estimates & Scope',           id: bid.drive_estimates_folder_id },
                  { label: 'Change Orders',               id: bid.drive_change_orders_folder_id },
                  { label: 'Submittals',                  id: bid.drive_submittals_folder_id },
                  { label: 'RFIs',                        id: bid.drive_rfis_folder_id },
                  { label: 'Photos',                      id: bid.drive_photos_folder_id },
                  { label: 'Contract & Invoices',         id: bid.drive_contracts_folder_id },
                  { label: 'All Job Files',               id: bid.drive_job_folder_id },
                ].filter(f => f.id).map(f => (
                  <a
                    key={f.label}
                    href={`https://drive.google.com/drive/folders/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 13, color: 'var(--blue)', textDecoration: 'none',
                      padding: '4px 0',
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    {f.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
