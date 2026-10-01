// UI cleanup round 2A — typicalassign only, kept in its own file on purpose.
// Accuracy round B3 (feat/accuracy-reading) — a per-pole item
// (item.hostAssignment.perPole) is answered POLE by pole: one row per member
// (pole:<sheet>:<i>, pole:unlocated:…, pole:held:<sheet>:<i>), a select of the
// legend's pole types + "not a power pole", posting exactly
// { itemIds, action: 'answer', answer: <typeId | 'not_a_host'>, memberKey }.
// Items from earlier runs (no perPole) keep the per-type body below.
import React, { useState } from 'react';
import type { ReviewItem } from '../TakeoffReviewPanel';
import ReasonPicker, { useReasonSlot } from './ReasonPicker';
import { resolutionText } from './reviewModel';

interface Props {
  item: ReviewItem;
  busy: boolean;
  resolve: (itemIds: string[], body: Record<string, unknown>, key: string) => Promise<boolean>;
}

/** The server's "not one of these hosts" answer (NOT_A_HOST). */
export const NOT_A_HOST = 'not_a_host';

export default function TypicalAssignCard(props: Props) {
  return props.item.hostAssignment?.perPole ? <PerPoleAssign {...props} /> : <PerTypeAssign {...props} />;
}

function PerPoleAssign({ item, busy, resolve }: Props) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const pp = item.hostAssignment!.perPole!;
  const noun = item.hostAssignment?.hostNoun ?? 'host';
  const labelOf = (a?: string) => (a === NOT_A_HOST ? `Not a ${noun} / not on this job` : pp.types.find(t => t.typeId === a)?.label ?? a ?? '');
  return (
    <div className="tr-group-members" data-testid={`review-reconcile-members-${item.id}`}>
      <ul className="tr-list">
        {(item.reconcileMembers ?? []).map(m => {
          const mid = `${item.id}::${m.key}`;
          const pole = pp.poles.find(p => p.id === m.key);
          const place = pole?.held
            ? `on ${pole.sheetLabel ?? 'the plans'} enlarged plan ${pole.viewportLabel ?? ''} — may repeat a main-plan ${noun}`.replace(/\s+—/, ' —')
            : pole?.pdf ? `on ${pole.sheetLabel ?? 'the plans'} at (${Math.round(pole.pdf.x)}, ${Math.round(pole.pdf.y)}) pt` : null;
          const hint = pole?.suggestedType ? labelOf(pole.suggestedType) : null;
          return (
            <li key={m.key} className="tr-item" data-testid={`review-reconcilemember-${mid}`} data-member-key={m.key}
              {...(m.resolution ? {} : { 'data-member-open': 'true', tabIndex: -1 })}>
              <div className="tr-item-head">
                <strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}
                {place && <span className="tr-sub" data-testid={`assign-pole-place-${mid}`}> — {place}</span>}
              </div>
              {m.resolution ? (
                <div className="tr-sub" data-testid={`review-reconcilemember-done-${mid}`}>{labelOf(m.resolution.answer)} ({m.resolution.by})</div>
              ) : (
                <div className="tr-actions">
                  <select aria-label={`Type of ${m.type}`} value={pick[mid] ?? ''} data-testid={`assign-pole-type-${mid}`}
                    onChange={e => setPick(p => ({ ...p, [mid]: e.target.value }))}>
                    <option value="">Choose its type…</option>
                    {pp.types.map(t => <option key={t.typeId} value={t.typeId}>{t.label}</option>)}
                    <option value={NOT_A_HOST}>{labelOf(NOT_A_HOST)}</option>
                  </select>
                  <button type="button" className="btn primary sm" disabled={!pick[mid] || busy} data-testid={`assign-pole-save-${mid}`}
                    onClick={() => void resolve([item.id], { action: 'answer', answer: pick[mid], memberKey: m.key }, `rcmember:${mid}`)}>
                    Save type
                  </button>
                  {/* A suggestion only (a tag read there): never pre-selected, never posted. */}
                  {hint && <span className="tr-sub" data-testid={`assign-pole-hint-${mid}`}>Suggested: {hint} (not counted)</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Small-fixes: a stated tag that is really two poles — add the pole the plans do not show; it is then typed
          like any other pole (member pole:extra:<n>), and counts in the line and its devices. */}
      <div className="tr-actions">
        <button type="button" className="btn ghost sm" disabled={busy} data-testid={`assign-pole-add-${item.id}`}
          onClick={() => void resolve([item.id], { action: 'add_pole' }, `rcadd:${item.id}`)}>
          Add a {noun} not shown on the plans
        </button>
      </div>
    </div>
  );
}

function PerTypeAssign({ item, busy, resolve }: Props) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const slot = useReasonSlot();
  return (
    <div className="tr-group-members" data-testid={`review-reconcile-members-${item.id}`}>
      <ul className="tr-list">
        {(item.reconcileMembers ?? []).map(m => {
          const mid = `${item.id}::${m.key}`;
          const k = `none:${m.key}`;
          const idBase = `assign-none-${mid}`;
          return (
            <li key={m.key} className="tr-item" data-testid={`review-reconcilemember-${mid}`} data-member-key={m.key}
              {...(m.resolution ? {} : { 'data-member-open': 'true', tabIndex: -1 })}>
              <div className="tr-item-head">
                <strong>{m.type}</strong>{m.description ? ` — ${m.description}` : ''}
                <span className="tr-sub"> — currently {m.currentQty} {m.unit}</span>
              </div>
              {m.resolution ? (
                <div className="tr-sub" data-testid={`review-reconcilemember-done-${mid}`}>
                  {resolutionText(m.resolution)}
                </div>
              ) : (
                <>
                  <div className="tr-actions">
                    {/* Known gap (see plan 2A): when the LAST answer leaves the totals not adding up to the host
                        count, the server needs a real reason on this count call, and this field never sends one.
                        The only way through today is "None of this type" (confirm; the server keeps the member's current qty). Left as is on purpose. Review fix S1: no presets on "None of this type" (typed reason only). */}
                    <input type="number" min={1} step={1} inputMode="numeric" aria-label={`How many ${m.type}`} placeholder="How many"
                      value={qty[mid] ?? ''} data-testid={`assign-qty-${mid}`} onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))} />
                    <button type="button" className="btn primary sm" disabled={!qty[mid] || busy} data-testid={`assign-save-${mid}`}
                      onClick={() => void resolve([item.id], { action: 'count', qty: Number(qty[mid]), memberKey: m.key }, `rcmember:${mid}`)}>
                      Save
                    </button>
                    <button type="button" className="btn ghost sm" disabled={busy} data-testid={idBase} {...slot.trigger(k, idBase)}>
                      None of this type
                    </button>
                  </div>
                  {slot.open === k && (
                    <ReasonPicker idBase={idBase} inputLabel={`Why none of ${m.type}`} inputTestId={`assign-reason-input-${mid}`}
                      presets={[]} busy={busy}
                      onSave={async reason => { if (await resolve([item.id], { action: 'confirm', reason, memberKey: m.key }, `rcmember:${mid}`)) slot.close(); }}
                      onCancel={() => slot.cancel(k)} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
