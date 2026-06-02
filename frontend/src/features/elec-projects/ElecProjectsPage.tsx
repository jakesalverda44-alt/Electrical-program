import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Bid, Toast } from '../../types';

const PHASES = [
  { key: 'signed',      label: 'Contract Signed', color: '#7C8AA3' },
  { key: 'rough',       label: 'Rough-In',        color: '#E0A53B' },
  { key: 'inspection',  label: 'Inspection',      color: '#4D8DF7' },
  { key: 'trim',        label: 'Trim-Out',        color: '#9B6DFF' },
  { key: 'final',       label: 'Final',           color: '#F2854F' },
  { key: 'complete',    label: 'Complete',        color: '#34C588' },
] as const;

type PhaseKey = typeof PHASES[number]['key'];

interface ProjectState {
  phase: PhaseKey;
  notes: string;
}

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n);
}
function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  bids: Bid[];
  showToast: (t: Toast) => void;
}

export default function ElecProjectsPage({ bids, showToast }: Props) {
  const awarded = useMemo(() => bids.filter(b => b.stage === 'awarded'), [bids]);

  const [states, setStates] = useState<Record<string, ProjectState>>(() =>
    Object.fromEntries(awarded.map(b => [b.id, { phase: 'signed', notes: '' }]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterPhase, setFilterPhase] = useState<PhaseKey | 'all'>('all');
  const [filterRep,   setFilterRep]   = useState('all');

  const salespeople = useMemo(
    () => Array.from(new Set(awarded.map(b => b.salesperson_name))).sort(),
    [awarded]
  );

  const setPhase = (id: string, phase: PhaseKey) => {
    setStates(prev => ({ ...prev, [id]: { ...prev[id], phase } }));
    const label = PHASES.find(p => p.key === phase)?.label ?? phase;
    showToast({ title: 'Phase updated', sub: label });
  };

  const setNotes = (id: string, notes: string) =>
    setStates(prev => ({ ...prev, [id]: { ...prev[id], notes } }));

  const ensureState = (b: Bid) => {
    if (!states[b.id]) {
      setStates(prev => ({ ...prev, [b.id]: { phase: 'signed', notes: '' } }));
    }
    return states[b.id] ?? { phase: 'signed', notes: '' };
  };

  const filtered = awarded.filter(b => {
    const st = states[b.id] ?? { phase: 'signed' };
    if (filterPhase !== 'all' && st.phase !== filterPhase) return false;
    if (filterRep   !== 'all' && b.salesperson_name !== filterRep) return false;
    return true;
  });

  const totalValue   = awarded.reduce((s, b) => s + Number(b.amount), 0);
  const activeCount  = awarded.filter(b => (states[b.id]?.phase ?? 'signed') !== 'complete').length;
  const doneCount    = awarded.filter(b => states[b.id]?.phase === 'complete').length;
  const avgVal       = awarded.length ? Math.round(totalValue / awarded.length) : 0;

  const PhaseChip = ({ phase }: { phase: PhaseKey }) => {
    const p = PHASES.find(x => x.key === phase)!;
    return (
      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 5,
        background: p.color + '22', color: p.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {p.label}
      </span>
    );
  };

  const PhaseTracker = ({ id, currentPhase }: { id: string; currentPhase: PhaseKey }) => {
    const idx = PHASES.findIndex(p => p.key === currentPhase);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 14 }}>
        {PHASES.map((p, i) => {
          const done   = i < idx;
          const active = i === idx;
          return (
            <React.Fragment key={p.key}>
              <button
                onClick={e => { e.stopPropagation(); setPhase(id, p.key); }}
                title={p.label}
                style={{
                  width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800,
                  background: done ? p.color : active ? p.color : 'var(--surface2)',
                  color: (done || active) ? '#fff' : 'var(--text3)',
                  outline: active ? `2px solid ${p.color}` : 'none', outlineOffset: 2,
                  flexShrink: 0,
                }}>
                {done ? <Icon name="check" size={12} stroke={2.5}/> : i + 1}
              </button>
              {i < PHASES.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < idx ? PHASES[i].color : 'var(--surface2)', minWidth: 8 }}/>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        {/* Stats */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'Active Contract Value', val: moneyFull(totalValue), sub: `${awarded.length} jobs awarded`, tone: 'green' },
            { label: 'Jobs In Progress',      val: String(activeCount),   sub: 'currently in field',             tone: 'blue'  },
            { label: 'Jobs Completed',        val: String(doneCount),     sub: 'this year',                      tone: 'amber' },
            { label: 'Avg Job Value',         val: moneyFull(avgVal),     sub: 'per awarded contract',            tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="trend" size={16} stroke={1.9}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text3)' }}>
            <Icon name="filter" size={14} stroke={1.8}/> Phase
            <select value={filterPhase} onChange={e => setFilterPhase(e.target.value as any)}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', outline: 'none' }}>
              <option value="all">All Phases</option>
              {PHASES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text3)' }}>
            <Icon name="users" size={14} stroke={1.8}/> Rep
            <select value={filterRep} onChange={e => setFilterRep(e.target.value)}
              style={{ font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', outline: 'none' }}>
              <option value="all">All Reps</option>
              {salespeople.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }}>
            {filtered.length} of {awarded.length} jobs
          </span>
        </div>

        {/* Project cards */}
        {awarded.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No awarded jobs yet. Mark bids as Awarded in the Electrical Proposals board.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No jobs match these filters.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(bid => {
              const st       = ensureState(bid);
              const expanded = expandedId === bid.id;
              const phase    = PHASES.find(p => p.key === st.phase)!;

              return (
                <div key={bid.id} className="panel" style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : bid.id)}>
                  <div style={{ padding: '16px 20px' }}>
                    {/* Card header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{bid.name}</div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="building" size={12} stroke={1.8}/>{bid.gc}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="pin" size={12} stroke={1.8}/>{bid.loc}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="users" size={12} stroke={1.8}/>{bid.salesperson_name}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                        <PhaseChip phase={st.phase}/>
                        <span className="num" style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>{money(bid.amount)}</span>
                        <Icon name={expanded ? 'minus' : 'plus'} size={16} stroke={2}/>
                      </div>
                    </div>

                    {/* Phase tracker always visible */}
                    <PhaseTracker id={bid.id} currentPhase={st.phase}/>

                    {/* Phase labels */}
                    <div style={{ display: 'flex', gap: 0, marginTop: 6 }}>
                      {PHASES.map((p, i) => (
                        <div key={p.key} style={{ flex: 1, fontSize: 9, fontWeight: 700, color: p.key === st.phase ? p.color : 'var(--text3)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                          {i === 0 || i === PHASES.length - 1 || p.key === st.phase ? p.label.split(' ')[0] : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px' }}
                      onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                        {[
                          ['Contract Value', moneyFull(bid.amount)],
                          ['Contact',        bid.contact || '—'],
                          ['Plan Sheets',    bid.sheets ? `${bid.sheets} sheets` : '—'],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{k}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Set Phase</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {PHASES.map(p => (
                            <button key={p.key} onClick={() => setPhase(bid.id, p.key)}
                              style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                                background: st.phase === p.key ? p.color : 'var(--surface2)',
                                color: st.phase === p.key ? '#fff' : 'var(--text2)' }}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Job Notes</div>
                        <textarea
                          value={st.notes}
                          onChange={e => setNotes(bid.id, e.target.value)}
                          placeholder="Site conditions, schedule notes, change orders…"
                          style={{ width: '100%', font: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '10px 12px', height: 88, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
