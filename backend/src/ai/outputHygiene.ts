// Takeoff accuracy, Task 9 — output hygiene (Decision 9). Deterministic, not
// prompt-only. Pure: every function takes the agent JSON and returns a new
// value plus a record of what it changed, for takeoff_results.hygiene.
//
//  * GC = the bid record's gc. What the drawings print as GC/owner goes to
//    project.gc_extracted / project.owner; a mismatch is flagged, the bid
//    record is never overwritten (Kissimmee: "AutoZone Stores LLC" — the
//    owner — was pulled as the GC instead of Summit General Contractors).
//  * "Missing sheets" that are actually in the uploaded set are removed.
//  * A value flagged not-found can never be VERIFIED/FIRM (Kissimmee: utility
//    "Not found on drawings", confidence VERIFIED).
//  * Two different square-footage values are both kept and flagged.
//  * GC-facing text: spec boilerplate that names another region or store
//    type ("generator scope applies to Puerto Rico stores only") is flagged;
//    zero-quantity takeoff lines and zero-footage allowances are blocked.
import type { BidData } from '../bidstd/bidData';

export interface HygieneReport {
  gc: { bidGc: string; extracted: string; owner: string; mismatch: boolean } | null;
  removedMissingSheets: string[];
  downgraded: Array<{ path: string; value: string; from: string; to: string }>;
  sqFt: { values: Array<{ value: number; source: string }>; conflict: boolean } | null;
  flags: string[];
}

export function emptyHygiene(): HygieneReport {
  return { gc: null, removedMissingSheets: [], downgraded: [], sqFt: null, flags: [] };
}

function normName(s: string): string {
  return s.toLowerCase().replace(/\b(inc|llc|l\.l\.c|corp|corporation|co|company|the|general contractors?|gc)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pure: the bid record's GC wins. Returns a copy of the agent JSON. */
export function applyGcHygiene(json: Record<string, unknown>, bidGc: string, report: HygieneReport): Record<string, unknown> {
  const project = (json.project && typeof json.project === 'object') ? { ...(json.project as Record<string, unknown>) } : null;
  if (!project) return json;
  const extracted = String(project.gcName ?? '').trim();
  const owner = String(project.owner ?? '').trim();
  const gc = bidGc.trim();
  if (!gc) return json;
  const mismatch = !!extracted && normName(extracted) !== normName(gc);
  report.gc = { bidGc: gc, extracted, owner, mismatch };
  if (mismatch) {
    report.flags.push(`The drawings name "${extracted}" where the GC goes; this bid's GC is ${gc} — the bid record is used everywhere${owner ? ` (owner on the drawings: ${owner})` : ''}.`);
  }
  project.gc_extracted = extracted;
  project.gcName = gc;
  return { ...json, project };
}

/** "E-3", "E3", "e 3", "E-3.0", "E3.0" -> "E3". */
export function normalizeSheetNo(s: string): string {
  return s.toUpperCase().replace(/^SHEET\s+/, '').replace(/[\s\-_]+/g, '').replace(/\.0+$/, '').replace(/"[^"]*"$/, '').trim();
}

/** Pure: drops "missing" sheets that are in the loaded inventory. */
export function filterMissingSheets(json: Record<string, unknown>, loadedSheetNos: string[], report: HygieneReport): Record<string, unknown> {
  const missing = Array.isArray(json.missingSheets) ? json.missingSheets.filter((x): x is string => typeof x === 'string') : [];
  if (!missing.length) return json;
  const loaded = new Set(loadedSheetNos.map(normalizeSheetNo).filter(Boolean));
  const keep: string[] = [];
  for (const m of missing) {
    // A missing-sheet entry can carry prose ("E-5 referenced in note 3").
    const tok = /\b([A-Z]{1,3}[-\s]?\d+(?:\.\d+)?[A-Z]?)\b/i.exec(m)?.[1] ?? m;
    if (loaded.has(normalizeSheetNo(tok))) report.removedMissingSheets.push(m);
    else keep.push(m);
  }
  if (report.removedMissingSheets.length) {
    report.flags.push(`Removed from "missing sheets" because they are in the uploaded set: ${report.removedMissingSheets.join(', ')}.`);
  }
  return { ...json, missingSheets: keep };
}

const NOT_FOUND_RE = /\b(not\s+(found|shown|provided|listed|indicated|legible|located)|unknown|unable\s+to\s+(find|determine|locate|read)|illegible|n\/a|tbd|to\s+be\s+determined)\b/i;
const HIGH_CONFIDENCE = new Set(['VERIFIED', 'FIRM']);

/** Pure: any object whose string fields say the value wasn't found (or that
 *  a flag names as not found) can't carry VERIFIED/FIRM — downgraded to
 *  ASSUMED (APPROX), recorded. Returns a deep copy. */
export function downgradeNotFound(json: Record<string, unknown>, report: HygieneReport): Record<string, unknown> {
  const flagged = (Array.isArray(json.flags) ? json.flags : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .filter(f => NOT_FOUND_RE.test(String(f.issue ?? '')))
    .map(f => String(f.item ?? '').toLowerCase().trim())
    .filter(Boolean);
  const walk = (v: unknown, path: string, key: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, key));
    if (!v || typeof v !== 'object') return v;
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = walk(val, path ? `${path}.${k}` : k, k);
    const conf = typeof o.confidence === 'string' ? o.confidence.toUpperCase() : '';
    if (HIGH_CONFIDENCE.has(conf)) {
      const strings = Object.entries(o).filter(([k, x]) => k !== 'confidence' && typeof x === 'string') as Array<[string, string]>;
      const hit = strings.find(([, x]) => NOT_FOUND_RE.test(x));
      const flaggedHit = !hit && flagged.some(f => (path.toLowerCase().includes(f) || strings.some(([, x]) => x.toLowerCase().includes(f))) && f.length > 2);
      if (hit || flaggedHit) {
        const to = o.confidence === 'FIRM' ? 'APPROX' : 'ASSUMED';
        report.downgraded.push({ path: path || key, value: hit ? `${hit[0]}: ${hit[1]}` : 'flagged not found', from: String(o.confidence), to });
        o.confidence = to;
      }
    }
    return o;
  };
  const out = walk(json, '', '') as Record<string, unknown>;
  for (const d of report.downgraded) report.flags.push(`${d.path}: "${d.value}" can't be ${d.from} — downgraded to ${d.to}.`);
  return out;
}

/** Pure: every square-footage value the batches reported (Agent 1 merge keeps
 *  only the first); two different values are both kept and flagged. */
export function collectSqFt(batches: Array<Record<string, unknown>>, report: HygieneReport): void {
  const values: Array<{ value: number; source: string }> = [];
  batches.forEach((b, i) => {
    const p = (b.project ?? {}) as Record<string, unknown>;
    const n = Number(p.sqFt);
    if (Number.isFinite(n) && n > 0) values.push({ value: n, source: String(p.sqFtSource ?? '') || `drawing analysis batch ${i + 1}` });
  });
  if (!values.length) return;
  const distinct = [...new Set(values.map(v => v.value))];
  report.sqFt = { values, conflict: distinct.length > 1 };
  if (distinct.length > 1) {
    report.flags.push(`Two different square footages on the drawings: ${values.map(v => `${v.value.toLocaleString('en-US')} SF (${v.source})`).join(' vs ')} — confirm before relying on either; the bid's SF was not auto-filled.`);
  }
}

// ── GC-facing text checks ───────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam',
};
const OTHER_PLACES = ['Canada', 'Mexico', 'Brazil'];

/** The project's state (full name) from an address like "..., Kissimmee, FL
 *  34747"; null when it can't be read. */
export function projectStateOf(address: string): string | null {
  const m = /,\s*([A-Z]{2})\s*(\d{5}(-\d{4})?)?\s*$/.exec(address.trim()) ?? /\b([A-Z]{2})\s+\d{5}\b/.exec(address);
  if (m && US_STATES[m[1]]) return US_STATES[m[1]];
  const full = Object.values(US_STATES).find(s => new RegExp(`\\b${s}\\b`, 'i').test(address));
  return full ?? null;
}

/** Sentences in GC-facing text that look like owner-spec boilerplate for
 *  OTHER places or store types. `block`: a qualifier that scopes the text to
 *  other stores/locations ("applies to Puerto Rico stores only"); `warn`: a
 *  sentence that merely names another state/territory (could be a utility or
 *  a street — "Georgia Power", "Washington St" — so it is only surfaced). */
export function irrelevantSpecSentences(text: string, projectAddress: string): { block: string[]; warn: string[] } {
  const state = projectStateOf(projectAddress);
  const places = [...Object.values(US_STATES), ...OTHER_PLACES].filter(p => p !== state);
  const sentences = text.split(/(?<=[.;!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const block: string[] = [];
  const warn: string[] = [];
  const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s);
  for (const s of sentences) {
    const place = places.find(p => new RegExp(`\\b${p}\\b(?!\\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Hwy|Power|Pkwy)\\b)`, 'i').test(s));
    const scopedToOthers = /\b(stores?|locations?|sites?|markets?|regions?|prototypes?)\s+only\b/i.test(s)
      || /\bonly\s+(applies|apply|applicable)\s+to\b/i.test(s);
    if (scopedToOthers || (place && /\b(stores?|locations?|markets?|regions?)\b/i.test(s))) block.push(clip(s));
    else if (place) warn.push(clip(s));
  }
  return { block: [...new Set(block)], warn: [...new Set(warn)] };
}

/** Takeoff lines with a zero quantity and allowances with zero footage in
 *  GC-facing data — a GC reads "0 LF allowance" as a promise of nothing. */
export function zeroQuantityProblems(data: Pick<BidData, 'takeoff' | 'sections'>): string[] {
  const out: string[] = [];
  for (const cat of data.takeoff ?? []) {
    for (const it of cat.items ?? []) {
      const q = typeof it.qty === 'number' ? it.qty : Number(String(it.qty ?? '').replace(/,/g, ''));
      if (String(it.qty ?? '').trim() !== '' && Number.isFinite(q) && q === 0) out.push(`${cat.name}: "${it.item}${it.description ? ` — ${it.description}` : ''}" has quantity 0`);
    }
  }
  for (const s of data.sections ?? []) {
    for (const b of s.bullets ?? []) {
      const text = typeof b === 'string' ? b : `${b.b} ${b.t}`;
      if (/(^|[\s(])0(\.0+)?\s*('|’|LF\b|lf\b|feet\b|ft\b)[^.]*\ballowance/i.test(text) || /\ballowance\b[^.]*\b0(\.0+)?\s*(LF|feet|ft)\b/i.test(text)) {
        out.push(`${s.title}: zero-footage allowance "${text}"`);
      }
    }
  }
  return out;
}
