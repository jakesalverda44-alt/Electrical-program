// Price accuracy round, C2 — the estimator's takeoff-review answers reach the
// estimate immediately. Resolving a review item that changes a quantity used
// to change only the GC documents (composeProposal.ts runs the enforcement);
// the Labor & Pricing lines kept Agent 2's numbers until a new analysis run.
// This applies the SAME enforcement the proposal uses (ai/reviewItems.ts's
// enforcedCounts + bidstd/enforceCounts.ts's enforceCountsOnTakeoff) to
// Agent 2's takeoff rows before they are mapped, so the next GET (proposed
// lines) and the next sync-takeoff carry the answers:
//   * an unlisted tag named + counted → its own line (the estimator's name,
//     mapped through the mapper like any row);
//   * "same as type X" → added to X's line;
//   * a count / status / area / legend answer → that type's qty;
//   * a demolition answer (a counted class with no unit, or "the same items
//     / different items" across two sheets) → the Demolition line;
//   * "not on this job" → the type's line leaves the takeoff;
//   * pole heads, typicals, panel copies — exactly as the proposal enforces.
// Pure: no I/O. bidEstimate.ts reads count_result / review_items.
import type { TakeoffCategory, TakeoffItem } from '../bidstd/bidData';
import { enforceCountsOnTakeoff } from '../bidstd/enforceCounts';
import { enforcedCounts, type ReviewItem } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

export interface ReviewRowLike {
  category: string;
  item: string;
  spec?: string;
  qty: number | string;
  unit: string;
  confidence?: string;
  countType?: string;
  evidence?: string | null;
}

export interface ReviewAnswersResult<T extends ReviewRowLike> {
  rows: T[];
  /** What changed, in words (for logs / the report). */
  corrections: string[];
}

type Tagged = TakeoffItem & { __idx?: number };

function hasAnswers(items: ReviewItem[] | null | undefined): boolean {
  return (items ?? []).some(i => i.resolution || i.groupedTypes?.some(m => m.resolution) || i.reconcileMembers?.some(m => m.resolution));
}

/** Demolition answers the proposal's enforcement doesn't key on: a
 *  `demodup:<CLASS>` "same items / different items" answer (or a typed
 *  count), and any other resolved item on a DEMO-* class with a qty
 *  (`demounit:` is an extra line, handled by enforcedCounts). */
function demolitionAnswers(items: ReviewItem[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const i of items) {
    const r = i.resolution;
    if (!r || i.id.startsWith('demounit:')) continue;
    const key = i.typeKey ?? '';
    if (!/^DEMO-/.test(key)) continue;
    if (r.action === 'not_on_job') { out.set(key, null); continue; }
    if (r.qty != null && Number.isFinite(r.qty)) out.set(key, r.qty);
  }
  return out;
}

export function applyReviewAnswers<T extends ReviewRowLike>(
  rows: T[],
  countResult: CountResult | null,
  reviewItems: ReviewItem[] | null | undefined,
): ReviewAnswersResult<T> {
  const items = reviewItems ?? [];
  if (!rows.length || !hasAnswers(items)) return { rows, corrections: [] };

  // Rows → the proposal's TakeoffCategory shape, remembering each row.
  const cats: TakeoffCategory[] = [];
  const byName = new Map<string, TakeoffCategory>();
  rows.forEach((r, idx) => {
    let cat = byName.get(r.category);
    if (!cat) { cat = { name: r.category, items: [] }; byName.set(r.category, cat); cats.push(cat); }
    const it: Tagged = {
      item: String(r.item ?? ''), description: String(r.spec ?? ''), unit: String(r.unit ?? ''), qty: r.qty,
      source: 'Agent 2', ...(r.countType ? { count_type: String(r.countType) } : {}), __idx: idx,
    };
    cat.items.push(it);
  });

  const enforced = enforcedCounts(countResult, items);
  const fix = enforceCountsOnTakeoff(cats, countResult, enforced);
  const corrections = [...fix.corrections];

  const kept: Array<{ order: number; row: T }> = [];
  let added = 0;
  for (const cat of fix.takeoff) {
    for (const it of cat.items as Tagged[]) {
      if (it.__idx != null) {
        const orig = rows[it.__idx];
        const qtyChanged = Number(orig.qty) !== Number(it.qty);
        kept.push({
          order: it.__idx,
          row: {
            ...orig,
            qty: it.qty,
            ...(it.count_type && !orig.countType ? { countType: it.count_type } : {}),
            ...(qtyChanged && orig.evidence == null ? { evidence: `Takeoff review answer: ${orig.qty || 0} → ${it.qty}` } : {}),
          },
        });
      } else {
        // A line the answers add (an unlisted tag named + counted, a
        // counted demolition class, a type Agent 2 dropped).
        kept.push({
          order: rows.length + added++,
          row: {
            category: cat.name, item: it.item, spec: it.description || it.item, qty: it.qty, unit: it.unit || 'EA',
            confidence: 'FIRM', ...(it.count_type ? { countType: it.count_type } : {}),
            evidence: it.source === 'Estimator review' ? `Named and counted by the estimator in the takeoff review (${it.qty})` : `Takeoff review: ${it.source}`,
          } as unknown as T,
        });
      }
    }
  }

  // Demolition answers on the Demolition lines (by the class key they carry).
  const demo = demolitionAnswers(items);
  const out: Array<{ order: number; row: T }> = [];
  for (const k of kept.sort((a, b) => a.order - b.order)) {
    const key = String(k.row.countType ?? '');
    if (demo.has(key)) {
      const q = demo.get(key)!;
      if (q === null) { corrections.push(`${k.row.item}: not on this job (takeoff review) — removed.`); continue; }
      if (Number(k.row.qty) !== q) {
        corrections.push(`${k.row.item}: ${k.row.qty} → ${q} (takeoff review answer).`);
        out.push({ order: k.order, row: { ...k.row, qty: q, evidence: `Takeoff review answer: ${k.row.qty || 0} → ${q}` } });
        continue;
      }
    }
    out.push(k);
  }
  return { rows: out.map(o => o.row), corrections };
}
