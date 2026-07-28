// "Compare Bids" tab — puts this bid next to similar past jobs so you can see what
// actually differs before pricing a new one. Comparables are ranked same-brand first
// (chain prototypes are near-identical), then by nearest square footage.
import React, { useEffect, useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { PROJECT_TYPES } from './constants';
import { moneyFull } from '../../lib/money';

interface Comparable {
  id: string; name: string; gc: string; stage: string;
  brand: string | null; project_type: string | null;
  sq_ft: number | null; amount: string | null;
  has_takeoff: boolean; has_breakdown: boolean; labor_hours: string | null;
}

interface CategoryRollup { name: string; itemCount: number; totals: Record<string, number> }

interface CompareJob {
  id: string; name: string; gc: string; brand: string | null;
  project_type: string | null; sq_ft: number | null; amount: string | null;
  categories: CategoryRollup[] | null;
  material_total: string | null; labor_total: string | null;
  equipment_total: string | null; quotes_total: string | null;
  labor_hours: string | null; avg_crew_size: string | null;
}

interface TakeoffLine { category: string; description: string; unit: string; qty: number }

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const typeLabel = (v: string | null) => PROJECT_TYPES.find(t => t.value === v)?.label ?? v ?? '—';

// Quantities are per-unit (EA/LF/LOT); a single summed number would be meaningless.
const fmtTotals = (t: Record<string, number> | undefined) =>
  t && Object.keys(t).length
    ? Object.entries(t).sort((a, b) => b[1] - a[1]).map(([u, q]) => `${q.toLocaleString()} ${u}`).join(' · ')
    : '—';

const cell: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border2)', verticalAlign: 'top',
};
const headCell: React.CSSProperties = {
  ...cell, fontWeight: 800, fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase',
  letterSpacing: .3, whiteSpace: 'nowrap',
};

export default function BidCompare({ bidId }: { bidId: string }) {
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, TakeoffLine[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/preconstruction/${bidId}/comparables`)
      .then(r => {
        const list: Comparable[] = r.data.comparables ?? [];
        setComparables(list);
        // Preselect the three closest so the tab is useful without any clicking.
        setSelected(new Set(list.slice(0, 3).map(c => c.id)));
      })
      .catch(() => setError('Could not load comparable bids.'))
      .finally(() => setLoading(false));
  }, [bidId]);

  const runCompare = React.useCallback(async (ids: Set<string>) => {
    if (!ids.size) { setJobs([]); setCategoryNames([]); return; }
    setComparing(true);
    try {
      const { data } = await api.get(`/preconstruction/${bidId}/compare`, { params: { against: [...ids].join(',') } });
      setJobs(data.jobs ?? []);
      setCategoryNames(data.categoryNames ?? []);
    } catch {
      setError('Could not build the comparison.');
    } finally {
      setComparing(false);
    }
  }, [bidId]);

  useEffect(() => { if (!loading) runCompare(selected); }, [loading, selected, runCompare]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openDrill = async (category: string) => {
    if (openCategory === category) { setOpenCategory(null); return; }
    setOpenCategory(category);
    const missing = jobs.filter(j => !lines[j.id]);
    if (missing.length) {
      const fetched = await Promise.all(missing.map(j =>
        api.get(`/preconstruction/${j.id}/takeoff`)
          .then(r => [j.id, (r.data?.line_items ?? []) as TakeoffLine[]] as const)
          .catch(() => [j.id, [] as TakeoffLine[]] as const)
      ));
      setLines(prev => ({ ...prev, ...Object.fromEntries(fetched) }));
    }
  };

  // Per-SF figures are the only fair way to line up buildings of different sizes.
  const perSf = (amount: string | null, sqFt: number | null) => {
    const a = num(amount), s = num(sqFt);
    return a && s ? a / s : null;
  };

  const subject = jobs[0];
  const anyBreakdown = useMemo(() => jobs.some(j => num(j.labor_total) || num(j.material_total)), [jobs]);

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading comparable bids…</div>;

  if (error) return <div style={{ padding: 24, color: 'var(--red, #d9534f)', fontSize: 13 }}>{error}</div>;

  if (!comparables.length) return (
    <div style={{ padding: '20px 24px' }}>
      <div className="panel">
        <div className="panel-hdr"><span className="panel-title">Compare Bids</span></div>
        <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
          No comparable bids yet. A past bid shows up here once it has a <b>contract amount</b> and either the
          same <b>brand</b> or the same <b>project type</b> as this one. Import finished bids from the Overview
          tab to build the library.
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Comparable picker */}
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Similar Jobs</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
            Same brand first, then closest square footage
          </span>
        </div>
        <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {comparables.map(c => {
            const on = selected.has(c.id);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '8px 11px',
                  border: `1px solid ${on ? 'var(--blue)' : 'var(--border2)'}`,
                  background: on ? 'rgba(77,141,247,.10)' : 'var(--surface)',
                  color: 'var(--text)', font: 'inherit',
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {c.brand ? `${c.brand} · ` : ''}{typeLabel(c.project_type)}
                  {c.sq_ft ? ` · ${c.sq_ft.toLocaleString()} SF` : ''}
                  {c.amount ? ` · ${moneyFull(Number(c.amount))}` : ''}
                  {c.has_breakdown ? ' · costed' : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {comparing && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text3)' }}>Building comparison…</div>}

      {!comparing && jobs.length > 1 && (
        <>
          {/* Headline numbers */}
          <div className="panel" style={{ marginTop: 12, overflowX: 'auto' }}>
            <div className="panel-hdr"><span className="panel-title">Job Totals</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ ...headCell, textAlign: 'left' }} />
                  {jobs.map((j, i) => (
                    <th key={j.id} style={{ ...headCell, textAlign: 'left', color: i === 0 ? 'var(--blue)' : 'var(--text3)' }}>
                      {i === 0 ? 'This bid' : ''}<div style={{ color: 'var(--text)', fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>{j.name}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([
                  ['Square feet',   (j: CompareJob) => j.sq_ft ? j.sq_ft.toLocaleString() : '—'],
                  ['Contract',      (j: CompareJob) => j.amount ? moneyFull(Number(j.amount)) : '—'],
                  ['$ / SF',        (j: CompareJob) => { const v = perSf(j.amount, j.sq_ft); return v ? `$${v.toFixed(2)}` : '—'; }],
                  ['Takeoff items', (j: CompareJob) => (j.categories ?? []).reduce((s, c) => s + c.itemCount, 0) || '—'],
                ] as [string, (j: CompareJob) => React.ReactNode][]).map(([label, fn]) => (
                  <tr key={label}>
                    <td style={{ ...cell, fontWeight: 700, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</td>
                    {jobs.map(j => <td key={j.id} style={cell}>{fn(j)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cost drivers — only for jobs with an Accubid breakdown on file */}
          {anyBreakdown && (
            <div className="panel" style={{ marginTop: 12, overflowX: 'auto' }}>
              <div className="panel-hdr">
                <span className="panel-title">Cost Drivers</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>From the Accubid breakdown</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <tbody>
                  {([
                    ['Material',    (j: CompareJob) => j.material_total],
                    ['Labor',       (j: CompareJob) => j.labor_total],
                    ['Equipment',   (j: CompareJob) => j.equipment_total],
                    ['Gear quotes', (j: CompareJob) => j.quotes_total],
                  ] as [string, (j: CompareJob) => string | null][]).map(([label, fn]) => (
                    <tr key={label}>
                      <td style={{ ...cell, fontWeight: 700, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</td>
                      {jobs.map(j => {
                        const v = num(fn(j));
                        const sf = num(j.sq_ft);
                        return (
                          <td key={j.id} style={cell}>
                            {v ? moneyFull(v) : '—'}
                            {v && sf ? <span style={{ color: 'var(--text3)' }}> · ${(v / sf).toFixed(2)}/SF</span> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...cell, fontWeight: 700, color: 'var(--text3)', whiteSpace: 'nowrap' }}>Labor hours</td>
                    {jobs.map(j => {
                      const h = num(j.labor_hours), sf = num(j.sq_ft);
                      return (
                        <td key={j.id} style={cell}>
                          {h ? h.toLocaleString() : '—'}
                          {h && sf ? <span style={{ color: 'var(--text3)' }}> · {(h / sf * 1000).toFixed(1)}/1k SF</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Takeoff quantities by category */}
          <div className="panel" style={{ marginTop: 12, overflowX: 'auto' }}>
            <div className="panel-hdr">
              <span className="panel-title">Takeoff by Category</span>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>Click a category for line-item detail</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <tbody>
                {categoryNames.map(name => {
                  const open = openCategory === name;
                  const subjCat = subject?.categories?.find(c => c.name === name);
                  return (
                    <React.Fragment key={name}>
                      <tr onClick={() => openDrill(name)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...cell, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <Icon name="chevron-down" size={12} stroke={2.4}
                            style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s', marginRight: 6, verticalAlign: -1 }}/>
                          {name}
                        </td>
                        {jobs.map((j, i) => {
                          const c = j.categories?.find(x => x.name === name);
                          // Flag a category the subject has and a comp doesn't (or vice versa) —
                          // that's usually the real scope difference.
                          const missing = i > 0 && !!subjCat !== !!c;
                          return (
                            <td key={j.id} style={{ ...cell, color: missing ? 'var(--amber, #e0a53b)' : undefined }}>
                              {c ? <>{fmtTotals(c.totals)}<span style={{ color: 'var(--text3)' }}> · {c.itemCount} items</span></> : 'not in takeoff'}
                            </td>
                          );
                        })}
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={jobs.length + 1} style={{ padding: 0, background: 'var(--surface2, rgba(0,0,0,.03))' }}>
                            <div style={{ display: 'flex', gap: 16, padding: 12, overflowX: 'auto' }}>
                              {jobs.map(j => (
                                <div key={j.id} style={{ flex: '1 1 0', minWidth: 240 }}>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 6 }}>{j.name}</div>
                                  {(lines[j.id] ?? []).filter(l => l.category === name).map((l, idx) => (
                                    <div key={idx} style={{ fontSize: 11.5, marginBottom: 4, lineHeight: 1.45 }}>
                                      <b>{l.qty} {l.unit}</b> — {l.description}
                                    </div>
                                  ))}
                                  {!(lines[j.id] ?? []).some(l => l.category === name) && (
                                    <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>No items in this category.</div>
                                  )}
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
        </>
      )}

      {!comparing && jobs.length <= 1 && selected.size > 0 && (
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text3)' }}>Select at least one job above to compare.</div>
      )}
    </div>
  );
}
