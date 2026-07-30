import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { PrebidSection } from './prebidScope';
import PreBidUpload from './PreBidUpload';
import PreBidQuantityCompare from './PreBidQuantityCompare';
import PreBidScopeCompare from './PreBidScopeCompare';
import PreBidAnalyze from './PreBidAnalyze';

interface Subcategory { name: string; itemCount: number; totals: Record<string, number> }
interface Category {
  name: string; itemCount: number; unresolvedCount: number;
  totals: Record<string, number>; subcategories: Subcategory[];
}
interface LineItem {
  category: string; description: string; unit: string;
  qty: number | null; qtyRaw?: string; confidence?: string; notes?: string;
}
interface Comparable {
  id: string; name: string; sq_ft: number | null; project_type: string | null;
  stage: string; sq_ft_delta_pct: number | null;
}
interface AiComparison {
  majorDifferences?: string[]; costDrivers?: string[]; missingScope?: string[]; notes?: string;
}

export default function PreBidTab({ bidId, onSectionsLoaded }: {
  bidId: string;
  onSectionsLoaded: (s: PrebidSection[]) => void;
}) {
  const [pkg, setPkg] = useState<{ takeoff: null | {
    item_count: number; categories: Category[]; line_items: LineItem[]; key_findings: string[];
  }; scope: null | {
    furnish_model: string | null; furnish_note: string | null;
    meta: Record<string, string>; sections: PrebidSection[];
    ai_comparison: AiComparison | null; ai_comparison_against: string | null;
    ai_status: string | null; ai_error: string | null;
  } } | null>(null);
  const [comps, setComps] = useState<Comparable[]>([]);
  const [selected, setSelected] = useState<Comparable | null>(null);

  const refetch = useCallback(() => {
    api.get(`/preconstruction/${bidId}/prebid`).then(r => {
      setPkg(r.data);
      if (r.data?.scope?.sections) onSectionsLoaded(r.data.scope.sections);
    });
    api.get(`/preconstruction/${bidId}/prebid-comparables`)
      .then(r => setComps(r.data?.comparables ?? []))
      .catch(() => setComps([]));
  }, [bidId, onSectionsLoaded]);

  useEffect(() => { refetch(); }, [refetch]);

  if (!pkg) return <div style={{ padding: '20px 24px' }}>Loading…</div>;

  const takeoff = pkg.takeoff;
  const scope = pkg.scope;
  const unresolved = (takeoff?.line_items ?? []).filter(i => i.qty === null);

  return (
    <div style={{ padding: '20px 24px' }}>
      <PreBidUpload bidId={bidId} hasScope={!!scope} hasTakeoff={!!takeoff} onImported={refetch}/>

      {!takeoff && !scope && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ padding: 16, fontSize: 13, color: 'var(--muted)' }}>
            Upload the pre-bid package (scope .docx and quantity takeoff .xlsx) above to
            compare this job against similar past bids.
          </div>
        </div>
      )}

      {scope?.furnish_model === 'OFEI' && (
        <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
          <div className="panel-hdr"><span className="panel-title">OFEI — Owner-Furnished, EC-Installed</span></div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            Gear and fixtures are owner-furnished on this job, so its cost per square foot
            reads structurally low against ECFECI comparables. {scope.furnish_note}
          </div>
        </div>
      )}

      {comps.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr"><span className="panel-title">Similar jobs</span></div>
          <div style={{ padding: '10px 16px' }}>
            {comps.map(c => (
              <button key={c.id} onClick={() => setSelected(c)}
                style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                         fontSize: 13, background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                <strong>{c.name}</strong>
                {c.sq_ft_delta_pct != null && (
                  <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
                    This job is {Math.abs(Math.round(c.sq_ft_delta_pct))}%{' '}
                    {c.sq_ft_delta_pct >= 0 ? 'larger' : 'smaller'} than {c.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {takeoff && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Quantity takeoff — {takeoff.item_count} items</span>
          </div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            {takeoff.categories.map(cat => (
              <div key={cat.name} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>
                  {cat.name}
                  <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                    {cat.itemCount} items
                    {cat.unresolvedCount > 0 && ` · ${cat.unresolvedCount} unresolved`}
                  </span>
                </div>
                {cat.subcategories.length > 1 && cat.subcategories.map(s => (
                  <div key={s.name} style={{ paddingLeft: 14, color: 'var(--muted)' }}>
                    {s.name} — {s.itemCount} items
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Unresolved — {unresolved.length} items need verification</span>
          </div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            {unresolved.map((i, n) => (
              <div key={n} style={{ marginBottom: 6 }}>
                <strong>{i.description}</strong>{' '}
                <span style={{ color: 'var(--amber)' }}>{i.qtyRaw ?? i.confidence}</span>
                {i.notes && <div style={{ color: 'var(--muted)' }}>{i.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>Comparing against {selected.name}</div>
          <PreBidQuantityCompare bidId={bidId} compId={selected.id} compName={selected.name}/>
          <PreBidScopeCompare bidId={bidId} compId={selected.id} compName={selected.name}
            subjectSections={scope?.sections ?? []}/>
          <PreBidAnalyze bidId={bidId} compId={selected.id} compName={selected.name}
            initialAgainst={scope?.ai_comparison_against ?? null}
            initialStatus={scope?.ai_status ?? null}
            initialComparison={scope?.ai_comparison ?? null}
            initialError={scope?.ai_error ?? null}/>
        </>
      )}
    </div>
  );
}
