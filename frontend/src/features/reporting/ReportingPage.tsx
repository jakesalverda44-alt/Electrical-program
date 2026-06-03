import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, WonJob } from '../../types';

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n);
}
const sumVal = (arr: WonJob[]) => arr.reduce((s, j) => s + Number(j.value), 0);
const sumAmt = (arr: Bid[])    => arr.reduce((s, b) => s + Number(b.amount), 0);
const sumGen = (arr: Gen[])    => arr.reduce((s, g) => s + Number(g.amount), 0);

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
}

type ReportTab = 'pipeline' | 'revenue' | 'winrate' | 'divisions';

export default function ReportingPage({ bids, gens, wonJobs }: Props) {
  const [tab, setTab] = useState<ReportTab>('pipeline');

  const now          = new Date();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();

  // Pipeline health
  const elecActive  = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const elecAwarded = bids.filter(b => b.stage === 'awarded');
  const elecLost    = bids.filter(b => b.stage === 'lost');
  const genActive   = gens.filter(g => g.stage === 'building' || g.stage === 'sent');
  const genAwarded  = gens.filter(g => g.stage === 'awarded');
  const genDeclined = gens.filter(g => g.stage === 'declined');

  const elecWinRate = (elecAwarded.length + elecLost.length) > 0
    ? Math.round(elecAwarded.length / (elecAwarded.length + elecLost.length) * 100) : 0;
  const genWinRate  = (genAwarded.length + genDeclined.length) > 0
    ? Math.round(genAwarded.length / (genAwarded.length + genDeclined.length) * 100) : 0;

  // Monthly revenue for current year
  const months = useMemo(() => MONTH_LABELS.slice(0, currentMonth + 1).map((label, i) => {
    const elec = sumVal(wonJobs.filter(j => {
      const d = new Date(j.date_won);
      return j.proposal_type === 'Electrical' && d.getFullYear() === currentYear && d.getMonth() === i;
    }));
    const gen = sumVal(wonJobs.filter(j => {
      const d = new Date(j.date_won);
      return j.proposal_type === 'Generator' && d.getFullYear() === currentYear && d.getMonth() === i;
    }));
    return { label, elec, gen, total: elec + gen };
  }), [wonJobs, currentMonth, currentYear]);

  const maxMonth = Math.max(1, ...months.map(m => m.total));

  // Win rate by rep
  const salespeople = useMemo(() =>
    Array.from(new Set([...bids.map(b => b.salesperson_name), ...gens.map(g => g.salesperson_name)])).sort(),
    [bids, gens]
  );

  const repStats = useMemo(() => salespeople.map(sp => {
    const myBids = bids.filter(b => b.salesperson_name === sp);
    const myGens  = gens.filter(g => g.salesperson_name === sp);
    const won     = wonJobs.filter(j => j.salesperson_name === sp);
    const closedBids = myBids.filter(b => b.stage === 'awarded' || b.stage === 'lost');
    const closedGens  = myGens.filter(g => g.stage === 'awarded' || g.stage === 'declined');
    const winRate = (closedBids.length + closedGens.length) > 0
      ? Math.round((myBids.filter(b => b.stage === 'awarded').length + myGens.filter(g => g.stage === 'awarded').length) / (closedBids.length + closedGens.length) * 100)
      : 0;
    return {
      sp,
      activeBids: myBids.filter(b => b.stage === 'due' || b.stage === 'submitted').length,
      activeGens: myGens.filter(g => g.stage === 'building' || g.stage === 'sent').length,
      won: won.length,
      wonValue: sumVal(won),
      winRate,
      pipelineValue: sumAmt(myBids.filter(b => b.stage !== 'lost')) + sumGen(myGens.filter(g => g.stage !== 'declined')),
    };
  }), [salespeople, bids, gens, wonJobs]);

  const totalPipeline  = sumAmt(elecActive) + sumGen(genActive);
  const totalAwarded   = sumVal(wonJobs);
  const totalBidsOpen  = elecActive.length + genActive.length;

  const BAR = ({ pct, color }: { pct: number; color: string }) => (
    <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 4 }}/>
    </div>
  );

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        {/* Summary stats */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 20 }}>
          {[
            { label: 'Total Pipeline Value',  val: money(totalPipeline), sub: `${totalBidsOpen} open bids & proposals`, tone: 'blue'  },
            { label: 'Revenue Won YTD',       val: money(totalAwarded),  sub: `${wonJobs.length} jobs`,                  tone: 'green' },
            { label: 'Elec Win Rate',         val: elecWinRate + '%',    sub: `${elecAwarded.length} of ${elecAwarded.length + elecLost.length} closed`, tone: 'amber' },
            { label: 'Gen Win Rate',          val: genWinRate + '%',     sub: `${genAwarded.length} of ${genAwarded.length + genDeclined.length} closed`, tone: 'green' },
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

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 10, padding: 3, marginBottom: 20, width: 'fit-content' }}>
          {([['pipeline','Pipeline Health'],['revenue','Revenue by Month'],['winrate','Win Rate by Rep'],['divisions','Divisions']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700,
              padding: '7px 16px', borderRadius: 8,
              background: tab === id ? 'var(--panel)' : 'transparent',
              color: tab === id ? 'var(--text)' : 'var(--text3)',
            }}>{label}</button>
          ))}
        </div>

        {/* ── Pipeline Health ── */}
        {tab === 'pipeline' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { title: 'Electrical Pipeline', icon: 'pipeline', color: 'var(--blue)', sections: [
                { label: 'Bids Due',    count: bids.filter(b => b.stage === 'due').length,       val: sumAmt(bids.filter(b => b.stage === 'due')),       pct: sumAmt(bids.filter(b => b.stage === 'due'))       / Math.max(1, sumAmt(bids)) },
                { label: 'Submitted',  count: bids.filter(b => b.stage === 'submitted').length,  val: sumAmt(bids.filter(b => b.stage === 'submitted')),  pct: sumAmt(bids.filter(b => b.stage === 'submitted'))  / Math.max(1, sumAmt(bids)) },
                { label: 'Awarded',    count: elecAwarded.length,                                val: sumAmt(elecAwarded),                               pct: sumAmt(elecAwarded)                               / Math.max(1, sumAmt(bids)) },
                { label: 'Lost',       count: elecLost.length,                                   val: sumAmt(elecLost),                                  pct: sumAmt(elecLost)                                  / Math.max(1, sumAmt(bids)) },
              ]},
              { title: 'Generator Pipeline', icon: 'bolt', color: 'var(--amber)', sections: [
                { label: 'Building',   count: gens.filter(g => g.stage === 'building').length,  val: sumGen(gens.filter(g => g.stage === 'building')),  pct: sumGen(gens.filter(g => g.stage === 'building'))  / Math.max(1, sumGen(gens)) },
                { label: 'Sent',       count: gens.filter(g => g.stage === 'sent').length,      val: sumGen(gens.filter(g => g.stage === 'sent')),      pct: sumGen(gens.filter(g => g.stage === 'sent'))      / Math.max(1, sumGen(gens)) },
                { label: 'Awarded',    count: genAwarded.length,                                val: sumGen(genAwarded),                               pct: sumGen(genAwarded)                               / Math.max(1, sumGen(gens)) },
                { label: 'Declined',   count: genDeclined.length,                               val: sumGen(genDeclined),                              pct: sumGen(genDeclined)                              / Math.max(1, sumGen(gens)) },
              ]},
            ].map(div => (
              <div key={div.title} className="panel">
                <div className="panel-hdr">
                  <span className="panel-title">
                    <span className="pt-ic" style={{ background: div.color + '22', color: div.color }}>
                      <Icon name={div.icon as any} size={15} stroke={1.8}/>
                    </span>
                    {div.title}
                  </span>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  {div.sections.map(s => (
                    <div key={s.label} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>
                          {s.label} <span style={{ color: 'var(--text3)', fontWeight: 600 }}>· {s.count}</span>
                        </span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 800 }}>{moneyFull(s.val)}</span>
                      </div>
                      <BAR pct={Math.round(s.pct * 100)} color={div.color}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Revenue by Month ── */}
        {tab === 'revenue' && (
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                  <Icon name="trend" size={15} stroke={1.9}/>
                </span>
                Contract Value Won by Month · {currentYear}
              </span>
            </div>
            <div style={{ padding: '24px 28px 16px' }}>
              {/* Stacked bar chart */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 220, marginBottom: 12 }}>
                {months.map(m => (
                  <div key={m.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <div className="num" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textAlign: 'center' }}>
                      {m.total ? money(m.total) : '—'}
                    </div>
                    <div style={{ width: '100%', maxWidth: 48, display: 'flex', flexDirection: 'column', borderRadius: '6px 6px 0 0', overflow: 'hidden', height: m.total ? Math.max(6, (m.total / maxMonth) * 160) + 'px' : '0' }}>
                      {m.elec > 0 && <div style={{ flex: m.elec, background: 'var(--blue)' }}/>}
                      {m.gen  > 0 && <div style={{ flex: m.gen,  background: 'var(--amber)' }}/>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
                {[['var(--blue)', 'Electrical'], ['var(--amber)', 'Generator']].map(([color, label]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: color }}/>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Win Rate by Rep ── */}
        {tab === 'winrate' && (
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                  <Icon name="users" size={15} stroke={1.8}/>
                </span>
                Win Rate by Salesperson
              </span>
            </div>
            {repStats.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No rep data yet</div>
            ) : (
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Salesperson</th>
                    <th style={{ textAlign: 'right' }}>Active Bids</th>
                    <th style={{ textAlign: 'right' }}>Jobs Won</th>
                    <th style={{ textAlign: 'right' }}>Won Value</th>
                    <th style={{ textAlign: 'right', minWidth: 120 }}>Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {repStats.sort((a, b) => b.wonValue - a.wonValue).map(r => (
                    <tr key={r.sp}>
                      <td className="nm">{r.sp}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{r.activeBids + r.activeGens}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{r.won}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--green)' }}>{moneyFull(r.wonValue)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="num" style={{ fontWeight: 800, minWidth: 36, textAlign: 'right' }}>{r.winRate}%</span>
                          <BAR pct={r.winRate} color={r.winRate >= 60 ? 'var(--green)' : r.winRate >= 40 ? 'var(--amber)' : 'var(--red, #E06A6A)'}/>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Divisions ── */}
        {tab === 'divisions' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Bids by stage breakdown */}
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">Electrical · Stage Breakdown</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {[
                  { label: 'Bids Due',   count: bids.filter(b => b.stage === 'due').length,       color: '#F2854F' },
                  { label: 'Submitted',  count: bids.filter(b => b.stage === 'submitted').length,  color: '#4D8DF7' },
                  { label: 'Awarded',    count: elecAwarded.length,                                color: '#34C588' },
                  { label: 'Lost',       count: elecLost.length,                                   color: '#7C8AA3' },
                ].map(s => {
                  const pct = bids.length ? Math.round(s.count / bids.length * 100) : 0;
                  return (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }}/>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', width: 90 }}>{s.label}</span>
                      <BAR pct={pct} color={s.color}/>
                      <span className="num" style={{ fontSize: 13, fontWeight: 800, width: 32, textAlign: 'right' }}>{s.count}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)', width: 36, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  );
                })}
                <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }}/>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                  <span>Total Pipeline</span>
                  <span className="num">{moneyFull(sumAmt(bids))}</span>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">Generator · Stage Breakdown</span>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {[
                  { label: 'Building',  count: gens.filter(g => g.stage === 'building').length, color: '#E0A53B' },
                  { label: 'Sent',      count: gens.filter(g => g.stage === 'sent').length,     color: '#4D8DF7' },
                  { label: 'Awarded',   count: genAwarded.length,                               color: '#34C588' },
                  { label: 'Declined',  count: genDeclined.length,                              color: '#7C8AA3' },
                ].map(s => {
                  const pct = gens.length ? Math.round(s.count / gens.length * 100) : 0;
                  return (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }}/>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', width: 90 }}>{s.label}</span>
                      <BAR pct={pct} color={s.color}/>
                      <span className="num" style={{ fontSize: 13, fontWeight: 800, width: 32, textAlign: 'right' }}>{s.count}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)', width: 36, textAlign: 'right' }}>{pct}%</span>
                    </div>
                  );
                })}
                <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }}/>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                  <span>Total Pipeline</span>
                  <span className="num">{moneyFull(sumGen(gens))}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
