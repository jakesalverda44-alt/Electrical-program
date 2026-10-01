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
import { enforceCountsOnTakeoff, lineCountKey, plausiblySameFixture } from '../bidstd/enforceCounts';
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
  /** Fix round S4 — the enforcement's own second-look warnings (a possible
   *  double count, a type carried by several lines, an answer that collides
   *  with a counted line), shown on the estimate — never dropped. */
  flags: ReviewFlag[];
}

/** Fix round 2 — each warning says what kind it is (the sidebar labels it). */
export type ReviewFlagKind = 'possible_double' | 'ambiguous' | 'conflict' | 'count_lowered';
export interface ReviewFlag { kind: ReviewFlagKind; message: string }

/** Fix round S4 — names compare without case, dash style or punctuation:
 *  "Type H - LED high bay" is "Type H — LED high bay". */
export function normName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[\u2012-\u2015\u2212-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The type / class key an answer's extra line stands for. */
function extraLineKeys(items: ReviewItem[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of items) {
    if (!i.resolution || i.resolution.action !== 'count') continue;
    if (i.id.startsWith('unlisted:') && i.type) out.set(normName(`Type ${i.type} — ${i.resolution.reason ?? i.description ?? ''}`.replace(/ — $/, '')), i.type);
    if (i.id.startsWith('demounit:') && i.typeKey) out.set(normName(i.rowItem ?? i.title), i.typeKey);
  }
  return out;
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
  return applyReviewAnswersImpl(rows, countResult, reviewItems, false);
}

/** Accuracy round Task 0 / F2 — the replay eval's stand-in for Agent 2
 *  reading a (replayed) count: the same enforcement as applyReviewAnswers,
 *  run even when no review item is answered (the counted types' totals are
 *  projected onto Agent 2's rows). Replay-only; the app never calls it. */
export function projectCountsOntoRows<T extends ReviewRowLike>(
  rows: T[],
  countResult: CountResult | null,
  reviewItems: ReviewItem[] | null | undefined,
): ReviewAnswersResult<T> {
  return applyReviewAnswersImpl(rows, countResult, reviewItems, true);
}

function applyReviewAnswersImpl<T extends ReviewRowLike>(
  rows: T[],
  countResult: CountResult | null,
  reviewItems: ReviewItem[] | null | undefined,
  always: boolean,
): ReviewAnswersResult<T> {
  const items = reviewItems ?? [];
  if (!rows.length || (!always && !hasAnswers(items))) return { rows, corrections: [], flags: [] };

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
  // Fix round S4 — an answer's extra line lands on the row that is already
  // that item: the same name (any dash / case / punctuation), or a row that
  // carries the answer's type / class key. Never a second line.
  const keys = extraLineKeys(items);
  enforced.extraLines = enforced.extraLines.map(x => {
    const key = keys.get(normName(x.item));
    const hit = rows.find(r => normName(r.item) === normName(x.item))
      ?? (key ? rows.find(r => r.countType != null && String(r.countType).toUpperCase() === key.toUpperCase()) : undefined)
      ?? (key && /^[A-Z0-9]{1,4}$/i.test(key) ? rows.find(r => new RegExp(`^type\\s+${key.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(normName(r.item))) : undefined);
    return hit ? { ...x, item: String(hit.item), category: hit.category } : x;
  });
  // Fix round S4 — a counted type with no line of its own, while exactly
  // one untagged row plausibly IS that type ("WP GFCI receptacle exterior at
  // condensers" for type WP): that row carries the type, so the enforcement
  // sets its qty instead of adding a second line.
  const targets = countResult?.targets ?? [];
  const pretag: string[] = [];
  const pretagged: Array<{ it: Tagged; type: string; before: number }> = [];
  const located = new Set<string>();
  for (const c of cats) for (const it of c.items) { const k = lineCountKey(c.name, it, targets); if (k) located.add(k); }
  for (const [key, qty] of enforced.byType) {
    if (qty == null || key.endsWith(':heads') || located.has(key)) continue;
    const target = targets.find(t => t.key === key);
    if (!target) continue;
    const hits: Array<{ c: TakeoffCategory; it: TakeoffItem }> = [];
    for (const c of cats) for (const it of c.items) {
      if (it.count_type || lineCountKey(c.name, it, targets)) continue;
      const unit = String(it.unit ?? '').trim().toUpperCase();
      if (unit && unit !== 'EA') continue;
      if (plausiblySameFixture(`${it.item ?? ''} ${it.description ?? ''}`, target)) hits.push({ c, it });
    }
    if (hits.length !== 1) continue;
    hits[0].it.count_type = target.type;
    pretagged.push({ it: hits[0].it as Tagged, type: target.type, before: Number(hits[0].it.qty) });
    located.add(key);
    pretag.push(`${hits[0].c.name} "${hits[0].it.item}" is counted Type ${target.type} — it takes the answer (no second line).`);
  }
  const fix = enforceCountsOnTakeoff(cats, countResult, enforced);
  const corrections = [...pretag, ...fix.corrections];

  const flags: ReviewFlag[] = [];
  const rowFlags = new Map<number, string>();
  for (const pd of fix.possibleDoubles) {
    const cat = fix.takeoff.find(c => c.name === pd.category);
    const existing = (cat?.items as Tagged[] | undefined)?.find(it => it.__idx != null && `${it.item ?? ''} ${it.description ?? ''}`.trim() === pd.line);
    const msg = `Possible double count: "${pd.line}" may be the same as counted Type ${pd.type} (${pd.count}) — check it in the takeoff review.`;
    flags.push({ kind: 'possible_double', message: msg });
    if (existing?.__idx != null) rowFlags.set(existing.__idx, msg);
  }
  for (const a of fix.ambiguous) flags.push({ kind: 'ambiguous', message: `${a.name}: ${a.lines.length} lines carry this type (${a.lines.map(l => l.line).join('; ')}) — mark the counted one in the takeoff review.` });
  for (const c of fix.conflicts) flags.push({ kind: 'conflict', message: c });
  // Fix round 2 N3 — a row that took a counted type's answer and came out
  // LOWER than Agent 2 had it is never lowered silently.
  const finalByIdx = new Map<number, Tagged>();
  for (const c of fix.takeoff) for (const it of c.items as Tagged[]) if (it.__idx != null) finalByIdx.set(it.__idx, it);
  for (const p of pretagged) {
    const fin = p.it.__idx != null ? finalByIdx.get(p.it.__idx) : undefined;
    if (!fin) continue;
    const after = Number(fin.qty);
    if (!(after < p.before)) continue;
    const msg = `Count lowered: "${p.it.item}" ${p.before} → ${after} — it was read as counted Type ${p.type}; check it in the takeoff review.`;
    flags.push({ kind: 'count_lowered', message: msg });
    if (p.it.__idx != null) rowFlags.set(p.it.__idx, rowFlags.has(p.it.__idx) ? `${rowFlags.get(p.it.__idx)} ${msg}` : msg);
  }

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
            ...(rowFlags.has(it.__idx) ? { evidence: `⚠ ${rowFlags.get(it.__idx)}${orig.evidence ? ` ${orig.evidence}` : ''}` } : {}),
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
  return { rows: out.map(o => o.row), corrections, flags };
}
