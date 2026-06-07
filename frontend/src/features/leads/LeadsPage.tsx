import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Lead } from '../../types';
import { Gen } from '../../types';
import { LEAD_STAGES, LeadStageKey, SOURCE_LABELS, INTEREST_COLORS, INTEREST_LABELS } from './constants';
import AddLeadModal from './AddLeadModal';
import LeadDetailDrawer from './LeadDetailDrawer';

interface Props {
  onNav: (view: string) => void;
  onEditGen?: (gen: Gen) => void;
}

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function followUpMeta(d?: string | null): { label: string; color: string } | null {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(d + 'T00:00:00');
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `Overdue ${-days}d`, color: 'var(--red)' };
  if (days === 0) return { label: 'Today', color: 'var(--amber)' };
  if (days === 1) return { label: 'Tomorrow', color: 'var(--amber)' };
  return { label: fmtDate(d)!, color: 'var(--text3)' };
}

export default function LeadsPage({ onNav, onEditGen }: Props) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<LeadStageKey | 'all'>('all');
  const [contactFilter, setContactFilter] = useState<'all' | 'email' | 'phone'>('all');
  const [detail, setDetail] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Lead[]>('/leads')
      .then(({ data }) => setLeads(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = leads.filter(l => {
    if (stageFilter !== 'all' && l.stage !== stageFilter) return false;
    if (contactFilter !== 'all' && l.contact_method !== contactFilter) return false;
    return true;
  });

  const stageCounts = Object.fromEntries(
    LEAD_STAGES.map(s => [s.key, leads.filter(l => l.stage === s.key).length])
  );

  const stageInfo = (key: string) => LEAD_STAGES.find(s => s.key === key);

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            <FilterChip
              label="All"
              active={stageFilter === 'all'}
              count={leads.length}
              onClick={() => setStageFilter('all')}
            />
            {LEAD_STAGES.map(s => (
              <FilterChip
                key={s.key}
                label={s.label}
                count={stageCounts[s.key]}
                color={s.color}
                active={stageFilter === s.key}
                onClick={() => setStageFilter(stageFilter === s.key ? 'all' : s.key as LeadStageKey)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'phone', 'email'] as const).map(m => (
              <button
                key={m}
                onClick={() => setContactFilter(m)}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 700,
                  borderRadius: 20, cursor: 'pointer',
                  border: contactFilter === m ? '2px solid var(--amber)' : '2px solid var(--border2)',
                  background: contactFilter === m ? 'rgba(245,158,11,.12)' : 'var(--surface)',
                  color: contactFilter === m ? 'var(--amber)' : 'var(--text2)',
                }}
              >
                {m === 'all' ? 'All Methods' : m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="btn ghost"
            style={{ fontSize: 13, color: 'var(--blue)', borderColor: 'rgba(59,130,246,.4)' }}
            onClick={() => navigate('/leads/kohler-intake')}
          >
            <Icon name="bolt" size={14} stroke={2}/>Kohler Intake
          </button>
          <button className="btn amber" style={{ fontSize: 13 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} stroke={2.4}/>Add Lead
          </button>
        </div>

        {/* Lead list */}
        {loading ? (
          <div style={{ padding: 32, color: 'var(--text3)', textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text3)' }}>
            {leads.length === 0 ? (
              <>
                <Icon name="users" size={40} stroke={1.2}/>
                <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, color: 'var(--text2)' }}>No leads yet</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>Add your first generator lead to start tracking the pipeline.</div>
                <button className="btn amber" style={{ marginTop: 16 }} onClick={() => setShowAdd(true)}>
                  <Icon name="plus" size={14} stroke={2.4}/>Add Lead
                </button>
              </>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--text2)' }}>No leads match the current filters.</div>
            )}
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.2fr 1.2fr 1fr 1fr 1fr 100px',
              gap: 0, padding: '8px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2, rgba(0,0,0,.03))',
            }}>
              {['Name', 'Phone', 'Email', 'Stage', 'Source', 'Interest', 'Follow-up'].map(h => (
                <div key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</div>
              ))}
            </div>
            {filtered.map((lead, i) => {
              const si = stageInfo(lead.stage);
              const fu = followUpMeta(lead.follow_up_date);
              return (
                <div
                  key={lead.id}
                  onClick={() => setDetail(lead)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.2fr 1.2fr 1fr 1fr 1fr 100px',
                    gap: 0, padding: '12px 16px',
                    cursor: 'pointer',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2, rgba(0,0,0,.03))')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{lead.name}</span>
                    {lead.address && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{lead.address}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', alignSelf: 'center' }}>{lead.phone || '—'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.email || '—'}</div>
                  <div style={{ alignSelf: 'center' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                      fontSize: 11.5, fontWeight: 700,
                      background: si ? si.color + '22' : 'transparent',
                      color: si?.color ?? 'var(--text3)',
                    }}>
                      {si?.label ?? lead.stage}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', alignSelf: 'center' }}>{SOURCE_LABELS[lead.source] ?? lead.source}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, alignSelf: 'center', color: INTEREST_COLORS[lead.interest_level] ?? 'var(--text3)' }}>
                    {INTEREST_LABELS[lead.interest_level] ?? lead.interest_level}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, alignSelf: 'center', color: fu?.color ?? 'var(--text3)' }}>
                    {fu?.label ?? '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onAdded={lead => { setLeads(prev => [lead, ...prev]); setShowAdd(false); setDetail(lead); }}
        />
      )}

      {detail && (
        <LeadDetailDrawer
          lead={detail}
          onClose={() => setDetail(null)}
          onUpdated={updated => {
            setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
            setDetail(updated);
          }}
          onDeleted={deleted => {
            setLeads(prev => prev.filter(l => l.id !== deleted.id));
            setDetail(null);
          }}
          onNav={onNav}
          onEditGen={onEditGen}
        />
      )}
    </div>
  );
}

function FilterChip({ label, active, count, color, onClick }: {
  label: string; active: boolean; count: number; color?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 12px', fontSize: 12.5, fontWeight: 700,
        borderRadius: 20, cursor: 'pointer',
        border: active ? `2px solid ${color ?? 'var(--navy)'}` : '2px solid var(--border2)',
        background: active ? (color ? color + '18' : 'rgba(27,58,107,.12)') : 'var(--surface)',
        color: active ? (color ?? 'var(--navy)') : 'var(--text2)',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          fontSize: 10.5, fontWeight: 800, minWidth: 18, height: 18,
          borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px',
          background: active ? (color ?? 'var(--navy)') : 'var(--border)',
          color: active ? '#fff' : 'var(--text3)',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}
