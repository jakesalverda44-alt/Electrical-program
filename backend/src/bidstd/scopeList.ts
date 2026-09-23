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
    return incTerms.filter(t => !exTerms.includes(t)).some(t => have.has(t));
  });
}

export function excludedScopeProblems(data: Pick<BidData, 'takeoff' | 'sections'>, items: ScopeItem[], overrides: NonElectricalOverride[] = []): string[] {
  const excluded = items.filter(i => i.kind === 'exclude');
  const includes = items.filter(i => i.kind === 'include');
  const kept = (cat: string, text: string) => overrideFor(normalizeLineKey(cat, text), overrides) !== null;
  const out: string[] = [];
  for (const ex of excluded) {
    for (const cat of data.takeoff ?? []) {
      for (const it of cat.items ?? []) {
        const text = `${it.item ?? ''} ${it.description ?? ''}`;
        if (mentionsExcludedItem(text, ex) && !carvedOut(text, ex, includes) && !kept(cat.name, text)) out.push(`Takeoff ${cat.name}: "${text.trim()}" is on the Not-included list ("${ex.text}")`);
      }
    }
    for (const s of data.sections ?? []) {
      for (const b of s.bullets ?? []) {
        const text = bulletText(b);
        if (mentionsExcludedItem(text, ex) && !carvedOut(text, ex, includes) && !kept(s.title, text)) out.push(`${s.title}: "${text}" is on the Not-included list ("${ex.text}")`);
      }
    }
  }
  return out;
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

const TRADES: TradeRule[] = [
  { trade: 'drywall / finishes', hard: true, test: t => /\b(drywall|gypsum|gyp\.?\s*board|sheetrock|level\s*[45]\s*finish|taping|mud(ding)?)\b/i.test(t) },
  { trade: 'site piping (HDPE / storm / sanitary / water)', hard: true, test: t => /\b(pipe|piping)\b/i.test(t) && /\b(hdpe|storm|sanitary|sewer|water|drain(age)?|pvc\s*drain|culvert|rcp)\b/i.test(t) && !/\b(conduit|duct|sleeve)\b/i.test(t) },
  { trade: 'plumbing fixtures', hard: true, test: t => /\b(toilet|water closet|urinal|lavator(y|ies)|faucet|mop sink|sink|plumbing fixture)\b/i.test(t) },
  { trade: 'roofing', hard: true, test: t => /\b(roofing|roof membrane|shingles?|flashing|re-?roof)\b/i.test(t), ecWork: /\b(pitch\s*pockets?|penetrations?|conduits?|roof\s*jacks?|pipe\s*portals?)\b/i },
  { trade: 'concrete (not an electrical pad or base)', hard: false, test: t => /\b(concrete|slab|sidewalk|curb|footing|cmu|masonry)\b/i.test(t) },
  { trade: 'HVAC equipment / ductwork supply', hard: false, test: t => (/\b(rtu|rooftop unit|air handler|ahu|condenser|mini-?split|diffuser|grille)\b/i.test(t) && /\b(furnish|supply|provide|purchase)\b/i.test(t)) || /\bductwork\b/i.test(t) },
  { trade: 'painting / flooring / ceilings', hard: false, test: t => /\b(paint(ing)?|flooring|carpet|vct|floor tile|ceiling tile|acoustical ceiling|ceiling grid)\b/i.test(t) },
  { trade: 'framing / doors / insulation', hard: false, test: t => /\b(framing|metal studs?|wood studs?|door hardware|doors?\b|insulation|batt)\b/i.test(t) },
  { trade: 'paving / landscaping / fencing', hard: false, test: t => /\b(asphalt|paving|landscap(e|ing)|irrigation|sod|fenc(e|ing))\b/i.test(t) },
  { trade: 'fire sprinkler', hard: false, test: t => /\b(sprinkler|fire suppression)\b/i.test(t) && !/\b(flow switch|tamper|monitor)\b/i.test(t) },
];

/** Units that don't belong on an electrical takeoff (SF of drywall is the
 *  classic). Lighting per SF, conduit per LF, devices per EA are fine. */
const NON_ELECTRICAL_UNITS = /^(sf|sq\.?\s*ft|sy|sq\.?\s*yd|cy|cu\.?\s*yd|ton|tons|gal|gallons)$/i;

export function normalizeLineKey(category: string, text: string): string {
  return `${category.trim().toLowerCase()}::${significantTerms(text).sort().join(' ')}`;
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

/** An override still applies after Agent 4 rewords the line: same category,
 *  and most of the significant words shared (S9: overrides were keyed on
 *  exact wording, so a re-run brought the block back). */
function overrideFor(lineKey: string, overrides: NonElectricalOverride[]): string | null {
  const exact = overrides.find(o => o.lineKey === lineKey);
  if (exact) return exact.reason;
  const [cat, words] = lineKey.split('::');
  const a = new Set((words ?? '').split(' ').filter(Boolean));
  for (const o of overrides) {
    const [oc, ow] = (o.lineKey ?? '').split('::');
    if (oc !== cat) continue;
    const b = new Set((ow ?? '').split(' ').filter(Boolean));
    const inter = [...a].filter(w => b.has(w)).length;
    const union = new Set([...a, ...b]).size;
    if (union && inter / union >= 0.6) return o.reason;
  }
  return null;
}

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
