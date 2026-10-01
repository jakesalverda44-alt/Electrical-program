// Accuracy round C7 — the feeder estimate on Labor & Pricing: one card per
// feeder (from → to) with the length math, the scale tier, what is missing,
// and the estimator's moves:
//   * Show on plans — the sheet its route (or a located end) is on;
//   * Adopt as run — a same-sheet route becomes a confirmed linear markup on
//     the feeder's conduit line (drops 2 × half the vertical + makeup, the
//     default slack), then applied — the line's qty comes from the plans;
//   * Confirm length — a cross-sheet length kept as the estimator's own qty;
//   * Pin endpoint — the Plans view, to drop a count marker named the node;
//   * Type length — the run length typed (conduit = run × sets).
// Plus the "Calibration job" checkbox (Jake's decision 4).
import React, { useState } from 'react';
import api from '../../api/client';
import { useApi } from '../../hooks/useApi';
import type { ApplyMarkupsResponse, EstimateLine } from './types';
import { PricingCard } from './pricing/PricingCard';
import { feedersSummary } from './pricing/laborPricingModel';

export interface FeederEndpointWire { node: string; located: boolean; sheetKey?: string; documentId?: string | null; pageIndex?: number | null; x?: number; y?: number; source?: string; confidence?: string; note?: string; hold?: string }
export interface FeederEdgeWire {
  id: string; from: string; to: string; kind: string; spec: string | null;
  status: 'estimated' | 'hold'; lengthFt: number | null; tier: string | null; underground: boolean;
  /** Parallel sets (the "(2)" of "(2)4#3/0"): the route length is per set; conduit and wire are priced per set. */
  sets?: number;
  math: string; holds: string[]; quotes: string[];
  endpoints: FeederEndpointWire[];
  route: { documentId: string | null; pageIndex: number | null; sheetKey: string | null; points: Array<{ x: number; y: number }> } | null;
  quantities: { conduitFt: number; conductors: Array<{ size: string; ground: boolean; count: number; ft: number }> } | null;
  verticalFt: number | null; makeupFt: number | null;
}
export interface FeedersResponse {
  priced: boolean; stage: string | null; calibration: boolean; slackPct: number;
  edges: FeederEdgeWire[];
  taps: Array<{ from: string; to: string; quote: string }>;
  skipped: Array<{ to: string; quote: string; reason: string }>;
  scales: Array<{ label: string; tier: string; ftPerPt: number | null; basis: string }>;
  summary: { suggested: number; confirmed: number; holds: number };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyItem = (k: string | null | undefined) => { const s = k ?? ''; const i = s.indexOf('||'); return (i >= 0 ? s.slice(i + 2) : s).replace(/::\d+$/, ''); };

/** The feeder's conduit line in the estimate (the C6 row "Feeder — A → B: <conduit>"). */
export function feederConduitLine(lines: EstimateLine[], edge: Pick<FeederEdgeWire, 'from' | 'to'>): { line: EstimateLine; idx: number } | null {
  const label = `${edge.from} → ${edge.to}`;
  const idx = lines.findIndex(l => {
    const item = keyItem(l.takeoff_key);
    return (item.startsWith(`Feeder — ${label}: `) && !/ wire \(/.test(item)) || (item.startsWith('MEASURE FEEDER — ') && item.endsWith(` — ${label}`) && / conduit/.test(item));
  });
  return idx >= 0 ? { line: lines[idx], idx } : null;
}

function sheetOf(e: FeederEdgeWire): string | null {
  if (e.route?.documentId && e.route.pageIndex != null) return `${e.route.documentId}:${e.route.pageIndex}`;
  const p = e.endpoints.find(x => x.located && x.documentId && x.pageIndex != null);
  return p ? `${p.documentId}:${p.pageIndex}` : null;
}

export interface FeedersPanelProps {
  bidId: string;
  lines: EstimateLine[];
  setLines: (fn: (prev: EstimateLine[]) => EstimateLine[]) => void;
  dirty?: boolean;
  /** Installs apply-markups' saved {lines, recap} (useEstimatingBid.installSaved). */
  onApplied?: (save: ApplyMarkupsResponse['save']) => void;
  /** Opens the Plans view on a sheet (`<documentId>:<pageIndex>`), or with no sheet. */
  onShowOnPlans?: (sheetKey: string | null) => void;
  showToast?: (t: { title: string; sub?: string; variant?: 'success' | 'error' }) => void;
}

export function FeedersPanel({ bidId, lines, setLines, dirty, onApplied, onShowOnPlans, showToast }: FeedersPanelProps) {
  const { data, reload } = useApi<FeedersResponse>(`/estimating/${bidId}/feeders`);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || !Array.isArray(data.edges)) return null;
  // UI cleanup round 2B — a card; the Calibration checkbox is pinned (always visible, even folded or with no feeders).
  return (
    <PricingCard
      storageKey="est-lp-feeders-open" defaultOpen title="Feeders" testId="lp-feeders" summary={feedersSummary(data)} summaryTestId="lp-feeders-card-summary"
      collapsible={data.edges.length > 0}
      pinned={<CalibrationToggle bidId={bidId} data={data} onChanged={reload} showToast={showToast} />}
    >
      {data.edges.length > 0 ? (
        <div className="lp-feeders-body">
          <div className="lp-feeders-head" data-testid="lp-feeders-summary">
            Feeders — {data.summary.suggested} length{data.summary.suggested === 1 ? '' : 's'} suggested (confirm){data.summary.confirmed ? `, ${data.summary.confirmed} on a confirmed scale` : ''}, {data.summary.holds} need a location / scale / size
            {!data.priced && <span className="lp-feeders-note"> — lengths are shown only: this bid is {data.stage ?? 'not due'} and not a calibration job, so they are not priced.</span>}
          </div>
          {data.edges.map(e => {
            const conduit = feederConduitLine(lines, e);
            const sets = Math.max(1, e.sets ?? 1);
            const sheet = sheetOf(e);
            const sameSheet = !!e.route && e.route.points.length > 1 && !!e.route.documentId;
            // A markup measures ONE route; a parallel-set feeder needs conduit AND wire x sets, which a markup
            // cannot carry (it would halve both) — Adopt is off for sets > 1 (Type length does it right).
            const canAdopt = e.status === 'estimated' && sameSheet && !!conduit && UUID_RE.test(conduit.line.line_key ?? '') && !dirty && sets === 1;
            const adopt = async () => {
              if (!conduit || !e.route?.documentId || e.route.pageIndex == null) return;
              setBusy(e.id);
              try {
                const dropFt = Math.round((((e.verticalFt ?? 0) + (e.makeupFt ?? 0)) / 2) * 100) / 100;
                await api.post(`/estimating/${bidId}/markups/batch`, {
                  creates: [{ id: crypto.randomUUID(), document_id: e.route.documentId, page_index: e.route.pageIndex, line_key: conduit.line.line_key, kind: 'linear', points: e.route.points, drops: 2, drop_ft: dropFt, slack_pct: data.slackPct }],
                  updates: [], deletes: [],
                });
                const { data: res } = await api.post<ApplyMarkupsResponse>(`/estimating/${bidId}/apply-markups`, { line_keys: [conduit.line.line_key] });
                if (res.skipped.length) showToast?.({ variant: 'error', title: 'The run could not be applied', sub: res.skipped.map(x => x.reason).join('; ') });
                else showToast?.({ title: `Adopted ${e.from} → ${e.to} as a measured run` });
                onApplied?.(res.save);
                reload();
              } catch {
                showToast?.({ variant: 'error', title: 'Adopt as run failed', sub: 'Try again' });
              } finally { setBusy(null); }
            };
            const setQty = (qty: number, note: string) => conduit && setLines(prev => prev.map((l, i) => (i === conduit.idx ? { ...l, qty, qty_overridden: true, qty_source: 'manual', evidence_note: note } : l)));
            const typedFt = Number(typed[e.id]);
            return (
              <div key={e.id} className="lp-feeder-card" data-testid={`lp-feeder-${e.id}`}>
                <div className="lp-feeder-title">
                  <strong>{e.from} → {e.to}</strong>
                  <span className="lp-feeder-kind">{e.kind.replace('_', ' ')}{e.spec ? ` · ${e.spec.replace('|', ' ')}` : ''}</span>
                  <span className={`lp-feeder-status lp-feeder-status-${e.status}`} data-testid={`lp-feeder-status-${e.id}`}>
                    {e.status === 'estimated' ? `${e.lengthFt} ft · ${e.tier === 'confirmed' ? 'confirmed scale' : 'suggested — confirm'}` : 'needs: ' + (e.holds[0]?.replace(/^needs:?\s*/, '') ?? 'a location')}
                  </span>
                </div>
                <div className="lp-feeder-math" data-testid={`lp-feeder-math-${e.id}`}>{e.math}</div>
                {e.holds.length > 1 && <ul className="lp-feeder-holds">{e.holds.slice(1).map(h => <li key={h}>{h}</li>)}</ul>}
                <div className="lp-feeder-actions">
                  <button type="button" className="btn ghost sm" disabled={!sheet} data-testid={`lp-feeder-show-${e.id}`} onClick={() => onShowOnPlans?.(sheet)}>Show on plans</button>
                  {sameSheet && e.status === 'estimated' && (
                    <button type="button" className="btn ghost sm" disabled={!canAdopt || busy === e.id} data-testid={`lp-feeder-adopt-${e.id}`}
                      title={sets > 1 ? `${sets} parallel sets: a plan markup measures one route and would halve the conduit and wire — use Type length (run ft × ${sets})` : !conduit ? 'No feeder line in the estimate yet — sync from takeoff' : dirty || !UUID_RE.test(conduit.line.line_key ?? '') ? 'Save the estimate first' : 'Draws this route as a confirmed run on its conduit line (the sheet needs a confirmed scale)'}
                      onClick={() => void adopt()}>Adopt as run</button>
                  )}
                  {!sameSheet && e.status === 'estimated' && (
                    <button type="button" className="btn ghost sm" disabled={!conduit} data-testid={`lp-feeder-confirm-${e.id}`}
                      onClick={() => setQty(e.quantities?.conduitFt ?? 0, `Confirmed feeder length estimate: ${e.math}`)}>Confirm length</button>
                  )}
                  {e.endpoints.filter(p => !p.located).map(p => (
                    <button key={p.node} type="button" className="btn ghost sm" data-testid={`lp-feeder-pin-${e.id}-${p.node}`}
                      onClick={() => { onShowOnPlans?.(sheet); showToast?.({ title: `Pin ${p.node}`, sub: `Use the count tool on the Plans view and name the marker "${p.node}", then confirm it.` }); }}>
                      Pin {p.node}
                    </button>
                  ))}
                  <span className="lp-feeder-type">
                    <input type="number" min={0} placeholder="run ft" value={typed[e.id] ?? ''} data-testid={`lp-feeder-length-${e.id}`}
                      onChange={ev => setTyped(prev => ({ ...prev, [e.id]: ev.target.value }))} disabled={!conduit} />
                    <button type="button" className="btn ghost sm" disabled={!conduit || !(typedFt > 0)} data-testid={`lp-feeder-length-set-${e.id}`}
                      title={conduit ? undefined : 'Type it on the MEASURE FEEDER line in the table'}
                      onClick={() => setQty(typedFt * sets, `Typed feeder run ${typedFt} ft for ${e.from} → ${e.to}${sets > 1 ? ` × ${sets} parallel sets` : ''}.`)}>Type length</button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </PricingCard>
  );
}

/** Jake's decision 4 — the per-bid "Calibration job" flag. */
export function CalibrationToggle({ bidId, data, onChanged, showToast }: { bidId: string; data: Pick<FeedersResponse, 'calibration'>; onChanged: () => void; showToast?: FeedersPanelProps['showToast'] }) {
  const [saving, setSaving] = useState(false);
  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await api.patch(`/bids/${bidId}`, { calibration: next });
      onChanged();
      showToast?.({ title: next ? 'Marked as a calibration job' : 'No longer a calibration job', sub: 'Sync from takeoff to update the lines.' });
    } catch {
      showToast?.({ variant: 'error', title: 'Could not change the calibration flag' });
    } finally { setSaving(false); }
  };
  return (
    <label className="lp-calibration" data-testid="lp-calibration">
      <input type="checkbox" checked={data.calibration} disabled={saving} data-testid="lp-calibration-checkbox" onChange={ev => void toggle(ev.target.checked)} />
      {' '}Calibration job — always add the automatic allowance, default and feeder lines, whatever the stage. Use for test jobs. On a submitted or sold bid, syncing while this is on rewrites its saved lines (new rows can stay after you turn it off), so only turn it on for a test copy.
    </label>
  );
}
