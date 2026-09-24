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

function resolutionText(r: ReviewResolution): string {
  const who = `${r.by}${r.carriedOver ? ', from the previous run' : ''}`;
  switch (r.action) {
    case 'count': return `${r.qty} EA — entered by ${who}`;
    case 'markers': return `${r.qty} EA — confirmed markers on the plans (${who})${r.reason ? `. ${r.reason}` : ''}`;
    case 'not_on_job': return `Not on this job — ${r.reason} (${who})`;
    case 'answer': return `${r.answer}${r.qty != null ? ` (${r.qty} EA)` : ''} (${who})`;
    case 'confirm': return `Confirmed${r.qty != null ? ` — ${r.qty} EA` : ''}: ${r.reason} (${who})`;
  }
}

function actionsOf(item: ReviewItem): ResolutionAction[] {
  if (item.actions?.length) return item.actions;
  if (item.kind === 'scope_question') return ['answer'];
  return item.id.endsWith(':heads') ? ['count', 'not_on_job'] : ['count', 'markers', 'not_on_job'];
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

/** Next round A7 — the cause an item is listed under (the server tags it;
 *  older runs are grouped the same way here). */
export function groupKey(i: ReviewItem): string {
  if (i.group) return i.group;
  // Fix round N8 — a run from before gapfill:/reconcile:/spotcheck: existed
  // never carries these ids, so this fallback only ever needs to classify
  // ids that ARE these prefixes on a current run whose `.group` was
  // stripped somewhere (defensive; `i.group` above already covers the
  // normal case).
  if (i.id.startsWith('checklist:')) return 'checklist';
  if (i.blocking === false && i.id.startsWith('spotcheck:')) return 'spotcheck';
  if (i.blocking === false) return 'info';
  if (i.id.startsWith('legend-zero:')) return 'legend-zero';
  if (i.id.startsWith('gapfill:')) return 'gapfill';
  if (i.id.startsWith('consistency:')) return 'consistency';
  if (i.id.startsWith('synonym:') || i.id.startsWith('combined:')) return 'synonym';
  if (i.id.startsWith('classconflict:')) return 'classconflict';
  if (i.id.startsWith('reconcile:')) return 'reconcile';
  if (i.id.startsWith('counting:')) return 'counting';
  if (i.id.startsWith('refsheet:')) return 'refsheets';
  if (i.id.startsWith('sheet:') || i.id.startsWith('file:')) return 'sheets';
  if (i.id.startsWith('scope:')) return 'scope';
  if (i.id.startsWith('viewport:')) return 'viewport';
  if (i.id.startsWith('typical:')) return 'typical';
  if (i.id.startsWith('family:')) return 'family';
  if (i.id.startsWith('schedule:')) return 'schedule';
  if (i.id.startsWith('unscheduled:')) return 'unscheduled';
  if (i.id.startsWith('coverage:')) return 'coverage';
  if (i.id.endsWith(':heads')) return 'heads';
  if (i.kind === 'area') return 'area';
  if (i.kind === 'count') return /^Could not be counted/.test(i.detail) ? 'unreadable' : 'zero';
  return 'other';
}

export function groupTitle(key: string, n: number): string {
  const s = n === 1 ? '' : 's';
  if (key === 'zero') return `${n} type${s} counted 0 — not found on the counted plans`;
  if (key === 'unreadable') return `${n} type${s} could not be read reliably`;
  if (key.startsWith('area')) return `Same area? ${key.replace(/^area:?/, '') || 'two plans of one level'} (${n} type${s})`;
  if (key === 'scope') return `Scope question${s} (${n})`;
  if (key === 'legend-zero') return `Legend items not found on any counted sheet (${n} group${s === '' ? '' : 's'})`;
  if (key === 'unscheduled') return `${n} fixture${s} not on the schedule`;
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

// Evidence round 4.5, fix round N8 — grouped in the SAME $-risk order the
// backend's riskRank() sorts the underlying list into (equipment/poles/
// family/reconciliation/typical mismatches first, then commodity devices,
// then admin/scope/informational): 'zero' comes first (it's where an
// equipment or pole type at $0 quantity lands — the single highest-$-risk
// bucket after counting/sheets problems), gapfill/reconcile sit with
// family/typical (all schedule-vs-plans mismatches), and scope questions —
// ranked near the BOTTOM server-side (riskRank 40) — no longer jump the
// queue just because they're a different kind of item. spotcheck (S13) is
// informational, grouped with photometric/checklist/info at the tail.
const GROUP_ORDER = ['counting', 'refsheets', 'sheets', 'zero', 'family', 'gapfill', 'consistency', 'reconcile', 'synonym', 'classconflict', 'schedule', 'typical', 'area', 'viewport', 'unreadable', 'coverage', 'heads', 'legend-zero', 'unscheduled', 'scope', 'other', 'photometric', 'spotcheck', 'checklist', 'info'];

export default function TakeoffReviewPanel({ bidId, review, countResult, onReviewChange, showToast, onSupplement }: Props) {
  const open = review.items.filter(i => !i.resolution);
  // Next round A6/A7 — information items never block.
  const blockingOpen = open.filter(i => i.blocking !== false);
  const [groupReason, setGroupReason] = useState<Record<string, string>>({});
  const resolved = review.items.filter(i => i.resolution);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState<Record<string, string>>({});
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
  const [groupAllReason, setGroupAllReason] = useState<Record<string, string>>({});
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

  const resolve = async (itemIds: string[], body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/resolve`, { itemIds, ...body });
      onReviewChange(data);
      setSelected(s => s.filter(id => !itemIds.includes(id)));
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not save', sub: errorOf(err, 'The review item was not updated') });
    } finally {
      setBusy(null);
    }
  };

  const reopen = async (itemId: string) => {
    setBusy(`reopen:${itemId}`);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/reopen`, { itemId });
      onReviewChange(data);
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
        const renderItem = (item: ReviewItem) => (
            <li key={item.id} className="tr-item" data-testid={`review-item-${item.id}`}>
              <div className="tr-item-head">
                {/* Fix round B6 — a grouped item is never added to the
                    cross-item multi-select: that bar's "Mark selected not on
                    this job" would otherwise resolve the WHOLE group with
                    one bulk action and no memberKey, no per-member answers,
                    no confirm listing — exactly what B6 removed. Fix round
                    3 / S16 — neither is equipment: it's only ever answered
                    on its own. */}
                {actionsOf(item).includes('not_on_job') && !item.groupedTypes?.length && item.category !== 'equipment' && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selected.includes(item.id)}
                    onChange={e => setSelected(s => (e.target.checked ? [...s, item.id] : s.filter(x => x !== item.id)))}
                  />
                )}
                <strong>{item.title}</strong>
                {item.kind === 'scope_question' && <span className="tr-chip tr-chip-q">Scope question</span>}
                {item.kind === 'area' && <span className="tr-chip tr-chip-q">Same area?</span>}
              </div>
              <div className="tr-detail">{item.detail}</div>
              {(item.sheets?.length ?? 0) > 0 && <div className="tr-sub">AI saw: {item.sheets!.join(' · ')}</div>}
              {(item.notes?.length ?? 0) > 0 && (
                <ul className="tr-notes">{item.notes!.map(n => <li key={n}>{n}</li>)}</ul>
              )}

              {item.previousResolution && (
                <div className="tr-sub" data-testid={`review-previous-${item.id}`}>
                  Earlier answer (the drawings or counts changed — confirm again): {resolutionText(item.previousResolution)}
                </div>
              )}
              {/* Fix round B6 — a legend-zero group: EACH member gets its own
                  row with its own action (not on job / enter qty). No bulk
                  button applies one action to every member at once; the one
                  shortcut ("mark all remaining not on job") sits behind a
                  confirm dialog listing every member it would touch, and —
                  structurally, since B6 never groups an equipment or
                  phone-board type in the first place — only ever offers to
                  touch non-equipment members. */}
              {item.groupedTypes && item.groupedTypes.length > 0 ? (
                <div className="tr-group-members" data-testid={`review-groupmembers-${item.id}`}>
                  <ul className="tr-list">
                    {item.groupedTypes.map(m => {
                      const mid = `${item.id}::${m.key}`;
                      return (
                        <li key={m.key} className="tr-item" data-testid={`review-groupmember-${mid}`}>
                          <div className="tr-item-head">
                            <strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}
                          </div>
                          {m.resolution ? (
                            <div className="tr-sub" data-testid={`review-groupmember-done-${mid}`}>{resolutionText(m.resolution)}</div>
                          ) : (
                            <div className="tr-actions">
                              <input
                                type="number" min={1} step={1} inputMode="numeric"
                                aria-label={`Count for ${m.type}`}
                                placeholder="Count (from the schedule, or as counted)"
                                value={qty[mid] ?? ''}
                                data-testid={`groupmember-qty-${mid}`}
                                onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))}
                              />
                              <button type="button" className="btn primary sm" disabled={!qty[mid] || busy !== null}
                                data-testid={`groupmember-count-${mid}`}
                                onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, `grpmember:${mid}`)}>
                                Save count
                              </button>
                              <input
                                type="text"
                                aria-label={`Why ${m.type} is not on this job`}
                                placeholder="Reason (at least 10 characters)"
                                value={reason[mid] ?? ''}
                                data-testid={`groupmember-reason-input-${mid}`}
                                onChange={e => setReason(rr => ({ ...rr, [mid]: e.target.value }))}
                              />
                              <button type="button" className="btn ghost sm" disabled={(reason[mid] ?? '').trim().length < 10 || busy !== null}
                                data-testid={`groupmember-noj-${mid}`}
                                onClick={() => void resolve([item.id], { action: 'not_on_job', reason: reason[mid], memberKey: m.key }, `grpmember:${mid}`)}>
                                Not on this job
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {(() => {
                    const remaining = item.groupedTypes!.filter(m => !m.resolution);
                    if (remaining.length < 2) return null; // one left: just answer it above
                    const allReason = groupAllReason[item.id] ?? '';
                    return (
                      <div className="tr-bulk" data-testid={`group-noj-all-${item.id}`}>
                        <input type="text" aria-label={`Reason for all ${remaining.length} remaining members of ${item.title}`}
                          placeholder="Reason for all of them (at least 10 characters)"
                          value={allReason} data-testid={`group-noj-all-reason-${item.id}`}
                          onChange={e => setGroupAllReason(g => ({ ...g, [item.id]: e.target.value }))} />
                        <button type="button" className="btn ghost sm" disabled={allReason.trim().length < 10 || busy !== null}
                          data-testid={`group-noj-all-button-${item.id}`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Mark all ${remaining.length} remaining not on this job?`,
                              body: (
                                <ul>
                                  {remaining.map(m => <li key={m.key}>{m.type}{m.description ? ` — ${m.description}` : ''}</li>)}
                                </ul>
                              ),
                              confirmLabel: 'Confirm',
                            });
                            if (!ok) return;
                            // No memberKey: the server answers every member
                            // that doesn't have one yet, each with its OWN
                            // recorded resolution — never a single blanket
                            // flag on the group.
                            void resolve([item.id], { action: 'not_on_job', reason: allReason }, `grp:${item.id}:all`);
                          }}>
                          Mark all {remaining.length} remaining not on this job
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ) : item.reconcileMembers && item.reconcileMembers.length > 0 ? (
                // Fix round 3 / B10, B11 — a gap-fill/reconcile finding: EACH
                // type it covers gets its own row, in its OWN unit (heads for
                // a site_lighting type, count otherwise) — never a number
                // broadcast to a sibling type. Never "not on this job": the
                // finding is about a second source disagreeing with the
                // plans, so the three actions are exactly "Confirm the found
                // marks on the plans" (gap-fill only), "No more on this job —
                // keep current count N" (rejects the suggestion/mismatch,
                // keeps the type's current value) and "Enter correct count".
                <div className="tr-group-members" data-testid={`review-reconcile-members-${item.id}`}>
                  <ul className="tr-list">
                    {item.reconcileMembers.map(m => {
                      const mid = `${item.id}::${m.key}`;
                      const canMarkers = (item.actions ?? []).includes('markers');
                      return (
                        <li key={m.key} className="tr-item" data-testid={`review-reconcilemember-${mid}`}>
                          <div className="tr-item-head">
                            <strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}
                            <span className="tr-sub"> — currently {m.currentQty} {m.unit}</span>
                          </div>
                          {m.resolution?.needs ? (
                            // Fix round 4 / B13, N9 — half done: poles or heads still needed.
                            <div className="tr-actions" data-testid={`review-reconcilemember-needs-${mid}`}>
                              <span className="tr-sub">
                                {m.resolution.needs === 'heads'
                                  ? `${m.resolution.poles} pole${m.resolution.poles === 1 ? '' : 's'} confirmed — heads per pole is not on the schedule: enter the heads.`
                                  : `${m.resolution.qty} heads entered — the poles can't be derived: enter the pole count.`}
                              </span>
                              <input
                                type="number" min={1} step={1} inputMode="numeric"
                                aria-label={`${m.resolution.needs === 'heads' ? 'Heads' : 'Pole count'} for ${m.type}`}
                                placeholder={m.resolution.needs === 'heads' ? 'Heads' : 'Poles'}
                                value={qty[mid] ?? ''}
                                data-testid={`reconcilemember-needs-qty-${mid}`}
                                onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))}
                              />
                              <button type="button" className="btn primary sm" disabled={!qty[mid] || busy !== null}
                                data-testid={`reconcilemember-needs-save-${mid}`}
                                onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, `rcmember:${mid}`)}>
                                {m.resolution.needs === 'heads' ? 'Save heads' : 'Save poles'}
                              </button>
                            </div>
                          ) : m.resolution ? (
                            <div className="tr-sub" data-testid={`review-reconcilemember-done-${mid}`}>{resolutionText(m.resolution)}</div>
                          ) : (
                            <div className="tr-actions">
                              {canMarkers && (
                                <button type="button" className="btn ghost sm" disabled={busy !== null}
                                  data-testid={`reconcilemember-markers-${mid}`}
                                  onClick={() => void resolve([item.id], { action: 'markers', memberKey: m.key }, `rcmember:${mid}`)}>
                                  Confirm the found marks on the plans
                                </button>
                              )}
                              <input
                                type="number" min={1} step={1} inputMode="numeric"
                                aria-label={`Correct count for ${m.type} (${m.unit})`}
                                placeholder={m.unit === 'heads' ? 'Correct heads' : 'Correct count'}
                                value={qty[mid] ?? ''}
                                data-testid={`reconcilemember-qty-${mid}`}
                                onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))}
                              />
                              <button type="button" className="btn primary sm" disabled={!qty[mid] || busy !== null}
                                data-testid={`reconcilemember-count-${mid}`}
                                onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, `rcmember:${mid}`)}>
                                Enter correct count
                              </button>
                              <input
                                type="text"
                                aria-label={`Why no more ${m.type} on this job`}
                                placeholder="Reason (at least 10 characters)"
                                value={reason[mid] ?? ''}
                                data-testid={`reconcilemember-reason-input-${mid}`}
                                onChange={e => setReason(rr => ({ ...rr, [mid]: e.target.value }))}
                              />
                              <button type="button" className="btn ghost sm" disabled={(reason[mid] ?? '').trim().length < 10 || busy !== null}
                                data-testid={`reconcilemember-reject-${mid}`}
                                onClick={() => void resolve([item.id], { action: 'confirm', reason: reason[mid], memberKey: m.key }, `rcmember:${mid}`)}>
                                No more on this job — keep current count {m.currentQty}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (() => {
                const acts = actionsOf(item);
                return (
                  <div className="tr-actions" {...(acts.includes('answer') ? { role: 'radiogroup', 'aria-label': item.question ?? item.title } : {})}>
                    {acts.includes('answer') && (
                      <>
                        {(item.options ?? []).map(o => (
                          <label key={o} className="tr-radio">
                            <input type="radio" name={`ans-${item.id}`} value={o} checked={(answer[item.id] ?? item.suggested) === o}
                              onChange={() => setAnswer(a => ({ ...a, [item.id]: o }))} />
                            {o}
                          </label>
                        ))}
                        <button type="button" className="btn primary sm" disabled={!(answer[item.id] ?? item.suggested) || busy !== null}
                          onClick={() => void resolve([item.id], { action: 'answer', answer: answer[item.id] ?? item.suggested }, `ans:${item.id}`)}>
                          Save answer
                        </button>
                        {item.suggested && !answer[item.id] && <span className="tr-sub">Pre-filled: {item.suggested} (the drawings say “by G.C.”, which is APT scope)</span>}
                      </>
                    )}
                    {acts.includes('count') && (
                      <>
                        <input
                          type="number" min={1} step={1} inputMode="numeric"
                          aria-label={`Count for ${item.title}`}
                          placeholder="Count"
                          value={qty[item.id] ?? ''}
                          onChange={e => setQty(q => ({ ...q, [item.id]: e.target.value }))}
                        />
                        <button type="button" className="btn primary sm" disabled={!qty[item.id] || busy !== null}
                          onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[item.id]) }, `count:${item.id}`)}>
                          Save count
                        </button>
                      </>
                    )}
                    {acts.includes('markers') && (
                      <button type="button" className="btn ghost sm" disabled={busy !== null}
                        onClick={() => void resolve([item.id], { action: 'markers' }, `markers:${item.id}`)}>
                        Use confirmed markers
                      </button>
                    )}
                    {(acts.includes('not_on_job') || acts.includes('confirm')) && (
                      <input
                        type="text"
                        aria-label={acts.includes('not_on_job') ? `Why ${item.title} is not on this job` : `Why you confirm ${item.title}`}
                        placeholder={acts.includes('not_on_job') ? 'Reason (at least 10 characters)' : 'Why this is right (at least 10 characters)'}
                        value={reason[item.id] ?? ''}
                        onChange={e => setReason(r => ({ ...r, [item.id]: e.target.value }))}
                      />
                    )}
                    {acts.includes('confirm') && (
                      <button type="button" className="btn ghost sm" disabled={(reason[item.id] ?? '').trim().length < 10 || busy !== null}
                        onClick={() => void resolve([item.id], { action: 'confirm', reason: reason[item.id] }, `confirm:${item.id}`)}>
                        {item.kind === 'count' && item.aiCount != null ? `Confirm ${item.aiCount}` : 'Confirm'}
                      </button>
                    )}
                    {acts.includes('not_on_job') && (
                      <button type="button" className="btn ghost sm" disabled={(reason[item.id] ?? '').trim().length < 10 || busy !== null}
                        onClick={() => void resolve([item.id], { action: 'not_on_job', reason: reason[item.id] }, `noj:${item.id}`)}>
                        Not on this job
                      </button>
                    )}
                  </div>
                );
              })()}
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
            </li>
        );
        const groups = new Map<string, ReviewItem[]>();
        for (const i of open) { const k = groupKey(i); groups.set(k, [...(groups.get(k) ?? []), i]); }
        const order = (k: string) => { const base = GROUP_ORDER.indexOf(k.startsWith('area') ? 'area' : k); return base < 0 ? 99 : base; };
        return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([key, items]) => {
          const info = items.every(i => i.blocking === false);
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
              <strong>Removed from Agent 1’s takeoff:</strong>
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
