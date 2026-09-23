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
import React, { useMemo, useState } from 'react';
import api from '../../../api/client';
import './takeoffReview.css';
import type { Toast } from '../../../types';

export interface ReviewResolution {
  action: 'count' | 'markers' | 'not_on_job' | 'answer';
  qty?: number;
  reason?: string;
  answer?: string;
  by: string;
  at: string;
  carriedOver?: boolean;
}

export interface ReviewItem {
  id: string;
  kind: 'count' | 'scope_question';
  title: string;
  detail: string;
  aiCount?: number;
  sheets?: string[];
  question?: string;
  options?: string[];
  notes?: string[];
  resolution?: ReviewResolution;
}

export interface TakeoffReview {
  status: 'clear' | 'needs_review' | null;
  items: ReviewItem[];
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
}

function resolutionText(r: ReviewResolution): string {
  const who = `${r.by}${r.carriedOver ? ', from the previous run' : ''}`;
  switch (r.action) {
    case 'count': return `${r.qty} EA — entered by ${who}`;
    case 'markers': return `${r.qty} EA — confirmed markers on the plans (${who})`;
    case 'not_on_job': return `Not on this job — ${r.reason} (${who})`;
    case 'answer': return `${r.answer} (${who})`;
  }
}

function errorOf(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export default function TakeoffReviewPanel({ bidId, review, countResult, onReviewChange, showToast }: Props) {
  const open = review.items.filter(i => !i.resolution);
  const resolved = review.items.filter(i => i.resolution);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkReason, setBulkReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const openCountIds = useMemo(() => open.filter(i => i.kind === 'count').map(i => i.id), [open]);

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

  if (!review.items.length && !countResult) return null;

  const counted = (countResult?.sheets ?? []).filter(s => s.status === 'counted').map(s => s.label.split(' ')[0]);
  const failed = (countResult?.sheets ?? []).filter(s => s.status !== 'counted');
  const lc = countResult?.loadCheck;

  return (
    <section className="tr-panel" data-testid="takeoff-review" aria-label="Takeoff review">
      <header className="tr-head">
        {review.status === 'needs_review' ? (
          <span className="tr-chip tr-chip-warn" data-testid="takeoff-review-status">Needs review — {open.length} open</span>
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

      {review.status === 'needs_review' && (
        <p className="tr-note">
          The proposal can’t be generated or sent until every item below is resolved. Nothing here is ever assumed.
        </p>
      )}

      {open.length > 0 && (
        <ul className="tr-list">
          {open.map(item => (
            <li key={item.id} className="tr-item" data-testid={`review-item-${item.id}`}>
              <div className="tr-item-head">
                {item.kind === 'count' && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={selected.includes(item.id)}
                    onChange={e => setSelected(s => (e.target.checked ? [...s, item.id] : s.filter(x => x !== item.id)))}
                  />
                )}
                <strong>{item.title}</strong>
                {item.kind === 'scope_question' && <span className="tr-chip tr-chip-q">Scope question</span>}
              </div>
              <div className="tr-detail">{item.detail}</div>
              {(item.sheets?.length ?? 0) > 0 && <div className="tr-sub">AI saw: {item.sheets!.join(' · ')}</div>}
              {(item.notes?.length ?? 0) > 0 && (
                <ul className="tr-notes">{item.notes!.map(n => <li key={n}>{n}</li>)}</ul>
              )}

              {item.kind === 'count' ? (
                <div className="tr-actions">
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
                  {!item.id.endsWith(':heads') && (
                    <button type="button" className="btn ghost sm" disabled={busy !== null}
                      onClick={() => void resolve([item.id], { action: 'markers' }, `markers:${item.id}`)}>
                      Use confirmed markers
                    </button>
                  )}
                  <input
                    type="text"
                    aria-label={`Why ${item.title} is not on this job`}
                    placeholder="Why it’s not on this job"
                    value={reason[item.id] ?? ''}
                    onChange={e => setReason(r => ({ ...r, [item.id]: e.target.value }))}
                  />
                  <button type="button" className="btn ghost sm" disabled={!(reason[item.id] ?? '').trim() || busy !== null}
                    onClick={() => void resolve([item.id], { action: 'not_on_job', reason: reason[item.id] }, `noj:${item.id}`)}>
                    Not on this job
                  </button>
                </div>
              ) : (
                <div className="tr-actions" role="radiogroup" aria-label={item.question}>
                  {(item.options ?? []).map(o => (
                    <label key={o} className="tr-radio">
                      <input type="radio" name={`ans-${item.id}`} value={o} checked={answer[item.id] === o}
                        onChange={() => setAnswer(a => ({ ...a, [item.id]: o }))} />
                      {o}
                    </label>
                  ))}
                  <button type="button" className="btn primary sm" disabled={!answer[item.id] || busy !== null}
                    onClick={() => void resolve([item.id], { action: 'answer', answer: answer[item.id] }, `ans:${item.id}`)}>
                    Save answer
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected.length > 1 && (
        <div className="tr-bulk" data-testid="takeoff-review-bulk">
          <span>{selected.length} selected:</span>
          <input type="text" aria-label="Why the selected types are not on this job" placeholder="Why they’re not on this job"
            value={bulkReason} onChange={e => setBulkReason(e.target.value)} />
          <button type="button" className="btn ghost sm" disabled={!bulkReason.trim() || busy !== null}
            onClick={() => void resolve(selected.filter(id => openCountIds.includes(id)), { action: 'not_on_job', reason: bulkReason }, 'bulk')}>
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
