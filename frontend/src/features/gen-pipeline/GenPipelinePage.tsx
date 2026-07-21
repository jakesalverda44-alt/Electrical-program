import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../components/Icon';
import { Gen, WonJob } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import { useGenPipeline } from './useGenPipeline';
import GenDetailDrawer from './GenDetailDrawer';
import api from '../../api/client';
import { moneyShort as money } from '../../lib/money';
import PipelineBoard from '../../components/PipelineBoard';
import { useShowToast } from '../../contexts/AppContext';

function fmtVisit(ts?: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface Props {
  gens: Gen[];
  setGens: (fn: (prev: Gen[]) => Gen[]) => void;
  setWonJobs: (fn: (prev: WonJob[]) => WonJob[]) => void;
  onOpenBuilder: () => void;
  flashId: string | null;
  onEditGen: (gen: import('../../types').Gen) => void;
  // Deep-link record id (from global search): opens that proposal's drawer.
  openId?: string | null;
  onClearParam?: () => void;
  onNav?: (v: string) => void;
}

export default function GenPipelinePage({ gens, setGens, setWonJobs, onOpenBuilder, flashId, onEditGen, openId, onClearParam, onNav }: Props) {
  const showToast = useShowToast();
  const [detail, setDetail] = useState<Gen | null>(null);

  // Open the deep-linked proposal's drawer once, then strip the id from the URL.
  const openedParam = useRef<string | null>(null);
  useEffect(() => {
    if (!openId) { openedParam.current = null; return; }
    if (openedParam.current === openId) return;
    const match = gens.find(g => g.id === openId);
    if (match) {
      openedParam.current = openId;
      setDetail(match);
      onClearParam?.();
    }
  }, [openId, gens, onClearParam]);

  const { moveToStage, advance, pendingDeclined, cancelDeclined } = useGenPipeline({
    gens, setGens, setWonJobs, showToast, onNav,
  });

  const sum = (list: Gen[]) => list.reduce((s, g) => s + Number(g.amount), 0);
  const activeCount = gens.filter(g => g.stage !== 'awarded' && g.stage !== 'declined').length;
  const activeValue = sum(gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed'));

  const handleStageFromDrawer = (stage: GenStageKey) => {
    if (!detail) return;
    moveToStage(detail.id, stage);
    setDetail(prev => prev ? { ...prev, stage } : prev);
  };

  const handleClosed = (gen: Gen) => {
    setGens(prev => prev.filter(g => g.id !== gen.id));
    setDetail(null);
    showToast({ title: 'Generator job closed', sub: gen.customer });
  };

  const handleDelete = async (gen: Gen) => {
    if (!window.confirm(`Delete "${gen.customer}" and its linked project/files/testing data? This cannot be undone.`)) return;
    try {
      await api.delete(`/gens/${gen.id}`);
      setGens(prev => prev.filter(g => g.id !== gen.id));
      setWonJobs(prev => prev.filter(w => w.proposal_id !== gen.id));
      setDetail(null);
      showToast({ title: 'Generator proposal deleted', sub: gen.customer });
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 403) {
        showToast({ title: 'Admin only', sub: 'Only an owner or administrator can delete proposals' });
      } else {
        showToast({ title: 'Delete failed', sub: 'Please try again' });
      }
    }
  };

  const daysSince = (ts?: string) => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : 0;

  const genBadge = (g: Gen) => {
    if (g.stage === 'building') return <span className="badge urgent">Building</span>;
    if (g.stage === 'sent') {
      const age = daysSince(g.sent_at);
      if (age >= 30) return (
        <span className="badge" style={{ background: 'var(--orange-soft)', color: 'var(--orange)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={11} stroke={2}/>Stale · {age}d
        </span>
      );
      return <span className="badge normal"><Icon name="arrow" size={11} stroke={2.2}/>Sent</span>;
    }
    if (g.stage === 'signed')  return <span className="badge" style={{ background: 'rgba(139,92,246,.15)', color: '#8B5CF6' }}><Icon name="check" size={11} stroke={2.2}/>Signed</span>;
    if (g.stage === 'awarded') return <span className="badge won"><Icon name="check" size={11} stroke={2.4}/>Awarded</span>;
    return <span className="badge lost">Declined</span>;
  };

  const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2);

  return (
    <div className="scroll view-enter">
      {/* Toolbar */}
      <div className="pipe-toolbar">
        <span className="spacer"/>
        <span className="pipe-summary">
          Active value <b>{money(activeValue)}</b> · {activeCount} open
        </span>
        <button className="btn amber" style={{ fontSize: 13 }} onClick={onOpenBuilder}>
          <Icon name="plus" size={15} stroke={2.4}/>New Proposal
        </button>
      </div>

      {/* Board */}
      <PipelineBoard<Gen>
        stages={GEN_STAGES}
        items={gens}
        getId={g => g.id}
        getStage={g => g.stage}
        getAmount={g => Number(g.amount)}
        flashId={flashId}
        onMoveToStage={(id, stageKey) => moveToStage(id, stageKey as GenStageKey)}
        onOpenDetail={g => setDetail(g)}
        renderEmptyAction={stageKey => stageKey === 'building'
          ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={onOpenBuilder}>
              <Icon name="plus" size={14} stroke={2.2}/>New Proposal
            </button>
          : null}
        renderCard={g => {
          const ORDER: GenStageKey[] = ['building', 'sent', 'signed', 'awarded'];
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

              {(g.site_visit_at || g.site_visit_needs_time) && (
                <div className="bcard-row" style={{ marginTop: 4 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700,
                    color: g.site_visit_at ? 'var(--text2)' : 'var(--amber)',
                  }}>
                    <Icon name="clock" size={12} stroke={1.9}/>
                    {g.site_visit_at ? `Visit ${fmtVisit(g.site_visit_at)}` : 'Visit · needs time'}
                  </span>
                </div>
              )}

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
          onClosed={handleClosed}
          onUpdated={(g, wj) => { setGens(prev => prev.map(x => x.id === g.id ? g : x)); setDetail(g); if (wj) setWonJobs(prev => prev.map(w => w.proposal_id === g.id ? wj : w)); }}
        />
      )}
    </div>
  );
}
