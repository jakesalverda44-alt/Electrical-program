import React, { useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import { WonJob } from '../../types';
import WonReports from './WonReports';

function moneyFull(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }
const sumVal = (arr: WonJob[]) => arr.reduce((s, j) => s + Number(j.value), 0);

interface Props {
  wonJobs: WonJob[];
}

export default function SalesByRepPage({ wonJobs }: Props) {
  const [tab,   setTab]   = useState<'records' | 'reports'>('records');
  const [fRep,  setFRep]  = useState('all');
  const [fType, setFType] = useState('all');

  // Dynamic salesperson list from data
  const salespeople = useMemo(
    () => Array.from(new Set(wonJobs.map(j => j.salesperson_name))).sort(),
    [wonJobs]
  );

  // Filter to salesperson scope first (used for stats + reports)
  const scoped = fRep !== 'all' ? wonJobs.filter(j => j.salesperson_name === fRep) : wonJobs;

  // Then filter by type for the table
  const records = [...(fType !== 'all' ? scoped.filter(j => j.proposal_type === fType) : scoped)]
    .sort((a, b) => new Date(b.date_won).getTime() - new Date(a.date_won).getTime());

  const now = new Date();
  const thisMonth = scoped.filter(j => {
    const d = new Date(j.date_won);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const total = sumVal(scoped);
  const avg   = scoped.length ? Math.round(total / scoped.length) : 0;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="scroll view-enter">
      <div style={{ padding: '20px 28px 40px' }}>
        {/* Tab toggle + rep filter */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 10, padding: 3, gap: 2 }}>
            {([['records','Won Jobs'], ['reports','Reports']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                border: 'none', cursor: 'pointer', font: 'inherit',
                fontSize: 13, fontWeight: 700, padding: '7px 16px', borderRadius: 8,
                background: tab === id ? 'var(--panel)' : 'transparent',
                color: tab === id ? 'var(--text)' : 'var(--text3)',
              }}>
                {label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, fontWeight: 600, color: 'var(--text3)' }}>
            <Icon name="users" size={15} stroke={1.8}/>Salesperson
            <select value={fRep} onChange={e => setFRep(e.target.value)} style={{
              font: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--text)',
              background: 'var(--surface)', border: '1px solid var(--border2)',
              borderRadius: 9, padding: '7px 12px', cursor: 'pointer', outline: 'none',
            }}>
              <option value="all">All Reps</option>
              {salespeople.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>

        {/* Stat cards */}
        <div className="stats" style={{ gridTemplateColumns: 'repeat(4,1fr)', padding: 0, marginBottom: 18 }}>
          {[
            { label: 'Won This Month', val: moneyFull(sumVal(thisMonth)), sub: `${thisMonth.length} job${thisMonth.length !== 1 ? 's' : ''} won`,    tone: 'green' },
            { label: 'Won This Year',  val: moneyFull(total),             sub: `${scoped.length} job${scoped.length !== 1 ? 's' : ''} won`,           tone: 'blue'  },
            { label: 'Jobs Won YTD',   val: String(scoped.length),        sub: 'across both divisions',                                               tone: 'amber' },
            { label: 'Avg Deal Size',  val: moneyFull(avg),               sub: 'per won job',                                                         tone: 'green' },
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

        {tab === 'reports' ? (
          <WonReports records={scoped} salespeople={salespeople}/>
        ) : (
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                  <Icon name="trend" size={15} stroke={1.9}/>
                </span>
                Won Jobs
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 6 }}>· {records.length}</span>
              </span>
              <select value={fType} onChange={e => setFType(e.target.value)} className="comm-filter">
                <option value="all">All Types</option>
                <option value="Electrical">Electrical</option>
                <option value="Generator">Generator</option>
              </select>
            </div>

            {records.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontWeight: 600 }}>
                No won jobs match these filters.
              </div>
            ) : (
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Salesperson</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th style={{ textAlign: 'right' }}>Contract Value</th>
                    <th>Date Won</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(j => (
                    <tr key={j.id}>
                      <td className="nm">{j.salesperson_name}</td>
                      <td className="sub" style={{ maxWidth: 220 }}>{j.customer}</td>
                      <td>
                        <span style={{
                          fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                          textTransform: 'uppercase', letterSpacing: '.04em',
                          background: j.proposal_type === 'Electrical' ? 'var(--blue-soft)'  : 'var(--amber-soft)',
                          color:      j.proposal_type === 'Electrical' ? 'var(--blue)'        : 'var(--amber)',
                        }}>
                          {j.proposal_type}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(Number(j.value))}</td>
                      <td className="sub">{formatDate(j.date_won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
