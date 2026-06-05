import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../../components/Icon';
import { WonJob } from '../../types';
import { isPrivileged } from '../../hooks/useAuth';
import api from '../../api/client';
import WonReports from './WonReports';
import { moneyFull } from '../../lib/money';

const sumVal = (arr: WonJob[]) => arr.reduce((s, j) => s + Number(j.value), 0);
const sumComm = (arr: WonJob[]) => arr.reduce((s, j) => s + Number(j.commission_amount || 0), 0);

interface Props {
  wonJobs: WonJob[];
  userRole?: string;
}

export default function SalesByRepPage({ wonJobs, userRole }: Props) {
  const [tab,   setTab]   = useState<'records' | 'reports'>('records');
  const [fRep,  setFRep]  = useState('all');
  const [fType, setFType] = useState('all');
  const canManage = isPrivileged({ role: userRole });

  // Local copy so the paid/earned toggle reflects immediately.
  const [rows, setRows] = useState<WonJob[]>(wonJobs);
  useEffect(() => setRows(wonJobs), [wonJobs]);

  const togglePaid = async (j: WonJob) => {
    if (!canManage) return;
    const next = j.commission_status === 'paid' ? 'earned' : 'paid';
    setRows(prev => prev.map(r => r.id === j.id ? { ...r, commission_status: next } : r));
    try { await api.patch(`/won-jobs/${j.id}/commission`, { status: next }); }
    catch { setRows(prev => prev.map(r => r.id === j.id ? { ...r, commission_status: j.commission_status } : r)); }
  };

  // Dynamic salesperson list from data
  const salespeople = useMemo(
    () => Array.from(new Set(rows.map(j => j.salesperson_name))).sort(),
    [rows]
  );

  // Filter to salesperson scope first (used for stats + reports)
  const scoped = fRep !== 'all' ? rows.filter(j => j.salesperson_name === fRep) : rows;

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
            { label: 'Won This Year',  val: moneyFull(total),             sub: `${scoped.length} job${scoped.length !== 1 ? 's' : ''} won`,           tone: 'blue'  },
            { label: 'Commission YTD', val: moneyFull(sumComm(scoped)),   sub: `${moneyFull(sumComm(scoped.filter(j => j.commission_status !== 'paid')))} unpaid`, tone: 'green' },
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
                    <th style={{ textAlign: 'right' }}>Commission</th>
                    <th>Status</th>
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
                      <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>
                        {j.commission_amount != null ? moneyFull(Number(j.commission_amount)) : '—'}
                        {j.commission_rate != null && <span style={{ color: 'var(--text3)', fontWeight: 600, fontSize: 11 }}> ({Number(j.commission_rate)}%)</span>}
                      </td>
                      <td>
                        {(() => {
                          const paid = j.commission_status === 'paid';
                          const style: React.CSSProperties = {
                            fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                            textTransform: 'uppercase', letterSpacing: '.04em',
                            background: paid ? 'var(--green-soft)' : 'var(--amber-soft)',
                            color: paid ? 'var(--green)' : 'var(--amber)',
                            cursor: canManage ? 'pointer' : 'default', border: 'none',
                          };
                          return canManage
                            ? <button style={style} onClick={() => togglePaid(j)} title="Click to toggle paid/earned">{paid ? 'Paid' : 'Earned'}</button>
                            : <span style={style}>{paid ? 'Paid' : 'Earned'}</span>;
                        })()}
                      </td>
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
