// Fewer-questions round Task 4 (Jake's approval 3) — the account / drawing
// scope questions, answered on the Scope step. Blocking is unchanged: they
// stay in the takeoff review, hold the proposal until answered and post the
// same requests as the Takeoff list (useReviewResolve).
import React from 'react';
import type { Toast } from '../../../../types';
import type { TakeoffReview } from '../TakeoffReviewPanel';
import ReviewCardShell from './ReviewCardShell';
import { ChoiceCard } from './reviewCards';
import { resolutionText } from './reviewModel';
import { useReviewResolve } from './useReviewResolve';

interface Props {
  bidId: string;
  review: TakeoffReview;
  onReviewChange: (review: TakeoffReview) => void;
  showToast: (t: Toast) => void;
}

export default function ScopeQuestionsCard({ bidId, review, onReviewChange, showToast }: Props) {
  const { busy, resolve, reopen } = useReviewResolve({ bidId, onReviewChange, showToast });
  const items = review.items.filter(i => i.step === 'scope');
  if (!items.length) return null;
  const open = items.filter(i => !i.resolution);
  const answered = items.filter(i => i.resolution);
  const suggestedIds = open.filter(i => i.suggested).map(i => i.id);
  return (
    <section className="tr-panel" data-testid="scope-questions" aria-label="Scope questions">
      <header className="tr-head">
        <span className={open.length ? 'tr-chip tr-chip-warn' : 'tr-chip tr-chip-ok'} data-testid="scope-questions-status">
          {open.length ? `Scope questions — ${open.length} open` : 'Scope questions answered'}
        </span>
      </header>
      {open.length > 0 && (
        <p className="tr-note">Who furnishes and installs these isn’t settled by the drawings or the account rule. The proposal can’t be made or sent until each one is answered.</p>
      )}
      {suggestedIds.length > 0 && (
        <div className="tr-bulk">
          <button type="button" className="btn ghost sm" disabled={busy !== null} data-testid="scope-questions-accept"
            onClick={() => void resolve(suggestedIds, { action: 'answer', useSuggested: true }, 'grp:scope')}>
            Accept the pre-filled answers ({suggestedIds.length})
          </button>
        </div>
      )}
      {open.length > 0 && (
        <ul className="tr-list">
          {open.map(item => (
            <ReviewCardShell key={item.id} item={item}>
              <ChoiceCard item={item} busy={busy !== null} resolve={resolve} />
            </ReviewCardShell>
          ))}
        </ul>
      )}
      {answered.length > 0 && (
        <details className="tr-resolved">
          <summary>{answered.length} answered</summary>
          <ul className="tr-list">
            {answered.map(item => (
              <li key={item.id} className="tr-item tr-item-done" data-testid={`scope-question-done-${item.id}`}>
                <strong>{item.title}</strong>: {resolutionText(item.resolution!)}
                <button type="button" className="btn ghost sm" disabled={busy !== null} onClick={() => void reopen(item.id)}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
