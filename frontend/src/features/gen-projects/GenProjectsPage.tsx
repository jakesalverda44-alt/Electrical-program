import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Gen, Toast } from '../../types';
import api from '../../api/client';

const PHASES = [
  { key: 'scheduled',  label: 'Scheduled',        color: '#7C8AA3' },
  { key: 'ordered',    label: 'Equip. Ordered',   color: '#E0A53B' },
  { key: 'delivered',  label: 'Delivered',        color: '#4D8DF7' },
  { key: 'install',    label: 'Installation',     color: '#9B6DFF' },
  { key: 'startup',    label: 'Startup',          color: '#F2854F' },
  { key: 'complete',   label: 'Complete',         color: '#34C588' },
] as const;

type PhaseKey = typeof PHASES[number]['key'];

interface ProjectState {
  phase: PhaseKey;
  installDate: string;
  notes: string;
}

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n);
}
function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  gens: Gen[];
  showToast: (t: Toast) => void;
}

export default function GenProjectsPage({ gens, showToast }: Props) {
  const awarded = useMemo(() => gens.filter(g => g.stage === 'awarded'), [gens]);

  const [states, setStates] = useState<Record<string, ProjectState>>(() =>
    Object.fromEntries(awarded.map(g => [g.id, { phase: (g.gen_install_phase as PhaseKey) || 'scheduled', installDate: '', notes: '' }]))
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterPhase, setFilterPhase] = useState<PhaseKey | 'all'>('all');
  const [filterRep,   setFilterRep]   = useState('all');
  const [filterMfr,   setFilterMfr]   = useState('all');

  const salespeople = useMemo(
    () => Array.from(new Set(awarded.map(g => g.salesperson_name))).sort(),
    [awarded]
  );

  const setPhase = (id: string, phase: PhaseKey) => {
    setStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? { phase: 'scheduled', installDate: '', notes: '' }), phase } }));
    const label = PHASES.find(p => p.key === phase)?.label ?? phase;
    showToast({ title: 'Phase updated', sub: label });
    api.patch(`/gens/${id}/phase`, { phase }).catch(() => {});
  };

  const setField = (id: string, key: keyof ProjectState, val: string) =>
    setStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? { phase: 'scheduled', installDate: '', notes: '' }), [key]: val } }));

  const ensureState = (g: Gen): ProjectState => {
    if (!states[g.id]) {
      setStates(prev => ({ ...prev, [g.id]: { phase: 'scheduled', installDate: '', notes: '' } }));
    }
    return states[g.id] ?? { phase: 'scheduled', installDate: '', notes: '' };
  };

  const filtered = awarded.filter(g => {
    const st = states[g.id] ?? { phase: 'scheduled' };
    if (filterPhase !== 'all' && st.phase !== filterPhase) return false;
    if (filterRep   !== 'all' && g.salesperson_name !== filterRep) return false;
    if (filterMfr   !== 'all' && g.mfr !== filterMfr) return false;
    return true;
  });

  const totalValue  = awarded.reduce((s, g) => s + Number(g.amount), 0);
  const activeCount = awarded.filter(g => (states[g.id]?.phase ?? 'scheduled') !== 'complete').length;
  const doneCount   = awarded.filter(g => states[g.id]?.phase === 'complete').length;
  const avgKw       = awarded.length ? Math.round(awarded.reduce((s, g) => s + Number(g.kw), 0) / awarded.length) : 0;

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
            { label: 'Active Install Value', val: moneyFull(totalValue), sub: `${awarded.length} units awarded`,    tone: 'green' },
            { label: 'Installs In Progress', val: String(activeCount),   sub: 'active job sites',                   tone: 'amber' },
            { label: 'Installs Complete',    val: String(doneCount),     sub: 'this year',                          tone: 'blue'  },
            { label: 'Avg Generator Size',   val: avgKw + 'kW',          sub: 'across active installs',             tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name="bolt" size={16} stroke={1.9}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Phase', val: filterPhase, set: setFilterPhase, options: [['all', 'All Phases'], ...PHASES.map(p => [p.key, p.label])] },
            { label: 'Rep',   val: filterRep,   set: setFilterRep,   options: [['all', 'All Reps'],   ...salespeople.map(r => [r, r])] },
            { label: 'Brand', val: filterMfr,   set: setFilterMfr,   options: [['all', 'All Brands'], ['Kohler', 'Kohler'], ['Generac', 'Generac']] },
          ].map(f => (
            <label key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text3)' }}>
              <Icon name="filter" size={14} stroke={1.8}/>{f.label}
              <select value={f.val} onChange={e => f.set(e.target.value as any)}
                style={{ font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '6px 10px', cursor: 'pointer', outline: 'none' }}>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text3)', fontWeight: 600 }}>
            {filtered.length} of {awarded.length} installs
          </span>
        </div>

        {/* Project cards */}
        {awarded.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No awarded generator installs yet. Mark proposals as Awarded in the Generator Proposals board.
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
            No installs match these filters.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(gen => {
              const st       = ensureState(gen);
              const expanded = expandedId === gen.id;

              return (
                <div key={gen.id} className="panel" style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedId(expanded ? null : gen.id)}>
                  <div style={{ padding: '16px 20px' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>{gen.customer}</div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{
                            fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                            textTransform: 'uppercase', letterSpacing: '.04em',
                            background: gen.mfr === 'Kohler' ? 'var(--blue-soft)' : 'var(--amber-soft)',
                            color: gen.mfr === 'Kohler' ? 'var(--blue)' : 'var(--amber)',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <Icon name="bolt" size={11} stroke={2}/>{gen.mfr}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>{gen.model} · {gen.kw}kW</span>
                          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="pin" size={12} stroke={1.8}/>{gen.loc}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="users" size={12} stroke={1.8}/>{gen.salesperson_name}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                        <PhaseChip phase={st.phase}/>
                        <span className="num" style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>{money(gen.amount)}</span>
                        <Icon name={expanded ? 'minus' : 'plus'} size={16} stroke={2}/>
                      </div>
                    </div>

                    <PhaseTracker id={gen.id} currentPhase={st.phase}/>

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
                          ['Contract Value', moneyFull(gen.amount)],
                          ['Add-ons',        `${gen.addons} included`],
                          ['Tax',            moneyFull(gen.tax)],
                        ].map(([k, v]) => (
                          <div key={k}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{k}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{v}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Install Date</div>
                        <input type="date" value={st.installDate} onChange={e => setField(gen.id, 'installDate', e.target.value)}
                          style={{ font: 'inherit', fontSize: 13, fontWeight: 600, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 9, padding: '7px 10px', outline: 'none' }}/>
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Set Phase</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {PHASES.map(p => (
                            <button key={p.key} onClick={() => setPhase(gen.id, p.key)}
                              style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                                background: st.phase === p.key ? p.color : 'var(--surface2)',
                                color: st.phase === p.key ? '#fff' : 'var(--text2)' }}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Install Notes</div>
                        <textarea
                          value={st.notes}
                          onChange={e => setField(gen.id, 'notes', e.target.value)}
                          placeholder="Site access, fuel type confirmed, utility coordination…"
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
