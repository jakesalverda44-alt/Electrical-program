import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../../components/Icon';
import { Bid, WonJob } from '../../types';
import { ELEC_STAGES, ElecStageKey } from './constants';
import { usePipeline } from './usePipeline';
import DetailDrawer from './DetailDrawer';
import AddBidModal from './AddBidModal';
import api from '../../api/client';
import { moneyShort as money } from '../../lib/money';
import PipelineBoard from '../../components/PipelineBoard';
import { useShowToast } from '../../contexts/AppContext';

type Filter = 'all' | 'urgent' | 'large';

interface Props {
  bids: Bid[];
  setBids: (fn: (prev: Bid[]) => Bid[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  onOpenPreconstruction: (id: string) => void;
  flashId: string | null;
  openAddBid?: boolean;
  onAddBidHandled?: () => void;
  initialGc?: string;
}

export default function ElecPipelinePage({ bids, setBids, setWonJobs, onOpenPreconstruction, flashId, openAddBid, onAddBidHandled, initialGc }: Props) {
  const showToast = useShowToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [filterRep, setFilterRep] = useState<string>('all');
  const repNames = useMemo(() => Array.from(new Set(bids.map(b => b.salesperson_name).filter(Boolean))).sort(), [bids]);
  const [detail, setDetail] = useState<Bid | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addGc, setAddGc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (openAddBid) { setAddGc(initialGc); setShowAdd(true); onAddBidHandled?.(); }
  }, [openAddBid]);

  const { moveToStage, advance, pendingLost, cancelLost } = usePipeline({
    bids, setBids, setWonJobs, showToast,
  });

  const sum = (list: Bid[]) => list.reduce((s, b) => s + Number(b.amount), 0);
  const activeCount = bids.filter(b => b.stage !== 'awarded' && b.stage !== 'lost').length;
  const activeValue = sum(bids.filter(b => b.stage === 'due' || b.stage === 'submitted'));

  const applyFilter = (list: Bid[]): Bid[] => {
    let r = list;
    if (filter === 'urgent') r = r.filter(b => b.due_days <= 7);
    if (filter === 'large')  r = r.filter(b => Number(b.amount) >= 500_000);
    if (filterRep !== 'all') r = r.filter(b => b.salesperson_name === filterRep);
    return r;
  };

  const handleStageFromDrawer = (stage: ElecStageKey, extra?: { loss_reason?: string; competitor?: string }) => {
    if (!detail) return;
    moveToStage(detail.id, stage, extra);
    setDetail(prev => prev ? { ...prev, stage, ...(stage === 'lost' ? extra : { loss_reason: undefined, competitor: undefined }) } : prev);
  };

  const handleBidEdited = (updated: Bid) => {
    setBids(prev => prev.map(b => b.id === updated.id ? updated : b));
    setDetail(updated);
  };

  const handleDelete = async (bid: Bid) => {
    if (!window.confirm(`Delete "${bid.name}" and its linked project/files/testing data? This cannot be undone.`)) return;
    try {
      await api.delete(`/bids/${bid.id}`);
      setBids(prev => prev.filter(b => b.id !== bid.id));
      setWonJobs(prev => prev.filter(w => w.proposal_id !== bid.id));
      setDetail(null);
      showToast({ title: 'Bid deleted', sub: bid.name });
    } catch {
      showToast({ title: 'Delete failed', sub: 'Please try again' });
    }
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
      <PipelineBoard<Bid>
        stages={ELEC_STAGES}
        items={bids}
        getId={b => b.id}
        getStage={b => b.stage}
        getAmount={b => Number(b.amount)}
        applyFilter={applyFilter}
        flashId={flashId}
        onMoveToStage={(id, stageKey) => moveToStage(id, stageKey as ElecStageKey)}
        onOpenDetail={b => setDetail(b)}
        renderEmptyAction={stageKey => stageKey === 'due'
          ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={() => setShowAdd(true)}>
              <Icon name="plus" size={14} stroke={2.2}/>New Bid
            </button>
          : null}
        renderCard={b => {
          const next = ELEC_STAGES.find(s => {
            const idx = ELEC_STAGES.findIndex(x => x.key === b.stage);
            return ELEC_STAGES.indexOf(s) === idx + 1 && s.key !== 'lost';
          });
          const isPendingLost = pendingLost === b.id;

          return (
            <>
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
            </>
          );
        }}
      />

      {/* Detail drawer */}
      {detail && (
        <DetailDrawer
          bid={bids.find(b => b.id === detail.id) || detail}
          pendingLost={pendingLost === detail.id}
          onStage={handleStageFromDrawer}
          onCancelLost={cancelLost}
          onClose={() => setDetail(null)}
          onOpenPreconstruction={id => { setDetail(null); onOpenPreconstruction(id); }}
          onBidEdited={handleBidEdited}
          onDelete={handleDelete}
        />
      )}

      {/* Add bid modal */}
      {showAdd && (
        <AddBidModal
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
          initialGc={addGc}
        />
      )}
    </div>
  );
}
