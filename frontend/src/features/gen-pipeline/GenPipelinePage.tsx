import React, { useState, useEffect, useRef, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Gen, WonJob } from '../../types';
import { GEN_STAGES, GenStageKey } from './constants';
import { useGenPipeline } from './useGenPipeline';
import GenDetailDrawer from './GenDetailDrawer';
import LogGenJobModal from './LogGenJobModal';
import CalendarEventPickerModal from './CalendarEventPickerModal';
import api from '../../api/client';
import { moneyShort as money } from '../../lib/money';
import PipelineBoard from '../../components/PipelineBoard';
import { useShowToast } from '../../contexts/AppContext';

function fmtVisit(ts?: string | null) {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Sibling proposals (same customer, alternate size/brand options created via
// Duplicate) share a group_id and are bundled into one board card. The card
// takes on the "leading" sibling's stage/amount — the awarded one once any
// is awarded, otherwise the furthest-along still-open option — so dragging
// or reading the card reflects where the group actually stands.
const GROUP_STAGE_RANK: Record<string, number> = { awarded: 4, signed: 3, sent: 2, building: 1, declined: 0 };

interface GenGroup { primary: Gen; siblings: Gen[] }

function groupGens(gens: Gen[]): GenGroup[] {
  const byGroup = new Map<string, Gen[]>();
  const groups: GenGroup[] = [];
  for (const g of gens) {
    if (!g.group_id) { groups.push({ primary: g, siblings: [] }); continue; }
    if (!byGroup.has(g.group_id)) byGroup.set(g.group_id, []);
    byGroup.get(g.group_id)!.push(g);
  }
  for (const members of byGroup.values()) {
    // Superseded options never lead a card — they're only shown nested under
    // the sibling that got awarded.
    const candidates = members.filter(m => m.stage !== 'superseded');
    const pool = candidates.length ? candidates : members;
    const primary = pool.reduce((best, m) => {
      const mRank = GROUP_STAGE_RANK[m.stage] ?? -1;
      const bRank = GROUP_STAGE_RANK[best.stage] ?? -1;
      if (mRank !== bRank) return mRank > bRank ? m : best;
      return (m.updated_at || '') > (best.updated_at || '') ? m : best;
    }, pool[0]);
    groups.push({ primary, siblings: members.filter(m => m.id !== primary.id) });
  }
  return groups;
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
  const [logOpen, setLogOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [autoKickoff, setAutoKickoff] = useState(false);

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
    onAwarded: gen => { setDetail(gen); setAutoKickoff(true); },
  });

  const sum = (list: Gen[]) => list.reduce((s, g) => s + Number(g.amount), 0);
  const activeCount = gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed').length;
  const activeValue = sum(gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed'));

  const genGroups = useMemo(() => groupGens(gens), [gens]);

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

  const handleDuplicate = async (gen: Gen) => {
    try {
      const { data } = await api.post<Gen>(`/gens/${gen.id}/duplicate`);
      setGens(prev => [data, ...prev]);
      setDetail(null);
      showToast({ title: 'Proposal duplicated', sub: `New draft for ${data.customer}` });
      // Drop straight into the builder so the rep can tweak the new option.
      onEditGen(data);
    } catch {
      showToast({ title: 'Duplicate failed', sub: 'Please try again' });
    }
  };

  const handleLinkGroup = async (gen: Gen, targetId: string) => {
    try {
      const { data } = await api.post<{ updated: Gen[]; superseded: Gen[] }>(`/gens/${gen.id}/link-group`, { targetId });
      setGens(prev => prev.map(g => data.updated.find(u => u.id === g.id) ?? g));
      setDetail(prev => (prev && data.updated.find(u => u.id === prev.id)) || prev);
      showToast({
        title: 'Linked as alternate option',
        sub: data.superseded.length
          ? `${data.superseded.length} other option${data.superseded.length > 1 ? 's' : ''} superseded — the group already has a winner`
          : 'Awarding one will now supersede the other instead of counting it as a loss',
      });
    } catch {
      showToast({ title: 'Link failed', sub: 'Please try again' });
    }
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
    if (g.stage === 'superseded') return <span className="badge" style={{ background: 'rgba(124,138,163,.15)', color: 'var(--text3)' }}>Not selected</span>;
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
        <button className="btn ghost" style={{ fontSize: 13, marginRight: 8 }} onClick={() => setLogOpen(true)}>
          <Icon name="doc" size={15} stroke={2.2}/>Log Existing Job
        </button>
        <button className="btn ghost" style={{ fontSize: 13, marginRight: 8 }} onClick={() => setCalendarOpen(true)}>
          <Icon name="clock" size={15} stroke={2.2}/>From Calendar
        </button>
        <button className="btn amber" style={{ fontSize: 13 }} onClick={onOpenBuilder}>
          <Icon name="plus" size={15} stroke={2.4}/>New Proposal
        </button>
      </div>

      {/* Board */}
      <PipelineBoard<GenGroup>
        stages={GEN_STAGES}
        items={genGroups}
        getId={x => x.primary.id}
        getStage={x => x.primary.stage === 'superseded' ? 'declined' : x.primary.stage}
        getAmount={x => Number(x.primary.amount)}
        flashId={flashId}
        onMoveToStage={(id, stageKey) => moveToStage(id, stageKey as GenStageKey)}
        onOpenDetail={x => setDetail(x.primary)}
        renderEmptyAction={stageKey => stageKey === 'building'
          ? <button className="btn ghost" style={{ fontSize: 12, height: 32, padding: '0 12px' }} onClick={onOpenBuilder}>
              <Icon name="plus" size={14} stroke={2.2}/>New Proposal
            </button>
          : null}
        renderCard={({ primary: g, siblings }) => {
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

              {siblings.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)' }}>
                    {siblings.length} other option{siblings.length > 1 ? 's' : ''} for this customer
                  </div>
                  {siblings.map(s => (
                    <div
                      key={s.id}
                      onClick={e => { e.stopPropagation(); setDetail(s); }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' }}
                    >
                      <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{s.kw}kW · {money(Number(s.amount))}</span>
                      {genBadge(s)}
                    </div>
                  ))}
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
          key={detail.id}
          gen={gens.find(g => g.id === detail.id) || detail}
          groupSiblings={gens.filter(g => g.id !== detail.id && !!g.group_id && g.group_id === detail.group_id)}
          linkCandidates={gens.filter(g =>
            g.id !== detail.id &&
            g.customer === detail.customer &&
            !(g.group_id && detail.group_id && g.group_id === detail.group_id)
          )}
          onLink={targetId => handleLinkGroup(gens.find(g => g.id === detail.id) || detail, targetId)}
          pendingDeclined={pendingDeclined === detail.id}
          onStage={handleStageFromDrawer}
          onCancelDeclined={cancelDeclined}
          onClose={() => { setDetail(null); setAutoKickoff(false); }}
          onEditGen={g => { setDetail(null); onEditGen(g); }}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onClosed={handleClosed}
          onUpdated={(g, wj) => { setGens(prev => prev.map(x => x.id === g.id ? g : x)); setDetail(g); if (wj) setWonJobs(prev => prev.map(w => w.proposal_id === g.id ? wj : w)); }}
          autoKickoff={autoKickoff}
          onAutoKickoffHandled={() => setAutoKickoff(false)}
        />
      )}

      {logOpen && (
        <LogGenJobModal
          onClose={() => setLogOpen(false)}
          onAdded={(gen, wonJob) => {
            setGens(prev => [gen, ...prev]);
            if (wonJob) setWonJobs(prev => [wonJob, ...prev]);
            setLogOpen(false);
            showToast({ title: 'Job logged', sub: `${gen.customer} added to the ${gen.stage} column.` });
          }}
        />
      )}

      {calendarOpen && (
        <CalendarEventPickerModal
          onClose={() => setCalendarOpen(false)}
          onCreated={gen => {
            setGens(prev => [gen, ...prev]);
            setCalendarOpen(false);
            showToast({ title: 'Proposal created from calendar', sub: `Review the pre-filled details for ${gen.customer}` });
            onEditGen(gen);
          }}
        />
      )}
    </div>
  );
}
