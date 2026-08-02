// Per-category quantity comparison + cost drivers for the Pre-Bid tab. Both panels read
// the same GET /compare?kind=prebid payload, so they share one fetch.
import { useEffect, useState } from 'react';
import api from '../../api/client';
import { per1kSf } from '../bid-hub/compareMath';

interface Subcategory { name: string; itemCount: number; totals: Record<string, number> }
interface Category {
  name: string; itemCount: number; unresolvedCount: number;
  totals: Record<string, number>; subcategories: Subcategory[];
}
interface CompareJob { id: string; name: string; sq_ft: number | string | null; categories: Category[] | null }

const cell: React.CSSProperties = {
  padding: '8px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border2)', verticalAlign: 'top',
};
const headCell: React.CSSProperties = {
  ...cell, fontWeight: 800, fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase',
  letterSpacing: .3, whiteSpace: 'nowrap',
};

// sq_ft can arrive as a numeric string from Postgres depending on column type; be
// defensive rather than assume the driver already coerced it (matches BidCompare's num()).
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normPerCat(job: CompareJob | undefined, name: string): number | null {
  const c = job?.categories?.find(c => c.name === name);
  const sf = num(job?.sq_ft);
  if (!c || !sf) return null;
  return per1kSf(c.itemCount, sf);
}

// A subcategory that's just the bare category name (no further split) doesn't represent a
// real scope difference — it's the "this job's takeoff wasn't split further" case, not a
// cost driver. Only a genuine sub-split (a name distinct from the category) counts.
function splitNames(cat: Category | undefined, categoryName: string): Set<string> {
  const names = (cat?.subcategories ?? []).map(s => s.name)
    .filter(n => n.toUpperCase() !== categoryName.toUpperCase());
  return new Set(names);
}

interface Driver { category: string; name: string; side: 'subject' | 'comp' }

function findDrivers(subject: CompareJob | undefined, comp: CompareJob | undefined, categoryNames: string[]): Driver[] {
  const drivers: Driver[] = [];
  for (const name of categoryNames) {
    const subjCat = subject?.categories?.find(c => c.name === name);
    const compCat = comp?.categories?.find(c => c.name === name);
    const subjNames = splitNames(subjCat, name);
    const compNames = splitNames(compCat, name);
    for (const n of subjNames) if (!compNames.has(n)) drivers.push({ category: name, name: n, side: 'subject' });
    for (const n of compNames) if (!subjNames.has(n)) drivers.push({ category: name, name: n, side: 'comp' });
  }
  return drivers;
}

export default function PreBidQuantityCompare({ bidId, compId, compName }: {
  bidId: string; compId: string; compName: string;
}) {
  const [jobs, setJobs] = useState<CompareJob[]>([]);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/preconstruction/${bidId}/compare`, { params: { kind: 'prebid', against: compId } })
      .then(r => {
        if (cancelled) return;
        setJobs(r.data?.jobs ?? []);
        setCategoryNames(r.data?.categoryNames ?? []);
      })
      .catch(() => { if (!cancelled) setError('Could not load the quantity comparison.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bidId, compId]);

  if (loading) return <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Loading comparison…</div>;
  if (error) return <div style={{ padding: 16, fontSize: 12.5, color: 'var(--amber)' }}>{error}</div>;

  const subject = jobs.find(j => j.id === bidId);
  const comp = jobs.find(j => j.id === compId);

  if (!categoryNames.length) {
    return (
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-hdr"><span className="panel-title">Quantity comparison</span></div>
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>
          Neither job has a takeoff category to compare yet.
        </div>
      </div>
    );
  }

  const drivers = findDrivers(subject, comp, categoryNames);

  return (
    <>
      <div className="panel" style={{ marginBottom: 14, overflowX: 'auto' }}>
        <div className="panel-hdr">
          <span className="panel-title">Quantity comparison — items per 1,000 SF</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ ...headCell, textAlign: 'left' }}>Category</th>
              <th style={{ ...headCell, textAlign: 'left' }}>This job</th>
              <th style={{ ...headCell, textAlign: 'left' }}>{compName}</th>
              <th style={{ ...headCell, textAlign: 'left' }}>Delta</th>
            </tr>
          </thead>
          <tbody>
            {categoryNames.map(name => {
              const subjCat = subject?.categories?.find(c => c.name === name);
              const compCat = comp?.categories?.find(c => c.name === name);
              const subjNorm = normPerCat(subject, name);
              const compNorm = normPerCat(comp, name);
              const gap = !subjCat !== !compCat;
              const delta = subjNorm != null && compNorm != null && compNorm !== 0
                ? ((subjNorm - compNorm) / compNorm) * 100
                : null;
              return (
                <tr key={name}>
                  <td style={{ ...cell, fontWeight: 700 }}>{name}</td>
                  <td style={{ ...cell, color: gap && !subjCat ? 'var(--amber)' : undefined }}>
                    {subjCat
                      ? (subjNorm != null ? `${subjNorm.toFixed(1)} /1k SF` : `${subjCat.itemCount} items`)
                      : 'Not in this job’s takeoff'}
                  </td>
                  <td style={{ ...cell, color: gap && !compCat ? 'var(--amber)' : undefined }}>
                    {compCat
                      ? (compNorm != null ? `${compNorm.toFixed(1)} /1k SF` : `${compCat.itemCount} items`)
                      : `Not in ${compName}’s takeoff`}
                  </td>
                  <td style={cell}>
                    {gap
                      ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>gap</span>
                      : (delta != null ? `${delta > 0 ? '+' : ''}${Math.round(delta)}%` : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-hdr">
          <span className="panel-title">Cost drivers</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            Subcategories present on only one job — the category rollup hides these
          </span>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 13 }}>
          {drivers.length === 0 && (
            <div style={{ color: 'var(--muted)' }}>No one-sided subcategories found between these two jobs.</div>
          )}
          {drivers.map((d, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <strong>{d.name}</strong>{' '}
              <span style={{ color: 'var(--muted)' }}>
                — only on {d.side === 'subject' ? 'this job' : compName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
