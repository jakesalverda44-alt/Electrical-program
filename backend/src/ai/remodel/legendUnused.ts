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

/** Words that say nothing about WHICH device a legend line is. */
const GENERIC = new Set([
  'receptacle', 'receptacles', 'duplex', 'switch', 'switches', 'single', 'pole', 'device', 'devices', 'box', 'boxes', 'light', 'lights',
  'fixture', 'fixtures', 'typical', 'typ', 'with', 'w', 'the', 'and', 'or', 'of', 'at', 'in', 'on', 'to', 'a', 'an', 'for', 'by', 'mounted',
  'wall', 'ceiling', 'floor', 'outlet', 'outlets', 'type', 'symbol', 'aff', 'above', 'new', 'existing', 'way', 'two', 'plan', 'see',
]);

export function distinctiveWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').split(' ').filter(w => w.length >= 2 && !GENERIC.has(w)))];
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
    if (!(Number(r.qty) > 0)) continue;
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

/** Where the corpus mentions this type, or null. A tag of 2+ characters
 *  counts as a whole word ("OS", "TC", "$D"); otherwise at least half of the
 *  description's distinctive words (min 1) in ONE entry. */
export function mentionOf(t: Pick<CountTarget, 'type' | 'description'>, corpus: string[]): string | null {
  const tag = t.type.trim();
  const tagRe = tag.length >= 2 && tag.length <= 6 && !/\s/.test(tag)
    ? new RegExp(`(^|[^A-Za-z0-9$])${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, tag === tag.toUpperCase() ? '' : 'i')
    : null;
  const words = distinctiveWords(`${t.description} ${/\s/.test(tag) ? tag : ''}`);
  const need = Math.max(1, Math.ceil(words.length / 2));
  for (const entry of corpus) {
    if (tagRe && tagRe.test(entry)) return entry;
    if (!words.length) continue;
    const have = new Set(distinctiveWords(entry));
    if (words.filter(w => have.has(w)).length >= need) return entry;
  }
  return null;
}

export interface LegendUnusedDecision { key: string; unused: boolean; mention?: string }

/** The zero-count legend types with no other evidence. `types` are the
 *  merge's results; `scheduleRows` the schedule rows a type owns. */
export function legendUnusedKeys(
  types: Array<{ key: string; status: string; reason: string; category: string; host?: boolean; scheduleRows?: unknown[]; excludedMarks?: number }>,
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
    if ((r.scheduleRows?.length ?? 0) > 0 || (r.excludedMarks ?? 0) > 0) continue;
    if (t.assignment) continue; // the legend says who furnishes it — it is on this job
    const mention = mentionOf(t, corpus);
    out.push(mention ? { key: r.key, unused: false, mention } : { key: r.key, unused: true });
  }
  return out;
}
