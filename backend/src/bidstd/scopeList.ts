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
export function excludedScopeProblems(data: Pick<BidData, 'takeoff' | 'sections'>, items: ScopeItem[]): string[] {
  const excluded = items.filter(i => i.kind === 'exclude');
  const out: string[] = [];
  for (const ex of excluded) {
    for (const cat of data.takeoff ?? []) {
      for (const it of cat.items ?? []) {
        const text = `${it.item ?? ''} ${it.description ?? ''}`;
        if (mentionsExcludedItem(text, ex)) out.push(`Takeoff ${cat.name}: "${text.trim()}" is on the Not-included list ("${ex.text}")`);
      }
    }
    for (const s of data.sections ?? []) {
      for (const b of s.bullets ?? []) {
        if (mentionsExcludedItem(bulletText(b), ex)) out.push(`${s.title}: "${bulletText(b)}" is on the Not-included list ("${ex.text}")`);
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

interface TradeRule { trade: string; test: (t: string) => boolean }

const ELECTRICAL_CONTEXT = /\b(conduit|duct\s*bank|raceway|conductor|wire|wiring|cable|circuit|feeder|disconnect|receptacle|panel|breaker|electrical|power|connection|connect|j-?box|junction|light|lighting|fixture|luminaire|grounding|ground rod|transformer|meter|switch|whip|homerun|home run)\b/i;

const TRADES: TradeRule[] = [
  { trade: 'drywall / finishes', test: t => /\b(drywall|gypsum|gyp\.?\s*board|sheetrock|level\s*[45]\s*finish|taping|mud(ding)?)\b/i.test(t) },
  { trade: 'site piping (HDPE / storm / sanitary / water)', test: t => /\b(pipe|piping)\b/i.test(t) && /\b(hdpe|storm|sanitary|sewer|water|drain(age)?|pvc\s*drain|culvert|rcp)\b/i.test(t) && !/\b(conduit|duct|sleeve)\b/i.test(t) },
  { trade: 'concrete (not an electrical pad or base)', test: t => /\b(concrete|slab|sidewalk|curb|footing|cmu|masonry)\b/i.test(t) && !/\b(pad|base|pole base|light base|housekeeping|encase(ment)?|duct\s*bank)\b/i.test(t) },
  { trade: 'roofing', test: t => /\b(roofing|roof membrane|shingles?|flashing)\b/i.test(t) },
  { trade: 'plumbing fixtures', test: t => /\b(toilet|water closet|urinal|lavator(y|ies)|faucet|mop sink|sink|plumbing fixture)\b/i.test(t) && !ELECTRICAL_CONTEXT.test(t) },
  { trade: 'HVAC equipment / ductwork supply', test: t => (/\b(rtu|rooftop unit|air handler|ahu|condenser|mini-?split|ductwork|diffuser|grille)\b/i.test(t) && /\b(furnish|supply|provide|purchase)\b/i.test(t) && !ELECTRICAL_CONTEXT.test(t)) || /\bductwork\b/i.test(t) },
  { trade: 'painting / flooring / ceilings', test: t => /\b(paint(ing)?|flooring|carpet|vct|floor tile|ceiling tile|acoustical ceiling|ceiling grid)\b/i.test(t) && !ELECTRICAL_CONTEXT.test(t) },
  { trade: 'framing / doors / insulation', test: t => /\b(framing|metal studs?|wood studs?|door hardware|doors?\b|insulation|batt)\b/i.test(t) && !ELECTRICAL_CONTEXT.test(t) },
  { trade: 'paving / landscaping / fencing', test: t => /\b(asphalt|paving|landscap(e|ing)|irrigation|sod|fenc(e|ing))\b/i.test(t) && !/\b(conduit|sleeve|gate operator)\b/i.test(t) },
  { trade: 'fire sprinkler', test: t => /\b(sprinkler|fire suppression)\b/i.test(t) && !/\b(flow switch|tamper|monitor)\b/i.test(t) },
];

/** Units that don't belong on an electrical takeoff (SF of drywall is the
 *  classic). Lighting per SF, conduit per LF, devices per EA are fine. */
const NON_ELECTRICAL_UNITS = /^(sf|sq\.?\s*ft|sy|sq\.?\s*yd|cy|cu\.?\s*yd|ton|tons|gal|gallons)$/i;

export function normalizeLineKey(category: string, text: string): string {
  return `${category.trim().toLowerCase()}::${significantTerms(text).sort().join(' ')}`;
}

export function nonElectricalReason(text: string, unit: string): string | null {
  for (const r of TRADES) if (r.test(text)) return r.trade;
  if (NON_ELECTRICAL_UNITS.test(unit.trim())) return `unit "${unit}" is not an electrical takeoff unit`;
  return null;
}

export interface NonElectricalFinding { category: string; line: string; unit: string; reason: string; lineKey: string; overridden: string | null }

export function nonElectricalFindings(data: Pick<BidData, 'takeoff'>, overrides: NonElectricalOverride[]): NonElectricalFinding[] {
  const byKey = new Map(overrides.map(o => [o.lineKey, o.reason]));
  const out: NonElectricalFinding[] = [];
  for (const cat of data.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const line = `${it.item ?? ''} ${it.description ?? ''}`.trim();
      const reason = nonElectricalReason(line, String(it.unit ?? ''));
      if (!reason) continue;
      const lineKey = normalizeLineKey(cat.name, line);
      out.push({ category: cat.name, line, unit: String(it.unit ?? ''), reason, lineKey, overridden: byKey.get(lineKey) ?? null });
    }
  }
  return out;
}

// ── Near duplicates ─────────────────────────────────────────────────────────

const DUP_NOISE = new Set(['surface', 'mounted', 'surface-mounted', 'recessed', 'complete', 'new', 'led', 'type', 'fixture', 'unit']);

function typeTag(text: string): string | null {
  return /\btype\s*[:#-]?\s*([a-z]{1,2}\d{0,2})\b/i.exec(text)?.[1]?.toUpperCase() ?? null;
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
