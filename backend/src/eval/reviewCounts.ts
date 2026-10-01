// Fewer-questions round Task 0 — the review list's measure (production-safe:
// no fixtures imported). "asked" = blocking, unanswered, not on the Scope step.
import type { ReviewItem } from '../ai/reviewItems';

export interface KindCounts { asked: number; info: number; auto: number; scopeStep: number; answered: number }
export interface ReviewCounts {
  total: number;
  /** Blocking, no resolution, not on the Scope step. */
  asked: number;
  /** On the Scope step (still blocking until answered). */
  scopeStep: number;
  /** blocking:false. */
  info: number;
  /** Resolved with an `auto` record. */
  auto: number;
  /** Resolved by a person (or carried over), not automatic. */
  answered: number;
  /** id prefix → counts. */
  byKind: Record<string, KindCounts>;
  /** Rows inside grouped items (groupedTypes / reconcileMembers). */
  members: number;
}

/** The id prefix an item is counted under ("count:", "area:", …). */
export function kindOf(i: ReviewItem): string {
  const m = /^([a-z-]+)(?::|$)/i.exec(i.id);
  return m ? m[1] : i.id;
}

type WithAuto = ReviewItem & { step?: string; resolution?: ReviewItem['resolution'] & { auto?: unknown } };

export function reviewCounts(items: ReviewItem[]): ReviewCounts {
  const out: ReviewCounts = { total: items.length, asked: 0, scopeStep: 0, info: 0, auto: 0, answered: 0, byKind: {}, members: 0 };
  for (const i0 of items) {
    const i = i0 as WithAuto;
    const k = kindOf(i);
    const b = out.byKind[k] ?? (out.byKind[k] = { asked: 0, info: 0, auto: 0, scopeStep: 0, answered: 0 });
    out.members += (i.groupedTypes?.length ?? 0) + (i.reconcileMembers?.length ?? 0);
    if (i.resolution?.auto) { out.auto++; b.auto++; continue; }
    if (i.resolution) { out.answered++; b.answered++; continue; }
    if (i.blocking === false) { out.info++; b.info++; continue; }
    if (i.step === 'scope') { out.scopeStep++; b.scopeStep++; continue; }
    out.asked++; b.asked++;
  }
  return out;
}

