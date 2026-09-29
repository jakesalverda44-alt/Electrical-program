// Remodel round A3 — legend noise. Pure: no I/O, no AI.
//
// An architect's MASTER legend lists every symbol the office uses; most are
// not on this job. A legend type that counted zero with NO other evidence
// anywhere — no panel circuit, no schedule quantity, no note or drawing-
// analysis mention, no equipment row — is "not used on this job": the
// review list collapses them into ONE informational group (expandable, each
// still answerable) and their 0-qty "COUNT PENDING ESTIMATOR REVIEW" rows
// never reach the takeoff. Fixture-schedule types and any zero with
// evidence stay review items exactly as before.
import type { CountTarget } from '../countTargets';

/** Fix round B4 — only words that carry no meaning at all are dropped;
 *  device nouns (receptacle, switch, light …) ARE significant: a legend type
 *  collapses only when NOTHING on the job names any of its words. */
const STOP = new Set([
  'the', 'and', 'or', 'of', 'at', 'in', 'on', 'to', 'an', 'for', 'by', 'with', 'w', 'typ', 'typical', 'type', 'symbol', 'see', 'plan', 'plans',
  'new', 'existing', 'aff', 'above', 'finished', 'ceiling', 'wall', 'each', 'ea', 'as', 'per', 'note', 'notes', 'required',
]);
/** Fix round Q1 — generic nouns: they never count as evidence on their own
 *  (every job has "a switch" and "a receptacle" somewhere). */
const GENERIC_NOUNS = new Set([
  'receptacle', 'switch', 'light', 'lights', 'fixture', 'fixtures', 'luminaire', 'luminaires', 'box', 'boxes', 'device', 'devices',
  'unit', 'units', 'mounted',
  // re-check N2
  'station', 'stations', 'assembly', 'assemblies', 'plate', 'plates', 'circuit', 'circuits',
  // "duplex" IS the plain receptacle: "Duplex receptacle AFCI" is told apart
  // by AFCI, "Duplex receptacle, 20A, 125V" by nothing (any receptacle row).
  'duplex',
]);

/** Re-check N2 — ratings and bare numbers (20A, 125V, 1P, 3/4", 2x4) are
 *  never distinguishing: "Duplex receptacle, 20A, 125V" is a plain
 *  receptacle. A voltage of 200 V or more is the exception — a "220V
 *  receptacle" is a different device and still needs "220V" named. */
function isRating(w: string): boolean {
  if (/^([2-9]\d\d)v$/.test(w)) return false;
  return /^\d+[a-z]{0,3}$/.test(w) || /^\d+x\d+$/.test(w) || w === 'nema';
}

/** Re-check N2 — phrase-level folding before tokenizing. */
function foldPhrases(text: string): string {
  return text.toLowerCase()
    .replace(/\belectric(?:al)?\s+vehicles?\b/g, ' ev ')
    .replace(/\barc[\s-]*fault\b/g, ' afci ')
    .replace(/\bground[\s-]*fault\b/g, ' gfci ')
    .replace(/\b(?:two|2)[\s-]*way\b/g, ' twoway ')
    .replace(/\b(?:three|3)[\s-]*way\b/g, ' threeway ')
    .replace(/\b(?:four|4)[\s-]*way\b/g, ' fourway ');
}
/** Normalization + a small synonym map (fix round B4). */
const SYNONYM: Record<string, string> = {
  evse: 'ev', charger: 'ev', chargers: 'ev', charging: 'ev', ev: 'ev',
  af: 'afci', afci: 'afci', gfi: 'gfci', gfci: 'gfci',
  recept: 'receptacle', recepts: 'receptacle', receptacles: 'receptacle', outlet: 'receptacle', outlets: 'receptacle', receptacle: 'receptacle',
  sw: 'switch', switches: 'switch', switch: 'switch',
};

function norm(w: string): string { return SYNONYM[w] ?? w; }

export function distinctiveWords(text: string): string[] {
  return [...new Set(foldPhrases(text).replace(/[^a-z0-9$]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOP.has(w)).map(norm))];
}

/** Every piece of the drawing analysis that is NOT the legend or fixture
 *  schedule itself (and not the counter's own 0-qty rows): its quantities,
 *  scope notes, flags, furnish statements, panel circuits, equipment,
 *  ECFECI items and allowances. */
export function evidenceCorpus(agent1: Record<string, unknown>, tableRows: string[][] = []): string[] {
  const out: string[] = [];
  const arr = (k: string) => (Array.isArray(agent1[k]) ? (agent1[k] as unknown[]) : []);
  for (const q of arr('quantities')) {
    const r = (q ?? {}) as Record<string, unknown>;
    if (r.countType || r.countedBy) continue; // the counter's own rows
    out.push(`${String(r.item ?? '')} ${String(r.spec ?? '')}`);
  }
  for (const n of arr('scopeNotes')) if (typeof n === 'string') out.push(n);
  for (const n of arr('ecfeciItems')) if (typeof n === 'string') out.push(n);
  for (const f of arr('flags')) { const r = (f ?? {}) as Record<string, unknown>; out.push(`${String(r.item ?? '')} ${String(r.issue ?? '')}`); }
  for (const f of arr('furnishStatements')) { const r = (f ?? {}) as Record<string, unknown>; out.push(`${String(r.item ?? '')} ${String(r.quote ?? '')}`); }
  for (const f of arr('panelCircuits')) { const r = (f ?? {}) as Record<string, unknown>; out.push(String(r.description ?? '')); }
  for (const f of arr('equipment')) { const r = (f ?? {}) as Record<string, unknown>; out.push(`${String(r.tag ?? '')} ${String(r.description ?? '')}`); }
  for (const f of arr('allowances')) { const r = (f ?? {}) as Record<string, unknown>; out.push(String(r.item ?? '')); }
  for (const cells of tableRows) out.push(cells.join(' '));
  return out.filter(s => s.trim());
}

/** Where the corpus mentions this type, or null. Fix round Q1 — a mention
 *  counts only when it names the TAG (2+ characters, never a one-letter or
 *  "$" tag on its own), or ALL the distinguishing words of the description
 *  in one entry. Distinguishing = significant words that are not generic
 *  nouns (receptacle / switch / light / fixture / box / device / unit …):
 *  "Single pole switch" needs single + pole, "Fourplex receptacle" needs
 *  fourplex. A description with NO distinguishing word ("Receptacle") is
 *  kept by any mention of its generic noun. A description listing
 *  alternatives ("Time clock / VP24 timer switch") matches on either one.
 *  Panel circuits, notes and Agent 1 rows all use the same test; words are
 *  normalized with the synonym map (EV / EVSE / charger …). */
export function mentionOf(t: Pick<CountTarget, 'type' | 'description'>, corpus: string[]): string | null {
  const tag = t.type.trim();
  const tagRe = tag.length >= 2 && tag.length <= 8 && !/\s/.test(tag) && !tag.startsWith('$')
    ? new RegExp(`(^|[^A-Za-z0-9$])${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, tag === tag.toUpperCase() ? '' : 'i')
    : null;
  // Re-check N2 — "Two/three way": either number, unless the tag names one
  // ($3 -> 3-way; $4 "Three/four way" -> 4-way, never a 3-way row).
  const NUM: Record<string, string> = { two: '2', three: '3', four: '4', 2: '2', 3: '3', 4: '4' };
  const expand = (p: string): string[] => {
    const m = /\b(two|three|four|[234])\s*\/\s*(two|three|four|[234])[\s-]*way\b/i.exec(p);
    if (!m) return [p];
    const nums = [NUM[m[1].toLowerCase()], NUM[m[2].toLowerCase()]];
    const tagNum = /([234])\s*$/.exec(tag)?.[1];
    return (tagNum && nums.includes(tagNum) ? [tagNum] : nums).map(n => p.replace(m[0], `${n}-way`));
  };
  const phrases = `${t.description}${/\s/.test(tag) ? ` / ${tag}` : ''}`.split(/\s+\/\s+/).flatMap(expand).map(p => {
    const words = distinctiveWords(p);
    const distinguishing = words.filter(w => !GENERIC_NOUNS.has(w));
    const need = distinguishing.filter(w => !isRating(w));
    return need.length ? { need, all: true } : { need: words.filter(w => GENERIC_NOUNS.has(w)), all: false };
  }).filter(p => p.need.length);
  for (const entry of corpus) {
    if (tagRe && tagRe.test(entry)) return entry;
    const have = new Set(distinctiveWords(entry));
    if (phrases.some(p => (p.all ? p.need.every(w => have.has(w)) : p.need.some(w => have.has(w))))) return entry;
  }
  return null;
}

export interface LegendUnusedDecision { key: string; unused: boolean; mention?: string }

/** The zero-count legend types with no other evidence. `types` are the
 *  merge's results; `scheduleRows` the schedule rows a type owns. */
export function legendUnusedKeys(
  types: Array<{ key: string; status: string; reason: string; category: string; host?: boolean; scheduleRows?: unknown[]; excludedMarks?: number; existingMarks?: number }>,
  targets: CountTarget[],
  corpus: string[],
): LegendUnusedDecision[] {
  const tByKey = new Map(targets.map(t => [t.key, t]));
  const out: LegendUnusedDecision[] = [];
  for (const r of types) {
    const t = tByKey.get(r.key);
    if (!t || t.source !== 'legend' || t.role === 'host' || r.host) continue;
    if (r.status !== 'zero' || r.reason !== 'not found on any counted plan sheet') continue;
    if (t.category === 'equipment' || t.category === 'panel_circuit') continue;
    if ((r.scheduleRows?.length ?? 0) > 0 || (r.excludedMarks ?? 0) > 0 || (r.existingMarks ?? 0) > 0) continue;
    if (t.assignment) continue; // the legend says who furnishes it — it is on this job
    const mention = mentionOf(t, corpus);
    out.push(mention ? { key: r.key, unused: false, mention } : { key: r.key, unused: true });
  }
  return out;
}
