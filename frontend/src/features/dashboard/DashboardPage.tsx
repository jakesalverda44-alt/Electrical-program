import React from 'react';
import Icon from '../../components/Icon';
import { Bid, Gen, WonJob } from '../../types';
import { moneyFull, moneyShort as money } from '../../lib/money';
import { useUser, useSettings } from '../../contexts/AppContext';
import './sales-dashboard.css';

// Roles that see company-wide figures; everyone else sees their own scoped data.
const MANAGER_ROLES = ['owner', 'administrator', 'sales_manager'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// date_won is a Postgres DATE serialized as ISO; take the calendar day so the
// browser timezone can't shift it into the wrong month.
function dayOf(d: string) { return new Date(String(d).slice(0, 10) + 'T00:00:00'); }

function fmtWinDate(d: string) {
  return dayOf(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "▲ 12% vs May" style delta chip; hidden when there's nothing to compare. */
function Delta({ cur, prev, vs }: { cur: number; prev: number; vs: string }) {
  if (prev <= 0 && cur <= 0) return null;
  if (prev <= 0) return <span className="sd-delta up">▲ first wins {vs}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="sd-delta">— even {vs}</span>;
  return (
    <span className={'sd-delta ' + (pct > 0 ? 'up' : 'down')}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% {vs}
    </span>
  );
}

interface Props {
  bids: Bid[];
  gens: Gen[];
  wonJobs: WonJob[];
  repNames?: string[];
  onNav: (v: string) => void;
}

export default function DashboardPage({ bids, gens, wonJobs, repNames, onNav }: Props) {
  const user = useUser();
  const { settings } = useSettings();
  const isManager = MANAGER_ROLES.includes(user.role);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const sumWon = (a: WonJob[]) => a.reduce((s, x) => s + Number(x.value), 0);

  // ── Sales: this month, this year, and the comparison baselines ──
  const inYear = (y: number) => wonJobs.filter(j => dayOf(j.date_won).getFullYear() === y);
  const thisYearJobs = inYear(year);
  const monthJobsOf = (y: number, m: number) =>
    wonJobs.filter(j => { const d = dayOf(j.date_won); return d.getFullYear() === y && d.getMonth() === m; });

  const thisMonthJobs = monthJobsOf(year, month);
  const prevMonthJobs = month === 0 ? monthJobsOf(year - 1, 11) : monthJobsOf(year, month - 1);
  const monthVal = sumWon(thisMonthJobs);
  const prevMonthVal = sumWon(prevMonthJobs);
  const yearVal = sumWon(thisYearJobs);

  // Last year *through the same date*, so a mid-year comparison is honest.
  const sameDateLastYear = new Date(year - 1, month, now.getDate(), 23, 59, 59);
  const lastYearToDate = sumWon(inYear(year - 1).filter(j => dayOf(j.date_won) <= sameDateLastYear));

  const avgDeal = thisYearJobs.length ? Math.round(yearVal / thisYearJobs.length) : 0;

  // Win rate across both divisions (decided deals only).
  const wonCount = bids.filter(b => b.stage === 'awarded').length + gens.filter(g => g.stage === 'awarded').length;
  const lostCount = bids.filter(b => b.stage === 'lost').length + gens.filter(g => g.stage === 'declined').length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

  // ── Monthly goal (company-wide, so only meaningful against company-wide numbers) ──
  const goal = isManager ? Number(settings.sales_goal_monthly) || 0 : 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((monthVal / goal) * 100)) : 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Pro-rated pace: where the month "should" be by today to land exactly on goal.
  const paceTarget = goal * (now.getDate() / daysInMonth);
  const onPace = monthVal >= paceTarget;

  // ── Commissions (fields ride along on each won job; reps see their own scope) ──
  const comm = (a: WonJob[]) => a.reduce((s, x) => s + Number(x.commission_amount ?? 0), 0);
  const commMonth = comm(thisMonthJobs);
  const commYear = comm(thisYearJobs);
  const commUnpaid = comm(wonJobs.filter(j => j.commission_status === 'earned'));

  // ── Monthly chart: stacked elec/gen for the current year ──
  const monthly = MONTHS.map((_, m) => {
    const js = monthJobsOf(year, m);
    return {
      elec: sumWon(js.filter(j => j.proposal_type === 'Electrical')),
      gen:  sumWon(js.filter(j => j.proposal_type === 'Generator')),
    };
  });
  const chartMax = Math.max(...monthly.map(x => x.elec + x.gen), 1);
  const yearElec = monthly.reduce((s, x) => s + x.elec, 0);
  const yearGen  = monthly.reduce((s, x) => s + x.gen, 0);

  // ── Open pipeline (live, not yet won) ──
  const elecActive = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const genActive  = gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed');
  const sum = (a: { amount: number | null }[]) => a.reduce((s, x) => s + Number(x.amount ?? 0), 0);
  const elecOpen = sum(elecActive), genOpen = sum(genActive);
  const openTotal = elecOpen + genOpen;
  const elecPct = openTotal ? Math.round((elecOpen / openTotal) * 100) : 50;

  // ── Proposal tracking funnel (gen proposals carry view/sign telemetry) ──
  const sentGens   = gens.filter(g => g.sent_at && g.stage !== 'awarded' && g.stage !== 'declined');
  const viewedGens = sentGens.filter(g => g.viewed_at);
  const signedGens = gens.filter(g => g.stage === 'signed');

  // ── Rep leaderboard (YTD) ──
  const repSet = new Set<string>(repNames ?? []);
  for (const j of thisYearJobs) if (j.salesperson_name) repSet.add(j.salesperson_name);
  const reps = [...repSet]
    .map(name => ({ name, val: sumWon(thisYearJobs.filter(j => j.salesperson_name === name)) }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 6);
  const repMax = Math.max(...reps.map(r => r.val), 1);

  // ── Recent wins ──
  const recentWins = [...wonJobs]
    .sort((a, b) => dayOf(b.date_won).getTime() - dayOf(a.date_won).getTime())
    .slice(0, 7);

  return (
    <div className="scroll view-enter">
      <div className="sd-root">

        {/* ── Hero: the two numbers that matter ── */}
        <div className="sd-hero">
          <div className="sd-hero-in">
            <div className="sd-big month">
              <div className="k">Sales · {now.toLocaleDateString('en-US', { month: 'long' })}</div>
              <div className="v">{moneyFull(monthVal)}</div>
              <div className="s">{thisMonthJobs.length} job{thisMonthJobs.length === 1 ? '' : 's'} won this month</div>
              <Delta cur={monthVal} prev={prevMonthVal} vs={`vs ${MONTHS[month === 0 ? 11 : month - 1]}`}/>
              {goal > 0 && (
                <div className="sd-goal">
                  <div className="track"><div className={'fill' + (goalPct >= 100 ? ' hit' : '')} style={{ width: goalPct + '%' }}/></div>
                  <div className="lbl">
                    {goalPct}% of {money(goal)} goal
                    {goalPct >= 100 ? ' — goal hit 🎉' : onPace ? ' · on pace' : ` · ${money(Math.max(0, Math.round(paceTarget - monthVal)))} behind pace`}
                  </div>
                </div>
              )}
            </div>
            <div className="sd-big">
              <div className="k">Sales · {year} total</div>
              <div className="v">{moneyFull(yearVal)}</div>
              <div className="s">{thisYearJobs.length} job{thisYearJobs.length === 1 ? '' : 's'} won this year</div>
              <Delta cur={yearVal} prev={lastYearToDate} vs={`vs ${year - 1} to date`}/>
            </div>
            <div className="sd-pills">
              {avgDeal > 0 && <span className="pill"><i>📊</i>Avg deal <b>{moneyFull(avgDeal)}</b></span>}
              {winRate !== null && <span className="pill"><i>🎯</i>Win rate <b>{winRate}%</b></span>}
              {openTotal > 0 && <span className="pill"><i>🔭</i>Open pipeline <b>{money(openTotal)}</b></span>}
              {!isManager && <span className="pill"><i>👤</i>Showing your deals</span>}
            </div>
          </div>
        </div>

        {/* ── Month-by-month, divisions stacked inline ── */}
        <div className="sd-card">
          <div className="ch">
            {year} month by month
            <span className="sp"/>
            <span className="sd-legend">
              <span><i style={{ background: 'var(--blue)' }}/>Electrical · {money(yearElec)}</span>
              <span><i style={{ background: 'var(--amber)' }}/>Generators · {money(yearGen)}</span>
            </span>
          </div>
          <div className="sd-chart">
            {monthly.map((x, m) => {
              const total = x.elec + x.gen;
              const isNow = m === month;
              return (
                <div
                  className={'sd-col' + (isNow ? ' now' : '') + (m > month ? ' future' : '')}
                  key={m}
                  title={total > 0 ? `${MONTHS[m]}: ${moneyFull(total)} (${moneyFull(x.elec)} electrical · ${moneyFull(x.gen)} generators)` : `${MONTHS[m]}: no wins`}
                >
                  <span className="amt">{total > 0 ? money(total) : ''}</span>
                  <div className={'bars' + (total === 0 ? ' empty' : '')} style={{ height: '100%' }}>
                    <div style={{ flex: 1 }}/>
                    <div className="seg-gen"  style={{ height: `${(x.gen  / chartMax) * 100}%` }}/>
                    <div className="seg-elec" style={{ height: `${(x.elec / chartMax) * 100}%` }}/>
                  </div>
                  <span className="m">{MONTHS[m]}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sd-grid">
          {/* ── Left: recent wins ── */}
          <div>
            <div className="sd-card">
              <div className="ch">
                Recent wins
                <span className="sp"/>
                <button className="panel-link" onClick={() => onNav('sales-by-rep')}>
                  Sales by rep <Icon name="arrow" size={13} stroke={2}/>
                </button>
              </div>
              {recentWins.length === 0 && <div className="sd-empty">No wins yet — go get the first one.</div>}
              {recentWins.map(j => (
                <div className="sd-win" key={j.id}>
                  <span className="ic"><Icon name="check" size={16} stroke={2.2}/></span>
                  <div className="tx">
                    <b>
                      {j.customer}
                      <span className={'div-chip ' + (j.proposal_type === 'Generator' ? 'gen' : 'elec')}>
                        {j.proposal_type === 'Generator' ? 'Gen' : 'Elec'}
                      </span>
                    </b>
                    <span>{j.salesperson_name || '—'} · {fmtWinDate(j.date_won)}</span>
                  </div>
                  <span className="amt">{moneyFull(Number(j.value))}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: pipeline, funnel, leaderboard ── */}
          <div>
            <div className="sd-card">
              <div className="ch">
                Open pipeline
                <span className="sp"/>
                <button className="panel-link" onClick={() => onNav('pipeline')}>
                  View <Icon name="arrow" size={13} stroke={2}/>
                </button>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>
                {moneyFull(openTotal)}
              </div>
              <div className="sd-pipe-bar">
                <i style={{ width: `${elecPct}%`, background: 'var(--blue)' }}/>
                <i style={{ width: `${100 - elecPct}%`, background: 'var(--amber)' }}/>
              </div>
              <div className="sd-pipe-row">
                <span className="dot" style={{ background: 'var(--blue)' }}/>Electrical · {elecActive.length} active
                <span className="v">{money(elecOpen)}</span>
              </div>
              <div className="sd-pipe-row">
                <span className="dot" style={{ background: 'var(--amber)' }}/>Generators · {genActive.length} active
                <span className="v">{money(genOpen)}</span>
              </div>
            </div>

            <div className="sd-card">
              <div className="ch">
                Proposals out
                <span className="sp"/>
                <button className="panel-link" onClick={() => onNav('gen-proposals')}>
                  View <Icon name="arrow" size={13} stroke={2}/>
                </button>
              </div>
              <div className="sd-funnel">
                <div className="step"><div className="n" style={{ color: 'var(--blue)'  }}>{sentGens.length}</div><div className="l">Sent</div></div>
                <div className="step"><div className="n" style={{ color: 'var(--amber)' }}>{viewedGens.length}</div><div className="l">Viewed</div></div>
                <div className="step"><div className="n" style={{ color: 'var(--green)' }}>{signedGens.length}</div><div className="l">Signed</div></div>
              </div>
            </div>

            {commYear > 0 && (
              <div className="sd-card">
                <div className="ch">
                  Commissions
                  <span className="sp"/>
                  <button className="panel-link" onClick={() => onNav('sales-by-rep')}>
                    Manage <Icon name="arrow" size={13} stroke={2}/>
                  </button>
                </div>
                <div className="sd-comm-row">
                  <span>This month</span>
                  <b>{moneyFull(commMonth)}</b>
                </div>
                <div className="sd-comm-row">
                  <span>{year} total</span>
                  <b>{moneyFull(commYear)}</b>
                </div>
                <div className="sd-comm-row">
                  <span>Unpaid</span>
                  <b className={commUnpaid > 0 ? 'due' : ''}>{moneyFull(commUnpaid)}</b>
                </div>
              </div>
            )}

            {isManager && reps.length > 0 && (
              <div className="sd-card">
                <div className="ch">Leaderboard · {year}</div>
                {reps.map(r => (
                  <div className="sd-rep" key={r.name}>
                    <span className="nm">{r.name}</span>
                    <span className="track"><span className="fill" style={{ width: `${(r.val / repMax) * 100}%`, display: 'block' }}/></span>
                    <span className="val">{money(r.val)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
