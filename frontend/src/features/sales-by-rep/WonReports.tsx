import React from 'react';
import Icon from '../../components/Icon';
import { WonJob } from '../../types';
import { moneyFull } from '../../lib/money';

const sumVal = (arr: WonJob[]) => arr.reduce((s, j) => s + Number(j.value), 0);

interface Props {
  records: WonJob[];
  salespeople: string[];
}

export default function WonReports({ records, salespeople }: Props) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear  = now.getFullYear();

  // Build Jan → current month array for current year
  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = MONTH_LABELS.slice(0, currentMonth + 1).map((label, i) => ({
    label,
    total: sumVal(records.filter(j => {
      const d = new Date(j.date_won);
      return d.getFullYear() === currentYear && d.getMonth() === i;
    })),
  }));
  const maxMonth = Math.max(1, ...months.map(x => x.total));

  const byRep = salespeople.map(sp => {
    const rs = records.filter(j => j.salesperson_name === sp);
    return { sp, total: sumVal(rs), count: rs.length };
  });

  const elecJobs = records.filter(j => j.proposal_type === 'Electrical');
  const genJobs  = records.filter(j => j.proposal_type === 'Generator');
  const elecT = sumVal(elecJobs);
  const genT  = sumVal(genJobs);
  const bothT = Math.max(1, elecT + genT);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Monthly bar chart */}
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
              <Icon name="trend" size={15} stroke={1.9}/>
            </span>
            Contract Value Won by Month · {currentYear}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, padding: '24px 24px 16px', height: 200 }}>
          {months.map(x => (
            <div key={x.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
              <div className="num" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text2)' }}>
                {x.total ? moneyFull(x.total) : '—'}
              </div>
              <div style={{
                width: '100%', maxWidth: 54,
                height: x.total ? Math.max(6, (x.total / maxMonth) * 130) + 'px' : '0',
                background: 'linear-gradient(180deg,var(--green),#2aa56e)',
                borderRadius: '7px 7px 0 0', transition: 'height .3s',
              }}/>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>{x.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* By salesperson */}
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                <Icon name="users" size={15} stroke={1.8}/>
              </span>
              By Salesperson
            </span>
          </div>
          <table className="ctable">
            <thead>
              <tr>
                <th>Salesperson</th>
                <th style={{ textAlign: 'right' }}>Jobs Won</th>
                <th style={{ textAlign: 'right' }}>Contract Value YTD</th>
              </tr>
            </thead>
            <tbody>
              {byRep.map(r => (
                <tr key={r.sp}>
                  <td className="nm">{r.sp}</td>
                  <td className="num" style={{ textAlign: 'right' }}>{r.count}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(r.total)}</td>
                </tr>
              ))}
              {byRep.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Electrical vs Generator */}
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">
              <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                <Icon name="pipeline" size={15} stroke={1.8}/>
              </span>
              Electrical vs Generator
            </span>
          </div>
          <div style={{ padding: '18px 20px' }}>
            {[
              { label: 'Electrical', jobs: elecJobs, val: elecT, color: 'var(--blue)'  },
              { label: 'Generator',  jobs: genJobs,  val: genT,  color: 'var(--amber)' },
            ].map(d => (
              <div key={d.label} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {d.label} <span style={{ color: 'var(--text3)', fontWeight: 600 }}>· {d.jobs.length} jobs</span>
                  </span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 800 }}>{moneyFull(d.val)}</span>
                </div>
                <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: (d.val / bothT * 100) + '%', background: d.color, borderRadius: 5 }}/>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, marginTop: 4 }}>
                  {Math.round(d.val / bothT * 100)}% of contract value won
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
