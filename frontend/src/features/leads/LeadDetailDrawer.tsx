import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Lead, LeadActivity } from '../../types';
import { LEAD_STAGES, LeadStageKey, SOURCE_LABELS, INTEREST_LABELS } from './constants';
import BuildFromNotesModal from '../builder/BuildFromNotesModal';
import { Gen } from '../../types';

interface Props {
  lead: Lead;
  onClose: () => void;
  onUpdated: (lead: Lead) => void;
  onDeleted: (lead: Lead) => void;
  onNav: (view: string) => void;
  onEditGen?: (gen: Gen) => void;
}

const inp: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)',
  background: 'var(--surface)', border: '1px solid var(--border2)',
  borderRadius: 9, padding: '7px 10px', outline: 'none',
  boxSizing: 'border-box', width: '100%',
};
const lbl: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, color: 'var(--text3)',
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4, display: 'block',
};

function timeAgo(ts: string) {
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Overdue thresholds mirror backend DEFAULT_STAGE_CONFIG.overdue_after_hours (hours)
const OVERDUE_HOURS: Partial<Record<Lead['stage'], number>> = {
  new: 48, contacted: 96, vetting: 120, quoted: 72,
  'site-scheduled': 168, 'site-complete': 72, 'proposal-sent': 96,
};

function isLeadOverdue(lead: Lead): boolean {
  const threshold = OVERDUE_HOURS[lead.stage];
  if (!threshold) return false;
  const ref = lead.last_activity_at ?? lead.created_at;
  if (!ref) return false;
  return Date.now() - new Date(ref).getTime() > threshold * 60 * 60 * 1000;
}

export default function LeadDetailDrawer({ lead: initialLead, onClose, onUpdated, onDeleted, onNav, onEditGen }: Props) {
  const [lead, setLead] = useState<Lead>(initialLead);
  const [activity, setActivity] = useState<LeadActivity[]>([]);
  const [dirty, setDirty] = useState<Partial<Lead>>({});
  const [saving, setSaving] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [quickLogging, setQuickLogging] = useState<string | null>(null); // which kind is in-flight
  const [quickLogged, setQuickLogged] = useState<string | null>(null);  // brief ✓ confirmation
  const [noteText, setNoteText] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteLogging, setNoteLogging] = useState(false);
  const [showBuildNotes, setShowBuildNotes] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLead(initialLead);
    setDirty({});
  }, [initialLead.id]);

  useEffect(() => {
    api.get<{ activity: LeadActivity[] } & Lead>(`/leads/${lead.id}`)
      .then(({ data }) => setActivity(data.activity || []))
      .catch(() => {});
  }, [lead.id]);

  useEffect(() => {
    if (!actionsOpen) return;
    const h = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [actionsOpen]);

  const field = (key: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setLead(p => ({ ...p, [key]: val }));
    setDirty(p => ({ ...p, [key]: val }));
  };

  const save = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      const { data } = await api.patch<Lead>(`/leads/${lead.id}`, dirty);
      setLead(data);
      setDirty({});
      onUpdated(data);
      // Refresh activity (stage change may have been logged)
      await refreshActivity();
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (stage: LeadStageKey) => {
    setActionsOpen(false);
    const { data } = await api.patch<Lead>(`/leads/${lead.id}`, { stage });
    setLead(data);
    setDirty({});
    onUpdated(data);
    await refreshActivity();
  };

  const refreshActivity = async () => {
    const { data: full } = await api.get<{ activity: LeadActivity[] } & Lead>(`/leads/${lead.id}`);
    setActivity(full.activity || []);
    setLead(l => ({ ...l, last_activity_at: full.last_activity_at }));
  };

  const quickLog = async (kind: 'call' | 'text' | 'voicemail', direction: 'in' | 'out' = 'out') => {
    setQuickLogging(kind);
    try {
      const { data } = await api.post<LeadActivity>(`/leads/${lead.id}/log-activity`, { kind, direction });
      setActivity(prev => [data, ...prev]);
      setLead(l => ({ ...l, last_activity_at: data.created_at }));
      setQuickLogged(kind);
      setTimeout(() => setQuickLogged(null), 2000);
    } finally {
      setQuickLogging(null);
    }
  };

  const logNote = async () => {
    if (!noteText.trim()) return;
    setNoteLogging(true);
    try {
      const { data } = await api.post<LeadActivity>(`/leads/${lead.id}/log-activity`, { kind: 'note', body: noteText.trim() });
      setActivity(prev => [data, ...prev]);
      setLead(l => ({ ...l, last_activity_at: data.created_at }));
      setNoteText(''); setShowNoteInput(false);
    } finally {
      setNoteLogging(false);
    }
  };

  const createGen = async () => {
    setActionsOpen(false);
    const { data: gen } = await api.post<Gen>(`/leads/${lead.id}/create-gen`);
    // Refresh lead to get linked_gen_id
    const { data: updated } = await api.get<Lead>(`/leads/${lead.id}`);
    setLead(updated);
    onUpdated(updated);
    if (onEditGen) {
      onClose();
      onEditGen(gen);
    } else {
      onNav('gen-proposals');
    }
  };

  const deleteLead = async () => {
    if (!window.confirm(`Delete lead "${lead.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/leads/${lead.id}`);
      onDeleted(lead);
    } finally {
      setDeleting(false);
    }
  };

  const hasChanges = Object.keys(dirty).length > 0;
  const stageInfo = LEAD_STAGES.find(s => s.key === lead.stage);

  const kindLabel: Record<string, string> = {
    stage_change: 'Stage →', note: 'Note', call: 'Call', text: 'Text',
    voicemail: 'Voicemail', email_sent: 'Email sent', email: 'Email',
    webhook_ok: 'Automation', webhook_fail: 'Automation failed', system: 'System',
  };
  const directionArrow = (a: LeadActivity) => {
    if (a.direction === 'out') return <span style={{ fontSize: 11, color: 'var(--text3)' }}>↗ </span>;
    if (a.direction === 'in')  return <span style={{ fontSize: 11, color: 'var(--text3)' }}>↙ </span>;
    return null;
  };

  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Generator Lead</div>
            <div className="drawer-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {lead.name}
              {isLeadOverdue(lead) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: 'rgba(217,119,6,.12)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 20, padding: '2px 8px', verticalAlign: 'middle' }}>
                  OVERDUE
                </span>
              )}
            </div>
          </div>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>

        <div className="drawer-body">
          {/* Stage badge + selector */}
          <div className="dtl-stage-label">Stage</div>
          <div className="dtl-stages" style={{ flexWrap: 'wrap' }}>
            {LEAD_STAGES.map(s => {
              const isActive = lead.stage === s.key;
              return (
                <button
                  key={s.key}
                  className={'dtl-stage' + (isActive ? ' on' : '')}
                  style={isActive ? { background: s.color, borderColor: s.color, color: '#fff' } : undefined}
                  onClick={() => setStage(s.key as LeadStageKey)}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Contact Info */}
          <div className="dtl-section" style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Contact</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>Phone</label>
                <input style={inp} value={lead.phone ?? ''} onChange={field('phone')} placeholder="(555) 555-5555"/>
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input style={inp} value={lead.email ?? ''} onChange={field('email')} placeholder="email@example.com"/>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Address</label>
              <input style={inp} value={lead.address ?? ''} onChange={field('address')} placeholder="123 Main St"/>
            </div>
          </div>

          {/* Lead Details */}
          <div className="dtl-section">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Lead Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={lbl}>Source</label>
                <select style={{ ...inp }} value={lead.source} onChange={field('source')}>
                  {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Contact via</label>
                <select style={{ ...inp }} value={lead.contact_method} onChange={field('contact_method')}>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Interest</label>
                <select style={{ ...inp }} value={lead.interest_level} onChange={field('interest_level')}>
                  {Object.entries(INTEREST_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Follow-up Date</label>
                <input style={inp} type="date" value={lead.follow_up_date ?? ''} onChange={field('follow_up_date')}/>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Quoted Range</label>
              <input style={inp} value={lead.quoted_range ?? ''} onChange={field('quoted_range')} placeholder="e.g. $12,000 – $15,000"/>
            </div>
          </div>

          {/* Notes */}
          <div className="dtl-section">
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, resize: 'vertical', minHeight: 80 }} value={lead.notes ?? ''} onChange={field('notes')} placeholder="General notes…"/>
          </div>

          {/* Site Notes — shown when stage >= site-scheduled */}
          {['site-scheduled','site-complete','proposal-sent','won','lost'].includes(lead.stage) && (
            <div className="dtl-section">
              <label style={lbl}>Site Visit Notes</label>
              <textarea
                style={{ ...inp, resize: 'vertical', minHeight: 100 }}
                value={lead.site_notes ?? ''}
                onChange={field('site_notes')}
                placeholder="Detailed site visit notes — generator size, fuel type, placement, clearances, needed equipment…"
              />
            </div>
          )}

          {/* Save bar */}
          {hasChanges && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 4 }}>
              <button className="btn ghost" style={{ fontSize: 13 }} onClick={() => { setLead(initialLead); setDirty({}); }}>Discard</button>
              <button className="btn amber" style={{ fontSize: 13 }} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}

          {/* Generate Proposal button — when site complete and has linked gen */}
          {lead.stage === 'site-complete' && lead.linked_gen_id && lead.site_notes && (
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)', borderColor: 'rgba(59,130,246,.4)', marginTop: 4 }}
              onClick={() => setShowBuildNotes(true)}
            >
              <Icon name="bolt" size={14} stroke={2}/>Generate Proposal from Site Notes
            </button>
          )}

          {/* Quick-log buttons */}
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['call', 'text', 'voicemail'] as const).map(kind => {
              const labels = { call: '📞 Called', text: '💬 Texted', voicemail: '📭 Voicemail' };
              const isLogging = quickLogging === kind;
              const didLog = quickLogged === kind;
              return (
                <button
                  key={kind}
                  className="btn ghost"
                  style={{ fontSize: 12, flex: 1, justifyContent: 'center', minWidth: 80,
                    color: didLog ? 'var(--green)' : undefined,
                    borderColor: didLog ? 'var(--green)' : undefined }}
                  disabled={isLogging || !!quickLogging}
                  onClick={() => quickLog(kind)}
                >
                  {didLog ? '✓ Logged' : isLogging ? '…' : labels[kind]}
                </button>
              );
            })}
            <button
              className="btn ghost"
              style={{ fontSize: 12, flex: 1, justifyContent: 'center', minWidth: 80 }}
              onClick={() => { setShowNoteInput(v => !v); setNoteText(''); }}
            >
              <Icon name="pencil" size={13} stroke={2}/>Note
            </button>
          </div>
          {showNoteInput && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <textarea
                style={{ ...inp, flex: 1, resize: 'vertical', minHeight: 56 }}
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note…"
                autoFocus
                onKeyDown={e => { if (e.key === 'Escape') { setShowNoteInput(false); setNoteText(''); }}}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn" style={{ fontSize: 12, padding: '0 14px' }} onClick={logNote} disabled={noteLogging || !noteText.trim()}>
                  {noteLogging ? '…' : 'Log'}
                </button>
                <button className="btn ghost" style={{ fontSize: 12, padding: '0 10px' }} onClick={() => { setShowNoteInput(false); setNoteText(''); }}>✕</button>
              </div>
            </div>
          )}

          {/* Actions dropdown */}
          <div style={{ position: 'relative', marginTop: 8 }} ref={actionsRef}>
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
              onClick={() => setActionsOpen(v => !v)}
            >
              <Icon name="chevron-down" size={14} stroke={2}/>Actions
            </button>
            {actionsOpen && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.18)',
                zIndex: 200, overflow: 'hidden',
              }}>
                {!lead.linked_gen_id && (
                  <ActionItem icon="bolt" label="Create Generator Record" onClick={createGen}/>
                )}
                <ActionItem icon="x" label="Mark Lost" onClick={async () => {
                  if (!window.confirm('Mark this lead as lost?')) return;
                  await setStage('lost');
                }} color="#E06A6A"/>
                <ActionItem icon="x" label="Delete Lead" onClick={deleteLead} color="#E06A6A"/>
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          {activity.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Activity</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activity.map(a => (
                  <div key={a.id} style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: a.kind === 'webhook_fail' ? 'rgba(224,106,106,.08)' : 'var(--surface-2, rgba(0,0,0,.04))',
                    border: `1px solid ${a.kind === 'webhook_fail' ? 'rgba(224,106,106,.2)' : 'var(--border)'}`,
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text3)', flexShrink: 0 }}>
                        {directionArrow(a)}{kindLabel[a.kind] ?? a.kind}
                      </span>
                      {a.text && a.kind !== 'stage_change' && (
                        <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1 }}>{a.text}</span>
                      )}
                      {a.kind === 'stage_change' && (
                        <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1 }}>{a.text}</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{timeAgo(a.created_at)}</span>
                    </div>
                    {a.created_by && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>by {a.created_by}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked generator */}
          {lead.linked_gen_id && (
            <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>Linked Generator Proposal</div>
              <button
                className="btn ghost"
                style={{ fontSize: 13, color: 'var(--amber)', borderColor: 'rgba(245,158,11,.4)' }}
                onClick={() => { onClose(); onNav('gen-proposals'); }}
              >
                <Icon name="bolt" size={13} stroke={2}/>View in Generator Pipeline
              </button>
            </div>
          )}

          {/* Stage info */}
          <div className="dtl-section" style={{ marginTop: 12 }}>
            <div className="dtl-row">
              <span className="dtl-k">Current Stage</span>
              <span className="dtl-v">
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                  fontSize: 12, fontWeight: 700,
                  background: stageInfo ? stageInfo.color + '22' : 'transparent',
                  color: stageInfo?.color,
                }}>
                  {stageInfo?.label ?? lead.stage}
                </span>
              </span>
            </div>
            {lead.salesperson_name && (
              <div className="dtl-row"><span className="dtl-k">Salesperson</span><span className="dtl-v">{lead.salesperson_name}</span></div>
            )}
          </div>
        </div>
      </div>

      {showBuildNotes && lead.linked_gen_id && (
        <BuildFromNotesModal
          genId={lead.linked_gen_id}
          onClose={() => setShowBuildNotes(false)}
          onSuccess={gen => {
            setShowBuildNotes(false);
            onClose();
            if (onEditGen) onEditGen(gen);
            else onNav('builder');
          }}
        />
      )}
    </div>
  );
}

function ActionItem({ icon, label, onClick, color }: { icon: string; label: string; onClick: () => void; color?: string }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '10px 16px',
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 600,
        color: color || 'var(--text)',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={14} stroke={2}/>{label}
    </button>
  );
}
