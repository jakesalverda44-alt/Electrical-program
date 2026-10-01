// Fewer-questions round Task 7 — the zero-count checklist (textzero:): one
// row per type the notes / schedules name but the plans never draw as a
// symbol. Each row shows the text it comes from (quoted, with its sheet) and
// what the checklist proposes; nothing counts until a row is answered.
// "Confirm all" applies ONLY the pre-filled rows, behind a dialog that lists
// every one of them (with its value and quote, the not-on-this-job rows by
// name); legend rows (D1) and rows with no proposal are never in it.
// Equipment gets no ready-made reasons (S16): the reason is typed.
import React, { useState } from 'react';
import type { ReviewItem } from '../TakeoffReviewPanel';
import { useConfirm } from '../../../../components/ConfirmDialog';
import ReasonPicker, { useReasonSlot } from './ReasonPicker';
import { reasonPresets, resolutionText, unitsOf } from './reviewModel';
import type { CardProps } from './reviewCards';

type Member = NonNullable<ReviewItem['groupedTypes']>[number];

export const CONFIRM_ALL_REASON = 'Confirmed the pre-filled checklist against the quotes';

export function proposalChip(m: Member): string | null {
  const p = m.proposal;
  if (!p) return null;
  switch (p.tier) {
    case 'stated': return `Stated: ${p.qty}`;
    case 'named': return `Named: ${m.type} → ${p.qty}`;
    case 'classified': return 'By others';
    case 'twin': return `Same item as ${m.twinOf ?? 'another row'}`;
    case 'covered': return `Covered by ${/^Covered by (\S+)/.exec(p.reason)?.[1] ?? 'a counted line'}`;
  }
}

const valueOf = (m: Member) => (m.proposal?.action === 'count' ? `${m.proposal.qty}` : 'not on this job');

export default function ChecklistCard({ item, busy, resolve, reopen }: CardProps & { reopen?: (itemId: string, memberKey?: string) => void }) {
  const confirm = useConfirm();
  const [qty, setQty] = useState<Record<string, string>>({});
  const slot = useReasonSlot();
  const members = item.groupedTypes ?? [];
  const { total, answered } = unitsOf(item);
  const prefilled = members.filter(m => !m.resolution && m.proposal && m.rowKind !== 'legend');
  const send = (m: Member, body: Record<string, unknown>) => resolve([item.id], { ...body, memberKey: m.key }, `chk:${item.id}::${m.key}`);
  return (
    <div className="tr-group-members" data-testid={`review-checklist-${item.id}`}>
      <div className="tr-sub" data-testid={`checklist-progress-${item.id}`}>{answered} of {total} answered</div>
      {prefilled.length > 0 && (
        <div className="tr-bulk">
          <button type="button" className="btn ghost sm" disabled={busy} data-testid={`checklist-confirm-all-${item.id}`}
            onClick={async () => {
              const ok = await confirm({
                title: `Confirm all ${prefilled.length} pre-filled?`,
                body: (
                  <ul data-testid="checklist-confirm-list">
                    {prefilled.map(m => (
                      <li key={m.key}>
                        <strong>{m.type}</strong>: {m.proposal!.action === 'count' ? `${m.proposal!.qty}` : 'not on this job'} — {m.proposal!.reason}
                        {m.quote ? <> (“{m.quote.text}”, {m.quote.sheet})</> : null}
                      </li>
                    ))}
                  </ul>
                ),
                confirmLabel: 'Confirm',
              });
              if (ok) void resolve([item.id], { action: 'confirm', reason: CONFIRM_ALL_REASON }, `chk:${item.id}:all`);
            }}>
            Confirm all {prefilled.length} pre-filled
          </button>
          <span className="tr-sub">Only rows with a value taken from their own text. The others are answered one by one.</span>
        </div>
      )}
      <ul className="tr-list">
        {members.map(m => {
          const mid = `${item.id}::${m.key}`;
          const k = `noj:${m.key}`;
          const idBase = `checklist-noj-${mid}`;
          const chip = proposalChip(m);
          const drawn = (m.alsoDrawn ?? []).reduce((n, d) => n + d.count, 0);
          return (
            <li key={m.key} className="tr-item" data-testid={`review-checklistrow-${mid}`} data-member-key={m.key}
              {...(m.resolution ? {} : { 'data-member-open': 'true', tabIndex: -1 })}>
              <div className="tr-item-head">
                <strong>{m.type}</strong>{m.description && m.description !== m.type ? ` — ${m.description}` : ''}
                {m.rowKind === 'legend' && <span className="tr-chip tr-chip-q">Legend symbol</span>}
                {chip && <span className="tr-chip tr-chip-q" data-testid={`checklist-chip-${mid}`}>{chip}</span>}
              </div>
              {m.quote && m.rowKind !== 'legend' && (
                <div className="tr-sub" data-testid={`checklist-quote-${mid}`}>“{m.quote.text}” — {m.quote.sheet}</div>
              )}
              {m.label && <div className="tr-sub" data-testid={`checklist-label-${mid}`}>{m.label}</div>}
              {m.proposal && !m.resolution && <div className="tr-sub">Proposed: {valueOf(m)} — {m.proposal.reason}</div>}
              {drawn > 0 && !m.resolution && (
                <div className="tr-sub">Drawn on {(m.alsoDrawn ?? []).map(d => `${d.sheet} (${d.count})`).join(', ')} — not counted there.</div>
              )}
              {m.resolution ? (
                <div className="tr-sub" data-testid={`checklist-done-${mid}`}>
                  {resolutionText(m.resolution)}
                  {reopen && <> <button type="button" className="tr-link" disabled={busy} data-testid={`checklist-change-${mid}`} onClick={() => reopen(item.id, m.key)}>Change</button></>}
                </div>
              ) : (
                <>
                  <div className="tr-actions">
                    {m.proposal?.action === 'count' && (
                      <button type="button" className="btn primary sm" disabled={busy} data-testid={`checklist-use-${mid}`}
                        onClick={() => void send(m, { action: 'count', qty: m.proposal!.qty, reason: m.proposal!.reason })}>
                        Use {m.proposal.qty}
                      </button>
                    )}
                    {m.proposal?.action === 'not_on_job' && (
                      <button type="button" className="btn primary sm" disabled={busy} data-testid={`checklist-use-noj-${mid}`}
                        onClick={() => void send(m, { action: 'not_on_job', reason: m.proposal!.reason })}>
                        Not on this job — {chip}
                      </button>
                    )}
                    {m.twinOf && (
                      <button type="button" className="btn ghost sm" disabled={busy} data-testid={`checklist-twin-${mid}`}
                        onClick={() => void send(m, { action: 'not_on_job', reason: `Same item as ${m.twinOf} — counted once there` })}>
                        Same item as {m.twinOf} — not on this job
                      </button>
                    )}
                    {drawn > 0 && (
                      <button type="button" className="btn ghost sm" disabled={busy} data-testid={`checklist-drawn-${mid}`}
                        onClick={() => void send(m, { action: 'count', qty: drawn, reason: `Drawn on ${(m.alsoDrawn ?? []).map(d => `${d.sheet} (${d.count})`).join(', ')} — used those markers` })}>
                        Use those markers ({drawn})
                      </button>
                    )}
                    {!m.proposal && (
                      <button type="button" className="btn ghost sm" disabled={busy} data-testid={`checklist-one-${mid}`}
                        onClick={() => void send(m, { action: 'count', qty: 1 })}>1</button>
                    )}
                    <input type="number" min={1} step={1} inputMode="numeric" aria-label={`Count for ${m.type}`}
                      placeholder={m.rowKind === 'legend' ? 'Needs your number' : 'Count'}
                      value={qty[mid] ?? ''} data-testid={`checklist-qty-${mid}`} onChange={e => setQty(q => ({ ...q, [mid]: e.target.value }))} />
                    <button type="button" className="btn ghost sm" disabled={!qty[mid] || busy} data-testid={`checklist-count-${mid}`}
                      onClick={() => void send(m, { action: 'count', qty: Number(qty[mid]) })}>
                      Save
                    </button>
                    <button type="button" className="btn ghost sm" disabled={busy} data-testid={idBase} {...slot.trigger(k, idBase)}>Not on this job</button>
                  </div>
                  {slot.open === k && (
                    <ReasonPicker idBase={idBase} inputLabel={`Why ${m.type} is not on this job`} inputTestId={`checklist-reason-input-${mid}`}
                      presets={reasonPresets(item, 'not_on_job')} busy={busy}
                      onSave={async reason => { if (await send(m, { action: 'not_on_job', reason })) slot.close(); }}
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
