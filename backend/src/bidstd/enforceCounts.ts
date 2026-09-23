// Takeoff accuracy fix round 1 / B1 — the counted and estimator-resolved
// quantities reach the GC documents DETERMINISTICALLY. Agent 4 (and the
// pre-bid draft composer) only ever PROPOSES the takeoff; after it, code:
//   * finds each counted type's line (the line's count_type, else the same
//     tag/description matching the merge uses),
//   * overwrites its qty with the counted / resolved number,
//   * re-inserts the line when Agent 4 dropped it,
//   * removes extra lines for the same type (a type is ONE line) and every
//     line for a type the estimator marked "not on this job",
// recording each change. countMismatchProblems then re-checks the final
// takeoff against the same set; any mismatch blocks the GC documents.
// Prompt text is never the guarantee.
//
// Pure: no I/O.
import type { TakeoffCategory, TakeoffItem } from './bidData';
import type { CountTarget } from '../ai/countTargets';
import { normalizeTypeKey } from '../ai/countTargets';
import { rowMatchScore, countedRowItem } from '../ai/countMerge';
import type { EnforcedCounts } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

const DEVICE_CATEGORIES = new Set(['equipment', 'device']);

const CATEGORY_NAME: Record<CountTarget['category'], string> = {
  interior_lighting: 'Interior Lighting',
  exterior_building: 'Exterior / Site Lighting',
  site_lighting: 'Exterior / Site Lighting',
  lighting_control: 'Lighting Controls',
  device: 'Branch Power',
  equipment: 'Branch Power',
  panel_circuit: 'Branch Power',
};

const FIXTURE_LIKE = /\blight|\bfixture|\bluminaire|\bcontrol|\bbranch\s+power|\bdevice/i;

function catKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** The enforcement key a takeoff line stands for, or null. Poles' heads are
 *  `<KEY>:heads`. */
export function lineCountKey(categoryName: string, it: Pick<TakeoffItem, 'item' | 'description' | 'count_type'>, targets: CountTarget[]): string | null {
  const byKey = new Map(targets.map(t => [t.key, t]));
  const heads = /\bheads?\b/i.test(`${it.item} ${it.description}`);
  let target: CountTarget | undefined;
  if (it.count_type) target = byKey.get(normalizeTypeKey(it.count_type.replace(/\s*heads?$/i, '')));
  if (!target) {
    const pool = FIXTURE_LIKE.test(categoryName) ? targets : targets.filter(t => DEVICE_CATEGORIES.has(t.category));
    let best = 0;
    for (const t of pool) {
      const sc = rowMatchScore({ item: it.item, spec: it.description }, t);
      if (sc > best) { best = sc; target = t; }
    }
  }
  if (!target) return null;
  return target.category === 'site_lighting' && heads ? `${target.key}:heads` : target.key;
}

function findOrAddCategory(takeoff: TakeoffCategory[], name: string): TakeoffCategory {
  const hit = takeoff.find(c => catKey(c.name) === catKey(name));
  if (hit) return hit;
  const c: TakeoffCategory = { name, items: [] };
  takeoff.push(c);
  return c;
}

function sourceFor(countResult: CountResult | null, key: string): string {
  const t = countResult?.types.find(x => x.key === key.replace(/:heads$/, ''));
  const used = (t?.sheets ?? []).filter(s => s.used).map(s => s.label.split(' ')[0]);
  return used.length ? used.join(', ') : 'Estimator review';
}

function itemTextFor(target: CountTarget, heads: boolean): string {
  if (target.category === 'site_lighting') {
    return heads
      ? `Type ${target.type} — fixture heads${target.headsPerPole != null ? ` (${target.headsPerPole} per pole)` : ''}`
      : `Type ${target.type} — pole (${target.description || 'site light'})`;
  }
  return countedRowItem(target);
}

export interface EnforceCountsResult {
  takeoff: TakeoffCategory[];
  corrections: string[];
}

export function enforceCountsOnTakeoff(
  input: TakeoffCategory[],
  countResult: CountResult | null,
  enforced: EnforcedCounts,
): EnforceCountsResult {
  const takeoff: TakeoffCategory[] = input.map(c => ({ ...c, items: c.items.map(i => ({ ...i })) }));
  const corrections: string[] = [];
  const targets = countResult?.targets ?? [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  if (!targets.length && !enforced.extraLines.length) return { takeoff, corrections };

  // Every line, tagged with the key it stands for.
  const located = new Map<string, Array<{ cat: TakeoffCategory; it: TakeoffItem }>>();
  for (const cat of takeoff) {
    for (const it of cat.items) {
      const k = lineCountKey(cat.name, it, targets);
      if (!k) continue;
      if (!located.has(k)) located.set(k, []);
      located.get(k)!.push({ cat, it });
    }
  }
  const remove = (cat: TakeoffCategory, it: TakeoffItem) => { cat.items = cat.items.filter(x => x !== it); };
  const label = (it: TakeoffItem) => `"${it.item}${it.description && !it.description.includes(it.item) ? ` — ${it.description}` : ''}"`;

  for (const [key, qty] of enforced.byType) {
    const lines = located.get(key) ?? [];
    const target = byKey.get(key.replace(/:heads$/, ''));
    if (!target) continue;
    const name = key.endsWith(':heads') ? `Type ${target.type} heads` : `Type ${target.type}`;
    if (qty === null) {
      for (const { cat, it } of lines) {
        remove(cat, it);
        corrections.push(`${name} is not on this job (estimator review) — removed ${cat.name} ${label(it)}.`);
      }
      continue;
    }
    if (!lines.length) {
      const cat = findOrAddCategory(takeoff, CATEGORY_NAME[target.category]);
      cat.items.push({
        item: itemTextFor(target, key.endsWith(':heads')), description: key.endsWith(':heads') ? target.description : '',
        unit: 'EA', qty, source: sourceFor(countResult, key), count_type: target.type,
      });
      corrections.push(`${name} was missing from the takeoff — added to ${cat.name} with the counted quantity ${qty}.`);
      continue;
    }
    const [first, ...extra] = lines;
    if (Number(first.it.qty) !== qty) {
      corrections.push(`${name}: ${first.cat.name} ${label(first.it)} said ${first.it.qty || 0} — set to the counted quantity ${qty}.`);
      first.it.qty = qty;
    }
    if (String(first.it.unit ?? '').toUpperCase() !== 'EA') first.it.unit = 'EA';
    first.it.count_type = target.type;
    for (const { cat, it } of extra) {
      remove(cat, it);
      corrections.push(`${name} is one line — removed the extra ${cat.name} ${label(it)} (${it.qty}), which would have stacked on the counted ${qty}.`);
    }
  }

  for (const x of enforced.extraLines) {
    const want = x.item.toLowerCase();
    let hit: { cat: TakeoffCategory; it: TakeoffItem } | undefined;
    for (const cat of takeoff) {
      const it = cat.items.find(i => `${i.item} ${i.description}`.toLowerCase().includes(want)
        || (String(i.item).length > 6 && want.includes(String(i.item).toLowerCase())));
      if (it) { hit = { cat, it }; break; }
    }
    if (!hit) {
      const cat = findOrAddCategory(takeoff, x.category.replace(/^exterior site lighting$/i, 'Exterior / Site Lighting'));
      cat.items.push({ item: x.item, description: '', unit: 'EA', qty: x.qty, source: 'Estimator review' });
      corrections.push(`"${x.item}" (unscheduled, counted by the estimator) was missing — added to ${cat.name} with ${x.qty}.`);
    } else if (Number(hit.it.qty) !== x.qty) {
      corrections.push(`"${x.item}": ${hit.cat.name} said ${hit.it.qty || 0} — set to the estimator's count ${x.qty}.`);
      hit.it.qty = x.qty;
    }
  }
  return { takeoff: takeoff.filter(c => c.items.length > 0), corrections };
}

/** The final check (also run on every GC document path): each enforced type
 *  is exactly one line with exactly its quantity; a "not on this job" type
 *  has no line. Any difference is a problem that blocks the GC documents. */
export function countMismatchProblems(takeoff: TakeoffCategory[], countResult: CountResult | null, enforced: EnforcedCounts): string[] {
  const targets = countResult?.targets ?? [];
  if (!targets.length) return [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  const found = new Map<string, number[]>();
  for (const cat of takeoff) for (const it of cat.items) {
    const k = lineCountKey(cat.name, it, targets);
    if (!k) continue;
    if (!found.has(k)) found.set(k, []);
    found.get(k)!.push(Number(it.qty));
  }
  const problems: string[] = [];
  for (const [key, qty] of enforced.byType) {
    const t = byKey.get(key.replace(/:heads$/, ''));
    if (!t) continue;
    const name = key.endsWith(':heads') ? `Type ${t.type} heads` : `Type ${t.type}`;
    const got = found.get(key) ?? [];
    if (qty === null) {
      if (got.length) problems.push(`${name} is marked not on this job but the takeoff still has ${got.length} line(s) for it.`);
    } else if (got.length !== 1 || got[0] !== qty) {
      problems.push(`${name} must be one takeoff line of ${qty} (counted/resolved); the takeoff has ${got.length ? got.join(' + ') : 'no line'}.`);
    }
  }
  return problems;
}
