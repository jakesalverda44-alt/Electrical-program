import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Gen, WonJob, Toast } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import { useGenPipeline } from './useGenPipeline';
import GenDetailDrawer from './GenDetailDrawer';
import api from '../../api/client';
import { moneyShort as money } from '../../lib/money';
import PipelineBoard from '../../components/PipelineBoard';

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

  const handleStageFromDrawer = (stage: GenStageKey) => {
    if (!detail) return;
    moveToStage(detail.id, stage);
    setDetail(prev => prev ? { ...prev, stage } : prev);
  };

  const handleDelete = async (gen: Gen) => {
    if (!window.confirm(`Delete "${gen.customer}" and its linked project/files/testing data? This cannot be undone.`)) return;
    try {
      await api.delete(`/gens/${gen.id}`);
      setGens(prev => prev.filter(g => g.id !== gen.id));
      setWonJobs(prev => prev.filter(w => w.proposal_id !== gen.id));
      setDetail(null);
      showToast({ title: 'Generator proposal deleted', sub: gen.customer });
    } catch {
      showToast({ title: 'Delete failed', sub: 'Please try again' });
    }
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
      <PipelineBoard<Gen>
        stages={GEN_STAGES}
        items={gens}
        getId={g => g.id}
        getStage={g => g.stage}
        getAmount={g => Number(g.amount)}
        applyFilter={applyFilter}
        flashId={flashId}
        onMoveToStage={(id, stageKey) => moveToStage(id, stageKey as GenStageKey)}
        onOpenDetail={g => setDetail(g)}
        renderEmptyAction={stageKey => stageKey === 'building'
          ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={onOpenBuilder}>
              <Icon name="plus" size={14} stroke={2.2}/>New Proposal
            </button>
          : null}
        renderCard={g => {
          const ORDER: GenStageKey[] = ['building', 'sent', 'awarded'];
          const idx = ORDER.indexOf(g.stage as GenStageKey);
          const hasNext = idx >= 0 && idx < ORDER.length - 1;
          const isPendingDeclined = pendingDeclined === g.id;

          return (
            <>
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
            </>
          );
        }}
      />

      {detail && (
        <GenDetailDrawer
          gen={gens.find(g => g.id === detail.id) || detail}
          pendingDeclined={pendingDeclined === detail.id}
          onStage={handleStageFromDrawer}
          onCancelDeclined={cancelDeclined}
          onClose={() => setDetail(null)}
          onEditGen={g => { setDetail(null); onEditGen(g); }}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
