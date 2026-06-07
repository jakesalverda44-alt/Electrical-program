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

export default function LeadDetailDrawer({ lead: initialLead, onClose, onUpdated, onDeleted, onNav, onEditGen }: Props) {
  const [lead, setLead] = useState<Lead>(initialLead);
  const [activity, setActivity] = useState<LeadActivity[]>([]);
  const [dirty, setDirty] = useState<Partial<Lead>>({});
  const [saving, setSaving] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [callText, setCallText] = useState('');
  const [showCallInput, setShowCallInput] = useState(false);
  const [logCallSaving, setLogCallSaving] = useState(false);
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
      const { data: full } = await api.get<{ activity: LeadActivity[] } & Lead>(`/leads/${lead.id}`);
      setActivity(full.activity || []);
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
    const { data: full } = await api.get<{ activity: LeadActivity[] } & Lead>(`/leads/${lead.id}`);
    setActivity(full.activity || []);
  };

  const logCall = async () => {
    if (!callText.trim()) return;
    setLogCallSaving(true);
    try {
      const { data } = await api.post<LeadActivity>(`/leads/${lead.id}/log-call`, { text: callText.trim() });
      setActivity(prev => [data, ...prev]);
      setCallText(''); setShowCallInput(false);
    } finally {
      setLogCallSaving(false);
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

  const kindIcon: Record<string, string> = {
    stage_change: '→',
    note:         '📝',
    call:         '📞',
    webhook_ok:   '✓',
    webhook_fail: '!',
  };

  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hdr">
          <div>
            <div className="drawer-eyebrow">Generator Lead</div>
            <div className="drawer-title">{lead.name}</div>
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

          {/* Log call */}
          {showCallInput ? (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <input
                style={{ ...inp, flex: 1 }}
                value={callText}
                onChange={e => setCallText(e.target.value)}
                placeholder="Call notes…"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') logCall(); if (e.key === 'Escape') { setShowCallInput(false); setCallText(''); }}}
              />
              <button className="btn" style={{ fontSize: 12, padding: '0 14px' }} onClick={logCall} disabled={logCallSaving || !callText.trim()}>
                {logCallSaving ? '…' : 'Log'}
              </button>
              <button className="btn ghost" style={{ fontSize: 12, padding: '0 10px' }} onClick={() => { setShowCallInput(false); setCallText(''); }}>✕</button>
            </div>
          ) : (
            <button
              className="btn ghost"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 13 }}
              onClick={() => setShowCallInput(true)}
            >
              <Icon name="phone" size={14} stroke={1.9}/>Log Call
            </button>
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
                      <span style={{ fontSize: 12 }}>{kindIcon[a.kind] ?? '•'}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{a.text}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{timeAgo(a.created_at)}</span>
                    </div>
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
