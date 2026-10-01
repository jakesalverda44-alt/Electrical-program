// UI cleanup round 2A — the frame around every review card: title, chips, the
// short detail, a "Details" disclosure for the technical text, and the
// earlier-answer line (always visible: it asks the estimator to look again).
import React, { useId, useState } from 'react';
import type { ReviewItem } from '../TakeoffReviewPanel';
import { resolutionText } from './reviewModel';

interface Props {
  item: ReviewItem;
  selectable?: { checked: boolean; onChange: (v: boolean) => void };
  /** Rendered after the card body (upload / type-entry blocks the panel owns). */
  extra?: React.ReactNode;
  children?: React.ReactNode;
}

export default function ReviewCardShell({ item, selectable, extra, children }: Props) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const titleId = `${uid}-t`;
  const moreId = `${uid}-more`;
  const long = item.detail.length > 180;
  const sheets = item.sheets ?? [];
  const notes = item.notes ?? [];
  const hasMore = long || sheets.length > 0 || notes.length > 0;
  return (
    <li className="tr-item tr-card" data-testid={`review-item-${item.id}`} data-review-id={item.id} tabIndex={-1} aria-labelledby={titleId}>
      <div className="tr-item-head">
        {/* Fix round B6 — a grouped item is never added to the cross-item
            multi-select; fix round 3 / S16 — neither is equipment. The
            panel decides (selectable is simply not passed for those). */}
        {selectable && (
          <input type="checkbox" aria-label={`Select ${item.title}`} checked={selectable.checked} onChange={e => selectable.onChange(e.target.checked)} />
        )}
        <strong id={titleId}>{item.title}</strong>
        {item.kind === 'scope_question' && <span className="tr-chip tr-chip-q">Scope question</span>}
        {item.kind === 'area' && <span className="tr-chip tr-chip-q">Same area?</span>}
      </div>
      <div className={`tr-detail${long && !open ? ' tr-detail-clamp' : ''}`}>{item.detail}</div>
      {hasMore && (
        <button type="button" className="tr-link" aria-expanded={open} aria-controls={moreId} data-testid={`review-details-toggle-${item.id}`} onClick={() => setOpen(v => !v)}>
          {open ? 'Hide details' : 'Details'}
        </button>
      )}
      {/* Always rendered (hidden, not unmounted) so the text stays in the DOM. */}
      <div id={moreId} hidden={!open} data-testid={`review-details-${item.id}`}>
        {sheets.length > 0 && <div className="tr-sub">AI saw: {sheets.join(' · ')}</div>}
        {notes.length > 0 && <ul className="tr-notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
      </div>
      {item.previousResolution && (
        <div className="tr-sub tr-earlier" data-testid={`review-previous-${item.id}`}>
          Earlier answer (the drawings or counts changed — check it again): {resolutionText(item.previousResolution)}
        </div>
      )}
      {children}
      {extra}
    </li>
  );
}
