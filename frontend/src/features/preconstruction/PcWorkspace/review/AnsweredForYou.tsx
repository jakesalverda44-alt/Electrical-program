// Fewer-questions round Task 7 — every answer the CRM gave by itself (the
// sheets line up, an independent check agrees, the same account's other
// bid): the answer, why, the evidence and where it came from — each with an
// Undo (the ordinary reopen; the item is asked again and not re-answered on
// the next run while its evidence is unchanged).
import React from 'react';
import type { ReviewItem, ReviewResolution } from '../TakeoffReviewPanel';
import { resolutionText } from './reviewModel';

export interface AutoRow { itemId: string; memberKey?: string; title: string; resolution: ReviewResolution & { auto: NonNullable<ReviewResolution['auto']> } }

export function autoRowsOf(items: ReviewItem[]): AutoRow[] {
  const rows: AutoRow[] = [];
  for (const i of items) {
    if (i.groupedTypes?.length) {
      for (const m of i.groupedTypes) if (m.resolution?.auto) rows.push({ itemId: i.id, memberKey: m.key, title: `${m.type}${m.description && m.description !== m.type ? ` — ${m.description}` : ''}`, resolution: m.resolution as AutoRow['resolution'] });
      continue;
    }
    if (i.resolution?.auto) rows.push({ itemId: i.id, title: i.title, resolution: i.resolution as AutoRow['resolution'] });
  }
  return rows;
}

export function sourceLabel(r: AutoRow['resolution']): string {
  if (r.auto.source === 'account_memory') return `From ${r.auto.fromBid?.name ?? 'another bid'} — change`;
  return r.auto.source === 'registration' ? 'The sheets line up' : 'An independent check agrees';
}

export default function AnsweredForYou({ items, busy, reopen }: { items: ReviewItem[]; busy: boolean; reopen: (itemId: string, memberKey?: string) => void }) {
  const rows = autoRowsOf(items);
  if (!rows.length) return null;
  return (
    <details className="tr-resolved" data-testid="review-auto">
      <summary>Answered for you ({rows.length})</summary>
      <ul className="tr-list">
        {rows.map(r => {
          const id = `${r.itemId}${r.memberKey ? `::${r.memberKey}` : ''}`;
          return (
            <li key={id} className="tr-item tr-item-done" data-testid={`review-auto-${id}`}>
              <div className="tr-item-head">
                <strong>{r.title}</strong>
                <span className="tr-chip tr-chip-q">{r.resolution.auto.source === 'account_memory' ? `From ${r.resolution.auto.fromBid?.name ?? 'another bid'}` : 'Answered automatically'}</span>
              </div>
              <div className="tr-sub">{resolutionText(r.resolution)}</div>
              <div className="tr-sub">Why: {r.resolution.auto.reason}</div>
              <ul className="tr-notes" data-testid={`review-auto-evidence-${id}`}>{r.resolution.auto.evidence.map(e => <li key={e}>{e}</li>)}</ul>
              <div className="tr-actions">
                <span className="tr-sub">{sourceLabel(r.resolution)}</span>
                <button type="button" className="btn ghost sm" disabled={busy} data-testid={`review-auto-undo-${id}`} onClick={() => reopen(r.itemId, r.memberKey)}>Undo</button>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
