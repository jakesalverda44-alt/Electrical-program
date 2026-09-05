import React, { memo } from 'react';
import { PROJECT_TYPES } from '../constants';
import { moneyFull } from '../../../lib/money';

interface CostsTabProps {
  historicalCosts: Array<Record<string, unknown>>;
  costTypeFilter: string;
  setCostTypeFilter: (v: string) => void;
  expandedCostRow: number | null;
  setExpandedCostRow: (v: number | null) => void;
}

function CostsTab({ historicalCosts, costTypeFilter, setCostTypeFilter, expandedCostRow, setExpandedCostRow }: CostsTabProps) {
  const filteredCosts = costTypeFilter === 'all'
    ? historicalCosts
    : historicalCosts.filter(r => r.project_type === costTypeFilter);
  const usedTypes = Array.from(new Set(historicalCosts.map(r => String(r.project_type || '')).filter(Boolean)));
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Project type filter chips */}
      {usedTypes.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {['all', ...usedTypes].map(val => {
            const label = val === 'all' ? 'All' : (PROJECT_TYPES.find(t => t.value === val)?.label ?? val);
            const active = costTypeFilter === val;
            return (
              <button key={val} onClick={() => setCostTypeFilter(val)}
                style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  background: active ? 'var(--accent)' : 'var(--surface2)',
                  color: active ? '#fff' : 'var(--text2)' }}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="panel">
        <div className="panel-hdr"><span className="panel-title">Historical Cost Comps — Awarded Jobs</span></div>
        {filteredCosts.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {historicalCosts.length === 0 ? 'No awarded jobs yet. Win bids to build your historical cost database.' : 'No jobs match the selected filter.'}
          </div>
        ) : (
          <div className="table-scroll">
          <table className="ctable">
            <thead>
              <tr>
                <th>Project</th>
                <th>GC</th>
                <th>Type</th>
                <th>Year</th>
                <th style={{ textAlign: 'right' }}>Sq Ft</th>
                <th style={{ textAlign: 'right' }}>Contract Value</th>
                <th style={{ textAlign: 'right' }}>$/SF</th>
              </tr>
            </thead>
            <tbody>
              {filteredCosts.map((row, i) => {
                const sqFt = row.sq_ft ? Number(row.sq_ft) : null;
                const amount = Number(row.amount);
                const perSF = sqFt ? amount / sqFt : null;
                const subtotals = (row.subtotals as Record<string,number> | null) ?? null;
                const isExpanded = expandedCostRow === i;
                const typePt = PROJECT_TYPES.find(t => t.value === String(row.project_type || ''));
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setExpandedCostRow(isExpanded ? null : i)}
                      style={{ cursor: subtotals ? 'pointer' : 'default' }}
                    >
                      <td className="nm">{String(row.name)}</td>
                      <td className="sub">{String(row.gc)}</td>
                      <td className="sub">
                        {typePt ? (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                            {typePt.label}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="sub">{String(row.year ?? '—')}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{sqFt ? sqFt.toLocaleString() : '—'}</td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(amount)}</td>
                      <td className="num" style={{ textAlign: 'right', color: 'var(--text3)' }}>{perSF ? `${moneyFull(perSF)}/sf` : '—'}</td>
                    </tr>
                    {isExpanded && subtotals && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface2)', padding: '12px 20px' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Category Breakdown</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 16px' }}>
                            {Object.entries(subtotals).map(([cat, val]) => (
                              <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                                <span style={{ color: 'var(--text2)', fontWeight: 600 }}>{cat}</span>
                                <span style={{ fontWeight: 800 }}>{moneyFull(Number(val))}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(CostsTab);
