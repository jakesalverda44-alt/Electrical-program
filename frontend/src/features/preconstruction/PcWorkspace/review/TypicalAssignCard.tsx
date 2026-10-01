// UI cleanup round 2A — typicalassign only, kept in its own file on purpose: feat/accuracy-reading B3 turns these members into one-per-pole selects ({memberKey, answer}); that change replaces this file's body and nothing else.
import React, { useState } from 'react';
import type { ReviewItem } from '../TakeoffReviewPanel';
import ReasonPicker, { useReasonSlot } from './ReasonPicker';
import { reasonPresets, resolutionText } from './reviewModel';

interface Props {
  item: ReviewItem;
  busy: boolean;
  resolve: (itemIds: string[], body: Record<string, unknown>, key: string) => Promise<boolean>;
}

export default function TypicalAssignCard({ item, busy, resolve }: Props) {
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
                        The only way through today is "None of this type" (confirm, qty 0). Left as is on purpose. */}
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
                      presets={reasonPresets(item, 'keep')} busy={busy}
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
