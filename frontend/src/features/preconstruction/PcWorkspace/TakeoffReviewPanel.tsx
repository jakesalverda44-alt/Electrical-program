// Takeoff accuracy, Task 7 — the Needs-review list in the Takeoff step.
//
// Every fixture/device/equipment type that came back 0 or unreadable from the
// counting stage, every pole type with no heads-per-pole, and (Task 8) every
// furnish/install scope question the drawings don't answer. While any item
// is open, Agent 4, the proposal .docx, the GC takeoff .xlsx and the send are
// blocked on the server; this panel is where the estimator clears them:
//   * enter a count,
//   * use the count of CONFIRMED markers on the plans (Plans view), or
//   * mark it "Not on this job" with a reason (bulk: several at once).
// Also shows what the counter did (sheets counted / not counted and why,
// flags, the load cross-check, Agent 1 rows it removed) so nothing about the
// numbers is hidden.
import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../api/client';
import './takeoffReview.css';
import type { Toast } from '../../../types';
import { useConfirm } from '../../../components/ConfirmDialog';
import { signalEstimateStale } from '../../estimating/estimateSignals';
import { actionsOf, cardKindOf, groupKey, orderedGroups, resolutionText } from './review/reviewModel';
import ReviewCardShell from './review/ReviewCardShell';
import TypicalAssignCard from './review/TypicalAssignCard';
import { ChoiceCard, ConfirmCard, CountCard, LegendGroupCard, QuantityCard, ReconcileCard, UnlistedCard } from './review/reviewCards';

// UI cleanup round 2A — the helpers moved to review/reviewModel; groupKey stays
// exported from here so the module's surface is unchanged.
export { groupKey };

export type ResolutionAction = 'count' | 'markers' | 'not_on_job' | 'answer' | 'confirm';

export interface ReviewResolution {
  action: ResolutionAction;
  qty?: number;
  reason?: string;
  answer?: string;
  furnishBy?: string;
  installBy?: string;
  by: string;
  at: string;
  carriedOver?: boolean;
  /** Fix round 4 / B13, N9 — a site-light member's pole count, and which
   *  number is still needed (the member stays open until it is entered). */
  poles?: number;
  needs?: 'heads' | 'poles';
}

export interface ReviewItem {
  id: string;
  /** Fix round 1: 'area' (same area or different areas?) and 'confirm'
   *  (counts not verified / a page not counted — confirm with a reason). */
  kind: 'count' | 'scope_question' | 'area' | 'confirm';
  title: string;
  detail: string;
  aiCount?: number;
  sheets?: string[];
  question?: string;
  options?: string[];
  notes?: string[];
  /** What the estimator may do on this item (from the server). */
  actions?: ResolutionAction[];
  /** An earlier run's answer, not carried because the drawings changed. */
  previousResolution?: ReviewResolution;
  resolution?: ReviewResolution;
  /** Next round A6 — the pre-filled answer ("by G.C." on the drawings -> APT). */
  suggested?: string;
  /** Next round A6/A7 — false: information only, never blocks. */
  blocking?: boolean;
  /** Next round A7 — cause group. */
  group?: string;
  typeKey?: string;
  category?: string;
  /** Remodel round A2 — an unlisted tag's own letters ("H"). */
  type?: string;
  /** Evidence round 4.5 — a grouped legend-zero item's members. Fix round
   *  B6 — each member carries its OWN resolution now; the group itself
   *  resolves only once every member has one. */
  groupedTypes?: Array<{ key: string; type: string; description: string; resolution?: ReviewResolution }>;
  /** Fix round 3 / B10, B11 — a gap-fill/reconcile finding's own types, one
   *  per type it covers; each answers separately, in its OWN unit. */
  reconcileMembers?: Array<{
    key: string; type: string; description: string;
    unit: 'heads' | 'count';
    currentQty: number;
    headsPerPole: number | null;
    resolution?: ReviewResolution;
  }>;
}

export interface TakeoffReview {
  status: 'clear' | 'needs_review' | 'pending' | null;
  items: ReviewItem[];
}

/** GET /review extras (fix round 1 / S5, S8). */
interface ReviewExtras {
  legacy?: { message: string; accountRule: string | null; questions: Array<{ label: string; question: string; notes: string[] }> };
  accountRule?: { name: string; matchedBy: string; warning?: string };
}

interface CountResultLite {
  ran?: boolean;
  notRunReason?: string;
  sheets?: Array<{ label: string; status: string; error?: string; tiles?: number }>;
  skippedSheets?: Array<{ label: string; reason: string }>;
  flags?: string[];
  loadCheck?: { ran: boolean; skippedReason?: string; countedWatts: number; circuitVA: number; gapPct: number | null; discrepancy: boolean };
  removedRows?: Array<{ row: { item?: string; qty?: number; sourceSheet?: string }; reason: string }>;
  markers?: { written?: number; sheetsWithoutMarkers?: Array<{ label: string; reason: string }>; error?: string };
}

interface Props {
  bidId: string;
  review: TakeoffReview;
  countResult: CountResultLite | null;
  onReviewChange: (review: TakeoffReview) => void;
  showToast: (t: Toast) => void;
  /** Next round A4 — upload a referenced sheet into this run (supplement pass). */
  onSupplement?: (files: File[]) => Promise<void>;
}

/** "A — 2x4 LED troffer" / "S1: area light on pole, site" per line. */
export function parseCountTypes(text: string): Array<{ type: string; description: string; location: string }> {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^([A-Za-z0-9-]{1,12})\s*[—–:-]\s*(.+)$/.exec(l);
    const type = m ? m[1] : l.split(/\s+/)[0];
    const description = (m ? m[2] : l.slice(type.length)).trim();
    const location = /\b(site|pole)\b/i.test(description) ? 'site' : /\b(exterior|wall pack|canopy|soffit)\b/i.test(description) ? 'exterior_building' : 'interior';
    return { type, description, location };
  }).filter(t => t.type && t.description);
}

function errorOf(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

// Removed in Task 4 (replaced by groupHeading in review/reviewModel).
function groupTitle(key: string, n: number): string {
  const s = n === 1 ? '' : 's';
  if (key === 'zero') return `${n} type${s} counted 0 — not found on the counted plans`;
  if (key === 'unreadable') return `${n} type${s} could not be read reliably`;
  if (key.startsWith('area')) return `Same area? ${key.replace(/^area:?/, '') || 'two plans of one level'} (${n} type${s})`;
  if (key === 'scope') return `Scope question${s} (${n})`;
  if (key === 'legend-zero') return `Legend items not found on any counted sheet (${n} group${s === '' ? '' : 's'})`;
  if (key === 'unscheduled') return `${n} fixture${s} not on the schedule`;
  // Remodel round A1-A3.
  if (key === 'remodel') return `Remodel — new, existing and demolition (${n})`;
  if (key === 'unlisted') return `Tags drawn on the plans that are not on the schedule (${n}) — suggestions, not counted`;
  if (key === 'legend-unused') return 'Legend symbols not used on this job — for information';
  if (key === 'coverage') return `Partial coverage (${n})`;
  if (key === 'viewport') return `Enlarged plans — repeat the main plan or add devices? (${n})`;
  if (key === 'typical') return `Typical packages — how many hosts? (${n})`;
  if (key === 'family') return `Same fixture on two schedules (${n})`;
  // Fix round B2/S13 — a reconciled shortfall against a schedule/typical:
  // gapfill has a suggested marker to confirm, reconcile has none (or an
  // over-count, information only). Never a count by itself.
  if (key === 'gapfill') return `Gap-fill found possible marks — confirm on plans (${n})`;
  if (key === 'reconcile') return `Reconciliation mismatch${s}: schedule/typical vs. the plans (${n})`;
  // Real-run fixes 2 / 5 — a generic symbol drawn on another type's marks;
  // marks only one of two counting passes found on a dense sheet.
  if (key === 'synonym') return `The same device under two names? (${n})`;
  if (key === 'consistency') return `Dense-sheet check — a second counting pass (${n})`;
  if (key === 'classconflict') return `One receptacle drawn as two classes on two sheets (${n})`;
  if (key === 'spotcheck') return `Spot-check samples of a high count (${n}) — for information`;
  if (key === 'schedule') return `Schedules not read completely (${n})`;
  if (key === 'heads') return `Pole heads (${n})`;
  if (key === 'sheets') return `Pages not counted (${n})`;
  if (key === 'refsheets') return `Referenced sheet${s} not in the analysis (${n})`;
  if (key === 'counting') return 'Counting';
  if (key === 'photometric') return `${n} type${s} counted from the photometric sheet only — for information`;
  if (key === 'checklist') return `Facility checklist (${n}) — not evidence-driven`;
  if (key === 'info') return `${n} for information — installed by another trade, the Owner or a vendor (not blocking)`;
  return `Other (${n})`;
}

export default function TakeoffReviewPanel({ bidId, review, countResult, onReviewChange, showToast, onSupplement }: Props) {
  const open = review.items.filter(i => !i.resolution);
  // Next round A6/A7 — information items never block.
  const blockingOpen = open.filter(i => i.blocking !== false);
  const [groupReason, setGroupReason] = useState<Record<string, string>>({});
  const resolved = review.items.filter(i => i.resolution);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [extras, setExtras] = useState<ReviewExtras>({});
  const [typesText, setTypesText] = useState('');
  // Fix round B6 — a legend-zero group's members are answered one at a
  // time; `confirm()` gates the "mark all remaining" shortcut behind a
  // dialog that lists every member it would touch.
  const confirm = useConfirm();
  // Fix round 3 / S16 — equipment is never in the cross-item multi-select's
  // "not on this job" pool: it can only ever be answered on its own.
  const openCountIds = useMemo(() => open.filter(i => actionsOf(i).includes('not_on_job') && i.category !== 'equipment').map(i => i.id), [open]);

  // Fix round 1 / S5, S8 — the matched account rule, and for a bid analysed
  // before the accuracy checks, a (non-blocking) note with its questions.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.get<ReviewExtras>(`/preconstruction/${bidId}/review`))
      .then(res => { const data = res?.data; if (live && data) setExtras({ legacy: data.legacy, accountRule: data.accountRule }); })
      .catch(() => { /* extras only */ });
    return () => { live = false; };
  }, [bidId, review.status]);

  const saveTypes = async () => {
    const types = parseCountTypes(typesText);
    if (!types.length) return;
    setBusy('types');
    try {
      await api.put(`/preconstruction/${bidId}/count-types`, { types });
      showToast({ title: 'Fixture types saved', sub: 'Re-run the analysis — they are counted on the plan sheets like schedule rows.' });
      setTypesText('');
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not save the types', sub: errorOf(err, 'Nothing was saved') });
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (itemIds: string[], body: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/resolve`, { itemIds, ...body });
      onReviewChange(data);
      signalEstimateStale(bidId); // the estimate's proposed lines follow the answers
      setSelected(s => s.filter(id => !itemIds.includes(id)));
      return true;
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not save', sub: errorOf(err, 'The review item was not updated') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const reopen = async (itemId: string) => {
    setBusy(`reopen:${itemId}`);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/reopen`, { itemId });
      onReviewChange(data);
      signalEstimateStale(bidId); // the estimate's proposed lines follow the answers
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not reopen', sub: errorOf(err, 'The review item was not reopened') });
    } finally {
      setBusy(null);
    }
  };

  if (!review.items.length && !countResult && !extras.legacy && review.status !== 'pending') return null;
  if (extras.legacy && !review.items.length) {
    return (
      <section className="tr-panel" data-testid="takeoff-review" aria-label="Takeoff review">
        <div className="tr-legacy" data-testid="takeoff-review-legacy">
          <strong>{extras.legacy.message}</strong>
          {extras.legacy.accountRule && <div className="tr-sub">Account rule: {extras.legacy.accountRule}</div>}
          {extras.legacy.questions.length > 0 && (
            <ul className="tr-notes">{extras.legacy.questions.map(q => <li key={q.label}>{q.question}</li>)}</ul>
          )}
        </div>
      </section>
    );
  }

  const counted = (countResult?.sheets ?? []).filter(s => s.status === 'counted').map(s => s.label.split(' ')[0]);
  const failed = (countResult?.sheets ?? []).filter(s => s.status !== 'counted');
  const lc = countResult?.loadCheck;

  return (
    <section className="tr-panel" data-testid="takeoff-review" aria-label="Takeoff review">
      <header className="tr-head">
        {review.status === 'pending' ? (
          <span className="tr-chip tr-chip-warn" data-testid="takeoff-review-status">Analysis running — proposal blocked until it finishes</span>
        ) : review.status === 'needs_review' ? (
          <span className="tr-chip tr-chip-warn" data-testid="takeoff-review-status">Needs review — {blockingOpen.length} open</span>
        ) : (
          <span className="tr-chip tr-chip-ok" data-testid="takeoff-review-status">Takeoff review clear</span>
        )}
        <span className="tr-summary">
          {countResult?.ran === false
            ? `Counting did not run: ${countResult.notRunReason ?? 'unknown reason'}`
            : counted.length ? `Counted on ${counted.join(', ')}` : ''}
          {failed.length > 0 && ` · Not counted: ${failed.map(s => s.label.split(' ')[0]).join(', ')}`}
        </span>
        {countResult && (
          <button type="button" className="btn ghost sm" onClick={() => setShowDetails(v => !v)} aria-expanded={showDetails}>
            {showDetails ? 'Hide counting details' : 'Counting details'}
          </button>
        )}
      </header>

      {extras.accountRule && (
        <div className="tr-sub" data-testid="takeoff-review-rule">
          Account rule: {extras.accountRule.name} ({extras.accountRule.matchedBy})
          {extras.accountRule.warning && <div className="tr-warn">{extras.accountRule.warning}</div>}
        </div>
      )}
      {review.status === 'needs_review' && (
        <p className="tr-note">
          The proposal can’t be generated or sent until every item below is resolved. Nothing here is ever assumed.
        </p>
      )}

      {open.length > 0 && (() => {
        // UI cleanup round 2A — one card per kind of question; the old generic
        // renderer is gone. Cards own their inputs and post the same bodies.
        const renderItem = (item: ReviewItem) => {
          const cardProps = { item, busy: busy !== null, resolve };
          const kind = cardKindOf(item);
          const body = kind === 'legendGroup' ? <LegendGroupCard {...cardProps} />
            : kind === 'typicalAssign' ? <TypicalAssignCard {...cardProps} />
            : kind === 'reconcile' ? <ReconcileCard {...cardProps} />
            : kind === 'unlisted' ? <UnlistedCard {...cardProps} />
            : kind === 'choice' ? <ChoiceCard {...cardProps} />
            : kind === 'quantity' ? <QuantityCard {...cardProps} />
            : kind === 'count' ? <CountCard {...cardProps} />
            : <ConfirmCard {...cardProps} />;
          // Fix round B6 / S16 — a grouped item and equipment are never in the multi-select.
          const selectable = actionsOf(item).includes('not_on_job') && !item.groupedTypes?.length && item.category !== 'equipment'
            ? { checked: selected.includes(item.id), onChange: (v: boolean) => setSelected(s => (v ? [...s, item.id] : s.filter(x => x !== item.id))) }
            : undefined;
          const extra = (
            <>
              {item.id.startsWith('refsheet:') && onSupplement && (
                <div className="tr-types" data-testid={`supplement-${item.id}`}>
                  <label className="btn ghost sm" style={{ cursor: busy ? 'default' : 'pointer' }}>
                    Upload the sheet
                    <input type="file" accept=".pdf" multiple style={{ display: 'none' }} data-testid={`supplement-input-${item.id}`}
                      disabled={busy !== null}
                      onChange={e => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = '';
                        if (files.length) void onSupplement(files);
                      }}/>
                  </label>
                  <span className="tr-sub">It is analysed and counted into this run (only what it can change), then Agents 2–3 run again.</span>
                </div>
              )}
              {item.id.startsWith('counting:') && (
                <div className="tr-types" data-testid="count-types-entry">
                  <label className="tr-sub" htmlFor={`types-${item.id}`}>Or enter the fixture types (one per line, e.g. “A — 2x4 LED troffer”), then re-run the analysis to count them:</label>
                  <textarea id={`types-${item.id}`} rows={3} value={typesText} onChange={e => setTypesText(e.target.value)} />
                  <button type="button" className="btn ghost sm" disabled={!parseCountTypes(typesText).length || busy !== null} onClick={() => void saveTypes()}>
                    Save types
                  </button>
                </div>
              )}
            </>
          );
          return <ReviewCardShell key={item.id} item={item} selectable={selectable} extra={extra}>{body}</ReviewCardShell>;
        };
        return orderedGroups(open).map(({ key, items, info }) => {
          const ids = items.map(i => i.id);
          // Fix round 3 / S16 — equipment can't be zeroed by ANY bulk
          // action, this group's "mark all" included: each equipment item
          // is left out, answered only on its own row below.
          const nojItems = items.filter(i => actionsOf(i).includes('not_on_job') && i.category !== 'equipment');
          const confirmItems = items.filter(i => actionsOf(i).includes('confirm') && i.category !== 'equipment');
          const nojIds = nojItems.map(i => i.id);
          const confirmIds = confirmItems.map(i => i.id);
          const suggestedIds = items.filter(i => i.suggested).map(i => i.id);
          const r = groupReason[key] ?? '';
          const reasonOk = r.trim().length >= 10;
          const bulk = items.length > 1 && !info ? (
            <div className="tr-bulk" data-testid={`review-group-bulk-${key}`}>
              {key.startsWith('area') && (
                <>
                  <button type="button" className="btn ghost sm" disabled={busy !== null} data-testid={`group-area-keep-${key}`}
                    onClick={() => void resolve(ids, { action: 'answer', answerIndex: 0 }, `grp:${key}`)}>All the same area — keep the larger</button>
                  <button type="button" className="btn ghost sm" disabled={busy !== null} data-testid={`group-area-sum-${key}`}
                    onClick={() => void resolve(ids, { action: 'answer', answerIndex: 1 }, `grp:${key}`)}>All different areas — sum</button>
                </>
              )}
              {key === 'scope' && suggestedIds.length > 0 && (
                <button type="button" className="btn ghost sm" disabled={busy !== null} data-testid="group-scope-accept"
                  onClick={() => void resolve(suggestedIds, { action: 'answer', useSuggested: true }, `grp:${key}`)}>
                  Accept the pre-filled answers ({suggestedIds.length})
                </button>
              )}
              {(nojIds.length > 1 || (confirmIds.length > 1 && !key.startsWith('area') && key !== 'scope')) && (
                <>
                  <input type="text" aria-label={`Reason for all of ${groupTitle(key, items.length)}`} placeholder="Reason for all of them (at least 10 characters)"
                    value={r} onChange={e => setGroupReason(g => ({ ...g, [key]: e.target.value }))} data-testid={`group-reason-${key}`} />
                  {nojIds.length > 1 && (
                    <button type="button" className="btn ghost sm" disabled={!reasonOk || busy !== null} data-testid={`group-noj-${key}`}
                      onClick={async () => {
                        // Fix round 3 / S16 — any remaining bulk action goes
                        // behind a confirm dialog listing every member it
                        // would touch (the same gate B6 already put on
                        // legend-zero's own "mark all remaining").
                        const ok = await confirm({
                          title: `Mark all ${nojIds.length} not on this job?`,
                          body: <ul>{nojItems.map(i => <li key={i.id}>{i.title}</li>)}</ul>,
                          confirmLabel: 'Confirm',
                        });
                        if (ok) void resolve(nojIds, { action: 'not_on_job', reason: r }, `grp:${key}`);
                      }}>Mark all {nojIds.length} not on this job</button>
                  )}
                  {confirmIds.length > 1 && nojIds.length <= 1 && (
                    <button type="button" className="btn ghost sm" disabled={!reasonOk || busy !== null} data-testid={`group-confirm-${key}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Confirm all ${confirmIds.length}?`,
                          body: <ul>{confirmItems.map(i => <li key={i.id}>{i.title}</li>)}</ul>,
                          confirmLabel: 'Confirm',
                        });
                        if (ok) void resolve(confirmIds, { action: 'confirm', reason: r }, `grp:${key}`);
                      }}>Confirm all {confirmIds.length}</button>
                  )}
                </>
              )}
            </div>
          ) : null;
          const body = (
            <>
              {bulk}
              <ul className="tr-list">{items.map(renderItem)}</ul>
            </>
          );
          return info ? (
            <details key={key} className="tr-group tr-group-info" data-testid={`review-group-${key}`}>
              <summary>{groupTitle(key, items.length)}</summary>
              {body}
            </details>
          ) : (
            <section key={key} className="tr-group" data-testid={`review-group-${key}`}>
              <h4 className="tr-group-title">{groupTitle(key, items.length)}</h4>
              {body}
            </section>
          );
        });
      })()}

      {selected.length > 1 && (
        <div className="tr-bulk" data-testid="takeoff-review-bulk">
          <span>{selected.length} selected:</span>
          <input type="text" aria-label="Why the selected types are not on this job" placeholder="Why they’re not on this job"
            value={bulkReason} onChange={e => setBulkReason(e.target.value)} />
          <button type="button" className="btn ghost sm" disabled={bulkReason.trim().length < 10 || busy !== null}
            onClick={async () => {
              // Fix round 3 / S16 — same confirm-dialog gate as any other
              // bulk action; openCountIds already excludes equipment.
              const ids = selected.filter(id => openCountIds.includes(id));
              const ok = await confirm({
                title: `Mark ${ids.length} selected not on this job?`,
                body: <ul>{open.filter(i => ids.includes(i.id)).map(i => <li key={i.id}>{i.title}</li>)}</ul>,
                confirmLabel: 'Confirm',
              });
              if (ok) void resolve(ids, { action: 'not_on_job', reason: bulkReason }, 'bulk');
            }}>
            Mark selected not on this job
          </button>
        </div>
      )}

      {resolved.length > 0 && (
        <details className="tr-resolved">
          <summary>{resolved.length} resolved</summary>
          <ul className="tr-list">
            {resolved.map(item => (
              <li key={item.id} className="tr-item tr-item-done" data-testid={`review-resolved-${item.id}`}>
                <strong>{item.title}</strong>: {resolutionText(item.resolution!)}
                <button type="button" className="btn ghost sm" disabled={busy !== null} onClick={() => void reopen(item.id)}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showDetails && countResult && (
        <div className="tr-details" data-testid="takeoff-count-details">
          {(countResult.skippedSheets?.length ?? 0) > 0 && (
            <div><strong>Not counted:</strong> {countResult.skippedSheets!.map(s => `${s.label} — ${s.reason}`).join('; ')}</div>
          )}
          {failed.length > 0 && (
            <div><strong>Could not count:</strong> {failed.map(s => `${s.label} — ${s.error ?? 'failed'}`).join('; ')}</div>
          )}
          {lc && (
            <div>
              <strong>Load cross-check:</strong>{' '}
              {lc.ran
                ? `counted fixtures ${Math.round(lc.countedWatts).toLocaleString()} W vs lighting circuits ${Math.round(lc.circuitVA).toLocaleString()} VA${lc.gapPct != null ? ` (${Math.round(lc.gapPct * 100)}%)` : ''}${lc.discrepancy ? ' — more than 20% apart, check the lighting counts' : ''}`
                : `not run — ${lc.skippedReason}`}
            </div>
          )}
          {(countResult.flags?.length ?? 0) > 0 && (
            <ul className="tr-notes">{countResult.flags!.map(f => <li key={f}>{f}</li>)}</ul>
          )}
          {(countResult.removedRows?.length ?? 0) > 0 && (
            <div>
              <strong>Removed from the AI takeoff:</strong>
              <ul className="tr-notes">
                {countResult.removedRows!.map((r, i) => (
                  <li key={i}>{r.row.item ?? '(item)'}{r.row.qty != null ? ` × ${r.row.qty}` : ''}{r.row.sourceSheet ? ` (${r.row.sourceSheet})` : ''} — {r.reason}</li>
                ))}
              </ul>
            </div>
          )}
          {countResult.markers && (
            <div>
              <strong>Plans view:</strong>{' '}
              {countResult.markers.error ?? `${countResult.markers.written ?? 0} AI-counted markers to confirm`}
              {(countResult.markers.sheetsWithoutMarkers?.length ?? 0) > 0 && ` · no markers on ${countResult.markers.sheetsWithoutMarkers!.map(s => `${s.label} (${s.reason})`).join('; ')}`}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
