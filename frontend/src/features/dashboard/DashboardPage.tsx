import React, { useState, useEffect } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Bid, Gen, WonJob, Activity } from '../../types';
import { moneyFull, moneyShort as money } from '../../lib/money';

// Roles that see company-wide figures; everyone else sees their own scoped data.
const MANAGER_ROLES = ['owner', 'administrator', 'sales_manager'];

interface DueTask { id: string; title: string; due_date?: string | null; linked_name?: string | null; status: string; }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Compact dashboard widget: the current user's open follow-ups that are due today or overdue.
function FollowupsDue({ onNav }: { onNav: (v: string) => void }) {
  const [tasks, setTasks] = useState<DueTask[]>([]);
  useEffect(() => {
    api.get('/tasks', { params: { status: 'open' } })
      .then(({ data }) => setTasks(data))
      .catch(() => { /* non-fatal */ });
  }, []);

  const today = new Date(new Date().toDateString());
  const due = tasks.filter(t => t.due_date && new Date(t.due_date + 'T00:00:00') <= today);
  if (due.length === 0) return null;

  return (
    <div style={{ margin: '0 0 18px', padding: '14px 18px', background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.28)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name="checkc" size={18} stroke={2} style={{ color: '#D97706' }}/>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#B45309', marginBottom: 4 }}>
          {due.length} Follow-up{due.length !== 1 ? 's' : ''} due
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {due.slice(0, 4).map(t => (
            <span key={t.id} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', padding: '2px 8px', background: 'var(--surface2)', borderRadius: 6 }}>
              {t.title}{t.linked_name ? ` · ${t.linked_name}` : ''}
            </span>
          ))}
        </div>
      </div>
      <button className="btn ghost" onClick={() => onNav('followups')} style={{ fontSize: 12, flexShrink: 0, color: '#B45309', borderColor: '#D97706' }}>
        View
      </button>
    </div>
  );
}


interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
  activity: Activity[];
  repNames?: string[];
  userName?: string;
  userRole?: string;
  /** Division filter from the header tabs: 'all' | 'elec' | 'gen'. */
  dashFilter?: string;
  onNav: (v: string) => void;
  onNewProposal: () => void;
}

export default function DashboardPage({ bids, gens, wonJobs, activity, repNames, userName, userRole, dashFilter = 'all', onNav, onNewProposal }: Props) {
  const isManager = !userRole || MANAGER_ROLES.includes(userRole);
  const firstName = (userName || '').split(' ')[0];
  // Reps see their own scoped data (enforced server-side); label it accordingly.
  const scopeWord = isManager ? '' : 'My ';
  const sum = (a: { amount: number | null }[]) => a.reduce((s, x) => s + Number(x.amount ?? 0), 0);

  // Division filter from the header tabs.
  const showElec = dashFilter !== 'gen';
  const showGen  = dashFilter !== 'elec';
  // Activity feed scoped to the division (preconstruction is electrical work,
  // so it stays visible in Electrical mode).
  const fActivity = dashFilter === 'all' ? activity
    : dashFilter === 'gen' ? activity.filter(a => a.div === 'gen')
    : activity.filter(a => a.div !== 'gen');

  const elecActive = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const genActive  = gens.filter(g => g.stage === 'building' || g.stage === 'sent');
  const elecVal = sum(elecActive), genVal = sum(genActive);
  const total = (showElec ? elecVal : 0) + (showGen ? genVal : 0);
  const activeCount = (showElec ? elecActive.length : 0) + (showGen ? genActive.length : 0);
  const elecWon  = bids.filter(b => b.stage === 'awarded').length;
  const elecLost = bids.filter(b => b.stage === 'lost').length;
  const winRate = Math.round((elecWon / Math.max(1, elecWon + elecLost)) * 100);
  const pct = total ? Math.round((elecVal / total) * 100) : 50;
  const dueSoon = bids.filter(b => b.stage === 'due').sort((a, b) => a.due_days - b.due_days);
  const overdue = bids.filter(b => (b.stage === 'due' || b.stage === 'submitted') && b.due_days < 0);
  const recentGens = gens.slice(0, 4);

  // Proposal status tracking
  const sentGens    = gens.filter(g => g.sent_at && g.stage !== 'awarded' && g.stage !== 'declined');
  const viewedGens  = sentGens.filter(g => g.viewed_at);
  const signedGens  = gens.filter(g => g.stage === 'signed');
  const awaitingReply = sentGens.filter(g => !g.viewed_at);
  const viewedNotSigned = viewedGens.filter(g => g.stage !== 'signed');

  // Sales summary — scoped to the selected division.
  const fWon = dashFilter === 'elec' ? wonJobs.filter(j => j.proposal_type === 'Electrical')
             : dashFilter === 'gen'  ? wonJobs.filter(j => j.proposal_type === 'Generator')
             : wonJobs;
  const now = new Date();
  const thisMonth = fWon.filter(j => {
    const d = new Date(j.date_won); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisYear = fWon.filter(j => new Date(j.date_won).getFullYear() === now.getFullYear());
  const sumWon = (a: WonJob[]) => a.reduce((s, x) => s + Number(x.value), 0);
  const monthVal = sumWon(thisMonth), yearVal = sumWon(thisYear);
  const avgDeal  = thisYear.length ? Math.round(yearVal / thisYear.length) : 0;

  return (
    <div className="scroll view-enter">
      <div className="dash">
        {/* Personalized greeting */}
        {firstName && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>{greeting()}, {firstName}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>
              {isManager ? 'Company-wide pipeline and performance.' : 'Here are your deals and what needs attention today.'}
            </div>
          </div>
        )}

        {/* Follow-ups due today / overdue */}
        <FollowupsDue onNav={onNav}/>

        {/* Stat cards */}
        {(() => {
        const statCards = [
          { label: scopeWord + 'Open Pipeline', val: money(total), sub: `${activeCount} active opportunities`, ic: 'trend', tone: 'blue', nav: showGen && !showElec ? 'gen-proposals' : 'elec-proposals' },
          ...(showElec ? [{ label: 'Electrical Value', val: money(elecVal), sub: `${elecActive.length} active bids`,      ic: 'pipeline', tone: 'blue',  nav: 'elec-proposals' }] : []),
          ...(showGen  ? [{ label: 'Generator Value',  val: money(genVal),  sub: `${genActive.length} active proposals`, ic: 'bolt',     tone: 'amber', nav: 'gen-proposals'  }] : []),
          ...(showElec ? [{ label: 'Win Rate',         val: winRate + '%',  sub: `${elecWon} won · ${elecLost} lost`,    ic: 'spark',    tone: 'green', nav: 'sales-by-rep'   }] : []),
        ];
        return (
        <div className="stats" style={{ gridTemplateColumns: `repeat(${statCards.length},1fr)`, padding: 0 }}>
          {statCards.map(s => (
            <div className="stat" key={s.label} onClick={() => onNav(s.nav)} style={{ cursor: 'pointer' }}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className={'stat-ic ' + s.tone}><Icon name={s.ic} size={17} stroke={1.9}/></span>
              </div>
              <div className="stat-val num">{s.val}</div>
              <div className="stat-sub">{s.sub}</div>
            </div>
          ))}
        </div>
        ); })()}

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
              {(repNames && repNames.length > 0 ? repNames : ['Jake Salverda','David Marsh']).map(rep => {
                const repJobs = thisYear.filter(j => j.salesperson_name === rep);
                const repVal  = sumWon(repJobs);
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

              {showElec && overdue.length > 0 && (
                <div style={{ margin: '0 0 18px', padding: '14px 18px', background: 'rgba(224,106,106,.10)', border: '1px solid rgba(224,106,106,.25)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(224,106,106,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="clock" size={18} stroke={2} style={{ color: '#E06A6A' }}/>
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#E06A6A', marginBottom: 4 }}>
                      {overdue.length} Overdue Bid{overdue.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {overdue.map(b => (
                        <span key={b.id} style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', padding: '2px 8px', background: 'var(--surface2)', borderRadius: 6 }}>
                          {b.name} <span style={{ color: '#E06A6A' }}>({Math.abs(b.due_days)}d overdue)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="btn ghost" onClick={() => onNav('elec-proposals')} style={{ fontSize: 12, flexShrink: 0, color: '#E06A6A', borderColor: '#E06A6A' }}>
                    View Pipeline
                  </button>
                </div>
              )}
        <div className="dash-grid">
          {/* Left column */}
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            {showElec && (
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
            )}

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--blue-soft)', color:'var(--blue)' }}><Icon name="dollar" size={15} stroke={1.9}/></span>
                  Pipeline by Division
                </span>
              </div>
              <div className="split">
                {showElec && (
                <div className="split-card">
                  <div className="sc-top"><span className="sc-tag" style={{ background:'var(--blue)' }}/> Electrical Bids</div>
                  <div className="sc-val num">{money(elecVal)}</div>
                  <div className="sc-sub">{elecActive.length} active · {money(sum(bids.filter(b=>b.stage==='awarded')))} awarded</div>
                  {dashFilter === 'all' && <div className="sc-bar"><i style={{ width:pct+'%', background:'var(--blue)' }}/><i style={{ width:(100-pct)+'%', background:'var(--amber)' }}/></div>}
                </div>
                )}
                {showGen && (
                <div className="split-card">
                  <div className="sc-top"><span className="sc-tag" style={{ background:'var(--amber)' }}/> Generators</div>
                  <div className="sc-val num">{money(genVal)}</div>
                  <div className="sc-sub">{genActive.length} active · {money(sum(gens.filter(g=>g.stage==='awarded')))} awarded</div>
                  {dashFilter === 'all' && <div className="sc-bar"><i style={{ width:(100-pct)+'%', background:'var(--amber)' }}/><i style={{ width:pct+'%', background:'var(--surface3)' }}/></div>}
                </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            {showGen && (<>
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
                  <span className="pt-ic" style={{ background:'#F0FDF4', color:'#16A34A' }}><Icon name="doc" size={15} stroke={1.8}/></span>
                  Proposal Pipeline
                </span>
                <button className="panel-link" onClick={() => onNav('gen-proposals')}>View all <Icon name="arrow" size={13} stroke={2}/></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderBottom: '1px solid var(--border)' }}>
                {[
                  { label: 'Sent',    val: sentGens.length,         color: '#3B82F6', bg: '#EFF6FF' },
                  { label: 'Viewed',  val: viewedNotSigned.length,  color: '#F59E0B', bg: '#FFFBEB' },
                  { label: 'Signed',  val: signedGens.length,       color: '#16A34A', bg: '#F0FDF4' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '14px 0', textAlign: 'center', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="panel-body">
                {awaitingReply.length > 0 && (
                  <div style={{ padding: '10px 16px', background: '#FFF7ED', borderBottom: '1px solid var(--border)', fontSize: 12, color: '#92400E', fontWeight: 600 }}>
                    {awaitingReply.length} proposal{awaitingReply.length !== 1 ? 's' : ''} sent — awaiting customer view
                  </div>
                )}
                {viewedNotSigned.length > 0 && viewedNotSigned.map(g => (
                  <div className="recent-item" key={g.id} onClick={() => onNav('gen-proposals')} style={{ cursor: 'pointer' }}>
                    <div className="recent-ic" style={{ background: '#FFFBEB', color: '#F59E0B' }}><Icon name="eye" size={16} stroke={1.8}/></div>
                    <div className="di-main">
                      <div className="di-name">{g.customer}</div>
                      <div className="di-sub">Viewed · awaiting signature</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="di-amt num" style={{ fontSize: 12 }}>{money(Number(g.amount))}</div>
                    </div>
                  </div>
                ))}
                {signedGens.slice(0, 3).map(g => (
                  <div className="recent-item" key={g.id} onClick={() => onNav('gen-proposals')} style={{ cursor: 'pointer' }}>
                    <div className="recent-ic" style={{ background: '#F0FDF4', color: '#16A34A' }}><Icon name="check" size={16} stroke={2.2}/></div>
                    <div className="di-main">
                      <div className="di-name">{g.customer}</div>
                      <div className="di-sub">Signed — pending award</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="di-amt num" style={{ fontSize: 12 }}>{money(Number(g.amount))}</div>
                    </div>
                  </div>
                ))}
                {sentGens.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No active proposals sent yet.</div>
                )}
              </div>
            </div>
            </>)}

            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title">
                  <span className="pt-ic" style={{ background:'var(--green-soft)', color:'var(--green)' }}><Icon name="spark" size={15} stroke={1.9}/></span>
                  Activity
                </span>
              </div>
              <div className="panel-body">
                {fActivity.length === 0 && <div className="panel-empty">No recent activity</div>}
                {fActivity.slice(0, 6).map(a => (
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
