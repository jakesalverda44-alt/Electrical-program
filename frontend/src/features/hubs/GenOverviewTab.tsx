// frontend/src/features/hubs/GenOverviewTab.tsx
//
// Generators division overview: KPI rollup, stage breakdown, monthly trend,
// recent wins, and the sent→viewed→signed proposal funnel. Pure presentation
// over props — all numbers come from divisionStats.ts (Task 2), no fetching.
import React from 'react';
import { Gen, WonJob } from '../../types';
import { genDivisionStats, genFunnel } from '../../lib/divisionStats';
import { moneyFull, moneyShort as money } from '../../lib/money';
import { GEN_STAGES } from '../gen-pipeline/constants';
import { GenHubTab } from './constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAGE_COLOR: Record<string, string> = Object.fromEntries(GEN_STAGES.map(s => [s.key, s.color]));

// date_won is a Postgres DATE serialized as ISO; take the calendar day so the
// browser timezone can't shift it into the wrong month.
function dayOf(d: string) { return new Date(String(d).slice(0, 10) + 'T00:00:00'); }
function fmtDate(d: string) { return dayOf(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

interface Props {
  gens: Gen[];
  wonJobs: WonJob[];
  onSelectTab: (key: GenHubTab) => void;
}

export default function GenOverviewTab({ gens, wonJobs, onSelectTab }: Props) {
  const now = new Date();
  const stats = genDivisionStats(gens, wonJobs, now);
  const funnel = genFunnel(gens);
  const chartMax = Math.max(...stats.monthly, 1);
  const recentWins = wonJobs
    .filter(j => j.proposal_type === 'Generator')
    .slice()
    .sort((a, b) => dayOf(b.date_won).getTime() - dayOf(a.date_won).getTime())
    .slice(0, 5);

  return (
    <div className="scroll view-enter" style={{ padding: 32 }}>
      {/* ── KPI row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>YTD Sales</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{moneyFull(stats.ytdSales)}</div>
        </div>
        <div className="panel" style={{ padding: '18px 20px', cursor: 'pointer' }} onClick={() => onSelectTab('pipeline')}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Open Pipeline</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{money(stats.openValue)}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, fontWeight: 600 }}>{stats.openCount} open</div>
        </div>
        <div className="panel" style={{ padding: '18px 20px', cursor: 'pointer' }} onClick={() => onSelectTab('jobs')}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Jobs Won</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{stats.wonCount}</div>
        </div>
        <div className="panel" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8 }}>Win Rate</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>
            {stats.winRate === null ? '—' : `${stats.winRate}%`}
          </div>
        </div>
      </div>

      {/* ── Stage breakdown ── */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr"><span className="panel-title">Pipeline by stage</span></div>
        <div style={{ padding: '4px 20px 4px' }}>
          {stats.stages.map((s, i) => (
            <div
              key={s.key}
              onClick={() => onSelectTab('pipeline')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', cursor: 'pointer',
                borderBottom: i < stats.stages.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span className="dot" style={{ background: STAGE_COLOR[s.key] || 'var(--slate)' }}/>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{s.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{s.count}</span>
              <span className="num" style={{ fontSize: 13, fontWeight: 800, minWidth: 74, textAlign: 'right' }}>{money(s.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Monthly trend ── */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr"><span className="panel-title">{now.getFullYear()} month by month</span></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, padding: '20px 20px 12px' }}>
          {stats.monthly.map((v, m) => (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
              <span className="num" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)' }}>{v > 0 ? money(v) : ''}</span>
              <div style={{
                width: '100%', maxWidth: 34, borderRadius: '4px 4px 0 0', background: 'var(--amber)',
                height: v > 0 ? `${Math.max(4, (v / chartMax) * 100)}%` : 2, opacity: v > 0 ? 1 : 0.15,
              }}/>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)' }}>{MONTHS[m]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recent wins ── */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-hdr"><span className="panel-title">Recent wins</span></div>
        <div style={{ padding: '4px 20px 4px' }}>
          {recentWins.length === 0 && <div className="panel-empty">No wins yet — go get the first one.</div>}
          {recentWins.map((j, i) => (
            <div key={j.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
              borderBottom: i < recentWins.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{j.customer}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{fmtDate(j.date_won)}</span>
              <span className="num" style={{ fontSize: 13, fontWeight: 800, minWidth: 74, textAlign: 'right' }}>{moneyFull(Number(j.value))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Proposal funnel ── */}
      <div className="panel">
        <div className="panel-hdr"><span className="panel-title">Proposals out</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '20px' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--blue)' }}>{funnel.sent}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>Sent</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)' }}>{funnel.viewed}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>Viewed</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{funnel.signed}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>Signed</div>
          </div>
        </div>
      </div>
    </div>
  );
}
