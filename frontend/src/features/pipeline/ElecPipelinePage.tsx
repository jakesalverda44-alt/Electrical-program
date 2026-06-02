import React, { useState } from 'react';
import Icon from '../../components/Icon';
import { Bid, WonJob, Toast } from '../../types';
import { ELEC_STAGES, ElecStageKey } from './constants';
import { usePipeline } from './usePipeline';
import DetailDrawer from './DetailDrawer';
import AddBidModal from './AddBidModal';

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + n;
}

type Filter = 'all' | 'urgent' | 'large';

interface Props {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  showToast: (t: Toast) => void;
  onOpenPreconstruction: (id: string) => void;
  flashId: string | null;
}

export default function ElecPipelinePage({ bids, setBids, setWonJobs, showToast, onOpenPreconstruction, flashId }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<Bid | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const { moveToStage, advance, pendingLost, cancelLost } = usePipeline({
    bids, setBids, setWonJobs, showToast,
  });

  const sum = (list: Bid[]) => list.reduce((s, b) => s + Number(b.amount), 0);
  const activeCount = bids.filter(b => b.stage !== 'awarded' && b.stage !== 'lost').length;
  const activeValue = sum(bids.filter(b => b.stage === 'due' || b.stage === 'submitted'));

  const applyFilter = (list: Bid[]): Bid[] => {
    if (filter === 'urgent') return list.filter(b => b.due_days <= 7);
    if (filter === 'large')  return list.filter(b => Number(b.amount) >= 500_000);
    return list;
  };

  // Drag handlers
  const onDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  };
  const onDrop = (e: React.DragEvent, stageKey: ElecStageKey) => {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    if (id) moveToStage(id, stageKey);
    setDragId(null);
    setOverCol(null);
  };

  const handleStageFromDrawer = (stage: ElecStageKey) => {
    if (!detail) return;
    moveToStage(detail.id, stage);
    // Keep drawer open but update local state optimistically
    setDetail(prev => prev ? { ...prev, stage } : prev);
  };

  const handleAdded = (bid: Bid) => {
    setBids(prev => [bid, ...prev]);
    showToast({ title: 'Bid added to pipeline', sub: bid.name });
    setShowAdd(false);
  };

  const dueBadge = (b: Bid) => {
    if (b.stage === 'submitted') return <span className="badge normal">Submitted</span>;
    if (b.stage === 'awarded')   return <span className="badge won"><Icon name="check" size={11} stroke={2.4}/>Won</span>;
    if (b.stage === 'lost')      return <span className="badge lost">Lost</span>;
    const u = b.due_days <= 3 ? 'critical' : b.due_days <= 7 ? 'urgent' : 'normal';
    return <span className={'badge ' + u}><Icon name="clock" size={11} stroke={2}/>Due {b.due}</span>;
  };

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2);

  return (
    <div className="scroll view-enter">
      {/* Toolbar */}
      <div className="pipe-toolbar">
        <button className={'chip' + (filter === 'all'    ? ' active' : '')} onClick={() => setFilter('all')}>All</button>
        <button className={'chip' + (filter === 'urgent' ? ' active' : '')} onClick={() => setFilter('urgent')}>Due ≤ 7d</button>
        <button className={'chip' + (filter === 'large'  ? ' active' : '')} onClick={() => setFilter('large')}>&gt; $500K</button>
        <span className="spacer"/>
        <span className="pipe-summary">
          Active value <b>{money(activeValue)}</b> · {activeCount} open
        </span>
      </div>

      {/* Board */}
      <div className="board" style={{ gridTemplateColumns: `repeat(${ELEC_STAGES.length}, 1fr)` }}>
        {ELEC_STAGES.map(st => {
          const allInCol = bids.filter(b => b.stage === st.key);
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
                {/* Empty state */}
                {allInCol.length === 0 && (
                  <div className="col-empty">
                    {st.key === 'due'
                      ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={() => setShowAdd(true)}>
                          <Icon name="plus" size={14} stroke={2.2}/>New Bid
                        </button>
                      : isOver ? 'Drop here' : 'Drag a card here'
                    }
                  </div>
                )}

                {/* Filter empty state */}
                {allInCol.length > 0 && visible.length === 0 && (
                  <div className="col-empty" style={{ color: 'var(--text3)', fontSize: 12 }}>
                    No matches for this filter
                  </div>
                )}

                {visible.map(b => {
                  const next = ELEC_STAGES.find(s => {
                    const idx = ELEC_STAGES.findIndex(x => x.key === b.stage);
                    return ELEC_STAGES.indexOf(s) === idx + 1 && s.key !== 'lost';
                  });
                  const isPendingLost = pendingLost === b.id;

                  return (
                    <div
                      key={b.id}
                      className={'bcard' + (flashId === b.id ? ' flash' : '') + (dragId === b.id ? ' dragging' : '')}
                      draggable
                      onDragStart={e => onDragStart(e, b.id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      onClick={() => setDetail(b)}
                    >
                      <span className="bcard-accent" style={{ background: st.color }}/>

                      {/* Advance button */}
                      {next && (
                        <div className="bcard-adv">
                          <button
                            className="adv-btn"
                            title={`Move to ${next.label}`}
                            onClick={e => { e.stopPropagation(); advance(b.id); }}
                          >
                            <Icon name="arrow" size={15} stroke={2.2}/>
                          </button>
                        </div>
                      )}

                      <div className="bcard-name">{b.name}</div>

                      <div className="bcard-meta1">
                        <Icon name="building" size={13} stroke={1.8}/>{b.gc}
                      </div>
                      <div className="bcard-loc">
                        <Icon name="pin" size={12} stroke={1.8}/>{b.loc}
                      </div>
                      <div className="bcard-foot">
                        <span className="bcard-amt num">{money(Number(b.amount))}</span>
                        {dueBadge(b)}
                      </div>
                      <div className="bcard-row">
                        <span><Icon name="clip" size={12} stroke={1.8}/>{b.sheets} sheets</span>
                        <span className="bcard-rep" title={b.salesperson_name}>
                          <span className="avatar" style={{ width: 20, height: 20, fontSize: 9, flexShrink: 0 }}>
                            {initials(b.salesperson_name || '?')}
                          </span>
                          {b.salesperson_name?.split(' ')[0]}
                        </span>
                      </div>

                      {/* Lost confirmation inline on card */}
                      {isPendingLost && (
                        <div className="lost-confirm" onClick={e => e.stopPropagation()}>
                          <span>Mark as lost?</span>
                          <button className="btn ghost" style={{ height: 24, fontSize: 11, padding: '0 8px' }} onClick={cancelLost}>No</button>
                          <button className="btn" style={{ height: 24, fontSize: 11, padding: '0 8px', background: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={() => moveToStage(b.id, 'lost')}>Yes, lost</button>
                        </div>
                      )}

                      {/* Preconstruction shortcut */}
                      {b.stage !== 'awarded' && b.stage !== 'lost' && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                          <button
                            className="btn ghost"
                            style={{ height: 28, fontSize: 11, padding: '0 10px', width: '100%', justifyContent: 'center', color: 'var(--blue)' }}
                            onClick={e => { e.stopPropagation(); onOpenPreconstruction(b.id); }}
                          >
                            <Icon name="sparkle" size={12} stroke={2}/>Open in Preconstruction
                          </button>
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

      {/* Detail drawer */}
      {detail && (
        <DetailDrawer
          bid={bids.find(b => b.id === detail.id) || detail}
          pendingLost={pendingLost === detail.id}
          onStage={handleStageFromDrawer}
          onCancelLost={cancelLost}
          onClose={() => setDetail(null)}
          onOpenPreconstruction={id => { setDetail(null); onOpenPreconstruction(id); }}
        />
      )}

      {/* Add bid modal */}
      {showAdd && (
        <AddBidModal
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
