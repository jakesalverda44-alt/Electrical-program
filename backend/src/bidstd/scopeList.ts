// Takeoff accuracy, Task 11 — closes a real failure: the signed Big Dan's Car
// Wash (Lake City, Sep 2025) proposal listed items the estimator had EXCLUDED
// (a 480V MCC; 3 VFD panels for vacuum motors), other trades' work ("Supply
// and install 12" HDPE pipe 500 LF", "Install 5/8" drywall – Level 5 finish
// 8,000 SF") and near-duplicate lines (LED canopy fixtures x3, exit signs x2,
// lighting contactors x3). Pure: no I/O.
//
//  1. The estimator's scope list per bid — Included / Not included items.
//     Binding for Agents 2 and 4; a GC-facing takeoff line or scope bullet
//     matching a Not-included item BLOCKS the document; each Not-included
//     item becomes an exclusion bullet.
//  2. A non-electrical gate: other trades' lines (drywall, HDPE/storm/
//     sanitary pipe, concrete that isn't an electrical pad/base, roofing,
//     plumbing fixtures, HVAC equipment supply, ...) and unit sanity (SF, SY,
//     CY, TON on an electrical takeoff) block unless the estimator overrides
//     the line with a reason.
//  3. Near-duplicate takeoff lines (same category, same thing said twice) are
//     flagged before the proposal is generated.
import type { BidData, Bullet } from './bidData';

export type ScopeItemKind = 'include' | 'exclude';

export interface ScopeItem {
  id: string;
  kind: ScopeItemKind;
  text: string;
}

export interface NonElectricalOverride {
  /** normalizeLineKey(category, item/description) of the overridden line. */
  lineKey: string;
  reason: string;
  /** Fix round 2 / S-R2-5 — what was overridden: 'non_electrical',
   *  'excluded_scope', 'spec', 'count_line:<KEY>'. A row from before round 2
   *  has none and counts as 'non_electrical'. */
  flag?: string | null;
}

/** S-R2-5 — an override clears ONLY the exact line it was made on (same
 *  category and the same significant words) and only for the flag it was
 *  made for. No fuzzy word overlap. */
export function overrideFor(lineKey: string, overrides: NonElectricalOverride[], flag = 'non_electrical'): string | null {
  const o = overrides.find(x => x.lineKey === lineKey && (x.flag ?? 'non_electrical') === flag);
  return o ? o.reason : null;
}

// ── Terms ───────────────────────────────────────────────────────────────────

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'at', 'in', 'on', 'by', 'with', 'per', 'all', 'any', 'each', 'as', 'is', 'are', 'be',
  'not', 'included', 'include', 'includes', 'excluded', 'exclude', 'excludes', 'nic', 'others', 'other', 'no', 'only', 'scope',
  'furnish', 'furnished', 'install', 'installed', 'provide', 'provided', 'supply', 'supplied', 'new', 'existing',
]);

function singular(w: string): string {
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('es') && /(ch|sh|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Significant words: no stop words, no bare numbers or ratings (600A, 480V,
 *  3P, 15HP, 12"), singularized ("VFDs for vacuums" -> vfd, vacuum). */
export function significantTerms(text: string): string[] {
  const words = text.toLowerCase().replace(/[“”"'’]/g, '').split(/[^a-z0-9/]+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w)) continue;
    if (/^\d+(\.\d+)?$/.test(w)) continue;
    if (/^\d+(\.\d+)?(a|v|va|kva|kw|hp|p|w|amp|amps|volt|volts|ph|in|ft|lf|sf|ea|x\d+)$/.test(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(singular(w));
  }
  return [...new Set(out)];
}

/** Terms that identify a Not-included item — its significant words. */
export function excludedItemTerms(item: Pick<ScopeItem, 'text'>): string[] {
  const text = item.text.replace(/\s*[—–-]\s*(not included|nic|by others|excluded)\b.*$/i, '').replace(/\b(not included|nic|by others|excluded)\b/gi, '');
  return significantTerms(text);
}

/** Does `text` mention the excluded item? Every one of its terms must appear
 *  as a word ("VFDs for vacuums" matches "3 VFD panels for vacuum motors";
 *  "600A MCC" matches "480V MCC" but not "MCCB breaker"). */
export function mentionsExcludedItem(text: string, item: Pick<ScopeItem, 'text'>): boolean {
  const terms = excludedItemTerms(item);
  if (!terms.length) return false;
  const have = new Set(significantTerms(text));
  return terms.every(t => have.has(t));
}

function bulletText(b: Bullet): string {
  return typeof b === 'string' ? b : `${b.b} ${b.t}`;
}

/** GC-facing takeoff lines and scope bullets (never the exclusions) that
 *  mention a Not-included item. */
/** N7 — an Included item that carves out part of an Excluded one ("Low
 *  voltage" excluded, "Low voltage: conduit and pull strings only" included):
 *  text matching the Included item is its scope, not the excluded item. */
function carvedOut(text: string, ex: ScopeItem, includes: ScopeItem[]): boolean {
  const exTerms = excludedItemTerms(ex);
  return includes.some(inc => {
    const incTerms = significantTerms(inc.text);
    if (!exTerms.every(t => incTerms.includes(t)) || incTerms.length <= exTerms.length) return false;
    const have = new Set(significantTerms(text));
    // the text carries the carve-out's own extra words ("conduit", "pull", "string")
    if (!incTerms.filter(t => !exTerms.includes(t)).some(t => have.has(t))) return false;
    // S-R2-8 — precise: a carve-out covers only conduit, boxes and pull
    // strings; text that also names cabling, devices, wiring, terminations or
    // programming is the excluded work and fails.
    return !EXCLUDED_WORK.test(text);
  });
}

const EXCLUDED_WORK = /\b(cabl(e|es|ing)|devices?|wir(e|es|ing|ed)|terminat(e|es|ed|ion|ions)|programming|program|equipment|heads?|speakers?|cameras?|readers?|panels?)\b/i;

export interface ExcludedScopeFinding { category: string; line: string; detail: string }

/** Structured form (fix round 1 / N7): the category (takeoff category or
 *  section title) and line text an estimator override is keyed on. */
export function excludedScopeFindings(data: Pick<BidData, 'takeoff' | 'sections'>, items: ScopeItem[], overrides: NonElectricalOverride[] = []): ExcludedScopeFinding[] {
  const excluded = items.filter(i => i.kind === 'exclude');
  const includes = items.filter(i => i.kind === 'include');
  const kept = (cat: string, text: string) => overrideFor(normalizeLineKey(cat, text), overrides, 'excluded_scope') !== null;
  const out: ExcludedScopeFinding[] = [];
  for (const ex of excluded) {
    for (const cat of data.takeoff ?? []) {
      for (const it of cat.items ?? []) {
        const text = `${it.item ?? ''} ${it.description ?? ''}`.trim();
        if (mentionsExcludedItem(text, ex) && !carvedOut(text, ex, includes) && !kept(cat.name, text)) {
          out.push({ category: cat.name, line: text, detail: `Takeoff ${cat.name}: "${text}" is on the Not-included list ("${ex.text}")` });
        }
      }
    }
    for (const s of data.sections ?? []) {
      for (const b of s.bullets ?? []) {
        const text = bulletText(b);
        if (mentionsExcludedItem(text, ex) && !carvedOut(text, ex, includes) && !kept(s.title, text)) {
          out.push({ category: s.title, line: text, detail: `${s.title}: "${text}" is on the Not-included list ("${ex.text}")` });
        }
      }
    }
  }
  return out;
}

export function excludedScopeProblems(data: Pick<BidData, 'takeoff' | 'sections'>, items: ScopeItem[], overrides: NonElectricalOverride[] = []): string[] {
  return excludedScopeFindings(data, items, overrides).map(f => f.detail);
}

/** One exclusion bullet per Not-included item not already covered. */
export function exclusionBulletsFor(items: ScopeItem[], existing: Bullet[]): string[] {
  const out: string[] = [];
  for (const ex of items.filter(i => i.kind === 'exclude')) {
    if (existing.some(b => mentionsExcludedItem(bulletText(b), ex))) continue;
    const text = ex.text.trim().replace(/[.\s]+$/, '');
    out.push(/\b(not included|nic|by others|excluded)\b/i.test(text) ? `${text}.` : `${text} — not included.`);
  }
  return out;
}

export function renderScopeListBlock(items: ScopeItem[]): string | null {
  if (!items.length) return null;
  const inc = items.filter(i => i.kind === 'include');
  const exc = items.filter(i => i.kind === 'exclude');
  const lines = ['--- ESTIMATOR SCOPE LIST (BINDING — overrides the drawings, the analysis and every earlier scope) ---'];
  if (inc.length) lines.push('INCLUDED, exactly as limited here:', ...inc.map(i => `- ${i.text}`));
  if (exc.length) {
    lines.push('NOT INCLUDED — never write a scope bullet or takeoff line for these; each one gets an exclusion instead:', ...exc.map(i => `- ${i.text}`));
  }
  return lines.join('\n');
}

// ── Non-electrical gate ─────────────────────────────────────────────────────
// Fix round 1 / S9: a FLAG with an estimator override (reason required) for
// anything ambiguous; a hard BLOCK only for clearly other-trade lines
// (drywall/finishes, storm/sanitary/water piping, plumbing-fixture supply,
// roofing). Electrical context (pole bases/foundations, conduit
// encasement, equipment pads, EC roof penetrations, door-operator power,
// landscape-lighting / irrigation-controller power, saw cutting / core
// drilling for conduit) is never flagged. An SF unit alone only flags.

interface TradeRule { trade: string; hard: boolean; test: (t: string) => boolean; /** EC work that uses this trade's word (an EC roof penetration). */ ecWork?: RegExp }

/** Words that make a line EC work whatever other trade's word it contains. */
const ELECTRICAL_CONTEXT = /\b(conduits?|duct\s*banks?|raceways?|conductors?|wire|wiring|cables?|circuits?|feeders?|feeds?|disconnects?|receptacles?|panels?|breakers?|electrical|power(ed)?|connections?|connect|j-?box(es)?|junction|light|lighting|fixtures?|luminaires?|grounding|ground rods?|transformers?|meters?|switch(es)?|whips?|homeruns?|home runs?|motors?|operators?|controllers?|\d{3}\s*v|\d{2,3}\s*volts?|120v|208v|277v|480v|penetrations?|pitch\s*pockets?|sleeves?|stub[- ]?ups?|core\s*drill(ing)?|saw\s*cut(ting)?|encase(ment|d)?|pole\s*(bases?|foundations?|piers?)|foundations?\s+for\s+(the\s+)?(light|pole)|light\s*pole|equipment\s*pads?|housekeeping\s*pads?|transformer\s*pads?)\b/i;

// Fix round 2 / S-R2-4 — clear other-trade scope HARD-BLOCKS (keep it with a
// reason to override) whenever there is no electrical context: drywall /
// finishes, storm / sanitary pipe, plumbing piping and fixtures, roofing,
// HVAC ductwork / equipment supply, fire-sprinkler piping, paving / asphalt,
// painting. Electrical-adjacent words (concrete, flooring/ceilings, doors,
// framing, fencing, landscaping) only flag.
const TRADES: TradeRule[] = [
  { trade: 'drywall / finishes', hard: true, test: t => /\b(drywall|gypsum|gyp\.?\s*board|sheetrock|level\s*[45]\s*finish|taping|mud(ding)?)\b/i.test(t) },
  { trade: 'site piping (HDPE / storm / sanitary / water)', hard: true, test: t => /\b(pipe|piping)\b/i.test(t) && /\b(hdpe|storm|sanitary|sewer|water|drain(age)?|pvc\s*drain|culvert|rcp)\b/i.test(t) && !/\b(conduit|duct|sleeve)\b/i.test(t) },
  { trade: 'plumbing fixtures', hard: true, test: t => /\b(toilet|water closet|urinal|lavator(y|ies)|faucet|mop sink|sink|plumbing fixture)\b/i.test(t) },
  { trade: 'plumbing piping', hard: true, test: t => /\b(plumbing|domestic water|waste and vent|dwv|gas piping|gas pipe)\b/i.test(t) },
  { trade: 'roofing', hard: true, test: t => /\b(roofing|roof membrane|shingles?|flashing|re-?roof)\b/i.test(t), ecWork: /\b(pitch\s*pockets?|penetrations?|conduits?|roof\s*jacks?|pipe\s*portals?)\b/i },
  { trade: 'HVAC equipment / ductwork supply', hard: true, test: t => /\bductwork\b/i.test(t) || (/\b(rtu|rooftop unit|air handler|ahu|condenser|mini-?split|diffuser|grille)\b/i.test(t) && /\b(furnish|supply|provide|purchase|set)\b/i.test(t)) },
  { trade: 'fire sprinkler', hard: true, test: t => /\b(sprinkler|fire suppression)\b/i.test(t) && !/\b(flow switch|tamper|monitor)\b/i.test(t) },
  { trade: 'paving / asphalt', hard: true, test: t => /\b(asphalt|paving|pavement)\b/i.test(t) && !/\b(conduit|sleeve|saw\s*cut|patch(ing)?\s+(at|for|over)\s+(the\s+)?(trench|conduit))\b/i.test(t) },
  { trade: 'painting', hard: true, test: t => /\b(paint(ing)?|primer|repaint)\b/i.test(t) },
  { trade: 'concrete (not an electrical pad or base)', hard: false, test: t => /\b(concrete|slab|sidewalk|curb|footing|cmu|masonry)\b/i.test(t) },
  { trade: 'flooring / ceilings', hard: false, test: t => /\b(flooring|carpet|vct|floor tile|ceiling tile|acoustical ceiling|ceiling grid)\b/i.test(t) },
  { trade: 'framing / doors / insulation', hard: false, test: t => /\b(framing|metal studs?|wood studs?|door hardware|doors?\b|insulation|batt)\b/i.test(t) },
  { trade: 'landscaping / fencing', hard: false, test: t => /\b(landscap(e|ing)|irrigation|sod|fenc(e|ing))\b/i.test(t) && !/\b(conduit|sleeve|gate operator)\b/i.test(t) },
];

/** Units that don't belong on an electrical takeoff (SF of drywall is the
 *  classic). Lighting per SF, conduit per LF, devices per EA are fine. */
const NON_ELECTRICAL_UNITS = /^(sf|sq\.?\s*ft|sy|sq\.?\s*yd|cy|cu\.?\s*yd|ton|tons|gal|gallons)$/i;

/** The exact identity of a line an override is bound to (S-R2-5): its
 *  category and every word and number in it (quantities and ratings
 *  included — a 100 SF line is not a 900 SF line), order-insensitive. */
export function normalizeLineKey(category: string, text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9./]+/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[./]+$/, ''))
    .filter(w => w && !STOP.has(w));
  return `${category.trim().toLowerCase()}::${[...new Set(words)].sort().join(' ')}`;
}

export interface NonElectricalVerdict { reason: string; block: boolean }

/** null = electrical (or electrical context); otherwise why it looks like
 *  another trade and whether that is a hard block or a flag. */
export function nonElectricalVerdict(text: string, unit: string): NonElectricalVerdict | null {
  const context = ELECTRICAL_CONTEXT.test(text);
  for (const r of TRADES) {
    if (!r.test(text)) continue;
    if (r.ecWork?.test(text)) return null;
    if (context) return r.hard ? { reason: r.trade, block: false } : null; // a hard trade word WITH electrical context: flag only
    return { reason: r.trade, block: r.hard };
  }
  if (NON_ELECTRICAL_UNITS.test(unit.trim())) return { reason: `unit "${unit}" is not an electrical takeoff unit`, block: false };
  return null;
}

/** Back-compat: the reason only. */
export function nonElectricalReason(text: string, unit: string): string | null {
  return nonElectricalVerdict(text, unit)?.reason ?? null;
}

export interface NonElectricalFinding { category: string; line: string; unit: string; reason: string; lineKey: string; overridden: string | null; block: boolean }

export function nonElectricalFindings(data: Pick<BidData, 'takeoff'>, overrides: NonElectricalOverride[]): NonElectricalFinding[] {
  const out: NonElectricalFinding[] = [];
  for (const cat of data.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const line = `${it.item ?? ''} ${it.description ?? ''}`.trim();
      const v = nonElectricalVerdict(line, String(it.unit ?? ''));
      if (!v) continue;
      const lineKey = normalizeLineKey(cat.name, line);
      out.push({ category: cat.name, line, unit: String(it.unit ?? ''), reason: v.reason, lineKey, overridden: overrideFor(lineKey, overrides), block: v.block });
    }
  }
  return out;
}

// ── Near duplicates ─────────────────────────────────────────────────────────

const DUP_NOISE = new Set(['surface', 'mounted', 'surface-mounted', 'recessed', 'complete', 'new', 'led', 'type', 'fixture', 'unit']);

function typeTag(text: string): string | null {
  // N10 — "Type A", "Fixture A", "Fixture Type B1", "(A)", "A:" all carry a tag.
  const m = /\b(?:type|fixture(?:\s+type)?|luminaire)\s*[:#-]?\s*([a-z]{1,2}\d{0,2})\b/i.exec(text)
    ?? /\(([a-z]{1,2}\d{0,2})\)/i.exec(text)
    ?? /^([A-Z]{1,2}\d{0,2})\s*[-–—:]\s/.exec(text);
  return m?.[1]?.toUpperCase() ?? null;
}

export interface NearDuplicate { category: string; lines: string[] }

/** Lines in the same category that say the same thing: after dropping
 *  furnish/install verbs and noise words, one's words are a subset of the
 *  other's. Different type tags or different numbers are never duplicates
 *  ("Type A 4 ft" vs "Type B 8 ft"). */
export function nearDuplicateLines(data: Pick<BidData, 'takeoff'>): NearDuplicate[] {
  const out: NearDuplicate[] = [];
  for (const cat of data.takeoff ?? []) {
    const lines = (cat.items ?? []).map(it => {
      const text = `${it.item ?? ''} ${it.description ?? ''}`.trim();
      const terms = significantTerms(text);
      return {
        text,
        tag: typeTag(text),
        nums: terms.filter(t => /\d/.test(t)).sort().join(','),
        words: new Set(terms.filter(t => !/\d/.test(t) && !DUP_NOISE.has(t))),
      };
    });
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (seen.has(i)) continue;
      const group = [i];
      for (let j = i + 1; j < lines.length; j++) {
        if (seen.has(j)) continue;
        const a = lines[i], b = lines[j];
        if (!a.words.size || !b.words.size) continue;
        if (a.tag && b.tag && a.tag !== b.tag) continue;
        if (a.nums && b.nums && a.nums !== b.nums) continue;
        const [small, big] = a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words];
        if ([...small].every(w => big.has(w))) { group.push(j); seen.add(j); }
      }
      if (group.length > 1) { groups.push(group); seen.add(i); }
    }
    for (const g of groups) out.push({ category: cat.name, lines: g.map(i => lines[i].text) });
  }
  return out;
}
