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

/** Categories where a counted fixture / device could be written twice. */
const DOUBLE_CHECK_CATEGORY = /\blight|\bfixture|\bluminaire|\bdevice|\bcontrol|\bbranch\s+power|\breceptacle/i;

/** Words that say nothing about WHICH fixture it is. */
const GENERIC = new Set(['led', 'light', 'lights', 'lighting', 'fixture', 'fixtures', 'luminaire', 'luminaires', 'type', 'mounted', 'surface',
  'new', 'with', 'and', 'the', 'per', 'schedule', 'plan', 'plans', 'interior', 'exterior', 'white', 'black', 'lamp', 'lamps', 'lens', 'lensed',
  'unit', 'each', 'ea', 'owner', 'furnished', 'installed', 'install', 'furnish', 'provide', 'by', 'for', 'of', 'in', 'on', 'at', 'to', 'a']);

/** Words that mean the same kind of fixture. */
const SYNONYMS: Array<[string, RegExp]> = [
  ['LINEAR', /\b(linear|strip|strips|wrap|wraparound|wrap-around|channel)\b/i],
  ['DOWNLIGHT', /\b(downlights?|down\s*lights?|cans?|recessed\s+round|pot\s*lights?)\b/i],
  ['TROFFER', /\b(troffers?|2x4|2x2|1x4|flat\s*panels?|lay-?in)\b/i],
  ['EMERGENCY', /\b(exit|exits|emergency|egress|bug[- ]?eye|battery\s+pack|em\b)\b/i],
  ['WALLPACK', /\b(wall\s*packs?|wallpacks?)\b/i],
  ['AREA', /\b(area\s+lights?|pole\s+lights?|site\s+lights?|shoebox)\b/i],
  ['CANOPY', /\b(canopy)\b/i],
  ['HIGHBAY', /\b(high\s*bays?|low\s*bays?)\b/i],
  ['VANITY', /\b(vanity|mirror\s+lights?)\b/i],
  ['RECEPTACLE', /\b(receptacles?|duplex|outlets?)\b/i],
  ['GFCI', /\b(gfci|gfi|ground\s+fault)\b/i],
  ['SENSOR', /\b(occupancy|vacancy|motion|sensors?)\b/i],
  ['PHOTOCELL', /\b(photo\s*cells?|photocontrols?)\b/i],
  ['POLE', /\b(poles?|pole[- ]mounted)\b/i],
  ['QUAD', /\b(quad(?:plex)?|fourplex|double\s+duplex)\b/i],
  ['USB', /\busb\b/i],
];

function features(text: string): { groups: Set<string>; sizes: Set<string>; words: Set<string> } {
  const t = text.toLowerCase();
  const groups = new Set(SYNONYMS.filter(([, re]) => re.test(t)).map(([g]) => g));
  const sizes = new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|’)(?![a-z])/g)].map(m => `${m[1]}FT`));
  const words = new Set(t.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !GENERIC.has(w) && !/^\d/.test(w)));
  return { groups, sizes, words };
}

/** Next round A7 — two free-text lines plausibly name the same fixture /
 *  device (same rules as plausiblySameFixture, symmetric). */
export function plausiblySameText(a: string, b: string): boolean {
  const x = features(a);
  const y = features(b);
  const sizeConflict = x.sizes.size > 0 && y.sizes.size > 0 && ![...x.sizes].some(s => y.sizes.has(s));
  if (sizeConflict) return false;
  // Fix round S10 — a 2x4 is not a 2x2.
  const ax = gridSizes(a); const bx = gridSizes(b);
  if (ax.size && bx.size && ![...ax].some(s => bx.has(s))) return false;
  // Fix round S10 — a type tag decides when both lines carry one: "Pole
  // light S1" = "S1 site pole", "Fixture type C" = "Type C"; A1 != A2.
  const at = typeTags(a); const bt = typeTags(b);
  if (at.size && bt.size) return [...at].some(t => bt.has(t));
  // A specific kind on one side only is a different item: a GFCI is not a
  // plain duplex (the re-run review's own repro), a quad or USB receptacle
  // is not a duplex, an exit is not a strip.
  if (SPECIFIC_GROUPS.some(g => x.groups.has(g) !== y.groups.has(g))) return false;
  if ([...x.groups].some(g => y.groups.has(g))) return true;
  return [...x.words].filter(w => y.words.has(w)).length >= 2;
}

const SPECIFIC_GROUPS = ['GFCI', 'EMERGENCY', 'SENSOR', 'PHOTOCELL', 'QUAD', 'USB'];

/** "2x4", "2 X 2" -> {"2X4"}; orientation-free ("4x2" = "2x4"). */
function gridSizes(text: string): Set<string> {
  return new Set([...text.toUpperCase().matchAll(/\b(\d{1,2})\s*X\s*(\d{1,2})\b/g)].map(m => [m[1], m[2]].sort().join('X')));
}

/** Type tags a line names: "TYPE C", "(C)", "S1", "W2A". */
export function typeTags(text: string): Set<string> {
  const t = text.toUpperCase();
  const out = new Set<string>();
  for (const m of t.matchAll(/\bTYPE\s*[:#-]?\s*([A-Z]{1,2}\d{0,2}[A-Z]?)\b/g)) out.add(m[1]);
  for (const m of t.matchAll(/\(\s*([A-Z]{1,2}\d{0,2}[A-Z]?)\s*\)/g)) out.add(m[1]);
  for (const m of t.matchAll(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/g)) if (!/^(?:EA|LF|NO|QT|PC)\d/.test(m[1])) out.add(m[1]);
  return out;
}

/** Does a free-text line plausibly describe the counted type? The type's
 *  schedule description and symbol keywords, not its tag: the same kind of
 *  fixture (synonyms: "strip" = "linear", "exit sign" = an emergency type)
 *  with a matching size when both give one, or two shared distinctive words. */
export function plausiblySameFixture(line: string, target: Pick<CountTarget, 'description' | 'symbolHint' | 'emergency'>): boolean {
  const a = features(line);
  const b = features(`${target.description} ${target.symbolHint ?? ''}`);
  if (target.emergency) b.groups.add('EMERGENCY');
  const sharedGroup = [...a.groups].some(g => b.groups.has(g));
  const sizeConflict = a.sizes.size > 0 && b.sizes.size > 0 && ![...a.sizes].some(x => b.sizes.has(x));
  if (sharedGroup && !sizeConflict) return true;
  const sharedWords = [...a.words].filter(w => b.words.has(w));
  return sharedWords.length >= 2 && !sizeConflict;
}

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
  /** Pre-merge follow-up — an untagged EA line in a fixture / device /
   *  lighting category whose text plausibly refers to a counted type: it may
   *  be the same fixture counted twice. Blocking until the estimator says
   *  "Same fixture — remove this line" or "Different item — keep". */
  possibleDoubles: Array<{ key: string; type: string; count: number; category: string; line: string }>;
}

/** The estimator's decision on a possible double count, bound to the exact
 *  line: 'remove' (same fixture) or 'keep' (different item), else null. */
export type DoubleCountDecision = (key: string, category: string, lineText: string) => 'remove' | 'keep' | null;

/** An estimator's pick of THE counted line for a type (override flag
 *  `count_line:<KEY>`, bound to the exact line key). */
export type CountLinePick = (key: string, category: string, lineText: string) => boolean;

export function enforceCountsOnTakeoff(
  input: TakeoffCategory[],
  countResult: CountResult | null,
  enforced: EnforcedCounts,
  picked: CountLinePick = () => false,
  doubleDecision: DoubleCountDecision = () => null,
): EnforceCountsResult {
  const takeoff: TakeoffCategory[] = input.map(c => ({ ...c, items: c.items.map(i => ({ ...i })) }));
  const corrections: string[] = [];
  const ambiguous: EnforceCountsResult['ambiguous'] = [];
  const conflicts: string[] = [];
  const targets = countResult?.targets ?? [];
  const byKey = new Map(targets.map(t => [t.key, t]));
  const possibleDoubles: EnforceCountsResult['possibleDoubles'] = [];
  if (!targets.length && !enforced.extraLines.length) return { takeoff, corrections, ambiguous, conflicts, possibleDoubles };

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
  // Possible double counts: an EA line with no count_type, not the counted
  // line, in a fixture / device / lighting category, whose words plausibly
  // describe a counted type. Never removed unless the estimator says so.
  for (const cat of takeoff) {
    if (!DOUBLE_CHECK_CATEGORY.test(cat.name)) continue;
    for (const it of [...cat.items]) {
      if (locatedItems.has(it) || it.count_type) continue;
      const unit = String(it.unit ?? '').trim().toUpperCase();
      if (unit && unit !== 'EA') continue;
      const line = text(it);
      if (OTHER_ITEM.test(String(it.item ?? ''))) continue;
      const hit = [...enforced.byType.entries()]
        .filter(([key, qty]) => qty !== null && !key.endsWith(':heads'))
        .map(([key, qty]) => ({ key, qty: qty as number, target: byKey.get(key) }))
        .find(x => x.target && plausiblySameFixture(line, x.target));
      if (!hit) continue;
      const decision = doubleDecision(hit.key, cat.name, line);
      if (decision === 'keep') continue;
      if (decision === 'remove') {
        remove(cat, it);
        corrections.push(`${cat.name} ${label(it)} removed by the estimator — the same fixture as counted Type ${hit.target!.type} (${hit.qty}).`);
        continue;
      }
      possibleDoubles.push({ key: hit.key, type: hit.target!.type, count: hit.qty, category: cat.name, line });
    }
  }
  return { takeoff: takeoff.filter(c => c.items.length > 0), corrections, ambiguous, conflicts, possibleDoubles };
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
