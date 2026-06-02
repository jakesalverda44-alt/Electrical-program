import React from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, WonJob, Activity } from '../../types';

function money(n: number) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + n;
}
function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
  activity: Activity[];
  onNav: (v: string) => void;
  onNewProposal: () => void;
}

export default function DashboardPage({ bids, gens, wonJobs, activity, onNav, onNewProposal }: Props) {
  const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + Number(x.amount), 0);

  const elecActive = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const genActive  = gens.filter(g => g.stage === 'building' || g.stage === 'sent');
  const elecVal = sum(elecActive), genVal = sum(genActive);
  const total = elecVal + genVal;
  const elecWon  = bids.filter(b => b.stage === 'awarded').length;
  const elecLost = bids.filter(b => b.stage === 'lost').length;
  const winRate = Math.round((elecWon / Math.max(1, elecWon + elecLost)) * 100);
  const pct = total ? Math.round((elecVal / total) * 100) : 50;
  const dueSoon = bids.filter(b => b.stage === 'due').sort((a, b) => a.due_days - b.due_days);
  const recentGens = gens.slice(0, 4);

  // Sales summary
  const now = new Date();
  const thisMonth = wonJobs.filter(j => {
    const d = new Date(j.date_won); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisYear = wonJobs.filter(j => new Date(j.date_won).getFullYear() === now.getFullYear());
  const monthVal = sum(thisMonth), yearVal = sum(thisYear);
  const avgDeal  = thisYear.length ? Math.round(yearVal / thisYear.length) : 0;

  return (
    <div className="scroll view-enter">
      <div className="dash">
        {/* Stat cards */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0 }}>
          {[
            { label: 'Total Open Pipeline', val: money(total),   sub: `${elecActive.length + genActive.length} active opportunities`, ic: 'trend',    tone: 'blue' },
            { label: 'Electrical Value',    val: money(elecVal), sub: `${elecActive.length} active bids`,                             ic: 'pipeline', tone: 'blue' },
            { label: 'Generator Value',     val: money(genVal),  sub: `${genActive.length} active proposals`,                         ic: 'bolt',     tone: 'amber' },
            { label: 'Win Rate',            val: winRate + '%',  sub: `${elecWon} won · ${elecLost} lost`,                            ic: 'spark',    tone: 'green' },
          ].map(s => (
            <div className="stat" key={s.label}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name={s.ic} size={17} stroke={1.9}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Sales summary band */}
        <div className="comm-band">
          <div className="comm-stats">
            {[
              { label: 'Won This Month', val: moneyFull(monthVal) },
              { label: 'Won This Year',  val: moneyFull(yearVal)  },
              { label: 'Jobs Won YTD',   val: String(thisYear.length) },
              { label: 'Avg Deal Size',  val: moneyFull(avgDeal)  },
            ].map(s => (
              <div className="comm-stat" key={s.label}>
                <div className="cs-label">{s.label}</div>
                <div className="cs-val num">{s.val}</div>
              </div>
            ))}
          </div>
          <div className="comm-right">
            <div className="comm-reps">
              {['Jake Salverda','David Marsh'].map(rep => {
                const repJobs = thisYear.filter(j => j.salesperson_name === rep);
                const repVal  = sum(repJobs);
                const repPct  = yearVal ? Math.round((repVal/yearVal)*100) : 0;
                return (
                  <div className="rep-row" key={rep}>
                    <div className="rep-name">{rep}</div>
                    <div className="rep-bar-wrap"><div className="rep-bar" style={{ width: repPct+'%' }}/></div>
                    <div className="rep-val num">{moneyFull(repVal)}</div>
                  </div>
                );
              })}
            </div>
            <button className="panel-link" onClick={() => onNav('sales-by-rep')}>View all <Icon name="arrow" size={13} stroke={2}/></button>
          </div>
        </div>

        <div className="dash-grid">
          {/* Left column */}
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--orange-soft)', color:'var(--orange)' }}><Icon name="clock" size={15} stroke={2}/></span>
                  Bids Due This Week
                </span>
                <button className="panel-link" onClick={() => onNav('elec-proposals')}>View pipeline <Icon name="arrow" size={13} stroke={2}/></button>
              </div>
              <div className="panel-body">
                {dueSoon.length === 0 && <div className="panel-empty">No bids currently due</div>}
                {dueSoon.map(b => {
                  const [m, d] = b.due.split(' ');
                  return (
                    <div className="due-item" key={b.id} onClick={() => onNav('elec-proposals')}>
                      <div className={'due-date' + (b.due_days <= 3 ? ' hot' : '')}><b>{d}</b><small>{m}</small></div>
                      <div className="di-main"><div className="di-name">{b.name}</div><div className="di-sub">{b.gc} · {b.loc}</div></div>
                      <div style={{ textAlign:'right' }}>
                        <div className="di-amt num">{money(Number(b.amount))}</div>
                        <div className="di-when">{b.due_days <= 3 ? `Due in ${b.due_days}d` : `${b.due_days} days`}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--blue-soft)', color:'var(--blue)' }}><Icon name="dollar" size={15} stroke={1.9}/></span>
                  Pipeline by Division
                </span>
              </div>
              <div className="split">
                <div className="split-card">
                  <div className="sc-top"><span className="sc-tag" style={{ background:'var(--blue)' }}/> Electrical Bids</div>
                  <div className="sc-val num">{money(elecVal)}</div>
                  <div className="sc-sub">{elecActive.length} active · {money(sum(bids.filter(b=>b.stage==='awarded')))} awarded</div>
                  <div className="sc-bar"><i style={{ width:pct+'%', background:'var(--blue)' }}/><i style={{ width:(100-pct)+'%', background:'var(--amber)' }}/></div>
                </div>
                <div className="split-card">
                  <div className="sc-top"><span className="sc-tag" style={{ background:'var(--amber)' }}/> Generators</div>
                  <div className="sc-val num">{money(genVal)}</div>
                  <div className="sc-sub">{genActive.length} active · {money(sum(gens.filter(g=>g.stage==='awarded')))} awarded</div>
                  <div className="sc-bar"><i style={{ width:(100-pct)+'%', background:'var(--amber)' }}/><i style={{ width:pct+'%', background:'var(--surface3)' }}/></div>
                </div>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--amber-soft)', color:'var(--amber)' }}><Icon name="doc" size={15} stroke={1.8}/></span>
                  Recently Built Proposals
                </span>
                <button className="panel-link" onClick={onNewProposal} style={{ color:'var(--amber)' }}>New <Icon name="plus" size={13} stroke={2.4}/></button>
              </div>
              <div className="panel-body">
                {recentGens.map(g => (
                  <div className="recent-item" key={g.id} onClick={() => onNav('gen-proposals')}>
                    <div className="recent-ic"><Icon name="bolt" size={18} stroke={1.8}/></div>
                    <div className="di-main"><div className="di-name">{g.customer}</div><div className="di-sub">{g.mfr} {g.model} · {g.kw}kW</div></div>
                    <div style={{ textAlign:'right' }}><div className="di-amt num">{money(Number(g.amount))}</div><div className="di-when">{g.built_on}</div></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--green-soft)', color:'var(--green)' }}><Icon name="spark" size={15} stroke={1.9}/></span>
                  Activity
                </span>
              </div>
              <div className="panel-body">
                {activity.slice(0, 6).map(a => (
                  <div className="act-item" key={a.id}>
                    <div className={'act-ic ' + a.kind}>
                      <Icon name={a.kind==='awarded'?'check':a.kind==='lost'?'x':a.kind==='built'?'bolt':a.kind==='sent'?'arrow':'plus'} size={16} stroke={2}/>
                    </div>
                    <div className="act-text">{a.text}</div>
                    <div className="di-when">{a.time_label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
