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
  'new', 'existing', 'mounted', 'aff', 'above', 'finished', 'floor', 'ceiling', 'wall', 'each', 'ea', 'as', 'per', 'note', 'notes', 'required',
]);
/** Normalization + a small synonym map (fix round B4). */
const SYNONYM: Record<string, string> = {
  evse: 'ev', charger: 'ev', chargers: 'ev', charging: 'ev', ev: 'ev',
  recept: 'receptacle', recepts: 'receptacle', receptacles: 'receptacle', outlet: 'receptacle', outlets: 'receptacle', receptacle: 'receptacle',
  sw: 'switch', switches: 'switch', switch: 'switch',
};

function norm(w: string): string { return SYNONYM[w] ?? w; }

export function distinctiveWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').split(' ').filter(w => w.length >= 2 && !STOP.has(w)).map(norm))];
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

/** Where the corpus mentions this type, or null (fix round B4): its tag as
 *  a whole word (2+ characters, not a "$…" tag), or ANY significant word of
 *  its description (normalized, synonyms folded). A one-letter or "$" tag is
 *  never matched on its own — its description decides. */
export function mentionOf(t: Pick<CountTarget, 'type' | 'description'>, corpus: string[]): string | null {
  const tag = t.type.trim();
  const tagRe = tag.length >= 2 && tag.length <= 8 && !/\s/.test(tag) && !tag.startsWith('$')
    ? new RegExp(`(^|[^A-Za-z0-9$])${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i')
    : null;
  const words = distinctiveWords(`${t.description} ${/\s/.test(tag) ? tag : ''}`);
  for (const entry of corpus) {
    if (tagRe && tagRe.test(entry)) return entry;
    if (!words.length) continue;
    const have = new Set(distinctiveWords(entry));
    if (words.some(w => have.has(w))) return entry;
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
