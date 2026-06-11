import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Lead } from '../../types';
import { Gen } from '../../types';
import { LEAD_STAGES, ALL_LEAD_STAGES, LeadStageKey, SOURCE_LABELS, INTEREST_COLORS, INTEREST_LABELS } from './constants';
import AddLeadModal from './AddLeadModal';
import LeadDetailDrawer from './LeadDetailDrawer';

interface Props {
  onNav: (view: string) => void;
  // A lead id pulled from the URL (e.g. global search deep-link); opens that lead's drawer.
  openLeadId?: string | null;
  // Called once the deep-linked lead has been opened, so the id is stripped from the URL.
  onClearParam?: () => void;
  onEditGen?: (gen: Gen) => void;
  onConverted?: (gen: Gen) => void;
}

// Postgres DATE columns arrive serialized as ISO ("2026-06-11T00:00:00.000Z"); take the
// calendar-day portion so date math doesn't produce Invalid Date / NaN.
function dayOf(d: string) { return new Date(d.slice(0, 10) + 'T00:00:00'); }

function fmtDate(d?: string | null) {
  if (!d) return null;
  return dayOf(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function followUpMeta(d?: string | null): { label: string; color: string } | null {
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = dayOf(d);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `Overdue ${-days}d`, color: 'var(--red)' };
  if (days === 0) return { label: 'Today', color: 'var(--amber)' };
  if (days === 1) return { label: 'Tomorrow', color: 'var(--amber)' };
  return { label: fmtDate(d)!, color: 'var(--text3)' };
}

interface LeadAction {
  id: string; name: string; phone: string | null; email: string | null;
  stage: string; source: string; interest_level: string;
  priority: 1 | 2 | 3; reason: string;
}

// ---- Sorting --------------------------------------------------------------
// Leads arrive from the API in created_at order, which reads as "random" once
// there are more than a handful. These give the board a deliberate order.

// Pipeline progression weight (lower = earlier/needs attention sooner).
const STAGE_ORDER: Record<string, number> = {
  new: 0, contacted: 1, 'site-scheduled': 2, lost: 3, converted: 4,
};
// Interest weight (hottest first).
const INTEREST_ORDER: Record<string, number> = {
  hot: 0, warm: 1, unknown: 2, 'not-interested': 3,
};

function ts(d?: string | null) { return d ? dayOf(d).getTime() : null; }

// Newest created first.
function cmpCreated(a: Lead, b: Lead) {
  return (ts(b.created_at) ?? 0) - (ts(a.created_at) ?? 0);
}
// Soonest / overdue follow-up first; leads with no follow-up date sink to the bottom.
function cmpFollowUp(a: Lead, b: Lead) {
  const av = ts(a.follow_up_date), bv = ts(b.follow_up_date);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av - bv;
}

type SortKey = 'smart' | 'followup' | 'newest' | 'oldest' | 'name' | 'interest';

const SORTS: { key: SortKey; label: string; cmp: (a: Lead, b: Lead) => number }[] = [
  // Stage progression, then most urgent follow-up, then newest.
  { key: 'smart', label: 'Smart', cmp: (a, b) =>
      (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) || cmpFollowUp(a, b) || cmpCreated(a, b) },
  { key: 'followup', label: 'Follow-up due', cmp: (a, b) => cmpFollowUp(a, b) || cmpCreated(a, b) },
  { key: 'newest', label: 'Newest', cmp: cmpCreated },
  { key: 'oldest', label: 'Oldest', cmp: (a, b) => -cmpCreated(a, b) },
  { key: 'name', label: 'Name A–Z', cmp: (a, b) => a.name.localeCompare(b.name) },
  { key: 'interest', label: 'Interest', cmp: (a, b) =>
      (INTEREST_ORDER[a.interest_level] - INTEREST_ORDER[b.interest_level]) || cmpCreated(a, b) },
];

const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: 'Call now', color: 'var(--red)' },
  2: { label: 'No response', color: 'var(--orange)' },
  3: { label: 'Follow-up', color: 'var(--blue)' },
};

export default function LeadsPage({ onNav, openLeadId, onClearParam, onEditGen, onConverted }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [actions, setActions] = useState<LeadAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<LeadStageKey | 'all'>('all');
  const [contactFilter, setContactFilter] = useState<'all' | 'email' | 'phone'>('all');
  const [sort, setSort] = useState<SortKey>('smart');
  const [detail, setDetail] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const loadActions = useCallback(() => {
    api.get<LeadAction[]>('/leads/action-queue')
      .then(({ data }) => setActions(data))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Lead[]>('/leads')
      .then(({ data }) => setLeads(data))
      .catch(() => {})
      .finally(() => setLoading(false));
    loadActions();
  }, [loadActions]);

  useEffect(() => { load(); }, [load]);

  // Deep-link from global search / notifications: open the targeted lead's drawer.
  // Leads not on the board (e.g. a converted one) are fetched directly by id.
  const openedParam = useRef<string | null>(null);
  useEffect(() => {
    if (!openLeadId) { openedParam.current = null; return; }
    if (openedParam.current === openLeadId) return;
    const existing = leads.find(l => l.id === openLeadId);
    if (existing) {
      openedParam.current = openLeadId;
      setDetail(existing);
      onClearParam?.();
    } else if (!loading) {
      openedParam.current = openLeadId;
      api.get<Lead>(`/leads/${openLeadId}`)
        .then(({ data }) => setDetail(data))
        .catch(() => {})
        .finally(() => onClearParam?.());
    }
  }, [openLeadId, leads, loading, onClearParam]);

  const openActionLead = (a: LeadAction) => {
    const lead = leads.find(l => l.id === a.id);
    if (lead) setDetail(lead);
  };

  // Converted leads are handed off to the proposal pipeline and hidden from the board.
  const boardLeads = leads.filter(l => l.stage !== 'converted');

  const sortCmp = (SORTS.find(s => s.key === sort) ?? SORTS[0]).cmp;

  const filtered = boardLeads
    .filter(l => {
      // Lost leads are hidden from the default view — they only appear when the
      // "Lost" pill is explicitly selected, so they don't clutter active work.
      if (stageFilter === 'all') { if (l.stage === 'lost') return false; }
      else if (l.stage !== stageFilter) return false;
      if (contactFilter !== 'all' && l.contact_method !== contactFilter) return false;
      return true;
    })
    .sort(sortCmp);

  // The default ("Active") pill excludes lost leads so its count matches what's shown.
  const activeCount = boardLeads.filter(l => l.stage !== 'lost').length;

  const stageCounts = Object.fromEntries(
    LEAD_STAGES.map(s => [s.key, boardLeads.filter(l => l.stage === s.key).length])
  );

  const stageInfo = (key: string) => ALL_LEAD_STAGES.find(s => s.key === key);

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

        {/* Action queue: every lead that needs something, most urgent first */}
        {actions.length > 0 && (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 14,
            marginBottom: 20, overflow: 'hidden',
          }}>
            <div style={{
              padding: '11px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text2)',
            }}>
              ⚡ Needs action
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--surface2)',
                borderRadius: 6, padding: '2px 8px', color: 'var(--text3)',
              }}>{actions.length}</span>
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {actions.map((a, i) => {
                const pm = PRIORITY_META[a.priority];
                return (
                  <div
                    key={a.id}
                    onClick={() => openActionLead(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer',
                      borderBottom: i < actions.length - 1 ? '1px solid var(--border)' : 'none',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <span style={{
                      flex: 'none', fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                      padding: '3px 9px', borderRadius: 6, background: pm.color + '22', color: pm.color,
                      minWidth: 86, textAlign: 'center',
                    }}>{pm.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{a.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 10 }}>
                        {a.reason}{a.source === 'kohler' ? ' · Kohler' : ''}
                      </span>
                    </div>
                    {a.phone && (
                      <a
                        href={`tel:${a.phone.replace(/[^\d+]/g, '')}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                          flex: 'none', fontSize: 12, fontWeight: 700, textDecoration: 'none',
                          padding: '6px 12px', borderRadius: 8, background: 'var(--green-soft)', color: 'var(--green)',
                        }}
                      >Call {a.phone}</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            <FilterChip
              label="Active"
              active={stageFilter === 'all'}
              count={activeCount}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Sort</span>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              style={{
                padding: '6px 10px', fontSize: 12.5, fontWeight: 700,
                borderRadius: 8, cursor: 'pointer',
                border: '2px solid var(--border2)', background: 'var(--surface)', color: 'var(--text2)',
              }}
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <button className="btn amber" style={{ fontSize: 13 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} stroke={2.4}/>Add Lead
          </button>
        </div>

        {/* Lead list */}
        {loading ? (
          <div style={{ padding: 32, color: 'var(--text3)', textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text3)' }}>
            {boardLeads.length === 0 ? (
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
            loadActions();
          }}
          onDeleted={deleted => {
            setLeads(prev => prev.filter(l => l.id !== deleted.id));
            setDetail(null);
            loadActions();
          }}
          onNav={onNav}
          onEditGen={onEditGen}
          onConverted={onConverted}
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
