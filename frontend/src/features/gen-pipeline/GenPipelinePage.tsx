import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Gen, WonJob, Toast } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import { useGenPipeline } from './useGenPipeline';
import GenDetailDrawer from './GenDetailDrawer';

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + n;
}

type Filter = 'all' | 'large';

interface Props {
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
  onOpenBuilder: () => void;
  flashId: string | null;
  onEditGen: (gen: import('../../types').Gen) => void;
  onNav?: (v: string) => void;
}

export default function GenPipelinePage({ gens, setGens, setWonJobs, showToast, onOpenBuilder, flashId, onEditGen, onNav }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Gen | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [filterRep, setFilterRep] = useState<string>('all');
  const repNames = useMemo(() => Array.from(new Set(gens.map(g => g.salesperson_name).filter(Boolean))).sort(), [gens]);

  const { moveToStage, advance, pendingDeclined, cancelDeclined } = useGenPipeline({
    gens, setGens, setWonJobs, showToast, onNav,
  });

  const sum = (list: Gen[]) => list.reduce((s, g) => s + Number(g.amount), 0);
  const activeCount = gens.filter(g => g.stage !== 'awarded' && g.stage !== 'declined').length;
  const activeValue = sum(gens.filter(g => g.stage === 'building' || g.stage === 'sent'));

  const applyFilter = (list: Gen[]): Gen[] => {
    let r = list;
    if (filter === 'large') r = r.filter(g => Number(g.amount) >= 100_000);
    if (filterRep !== 'all') r = r.filter(g => g.salesperson_name === filterRep);
    return r;
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  };
  const onDrop = (e: React.DragEvent, stageKey: GenStageKey) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    if (id) moveToStage(id, stageKey);
    setDragId(null);
    setOverCol(null);
  };

  const handleStageFromDrawer = (stage: GenStageKey) => {
    if (!detail) return;
    moveToStage(detail.id, stage);
    setDetail(prev => prev ? { ...prev, stage } : prev);
  };

  const genBadge = (g: Gen) => {
    if (g.stage === 'building') return <span className="badge urgent">Building</span>;
    if (g.stage === 'sent')     return <span className="badge normal"><Icon name="arrow" size={11} stroke={2.2}/>Sent</span>;
    if (g.stage === 'awarded')  return <span className="badge won"><Icon name="check" size={11} stroke={2.4}/>Awarded</span>;
    return <span className="badge lost">Declined</span>;
  };

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2);

  return (
    <div className="scroll view-enter">
      {/* Toolbar */}
      <div className="pipe-toolbar">
        <button className={'chip' + (filter === 'all'   ? ' active' : '')} onClick={() => setFilter('all')}>All</button>
        <button className={'chip' + (filter === 'large' ? ' active' : '')} onClick={() => setFilter('large')}>&gt; $100K</button>
        {repNames.length > 1 && (
          <>
            <div style={{ width:1, height:20, background:'var(--border)', margin:'0 4px' }}/>
            <button className={'chip' + (filterRep === 'all' ? ' active' : '')} onClick={() => setFilterRep('all')}>All Reps</button>
            {repNames.map(r => (
              <button key={r} className={'chip' + (filterRep === r ? ' active' : '')} onClick={() => setFilterRep(r)}>
                {r.split(' ')[0]}
              </button>
            ))}
          </>
        )}
        <span className="spacer"/>
        <span className="pipe-summary">
          Active value <b>{money(activeValue)}</b> · {activeCount} open
        </span>
      </div>

      {/* Board */}
      <div className="board" style={{ gridTemplateColumns: `repeat(${GEN_STAGES.length}, 1fr)` }}>
        {GEN_STAGES.map(st => {
          const allInCol = gens.filter(g => g.stage === st.key);
          const visible  = applyFilter(allInCol);
          const isOver   = overCol === st.key;

          return (
            <div
              key={st.key}
              className={'col' + (isOver ? ' drag-over' : '')}
              onDragOver={e => { e.preventDefault(); if (overCol !== st.key) setOverCol(st.key); }}
              onDragLeave={e => { if (e.currentTarget === e.target) setOverCol(null); }}
              onDrop={e => onDrop(e, st.key)}
            >
              <div className="col-hdr">
                <span className="col-title">
                  <span className="dot" style={{ background: st.color }}/>
                  {st.label}
                  <span className="col-cnt">{allInCol.length}</span>
                </span>
                <span className="col-total num">{money(sum(allInCol))}</span>
              </div>

              <div className="col-body">
                {allInCol.length === 0 && (
                  <div className="col-empty">
                    {st.key === 'building'
                      ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={onOpenBuilder}>
                          <Icon name="plus" size={14} stroke={2.2}/>New Proposal
                        </button>
                      : isOver ? 'Drop here' : 'Drag a card here'
                    }
                  </div>
                )}

                {allInCol.length > 0 && visible.length === 0 && (
                  <div className="col-empty" style={{ color: 'var(--text3)', fontSize: 12 }}>
                    No matches for this filter
                  </div>
                )}

                {visible.map(g => {
                  const ORDER: GenStageKey[] = ['building', 'sent', 'awarded'];
                  const idx = ORDER.indexOf(g.stage as GenStageKey);
                  const hasNext = idx >= 0 && idx < ORDER.length - 1;
                  const isPendingDeclined = pendingDeclined === g.id;

                  return (
                    <div
                      key={g.id}
                      className={'bcard' + (flashId === g.id ? ' flash' : '') + (dragId === g.id ? ' dragging' : '')}
                      draggable
                      onDragStart={e => onDragStart(e, g.id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => setDetail(g)}
                    >
                      <span className="bcard-accent" style={{ background: st.color }}/>

                      {hasNext && (
                        <div className="bcard-adv">
                          <button
                            className="adv-btn amber"
                            title="Advance stage"
                            onClick={e => { e.stopPropagation(); advance(g.id); }}
                          >
                            <Icon name="arrow" size={15} stroke={2.2}/>
                          </button>
                        </div>
                      )}

                      <div className="bcard-name">{g.customer}</div>

                      <div className="bcard-meta1">
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                          textTransform: 'uppercase', letterSpacing: '.04em',
                          background: g.mfr === 'Kohler' ? 'var(--blue-soft)' : 'var(--amber-soft)',
                          color: g.mfr === 'Kohler' ? 'var(--blue)' : 'var(--amber)',
                        }}>
                          <Icon name="bolt" size={11} stroke={2}/>{g.mfr}
                        </span>
                        <span style={{ color: 'var(--text3)', fontWeight: 600 }}>{g.model}</span>
                      </div>

                      <div className="bcard-loc">
                        <Icon name="pin" size={12} stroke={1.8}/>{g.loc}
                      </div>

                      <div className="bcard-foot">
                        <span className="bcard-amt num">{money(Number(g.amount))}</span>
                        {genBadge(g)}
                      </div>

                      <div className="bcard-row">
                        <span>{g.kw}kW · {g.addons} add-ons</span>
                        <span className="bcard-rep" title={g.salesperson_name}>
                          <span className="avatar" style={{ width: 20, height: 20, fontSize: 9, flexShrink: 0 }}>
                            {initials(g.salesperson_name || '?')}
                          </span>
                          {g.salesperson_name?.split(' ')[0]}
                        </span>
                      </div>

                      {isPendingDeclined && (
                        <div className="lost-confirm" onClick={e => e.stopPropagation()}>
                          <span>Mark as declined?</span>
                          <button className="btn ghost" style={{ height: 24, fontSize: 11, padding: '0 8px' }} onClick={cancelDeclined}>No</button>
                          <button className="btn" style={{ height: 24, fontSize: 11, padding: '0 8px', background: 'var(--slate)', borderColor: 'var(--slate)' }}
                            onClick={() => moveToStage(g.id, 'declined')}>Yes</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <GenDetailDrawer
          gen={gens.find(g => g.id === detail.id) || detail}
          pendingDeclined={pendingDeclined === detail.id}
          onStage={handleStageFromDrawer}
          onCancelDeclined={cancelDeclined}
          onClose={() => setDetail(null)}
          onEditGen={g => { setDetail(null); onEditGen(g); }}
        />
      )}
    </div>
  );
}
