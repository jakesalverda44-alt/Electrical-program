// Scope side-by-side for the Pre-Bid tab. Aligned by normalized section TITLE, never by
// letter — the two lettering schemes collide (pre-bid D is Site, the CRM's D is Low
// Voltage; pre-bid E is Low Voltage, the CRM's E is Fire Alarm). Reuses the same
// normalizeTitle approach as buildScopeFromPrebid so this can't quietly regress to
// letter-alignment.
import { useEffect, useState } from 'react';
import api from '../../api/client';
import { PrebidSection, normalizeTitle } from './prebidScope';

interface AlignedRow { key: string; title: string; subjectItems: string[] | null; compItems: string[] | null }

function alignSections(subject: PrebidSection[], comp: PrebidSection[]): AlignedRow[] {
  const rows: AlignedRow[] = [];
  const seen = new Set<string>();
  const compByKey = new Map(comp.map(s => [normalizeTitle(s.title), s]));
  for (const s of subject) {
    const key = normalizeTitle(s.title);
    seen.add(key);
    const c = compByKey.get(key);
    rows.push({ key, title: s.title, subjectItems: s.items ?? [], compItems: c ? (c.items ?? []) : null });
  }
  for (const c of comp) {
    const key = normalizeTitle(c.title);
    if (seen.has(key)) continue;
    rows.push({ key, title: c.title, subjectItems: null, compItems: c.items ?? [] });
  }
  return rows;
}

const col: React.CSSProperties = { flex: '1 1 0', minWidth: 220 };

export default function PreBidScopeCompare({ bidId, compId, compName, subjectSections }: {
  bidId: string; compId: string; compName: string; subjectSections: PrebidSection[];
}) {
  const [compSections, setCompSections] = useState<PrebidSection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/preconstruction/${compId}/prebid`)
      .then(r => { if (!cancelled) setCompSections(r.data?.scope?.sections ?? null); })
      .catch(() => { if (!cancelled) setError('Could not load the comparable’s scope.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bidId, compId]);

  if (loading) return <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>Loading scope…</div>;
  if (error) return <div style={{ padding: 16, fontSize: 12.5, color: 'var(--amber)' }}>{error}</div>;

  if (!subjectSections.length && !(compSections ?? []).length) {
    return (
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-hdr"><span className="panel-title">Scope side-by-side</span></div>
        <div style={{ padding: 16, fontSize: 12.5, color: 'var(--muted)' }}>
          Neither job has a pre-bid scope to compare.
        </div>
      </div>
    );
  }

  const rows = alignSections(subjectSections, compSections ?? []);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-hdr">
        <span className="panel-title">Scope side-by-side</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Aligned by section title, not letter</span>
      </div>
      <div style={{ padding: '10px 16px' }}>
        {rows.map(row => (
          <div key={row.key} style={{ display: 'flex', gap: 16, marginBottom: 14, borderBottom: '1px solid var(--border2)', paddingBottom: 10 }}>
            <div style={col}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>{row.title}</div>
              {row.subjectItems === null ? (
                <div style={{ color: 'var(--amber)', fontSize: 12 }}>Not in this job’s scope</div>
              ) : (
                row.subjectItems.map((it, i) => <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>• {it}</div>)
              )}
            </div>
            <div style={col}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4, color: 'var(--muted)' }}>{compName}</div>
              {row.compItems === null ? (
                <div style={{ color: 'var(--amber)', fontSize: 12 }}>Not in {compName}’s scope</div>
              ) : (
                row.compItems.map((it, i) => <div key={i} style={{ fontSize: 12, marginBottom: 2, color: 'var(--muted)' }}>• {it}</div>)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
