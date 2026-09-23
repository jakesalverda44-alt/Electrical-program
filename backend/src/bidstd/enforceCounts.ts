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
import { countedRowItem } from '../ai/countMerge';
import type { EnforcedCounts } from '../ai/reviewItems';
import type { CountResult } from '../ai/countingStage';

const CATEGORY_NAME: Record<CountTarget['category'], string> = {
  interior_lighting: 'Interior Lighting',
  exterior_building: 'Exterior / Site Lighting',
  site_lighting: 'Exterior / Site Lighting',
  lighting_control: 'Lighting Controls',
  device: 'Branch Power',
  equipment: 'Branch Power',
  panel_circuit: 'Branch Power',
};

const FIXTURE_CATEGORY = /\blight|\bfixture|\bluminaire/i;

/** A line that names a DIFFERENT item than the counted one — the feeder,
 *  disconnect, base, breaker, junction box, whip, conduit or panel that goes
 *  WITH it. Never the counted line, whatever tag or count_type it carries. */
const OTHER_ITEM = /\b(feeders?|feeds?|disconnects?|safety\s+switch(es)?|bases?|foundations?|piers?|breakers?|junction\s+box(es)?|j-?box(es)?|whips?|conduits?|raceways?|panels?|panelboards?|circuits?|homeruns?|wiring|wire|conductors?|stub[- ]?ups?|sleeves?)\b/i;

function catKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Fix round 2 / R2-B2 — a takeoff line stands for a counted type ONLY by
 *  structured identity, never by a free-text mention of a tag:
 *    * its count_type is the type's tag (Agent 4 carries it from the counter
 *      row), or
 *    * its ITEM field IS the type — "A", "Type A", "Type A — …", "RTU-1 — …",
 *      or the legend description itself — in a category where that type
 *      lives (fixtures in a lighting category).
 *  And even then, a line that names a different item (feeder, disconnect,
 *  base, junction box, panel …) or isn't counted in EA is not the counted
 *  line. Poles' heads are `<KEY>:heads`. */
export function lineCountKey(categoryName: string, it: Pick<TakeoffItem, 'item' | 'description' | 'count_type'> & { unit?: string }, targets: CountTarget[]): string | null {
  const byKey = new Map(targets.map(t => [t.key, t]));
  const item = norm(String(it.item ?? ''));
  const full = `${it.item ?? ''} ${it.description ?? ''}`;
  const heads = /\bheads?\b/i.test(full);
  let target: CountTarget | undefined;
  if (it.count_type) target = byKey.get(normalizeTypeKey(String(it.count_type).replace(/\s*heads?$/i, '')));
  if (!target) {
    for (const t of targets) {
      const k = norm(t.type);
      const desc = norm(t.description);
      const typeField = item === k || item === `TYPE ${k}` || item.startsWith(`${k} —`) || item.startsWith(`${k} -`) || item.startsWith(`TYPE ${k} —`) || item.startsWith(`TYPE ${k} -`)
        || (t.source === 'legend' && !!desc && (item === desc || item === `${desc} (${k})`));
      if (!typeField) continue;
      if ((t.category === 'interior_lighting' || t.category === 'exterior_building' || t.category === 'site_lighting') && !FIXTURE_CATEGORY.test(categoryName)) continue;
      target = t;
      break;
    }
  }
  if (!target) return null;
  const unit = String(it.unit ?? '').trim().toUpperCase();
  if (unit && unit !== 'EA') return null;
  // The line is ABOUT something else that goes with the counted item.
  const itemOnly = String(it.item ?? '');
  const aboutOther = OTHER_ITEM.test(itemOnly) && !OTHER_ITEM.test(`${target.type} ${target.description}`);
  if (aboutOther) return null;
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
  /** R2-B2 — types whose line can't be identified unambiguously: several
   *  lines carry the identity. Nothing is deleted; the GC documents are
   *  blocked until the estimator marks which line is the counted one. */
  ambiguous: Array<{ key: string; name: string; lines: Array<{ category: string; line: string }> }>;
  /** S-R2-7 — an estimator-counted unscheduled line that collides with a
   *  counted type's line: never overwritten, raised for review instead. */
  conflicts: string[];
}

/** An estimator's pick of THE counted line for a type (override flag
 *  `count_line:<KEY>`, bound to the exact line key). */
export type CountLinePick = (key: string, category: string, lineText: string) => boolean;

export function enforceCountsOnTakeoff(
  input: TakeoffCategory[],
  countResult: CountResult | null,
  enforced: EnforcedCounts,
  picked: CountLinePick = () => false,
): EnforceCountsResult {
  const takeoff: TakeoffCategory[] = input.map(c => ({ ...c, items: c.items.map(i => ({ ...i })) }));
  const corrections: string[] = [];
  const ambiguous: EnforceCountsResult['ambiguous'] = [];
  const conflicts: string[] = [];
  const targets = countResult?.targets ?? [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  if (!targets.length && !enforced.extraLines.length) return { takeoff, corrections, ambiguous, conflicts };

  const located = new Map<string, Array<{ cat: TakeoffCategory; it: TakeoffItem }>>();
  const locatedItems = new Set<TakeoffItem>();
  for (const cat of takeoff) {
    for (const it of cat.items) {
      const k = lineCountKey(cat.name, it, targets);
      if (!k) continue;
      if (!located.has(k)) located.set(k, []);
      located.get(k)!.push({ cat, it });
      locatedItems.add(it);
    }
  }
  const remove = (cat: TakeoffCategory, it: TakeoffItem) => { cat.items = cat.items.filter(x => x !== it); };
  const text = (it: TakeoffItem) => `${it.item ?? ''} ${it.description ?? ''}`.trim();
  const label = (it: TakeoffItem) => `"${it.item}${it.description && !it.description.includes(it.item) ? ` — ${it.description}` : ''}"`;

  for (const [key, qty] of enforced.byType) {
    let lines = located.get(key) ?? [];
    const target = byKey.get(key.replace(/:heads$/, ''));
    if (!target) continue;
    const name = key.endsWith(':heads') ? `Type ${target.type} heads` : `Type ${target.type}`;
    if (lines.length > 1) {
      // Prefer the line that carries count_type; an estimator's pick wins.
      const pick = lines.filter(l => picked(key, l.cat.name, text(l.it)));
      const tagged = lines.filter(l => l.it.count_type);
      if (pick.length === 1) lines = pick;
      else if (tagged.length === 1) lines = tagged;
      else {
        ambiguous.push({ key, name, lines: lines.map(l => ({ category: l.cat.name, line: text(l.it) })) });
        continue; // never delete; blocked until the estimator picks
      }
    }
    if (qty === null) {
      for (const { cat, it } of lines) {
        remove(cat, it);
        corrections.push(`${name} is not on this job (estimator review) — removed ${cat.name} ${label(it)}.`);
      }
      continue;
    }
    if (!lines.length) {
      const cat = findOrAddCategory(takeoff, CATEGORY_NAME[target.category]);
      const added: TakeoffItem = {
        item: itemTextFor(target, key.endsWith(':heads')), description: key.endsWith(':heads') ? target.description : '',
        unit: 'EA', qty, source: sourceFor(countResult, key), count_type: target.type,
      };
      cat.items.push(added);
      locatedItems.add(added);
      corrections.push(`${name} was missing from the takeoff — added to ${cat.name} with the counted quantity ${qty}.`);
      continue;
    }
    const first = lines[0];
    if (Number(first.it.qty) !== qty) {
      corrections.push(`${name}: ${first.cat.name} ${label(first.it)} said ${first.it.qty || 0} — set to the counted quantity ${qty}.`);
      first.it.qty = qty;
    }
    if (!first.it.unit) first.it.unit = 'EA';
    first.it.count_type = target.type;
  }

  // Estimator-counted unscheduled lines (B3), matched by the stored row
  // identity (the item text), never by substring, and never onto a line that
  // belongs to a counted type (S-R2-7).
  for (const x of enforced.extraLines) {
    const want = norm(x.item);
    let hit: { cat: TakeoffCategory; it: TakeoffItem } | undefined;
    let collision: { cat: TakeoffCategory; it: TakeoffItem } | undefined;
    for (const cat of takeoff) {
      for (const it of cat.items) {
        if (norm(String(it.item ?? '')) !== want) continue;
        if (locatedItems.has(it)) collision ??= { cat, it };
        else hit ??= { cat, it };
      }
    }
    if (!hit && collision) {
      conflicts.push(`"${x.item}" (unscheduled, counted by the estimator at ${x.qty}) is the same line as a counted type (${collision.cat.name} ${label(collision.it)}) — resolve it in the takeoff review: count it as that type or mark one of them not on this job.`);
      continue;
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
  return { takeoff: takeoff.filter(c => c.items.length > 0), corrections, ambiguous, conflicts };
}

/** The final check (also run on every GC document path): each enforced type
 *  is exactly one line with exactly its quantity; a "not on this job" type
 *  has no line. Any difference is a problem that blocks the GC documents. */
export function countMismatchProblems(takeoff: TakeoffCategory[], countResult: CountResult | null, enforced: EnforcedCounts, picked: CountLinePick = () => false): string[] {
  const targets = countResult?.targets ?? [];
  if (!targets.length) return [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  const found = new Map<string, Array<{ qty: number; tagged: boolean; picked: boolean }>>();
  for (const cat of takeoff) for (const it of cat.items) {
    const k = lineCountKey(cat.name, it, targets);
    if (!k) continue;
    if (!found.has(k)) found.set(k, []);
    found.get(k)!.push({ qty: Number(it.qty), tagged: !!it.count_type, picked: picked(k, cat.name, `${it.item ?? ''} ${it.description ?? ''}`.trim()) });
  }
  const problems: string[] = [];
  for (const [key, qty] of enforced.byType) {
    const t = byKey.get(key.replace(/:heads$/, ''));
    if (!t) continue;
    const name = key.endsWith(':heads') ? `Type ${t.type} heads` : `Type ${t.type}`;
    let got = found.get(key) ?? [];
    if (got.length > 1) {
      const p = got.filter(g => g.picked);
      const tg = got.filter(g => g.tagged);
      got = p.length === 1 ? p : tg.length === 1 ? tg : got;
    }
    if (qty === null) {
      if (got.length) problems.push(`${name} is marked not on this job but the takeoff still has ${got.length} line(s) for it.`);
    } else if (got.length !== 1 || got[0].qty !== qty) {
      problems.push(`${name} must be one takeoff line of ${qty} (counted/resolved); the takeoff has ${got.length ? got.map(g => g.qty).join(' + ') : 'no line'}.`);
    }
  }
  return problems;
}
