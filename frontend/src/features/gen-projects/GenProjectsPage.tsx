import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Gen, Toast } from '../../types';
import api from '../../api/client';

const PHASES = [
  { key: 'deposit',      label: 'Deposit',      color: '#7C8AA3' },
  { key: 'engineering',  label: 'Engineering',  color: '#4D8DF7' },
  { key: 'permitting',   label: 'Permitting',   color: '#E0A53B' },
  { key: 'scheduling',   label: 'Scheduling',   color: '#9B6DFF' },
  { key: 'installation', label: 'Installation', color: '#F2854F' },
  { key: 'inspection',   label: 'Inspection',   color: '#4DC8F7' },
  { key: 'startup',      label: 'Startup',      color: '#E0A53B' },
  { key: 'complete',     label: 'Complete',     color: '#34C588' },
] as const;
type PhaseKey = typeof PHASES[number]['key'];

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n/1_000_000).toFixed(2).replace(/\.?0+$/,'')+'M';
  if (n >= 1_000)     return '$' + (n/1_000).toFixed(1).replace(/\.0$/,'')+'K';
  return '$'+Math.round(n);
}
function moneyFull(n: number) { return '$'+Math.round(n).toLocaleString('en-US'); }

interface Props { gens: Gen[]; showToast: (t: Toast) => void; }

export default function GenProjectsPage({ gens, showToast }: Props) {
  const awarded = useMemo(() => gens.filter(g => g.stage === 'awarded'), [gens]);

  // Normalise phase: map old values forward, default to 'deposit'
  const normalise = (raw?: string): PhaseKey => {
    const OLD_MAP: Record<string,PhaseKey> = {
      scheduled:'deposit', ordered:'engineering', delivered:'permitting', install:'installation',
    };
    if (!raw) return 'deposit';
    if (raw in OLD_MAP) return OLD_MAP[raw];
    return (PHASES.find(p=>p.key===raw)?.key ?? 'deposit');
  };

  const [phases, setPhases] = useState<Record<string,PhaseKey>>(() =>
    Object.fromEntries(awarded.map(g => [g.id, normalise(g.gen_install_phase)]))
  );
  const [dragId,  setDragId]  = useState<string|null>(null);
  const [overCol, setOverCol] = useState<PhaseKey|null>(null);
  const [detail,  setDetail]  = useState<Gen|null>(null);

  const movePhase = (id: string, phase: PhaseKey) => {
    setPhases(prev => ({ ...prev, [id]: phase }));
    api.patch(`/gens/${id}/phase`, { phase }).catch(() => {});
    showToast({ title: 'Phase updated', sub: PHASES.find(p=>p.key===phase)?.label });
  };

  const advancePhase = (id: string) => {
    const cur = phases[id] ?? 'deposit';
    const idx = PHASES.findIndex(p => p.key === cur);
    if (idx < PHASES.length - 1) movePhase(id, PHASES[idx+1].key);
  };

  const totalValue  = awarded.reduce((s,g)=>s+Number(g.amount),0);
  const activeCount = awarded.filter(g=>(phases[g.id]??'deposit')!=='complete').length;

  const byPhase = (phase: PhaseKey) => awarded.filter(g => (phases[g.id]??'deposit') === phase);

  return (
    <div className="scroll view-enter">
      {/* Summary banner */}
      <div style={{ display:'flex', alignItems:'center', gap:0, padding:'14px 28px', borderBottom:'1px solid var(--border)', background:'var(--panel)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 14px', borderRadius:8,
          background:'var(--green-soft)', color:'var(--green)', fontSize:12.5, fontWeight:700, marginRight:16 }}>
          <Icon name="check" size={13} stroke={2.2}/> Awarded → Active Projects
        </div>
        <span style={{ fontSize:13, fontWeight:700, color:'var(--text2)', marginRight:20 }}>
          {awarded.length} generator project{awarded.length!==1?'s':''}
        </span>
        <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }} className="num">
          {money(totalValue)} total
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:20 }}>
          <span style={{ fontSize:12.5, fontWeight:600, color:'var(--text3)' }}>
            {activeCount} active · {awarded.length - activeCount} complete
          </span>
        </div>
      </div>

      {awarded.length === 0 ? (
        <div style={{ padding:60, textAlign:'center', color:'var(--text3)', fontSize:13, fontWeight:600 }}>
          No awarded generator installs yet. Mark proposals as Awarded in the Generator Proposals board.
        </div>
      ) : (
        <div className="board" style={{ gridTemplateColumns:`repeat(${PHASES.length}, minmax(200px,1fr))`, overflowX:'auto' }}>
          {PHASES.map(phase => {
            const cards = byPhase(phase.key);
            const colVal = cards.reduce((s,g)=>s+Number(g.amount),0);
            const isOver = overCol === phase.key;
            return (
              <div key={phase.key}
                className={'col' + (isOver ? ' drag-over' : '')}
                onDragOver={e => { e.preventDefault(); setOverCol(phase.key); }}
                onDragLeave={() => setOverCol(null)}
                onDrop={e => {
                  e.preventDefault();
                  setOverCol(null);
                  const id = e.dataTransfer.getData('genId');
                  if (id) movePhase(id, phase.key);
                  setDragId(null);
                }}>
                {/* Column header */}
                <div className="col-hdr">
                  <div className="col-title">
                    <span style={{ width:8, height:8, borderRadius:'50%', background:phase.color, display:'inline-block', flexShrink:0 }}/>
                    {phase.label}
                    <span className="col-cnt">{cards.length}</span>
                  </div>
                  <span className="col-total">{cards.length > 0 ? money(colVal) : '$0'}</span>
                </div>

                {/* Cards */}
                <div className="col-body">
                  {cards.length === 0 ? (
                    <div className="col-empty">—</div>
                  ) : cards.map(gen => {
                    const isDragging = dragId === gen.id;
                    const isKohler   = gen.mfr === 'Kohler';
                    return (
                      <div key={gen.id}
                        className={'bcard' + (isDragging ? ' dragging' : '')}
                        draggable
                        onDragStart={e => { setDragId(gen.id); e.dataTransfer.setData('genId', gen.id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { setDragId(null); setOverCol(null); }}
                        onClick={() => setDetail(gen)}
                        style={{ borderLeft:`3px solid ${phase.color}` }}>

                        {/* Advance button */}
                        <div className="bcard-adv">
                          {phase.key !== 'complete' && (
                            <button onClick={e=>{ e.stopPropagation(); advancePhase(gen.id); }}
                              title={`Move to ${PHASES[PHASES.findIndex(p=>p.key===phase.key)+1]?.label}`}
                              style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:6, border:'none',
                                background:'var(--amber)', color:'#11192a', cursor:'pointer' }}>
                              → {PHASES[PHASES.findIndex(p=>p.key===phase.key)+1]?.label}
                            </button>
                          )}
                        </div>

                        <div className="bcard-name">{gen.customer}</div>

                        {/* Brand chip */}
                        <div className="bcard-meta1" style={{ marginBottom:6 }}>
                          <span style={{ fontSize:10.5, fontWeight:800, padding:'2px 7px', borderRadius:5,
                            textTransform:'uppercase', letterSpacing:'.04em',
                            background:isKohler?'var(--blue-soft)':'var(--amber-soft)',
                            color:isKohler?'var(--blue)':'var(--amber)',
                            display:'inline-flex', alignItems:'center', gap:4 }}>
                            <Icon name="bolt" size={10} stroke={2}/>{gen.mfr}
                          </span>
                          <span style={{ color:'var(--text3)', fontSize:11.5 }}>{gen.model}</span>
                        </div>

                        <div className="bcard-loc">
                          <Icon name="pin" size={11} stroke={1.8}/>{gen.loc}
                        </div>

                        <div className="bcard-foot">
                          <span className="bcard-amt num">{money(gen.amount)}</span>
                          <span style={{ fontSize:10.5, fontWeight:800, padding:'2px 8px', borderRadius:5,
                            background:'var(--green-soft)', color:'var(--green)',
                            textTransform:'uppercase', letterSpacing:'.04em' }}>Awarded</span>
                        </div>

                        <div className="bcard-row">
                          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="bolt" size={11} stroke={1.8}/>{gen.kw}kW
                            <span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4,
                              background:'var(--green-soft)', color:'var(--green)', marginLeft:4 }}>Active</span>
                          </span>
                          <span style={{ fontSize:11.5, fontWeight:700, color:'var(--text3)' }}>
                            {gen.salesperson_name.split(' ').map(n=>n[0]).join('')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail side panel */}
      {detail && (
        <div style={{ position:'fixed', right:0, top:0, bottom:0, width:340, background:'var(--panel)',
          borderLeft:'1px solid var(--border)', zIndex:200, overflowY:'auto', boxShadow:'-8px 0 32px rgba(0,0,0,.25)' }}
          onClick={e=>e.stopPropagation()}>
          <div style={{ padding:'20px 22px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:800, color:'var(--text)', marginBottom:4 }}>{detail.customer}</div>
                <div style={{ fontSize:12.5, color:'var(--text3)', fontWeight:600, display:'flex', alignItems:'center', gap:5 }}>
                  <Icon name="pin" size={12} stroke={1.8}/>{detail.loc}
                </div>
              </div>
              <button onClick={()=>setDetail(null)} style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text3)', padding:4 }}>
                <Icon name="x" size={18} stroke={2}/>
              </button>
            </div>

            {/* Brand + model */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:18 }}>
              <span style={{ fontSize:11, fontWeight:800, padding:'3px 10px', borderRadius:6,
                textTransform:'uppercase', letterSpacing:'.04em',
                background:detail.mfr==='Kohler'?'var(--blue-soft)':'var(--amber-soft)',
                color:detail.mfr==='Kohler'?'var(--blue)':'var(--amber)',
                display:'inline-flex', alignItems:'center', gap:5 }}>
                <Icon name="bolt" size={11} stroke={2}/>{detail.mfr}
              </span>
              <span style={{ fontSize:13, fontWeight:700, color:'var(--text2)' }}>{detail.model} · {detail.kw}kW</span>
            </div>

            {/* Info rows */}
            {[
              ['Contract Value', moneyFull(detail.amount)],
              ['Tax',            moneyFull(detail.tax)],
              ['Add-ons',        `${detail.addons} included`],
              ['Salesperson',    detail.salesperson_name],
            ].map(([k,v]) => (
              <div key={k} style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>{k}</div>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{v}</div>
              </div>
            ))}

            {/* Phase selector */}
            <div style={{ marginTop:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:10 }}>Set Phase</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {PHASES.map(p => {
                  const active = (phases[detail.id]??'deposit') === p.key;
                  return (
                    <button key={p.key} onClick={() => movePhase(detail.id, p.key)}
                      style={{ fontSize:12.5, fontWeight:700, padding:'8px 14px', borderRadius:8, border:'none',
                        cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8,
                        background:active?p.color+'22':'var(--surface2)',
                        color:active?p.color:'var(--text2)' }}>
                      <span style={{ width:8, height:8, borderRadius:'50%', background:active?p.color:'var(--border2)', display:'inline-block', flexShrink:0 }}/>
                      {p.label}
                      {active && <Icon name="check" size={12} stroke={2.5} style={{ marginLeft:'auto' }}/>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {detail && <div style={{ position:'fixed', inset:0, zIndex:199 }} onClick={()=>setDetail(null)}/>}
    </div>
  );
}
