// "Compare Bids" tab — puts this bid next to similar past jobs so you can see what
// actually differs before pricing a new one. Comparables are ranked same-brand first
// (chain prototypes are near-identical), then by nearest square footage.
import React, { useEffect, useState, useMemo } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { PROJECT_TYPES } from './constants';
import { moneyFull } from '../../lib/money';
import { per1kSf, median, deltaVsMedian, isOutlier } from '../bid-hub/compareMath';

interface Comparable {
  id: string; name: string; gc: string; stage: string;
  brand: string | null; project_type: string | null;
  sq_ft: number | null; amount: string | null;
  has_takeoff: boolean; has_breakdown: boolean; labor_hours: string | null;
  awarded_at: string | null;
}

interface CategoryRollup { name: string; itemCount: number; totals: Record<string, number> }

interface CompareJob {
  id: string; name: string; gc: string; stage: string; brand: string | null;
  project_type: string | null; sq_ft: number | null; amount: string | null;
  categories: CategoryRollup[] | null;
  material_total: string | null; labor_total: string | null;
  equipment_total: string | null; quotes_total: string | null;
  labor_hours: string | null; journeyman_hours: string | null; apprentice_hours: string | null;
  avg_labor_rate: string | null; avg_crew_size: string | null; labor_risk_ratio: string | null;
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

const outcomeYear = (awardedAt?: string | null): number | null => {
  if (!awardedAt) return null;
  const d = new Date(awardedAt);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
};

function OutcomeBadge({ stage, year }: { stage: string; year?: number | null }) {
  const cls = stage === 'awarded' ? 'won' : stage === 'lost' ? 'lost' : 'normal';
  const label = stage === 'awarded' ? 'Won' : stage === 'lost' ? 'Lost' : 'Open';
  return <span className={`badge ${cls}`}>{label}{year ? ` · ${year}` : ''}</span>;
}

const deltaText = (delta: number | null) =>
  delta === null ? '' : ` (${delta > 0 ? '+' : ''}${Math.round(delta * 100)}% vs comps)`;

type NormMode = 'dollarPerSf' | 'hoursPer1k' | 'raw';
interface CostRowSpec {
  label: string;
  raw: (j: CompareJob) => number | null;
  mode: NormMode;
  fmt: (v: number) => string;
}

const COST_ROWS: CostRowSpec[] = [
  { label: 'Material',          raw: j => num(j.material_total),  mode: 'dollarPerSf', fmt: moneyFull },
  { label: 'Labor',             raw: j => num(j.labor_total),     mode: 'dollarPerSf', fmt: moneyFull },
  { label: 'Equipment',         raw: j => num(j.equipment_total), mode: 'dollarPerSf', fmt: moneyFull },
  { label: 'Gear quotes',       raw: j => num(j.quotes_total),    mode: 'dollarPerSf', fmt: moneyFull },
  { label: 'Labor hours',       raw: j => num(j.labor_hours),      mode: 'hoursPer1k', fmt: v => v.toLocaleString() },
  { label: 'Journeyman hours',  raw: j => num(j.journeyman_hours), mode: 'hoursPer1k', fmt: v => v.toLocaleString() },
  { label: 'Apprentice hours',  raw: j => num(j.apprentice_hours), mode: 'hoursPer1k', fmt: v => v.toLocaleString() },
  { label: 'Avg labor rate',    raw: j => num(j.avg_labor_rate),   mode: 'raw', fmt: v => `$${v.toFixed(2)}/hr` },
  { label: 'Avg crew size',     raw: j => num(j.avg_crew_size),    mode: 'raw', fmt: v => v.toFixed(1) },
  { label: 'Labor risk ratio',  raw: j => num(j.labor_risk_ratio), mode: 'raw', fmt: v => v.toFixed(2) },
];

// Normalize a cost-row's raw value for cross-job comparison: dollar rows become $/SF,
// hour rows become hrs/1k SF, and "raw" rows (rates/ratios/headcount) pass through
// unchanged — they're already comparable across job sizes.
const normValue = (spec: CostRowSpec, j: CompareJob): number | null => {
  const v = spec.raw(j);
  if (v === null) return null;
  if (spec.mode === 'raw') return v;
  const sf = num(j.sq_ft);
  if (!sf) return null;
  return spec.mode === 'dollarPerSf' ? v / sf : per1kSf(v, sf);
};

const COST_HAS_DATA = (j: CompareJob) => COST_ROWS.some(spec => spec.raw(j) !== null);

// sqFt isn't consumed today (empty-state classification only needs brand/projectType)
// but is accepted for parity with the caller's subject-bid fields and future use.
export default function BidCompare({ bidId, brand, projectType }: {
  bidId: string; sqFt?: number | null; brand?: string | null; projectType?: string | null;
}) {
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, TakeoffLine[]>>({});
  const [takeoffErrors, setTakeoffErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
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
    setError(null);
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
          .catch((err: unknown) => {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 403) {
              setTakeoffErrors(prev => ({ ...prev, [j.id]: "You don't have access to this job's takeoff" }));
            }
            return [j.id, [] as TakeoffLine[]] as const;
          })
      ));
      setLines(prev => ({ ...prev, ...Object.fromEntries(fetched) }));
    }
  };

  // Per-SF figures are the only fair way to line up buildings of different sizes.
  const perSf = (amount: string | null, sqFtVal: number | null) => {
    const a = num(amount), s = num(sqFtVal);
    return a && s ? a / s : null;
  };

  // Normalized takeoff-category item density (items per 1,000 SF) for a job.
  const catNorm = (j: CompareJob, name: string): number | null => {
    const c = j.categories?.find(x => x.name === name);
    if (!c) return null;
    return per1kSf(c.itemCount, num(j.sq_ft));
  };

  const subject = jobs[0];
  const comps = jobs.slice(1);
  const anyBreakdown = useMemo(() => jobs.some(j => num(j.labor_total) || num(j.material_total)), [jobs]);

  // Benchmark mode: the subject bid has neither a takeoff nor any cost breakdown on
  // file yet, so a job-vs-job diff would just be blanks down the subject column.
  // Show comp medians instead of a diff.
  const benchmarkMode = !!subject && (!subject.categories || subject.categories.length === 0) && !COST_HAS_DATA(subject);

  if (loading) return <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13 }}>Loading comparable bids…</div>;

  if (error) return <div style={{ padding: 24, color: 'var(--red, #d9534f)', fontSize: 13 }}>{error}</div>;

  if (!comparables.length) {
    const noClassification = !brand && !projectType;
    return (
      <div style={{ padding: '20px 24px' }}>
        <div className="panel">
          <div className="panel-hdr"><span className="panel-title">Compare Bids</span></div>
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text3)', lineHeight: 1.6 }}>
            {noClassification ? (
              <>Set a brand or project type to find similar bids.</>
            ) : (
              <>
                No comparable past bids yet. A past bid shows up here once it has a <b>contract amount</b> and either the
                same <b>brand</b> or the same <b>project type</b> as this one. Import finished bids from the Overview
                tab to build the library.
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            const year = outcomeYear(c.awarded_at);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '8px 11px',
                  border: `1px solid ${on ? 'var(--blue)' : 'var(--border2)'}`,
                  background: on ? 'rgba(77,141,247,.10)' : 'var(--surface)',
                  color: 'var(--text)', font: 'inherit',
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.name}
                  <OutcomeBadge stage={c.stage} year={year}/>
                </div>
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

      {!comparing && jobs.length > 1 && benchmarkMode && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-hdr">
            <span className="panel-title">Benchmark from Similar Jobs</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
              No takeoff or cost breakdown on this bid yet — shown as comp medians
            </span>
          </div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: .3 }}>Comps</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{comps.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: .3 }}>Median $ / SF</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                {(() => {
                  const m = median(comps.map(j => perSf(j.amount, j.sq_ft)).filter((v): v is number => v !== null));
                  return m !== null ? `$${m.toFixed(2)}` : '—';
                })()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: .3 }}>Median labor hrs / 1k SF</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                {(() => {
                  const m = median(comps.map(j => {
                    const h = num(j.labor_hours), sf = num(j.sq_ft);
                    return h && sf ? per1kSf(h, sf) : null;
                  }).filter((v): v is number => v !== null));
                  return m !== null ? m.toFixed(1) : '—';
                })()}
              </div>
            </div>
            {COST_ROWS.filter(s => s.mode === 'dollarPerSf').map(spec => {
              const m = median(comps.map(j => normValue(spec, j)).filter((v): v is number => v !== null));
              return (
                <div key={spec.label}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: .3 }}>{spec.label} median $/SF</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{m !== null ? `$${m.toFixed(2)}` : '—'}</div>
                </div>
              );
            })}
          </div>
          {categoryNames.length > 0 && (
            <div style={{ padding: '0 16px 16px', overflowX: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: .3, marginBottom: 8 }}>
                Takeoff category medians (comps only)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 320 }}>
                <tbody>
                  {categoryNames.map(name => {
                    const m = median(comps.map(j => catNorm(j, name)).filter((v): v is number => v !== null));
                    return (
                      <tr key={name}>
                        <td style={{ ...cell, fontWeight: 700 }}>{name}</td>
                        <td style={cell}>{m !== null ? `${m.toFixed(1)} /1k SF` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!comparing && jobs.length > 1 && !benchmarkMode && (
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
                      {i === 0 ? 'This bid' : ''}
                      <div style={{ color: 'var(--text)', fontSize: 12, textTransform: 'none', letterSpacing: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {j.name}
                        <OutcomeBadge stage={j.stage}/>
                      </div>
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
                <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>From the Accubid breakdown · amber = 35%+ off the comp median</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <tbody>
                  {COST_ROWS.map(spec => {
                    const subjNorm = subject ? normValue(spec, subject) : null;
                    const compNorms = comps.map(j => normValue(spec, j));
                    const delta = deltaVsMedian(subjNorm, compNorms);
                    const outlier = isOutlier(delta);
                    return (
                      <tr key={spec.label}>
                        <td style={{ ...cell, fontWeight: 700, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{spec.label}</td>
                        {jobs.map((j, i) => {
                          const raw = spec.raw(j);
                          const norm = normValue(spec, j);
                          const isSubjectCell = i === 0;
                          const tint = isSubjectCell && outlier;
                          return (
                            <td key={j.id} style={{ ...cell, color: tint ? 'var(--amber, #e0a53b)' : undefined }}>
                              {raw === null ? '—' : (
                                <>
                                  {spec.fmt(raw)}
                                  {spec.mode === 'dollarPerSf' && (
                                    norm !== null
                                      ? <span style={{ color: 'var(--text3)' }}> · ${norm.toFixed(2)}/SF</span>
                                      : null
                                  )}
                                  {spec.mode === 'hoursPer1k' && (
                                    norm !== null
                                      ? <span style={{ color: 'var(--text3)' }}> · {norm.toFixed(1)}/1k SF</span>
                                      : <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700 }}> raw</span>
                                  )}
                                  {isSubjectCell && outlier && <span style={{ fontWeight: 700 }}>{deltaText(delta)}</span>}
                                </>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Takeoff quantities by category, normalized per 1,000 SF */}
          <div className="panel" style={{ marginTop: 12, overflowX: 'auto' }}>
            <div className="panel-hdr">
              <span className="panel-title">Takeoff by Category</span>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>Items per 1k SF · click a category for line-item detail</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <tbody>
                {categoryNames.map(name => {
                  const open = openCategory === name;
                  const subjCat = subject?.categories?.find(c => c.name === name);
                  const subjNorm = subject ? catNorm(subject, name) : null;
                  const compNorms = comps.map(j => catNorm(j, name));
                  const delta = deltaVsMedian(subjNorm, compNorms);
                  const outlier = isOutlier(delta);
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
                          const sf = num(j.sq_ft);
                          const norm = c ? per1kSf(c.itemCount, sf) : null;
                          const isSubjectCell = i === 0;
                          const tint = missing || (isSubjectCell && outlier);
                          return (
                            <td key={j.id} title={c ? `${c.itemCount} items — ${fmtTotals(c.totals)}` : undefined}
                              style={{ ...cell, color: tint ? 'var(--amber, #e0a53b)' : undefined }}>
                              {c ? (
                                <>
                                  {sf && norm !== null
                                    ? <>{norm.toFixed(1)} /1k SF</>
                                    : <>{c.itemCount} items <span style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700 }}>raw</span></>}
                                  <span style={{ color: 'var(--text3)', display: 'block', fontSize: 10.5 }}>{c.itemCount} items · {fmtTotals(c.totals)}</span>
                                  {isSubjectCell && outlier && <span style={{ fontWeight: 700 }}>{deltaText(delta)}</span>}
                                </>
                              ) : 'not in takeoff'}
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
                                    <div style={{ fontSize: 11.5, color: takeoffErrors[j.id] ? 'var(--red, #d9534f)' : 'var(--text3)' }}>
                                      {takeoffErrors[j.id] ?? 'No items in this category.'}
                                    </div>
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
