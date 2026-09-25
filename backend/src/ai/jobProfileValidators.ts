// Job profile fix round (review 1755e62) — the CODE validators. The model
// (ai/jobProfile.ts) proposes each field with the sheet and the exact quote
// it read it from; nothing here ever proposes a value. A value that fails a
// hard check is dropped (listed as rejected, with the reason); one that fails
// a soft check survives only as a lower-confidence suggestion. The card is
// auto-filled only from a value that passed every check here AND that the
// model read with high confidence (estimating/jobProfileCardRules.ts).
//
// Everything is pure and works on the ORIGINAL layout text of the pages the
// model was shown (pdftotext -layout keeps columns by character position,
// which the office-block and landscape-architect checks rely on).
import { aliasMatches } from '../bidstd/accountRules';

export type Confidence = 'high' | 'medium' | 'low';
export type SourceWhy = 'cover' | 'code_area' | 'electrical';

/** One page the model was shown. `sheet` is the label the prompt used. */
export interface ProfileSource {
  sheet: string;
  why: SourceWhy;
  /** Original layout text (a title-block region for electrical pages). */
  text: string;
  file: string;
  page: number;
}

export interface KnownBrand { name: string; aliases: string[]; projectType?: string }

/** The brands APT bids for (plan Decision 3), merged at run time with the
 *  account rules' names and aliases (Settings -> Account Rules), so "7-11"
 *  and "7 Eleven" are 7-Eleven exactly as the account-rule matcher reads them. */
export const BUILTIN_BRANDS: KnownBrand[] = [
  { name: 'AutoZone', aliases: ['AutoZone', 'Auto Zone', 'AutoZone Stores'], projectType: 'retail' },
  { name: '7-Eleven', aliases: ['7-Eleven', '7 Eleven', 'Seven Eleven', '7Eleven', '7-11', '711'], projectType: 'cstore_fuel' },
  { name: "Big Dan's", aliases: ["Big Dan's", 'Big Dans'], projectType: 'car_wash' },
  { name: 'Bubble Down', aliases: ['Bubble Down'], projectType: 'car_wash' },
  { name: "Tommy's Express", aliases: ["Tommy's Express", 'Tommys Express', "Tommy's Car Wash", "Tommy's"], projectType: 'car_wash' },
  { name: 'Murrell', aliases: ['Murrell', 'Murrell Storage'], projectType: 'self_storage' },
];

/** Merge account rules ({name, matchAliases, projectTypes}) into the list. */
export function mergeBrands(rules: Array<{ name: string; matchAliases: string[]; projectTypes: string[]; isDefault?: boolean; active?: boolean }>): KnownBrand[] {
  const out = BUILTIN_BRANDS.map(b => ({ ...b, aliases: [...b.aliases] }));
  for (const r of rules) {
    if (r.isDefault || r.active === false || !r.matchAliases?.length) continue;
    const existing = out.find(b => aliasMatches(b.name, r.name) || aliasMatches(r.name, b.name) || r.matchAliases.some(a => aliasMatches(a, b.name)));
    if (existing) {
      for (const a of r.matchAliases) if (!existing.aliases.some(x => x.toLowerCase() === a.toLowerCase())) existing.aliases.push(a);
    } else {
      out.push({ name: r.name, aliases: [...r.matchAliases], ...(r.projectTypes?.length === 1 ? { projectType: r.projectTypes[0] } : {}) });
    }
  }
  return out;
}

// ── Text helpers ────────────────────────────────────────────────────────────

/** Whitespace-, case- and separator-insensitive form for grounding. */
export function normText(s: string): string {
  return String(s ?? '').toUpperCase()
    .replace(/[‘’′]/g, "'").replace(/[“”]/g, '"')
    .replace(/[|⋯]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** The quote really is on that page (never an invented one). */
export function isGrounded(quote: string | null | undefined, text: string): boolean {
  const q = normText(quote ?? '');
  return q.length >= 3 && normText(text).includes(q);
}

/** A layout line (or a compacted " | " line, or a quote) split into its
 *  columns: 3+ spaces, " | " or a newline separate unrelated blocks that
 *  pdftotext put side by side on one line. */
export function segments(s: string): string[] {
  return String(s ?? '').split(/\n|\s\|\s|\s{3,}|⋯/).map(x => x.trim()).filter(Boolean);
}

/** The column segment of `quote` that contains `needle` (else the quote). */
function segmentWith(quote: string, needle: string): string {
  const n = normText(needle);
  return segments(quote).find(seg => normText(seg).includes(n)) ?? quote;
}

interface Occurrence { lines: string[]; line: number; col: number; len: number }

/** Where `needle` sits in a layout text (line + column), whitespace-tolerant. */
function occurrences(text: string, needle: string): Occurrence[] {
  const lines = String(text ?? '').split(/\r?\n/);
  const words = normText(needle).split(' ').filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [];
  const re = new RegExp(words.join('\\s+'), 'gi');
  const out: Occurrence[] = [];
  lines.forEach((ln, i) => {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(ln))) { out.push({ lines, line: i, col: m.index, len: m[0].length }); if (!m[0].length) re.lastIndex++; }
  });
  return out;
}

/** The column window around an occurrence, `above` lines up and `below` down. */
function columnWindow(o: Occurrence, above: number, below: number, pad = 12): string {
  const from = Math.max(0, o.col - pad);
  const to = o.col + o.len + pad;
  const out: string[] = [];
  for (let i = Math.max(0, o.line - above); i <= Math.min(o.lines.length - 1, o.line + below); i++) {
    out.push(o.lines[i].slice(from, to));
  }
  return out.join('\n');
}

// ── Common checks ───────────────────────────────────────────────────────────

const OFFICE_RE = /\bP\.?\s?E\.?(?![A-Z])|\bAIA\b|\bNCARB\b|LICEN[SC]E|\bLIC\.?\s*(NO|#)|\bREG(ISTRATION)?\.?\s*(NO|#)|\bTEL\b|\bFAX\b|\bPHONE\b|\bPH:|\(\d{3}\)\s*\d{3}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|CONSULT|\bENGINEER|\bARCHITECT|\bWWW\.|@|\bSUITE\b|\bP\.?\s?O\.?\s+BOX\b/i;
const PERSON_RE = /\bP\.?\s?E\.?(?![A-Z])|\bAIA\b|\bR\.?A\.?\b|\bATTN\b|ENGINEER|ARCHITECT|DRAWN\s+BY|DESIGNED\s+BY|CHECKED\s+BY|\bMR\.?\s|\bMS\.?\s|\bMRS\.?\s|\bPSM\b|\bRLA\b/i;
const NOT_THE_PROJECT_RE = /ADJACENT|NEIGHBOR|NEIGHBOUR|\bEXIST(ING)?\b[^|]{0,20}\b(PARCEL|STORE|BUILDING|SITE|LOT)\b|\bPARCEL\b|\bN\.?\s?I\.?\s?C\.?\b|NOT\s+IN\s+CONTRACT|BY\s+OTHERS|\bNOTE\b|\bSEE\b|\bNEXT\s+TO\b|\bACROSS\b/i;

export interface Checked<T> {
  ok: boolean;
  /** Hard failure: the value is dropped, never even suggested. */
  hard?: boolean;
  value?: T;
  /** The highest confidence the checks allow (the model's may be lower). */
  cap?: Confidence;
  notes: string[];
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The model's own confidence ('none' = not printed). */
export type ModelConfidence = Confidence | 'none';
export interface ModelField { value: string; sheet: string; quote: string; confidence: ModelConfidence }

/** The source the model cited, else the source the quote is actually on. */
export function locate(f: ModelField, sources: ProfileSource[]): { src: ProfileSource | null; citedRight: boolean } {
  const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
  const cited = sources.find(s => norm(s.sheet) === norm(f.sheet ?? ''));
  if (cited && isGrounded(f.quote, cited.text)) return { src: cited, citedRight: true };
  const found = sources.find(s => isGrounded(f.quote, s.text));
  return { src: found ?? null, citedRight: false };
}

/** Grounding every field shares: the quote is on a page the model was shown
 *  and contains the value. */
function grounded(f: ModelField, sources: ProfileSource[], valueMustAppear = true): { src: ProfileSource | null; fail?: Checked<never>; notes: string[] } {
  const notes: string[] = [];
  const { src, citedRight } = locate(f, sources);
  if (!src) return { src: null, fail: { ok: false, hard: true, notes: ['the quoted text is not on any sheet that was read'] }, notes };
  if (!citedRight) notes.push(`quote found on ${src.sheet}, not the cited ${f.sheet || 'sheet'}`);
  if (valueMustAppear && !normText(f.quote).includes(normText(f.value))) {
    return { src, fail: { ok: false, hard: true, notes: ['the value is not in the quoted text'] }, notes };
  }
  return { src, notes };
}

// ── Brand ───────────────────────────────────────────────────────────────────

export function canonicalBrand(text: string, brands: KnownBrand[]): KnownBrand | null {
  for (const b of brands) if (b.aliases.some(a => aliasMatches(a, text)) || aliasMatches(b.name, text)) return b;
  return null;
}

/** Brands printed in a project-name context on the covers / title blocks
 *  (never notes, never a person's name, never an adjacent parcel). */
export function brandsInProjectContext(sources: ProfileSource[], brands: KnownBrand[]): Map<string, { sheet: string; quote: string }> {
  const found = new Map<string, { sheet: string; quote: string }>();
  for (const s of sources) {
    if (s.why === 'code_area') continue;
    for (const seg of segments(s.text)) {
      if (PERSON_RE.test(seg) || NOT_THE_PROJECT_RE.test(seg)) continue;
      const b = canonicalBrand(seg, brands);
      if (b && !found.has(b.name)) found.set(b.name, { sheet: s.sheet, quote: seg });
    }
  }
  return found;
}

/** Other brands the model listed, kept only when printed in a project
 *  context on a cover / title block and not the chosen brand. */
export function otherBrandsInContext(others: Array<{ value: string; sheet: string; quote: string }>, sources: ProfileSource[], brands: KnownBrand[], chosen: string): string[] {
  const out = new Set<string>();
  for (const o of others ?? []) {
    if (!o?.value || !o.quote) continue;
    const src = locate({ value: o.value, sheet: o.sheet, quote: o.quote, confidence: 'low' }, sources).src;
    if (!src || src.why === 'code_area') continue;
    const seg = segmentWith(o.quote, o.value);
    if (PERSON_RE.test(seg) || NOT_THE_PROJECT_RE.test(seg)) continue;
    const name = canonicalBrand(o.value, brands)?.name ?? o.value.trim();
    if (name.toLowerCase() !== chosen.toLowerCase()) out.add(name);
  }
  return [...out];
}

export function checkBrand(f: ModelField, sources: ProfileSource[], brands: KnownBrand[]): Checked<{ name: string; projectType?: string; known: boolean }> {
  const g = grounded(f, sources, false);
  if (g.fail) return g.fail;
  const src = g.src!;
  const notes = [...g.notes];
  if (src.why === 'code_area') return { ok: false, hard: true, notes: ['a brand is only read from a cover or title block, never from notes'] };
  const known = canonicalBrand(f.value, brands);
  const needle = known ? (known.aliases.find(a => aliasMatches(a, f.quote)) ?? f.value) : f.value;
  if (!aliasMatches(needle, f.quote) && !normText(f.quote).includes(normText(f.value))) {
    return { ok: false, hard: true, notes: ['the brand is not in the quoted text'] };
  }
  const seg = segmentWith(f.quote, needle);
  if (PERSON_RE.test(seg)) return { ok: false, hard: true, notes: [`"${seg}" is a person or consultant, not the project`] };
  if (NOT_THE_PROJECT_RE.test(seg)) return { ok: false, hard: true, notes: [`"${seg}" describes something other than this project`] };
  let cap: Confidence = 'high';
  if (!known) { cap = 'medium'; notes.push('not one of the known brands / account rules'); }
  const others = [...brandsInProjectContext(sources, brands).keys()].filter(n => n !== (known?.name ?? f.value));
  if (others.length) { cap = 'low'; notes.push(`the plans also name ${others.join(', ')} — pick the brand`); }
  return { ok: true, value: { name: known?.name ?? f.value.trim(), projectType: known?.projectType, known: !!known }, cap, notes };
}

// ── Store number ────────────────────────────────────────────────────────────

const STORE_RE = /\bSTORE\s*(?:#|NO\.?|NUMBER|NUM\.?)\s*:?\s*#?\s*([A-Z]{0,3})\s*-?\s*(\d{3,7})(?![\d)\-.\/]|\s*[-.]\s*\d)/i;

export function checkStoreNumber(f: ModelField, sources: ProfileSource[]): Checked<string> {
  const g = grounded(f, sources, false);
  if (g.fail) return g.fail;
  const digits = String(f.value).replace(/\D/g, '');
  const m = STORE_RE.exec(f.quote);
  if (!m) return { ok: false, hard: true, notes: ['no "STORE #/NO/NUMBER" wording in the quote (a room tag or phone number is not a store number)'] };
  if (m[2] !== digits) return { ok: false, hard: true, notes: [`the quote's store number is ${m[2]}, not ${digits}`] };
  if (/\(\s*$/.test(f.quote.slice(0, m.index + m[0].indexOf(m[2])))) return { ok: false, hard: true, notes: ['looks like a phone number'] };
  const src = g.src!;
  return { ok: true, value: digits, cap: src.why === 'code_area' ? 'medium' : 'high', notes: g.notes };
}

// ── Prototype ───────────────────────────────────────────────────────────────

const PROTO_LABEL_RE = /\bPROTO(TYPE)?\b/i;
const PANEL_RE = /\bPANEL|\bPNL\b|PANELBOARD|\bCKT\b|CIRCUIT|FEEDER|\bMDP\b|\bLP-?\d|\bBREAKER/i;
/** Known brand prototype codes (AutoZone "7N2", "7N2-L"). */
const BRAND_PROTOTYPE: Record<string, RegExp> = { AutoZone: /^\d[A-Z]\d(-[A-Z0-9]{1,3})?$/ };

export function checkPrototype(f: ModelField, sources: ProfileSource[], brand: string | null): Checked<string> {
  const g = grounded(f, sources);
  if (g.fail) return g.fail;
  const value = f.value.trim().toUpperCase();
  const seg = segmentWith(f.quote, f.value);
  if (PANEL_RE.test(seg)) return { ok: false, hard: true, notes: [`"${seg}" is a panel / circuit name, not a prototype`] };
  if (PROTO_LABEL_RE.test(f.quote)) return { ok: true, value, cap: 'high', notes: g.notes };
  // A value printed next to PANEL / CKT anywhere on the sheets read is a
  // panel name ("1L1"), whatever the model called it.
  for (const s of sources) {
    for (const o of occurrences(s.text, value)) if (PANEL_RE.test(columnWindow(o, 2, 1, 16))) {
      return { ok: false, hard: true, notes: [`"${value}" is printed as a panel / circuit name on ${s.sheet}`] };
    }
  }
  const pattern = brand ? BRAND_PROTOTYPE[brand] : undefined;
  if (!pattern || !pattern.test(value)) return { ok: false, hard: true, notes: ['no PROTOTYPE label and not a known brand prototype code'] };
  // A brand code with no label must repeat across the title blocks.
  const onSheets = sources.filter(s => s.why !== 'code_area' && new RegExp(`(^|\\s)${value.replace(/[-]/g, '\\-')}(\\s|$)`, 'm').test(s.text.toUpperCase())).length;
  if (onSheets < 2) return { ok: true, value, cap: 'low', notes: [...g.notes, 'a brand prototype code seen on only one title block'] };
  return { ok: true, value, cap: 'high', notes: g.notes };
}

// ── Building SF ─────────────────────────────────────────────────────────────

const SF_RE = /\b(BLDG\.?|BUILDING|GROSS\s+BUILDING|GROSS\s+FLOOR|FLOOR|UNDER\s+ROOF)\b([^0-9]{0,40}?)(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(S\.?\s?F\.?|SQ\.?\s*F(?:EE)?T\.?|SQUARE\s+F(?:EE|OO)T|GSF)?/i;
const NOT_BUILDING_RE = /\bSITE\b|\bLOT\b|PARCEL|PAVED|PAVEMENT|LANDSCAP|DISTURB|IMPERVIOUS|PERVIOUS|PARKING|\bACRES?\b|\bA\.C\.|OPEN\s+SPACE|\bPOND\b|CANOPY/i;

export function checkSqFt(f: ModelField & { label?: string }, sources: ProfileSource[]): Checked<{ value: number; label: string }> {
  const g = grounded(f, sources, false);
  if (g.fail) return g.fail;
  const n = Number(String(f.value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n < 100 || n > 2_000_000) return { ok: false, hard: true, notes: ['not a building area'] };
  const label = (f.label ?? '').toLowerCase();
  if (/site|lot|parcel|other/.test(label)) return { ok: false, hard: true, notes: ['site / lot area is never the building SF'] };
  const m = SF_RE.exec(f.quote);
  if (!m) return { ok: false, hard: true, notes: ['the quote has no building / gross building / floor area label before the number'] };
  if (Number(m[3].replace(/,/g, '')) !== Math.round(n)) return { ok: false, hard: true, notes: [`the labeled area is ${m[3]}, not ${n}`] };
  const labelText = `${m[1]}${m[2]}`;
  // The words just before the label, in the same column block ("GROSS SITE
  // AREA", "TOTAL LOT AREA", "PAVED AREA").
  const before = segments(f.quote.slice(Math.max(0, m.index - 30), m.index)).pop() ?? '';
  if (NOT_BUILDING_RE.test(labelText) || NOT_BUILDING_RE.test(before)) {
    return { ok: false, hard: true, notes: ['a site / lot / paved area, not the building'] };
  }
  const outLabel = /gross/i.test(labelText) || /gross/.test(label) ? 'gross' : /net/.test(label) ? 'net' : 'building';
  return { ok: true, value: { value: Math.round(n), label: outLabel }, cap: 'high', notes: g.notes };
}

// ── Plan date ───────────────────────────────────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Every full date in a text, as ISO. */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  const t = String(text ?? '');
  for (const m of t.matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g)) {
    const v = iso(Number(m[3]), Number(m[1]), Number(m[2]));
    if (v) out.push(v);
  }
  for (const m of t.matchAll(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi)) {
    const v = iso(Number(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toUpperCase()) + 1, Number(m[2]));
    if (v) out.push(v);
  }
  return out;
}

export function normalizeIsoDate(v: string): string | null {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return datesIn(s)[0] ?? null;
}

const REVISION_RE = /\bREV(ISION|ISED)?\b|\bADDEND(UM|A)\b|\bBULLETIN\b|\bASI\b|\bR\d\b|Δ|\bDELTA\b/i;

/** Dates printed on a revision / addendum line (the words before the date
 *  on the same line, within its column block). */
function revisionDatesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    for (const m of line.matchAll(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g)) {
      const left = line.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      if (REVISION_RE.test(left)) for (const d of datesIn(m[0])) out.add(d);
    }
  }
  return out;
}

function issueDatesIn(text: string): Set<string> {
  const rev = revisionDatesIn(text);
  const all = datesIn(text);
  const out = new Set<string>();
  // A date printed both on an issue line and a revision line still counts.
  for (const line of String(text ?? '').split(/\r?\n/)) {
    for (const m of line.matchAll(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g)) {
      const left = line.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
      if (!REVISION_RE.test(left)) for (const d of datesIn(m[0])) out.add(d);
    }
  }
  for (const d of all) if (!rev.has(d)) out.add(d);
  return out;
}

export function checkPlanDate(f: ModelField & { kind?: string }, sources: ProfileSource[]): Checked<string> {
  const g = grounded(f, sources, false);
  if (g.fail) return g.fail;
  const value = normalizeIsoDate(f.value);
  if (!value) return { ok: false, hard: true, notes: ['not a date'] };
  if (!datesIn(f.quote).includes(value)) return { ok: false, hard: true, notes: ['the date is not in the quoted text'] };
  const src = g.src!;
  const notes = [...g.notes];
  let cap: Confidence = 'high';
  if (src.why !== 'electrical') { cap = 'medium'; notes.push('not an electrical sheet\'s date'); }
  if ((f.kind ?? '').toLowerCase() === 'revision' || REVISION_RE.test(f.quote) || revisionDatesIn(src.text).has(value) && !issueDatesIn(src.text).has(value)) {
    cap = 'low'; notes.push('a revision date, not the issue date');
  }
  // Cross-check: the issue date the electrical title blocks agree on
  // (revision-line dates never vote).
  const counts = new Map<string, number>();
  for (const s of sources.filter(x => x.why === 'electrical')) {
    for (const d of issueDatesIn(s.text)) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length && ranked[0][0] !== value && ranked[0][1] >= 2 && ranked[0][1] > (counts.get(value) ?? 0)) {
    cap = minConfidence(cap, 'low');
    notes.push(`the electrical title blocks mostly say ${ranked[0][0]}`);
  }
  return { ok: true, value, cap, notes };
}

// ── People / firms ──────────────────────────────────────────────────────────

const NOT_A_NAME_RE = /\b(DRAWINGS?|BACKFILL\w*|PIPE|SHALL|NOTES?|SEE|THE|CONTRACTOR|PLANS?|SHEET|SCALE|DETAILS?|SPECIFICATIONS?|WORK|INSTALL\w*|PROVIDE|REQUIRED|ALL|WITH|FOR|OF|IN)\b/i;

export function looksLikeNameOrFirm(v: string): boolean {
  const s = String(v ?? '').trim();
  if (s.length < 4 || s.length > 80) return false;
  if (!/^[A-Z0-9][A-Za-z0-9.'’&,\- ]+$/.test(s)) return false;
  const words = s.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 2 && !/\b(INC|LLC|CORP|CO)\b/i.test(s)) return false;
  // Words that only a note or a sentence would use.
  const stripped = s.replace(/\b(P\.?\s?E|INC|LLC|CORP|CO|AND|&)\b\.?/gi, ' ');
  return !NOT_A_NAME_RE.test(stripped);
}

export function checkEngineer(f: ModelField, sources: ProfileSource[]): Checked<string> {
  const g = grounded(f, sources);
  if (g.fail) return g.fail;
  if (!looksLikeNameOrFirm(f.value)) return { ok: false, hard: true, notes: [`"${f.value}" does not look like a name or firm`] };
  if (g.src!.why !== 'electrical') return { ok: false, hard: true, notes: ['the engineer of record is read from the electrical title block only'] };
  // Cross-check: the EOR repeats on the electrical title blocks; a name on a
  // minority of them (a civil-prepared photometric sheet) is only suggested.
  const electrical = sources.filter(s => s.why === 'electrical');
  const on = electrical.filter(s => occurrences(s.text, f.value).length > 0).length;
  if (electrical.length >= 3 && on * 2 < electrical.length) {
    return { ok: true, value: f.value.trim(), cap: 'medium', notes: [...g.notes, `on ${on} of ${electrical.length} electrical title blocks`] };
  }
  return { ok: true, value: f.value.trim(), cap: 'high', notes: g.notes };
}

const OTHER_DISCIPLINE_RE = /LANDSCAPE|\bCIVIL\b|STRUCTURAL|SURVEY|\bMEP\b|MECHANICAL|PLUMBING|IRRIGATION|GEOTECH|INTERIOR\s+DESIGN/i;

const HEADING_RE = /ARCHITECT|ENGINEER|\bOWNER\b|SURVEYOR|CONSULTANT|DESIGNER|DEVELOPER/i;

function lineWindow(o: Occurrence, i: number, pad = 12): string {
  return (o.lines[i] ?? '').slice(Math.max(0, o.col - pad), o.col + o.len + pad);
}

function underOtherDiscipline(o: Occurrence): boolean {
  for (let i = o.line - 1; i >= Math.max(0, o.line - 6); i--) {
    if (!HEADING_RE.test(lineWindow(o, i))) continue;
    if (OTHER_DISCIPLINE_RE.test(lineWindow(o, i))) return true;
    // The nearest non-blank line above the heading in its column ("LANDSCAPE"
    // over "ARCHITECT"; blank lines skipped).
    let seen = 0;
    for (let k = i - 1; k >= Math.max(0, i - 8) && seen < 1; k--) {
      const w = lineWindow(o, k);
      if (!w.trim()) continue;
      seen++;
      if (OTHER_DISCIPLINE_RE.test(w)) return true;
    }
    return false;
  }
  for (let i = o.line - 1; i >= Math.max(0, o.line - 3); i--) if (OTHER_DISCIPLINE_RE.test(lineWindow(o, i))) return true;
  return false;
}

export function checkArchitect(f: ModelField, sources: ProfileSource[]): Checked<string> {
  const g = grounded(f, sources);
  if (g.fail) return g.fail;
  if (!looksLikeNameOrFirm(f.value)) return { ok: false, hard: true, notes: [`"${f.value}" does not look like a name or firm`] };
  if (OTHER_DISCIPLINE_RE.test(segmentWith(f.quote, f.value))) return { ok: false, hard: true, notes: ['a landscape / civil / structural consultant, not the architect'] };
  // The block the name sits in, column by column, on every sheet read: the
  // nearest heading above it, and the two lines above that heading (layout
  // text often splits "LANDSCAPE / ARCHITECT" over lines with an address
  // interleaved from the next column).
  for (const s of sources) {
    for (const o of occurrences(s.text, f.value)) {
      if (underOtherDiscipline(o)) {
        return { ok: false, hard: true, notes: [`"${f.value}" sits under a landscape / civil / structural heading on ${s.sheet}`] };
      }
    }
  }
  return { ok: true, value: f.value.trim(), cap: 'high', notes: g.notes };
}

export function checkOwner(f: ModelField, sources: ProfileSource[]): Checked<string> {
  const g = grounded(f, sources);
  if (g.fail) return g.fail;
  const seg = segmentWith(f.quote, f.value);
  if (/\bP\.?\s?E\.?(?![A-Z])|\bAIA\b|ENGINEER|ARCHITECT|CONSULT/i.test(seg)) return { ok: false, hard: true, notes: ['a consultant, not the owner'] };
  if (!looksLikeNameOrFirm(f.value)) return { ok: false, hard: true, notes: [`"${f.value}" does not look like a name or firm`] };
  return { ok: true, value: f.value.trim(), cap: g.src!.why === 'code_area' ? 'medium' : 'high', notes: g.notes };
}

// ── Site address ────────────────────────────────────────────────────────────

export const US_STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'PUERTO RICO': 'PR',
};
const STATE_CODES = new Set(Object.values(US_STATES));

/** A valid 2-letter state code ("Tennessee" -> TN, "TE" -> null). */
export function stateCode(raw: string): string | null {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (STATE_CODES.has(s)) return s;
  return US_STATES[s] ?? null;
}

function titleCase(s: string): string {
  const KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'US', 'SR', 'CR', 'FM']);
  return s.split(/\s+/).filter(Boolean).map(w => {
    const bare = w.replace(/[.,]+$/, '');
    const trail = w.slice(bare.length);
    if (KEEP_UPPER.has(bare.toUpperCase())) return bare.toUpperCase() + trail;
    if (/^\d/.test(bare)) return bare.toUpperCase() + trail;
    return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase() + trail;
  }).join(' ');
}

export interface ModelAddress { street: string; city: string; state: string; zip: string; sheet: string; quote: string; confidence: ModelConfidence }

export function checkAddress(a: ModelAddress, sources: ProfileSource[]): Checked<{ loc: string; city: string; state: string }> {
  const f: ModelField = { value: a.street, sheet: a.sheet, quote: a.quote, confidence: a.confidence };
  const g = grounded(f, sources);
  if (g.fail) return g.fail;
  const st = stateCode(a.state);
  if (!st) return { ok: false, hard: true, notes: [`"${a.state}" is not a US state`] };
  if (!/^\d+\s+\S/.test(a.street.trim())) return { ok: false, hard: true, notes: ['not a street address'] };
  if (!a.city.trim()) return { ok: false, hard: true, notes: ['no city'] };
  const zip = /^\d{5}(-\d{4})?$/.test(a.zip.trim()) ? a.zip.trim() : '';
  const seg = segmentWith(a.quote, a.street);
  if (OFFICE_RE.test(seg)) return { ok: false, hard: true, notes: ['an engineer / architect / consultant office address, not the site'] };
  // Every place this street address is printed: if each one sits in an
  // office block (P.E., AIA, license, phone, "consulting"), it is an office.
  const occ = sources.flatMap(s => occurrences(s.text, a.street));
  if (occ.length && occ.every(o => OFFICE_RE.test(columnWindow(o, 3, 3)))) {
    return { ok: false, hard: true, notes: ['printed only inside an engineer / architect / consultant office block'] };
  }
  const notes = [...g.notes];
  let cap: Confidence = 'high';
  if (g.src!.why !== 'cover') { cap = 'medium'; notes.push('not from the cover sheet'); }
  const city = titleCase(a.city.trim());
  const loc = `${titleCase(a.street.trim().replace(/[.,]+$/, ''))}, ${city}, ${st}${zip ? ` ${zip}` : ''}`;
  return { ok: true, value: { loc, city, state: st }, cap, notes };
}

// ── Build type ──────────────────────────────────────────────────────────────

const BUILD_EVIDENCE: Record<string, RegExp> = {
  remodel: /REMODEL|RENOVAT|ALTERATION|\bEXISTING\b[^|]{0,30}\bTO\s+REMAIN\b|INTERIOR\s+RENOVATION|\bREFRESH\b/i,
  tenant: /TENANT\s+(IMPROVEMENT|FIT|BUILD|FINISH)|\bT\.\s?I\.|WHITE\s*BOX|\bVANILLA\s+SHELL\b/i,
  new: /\bNEW\s+(BUILDING|CONSTRUCTION|STORE|BUILD|FACILITY|DEVELOPMENT)\b|GROUND[- ]UP/i,
};
const NA_RE = /\bN\s?\/\s?A\b|NOT\s+APPLICABLE|NOT\s+USED|\bNONE\b|\bN\.A\.|\(NA\)/i;
const SPEC_INDEX_RE = /\bSECTION\b|\bDIVISION\b|\b\d{2}\s\d{2}\s\d{2}\b|\b\d{6}\b|PROCEDURES|REQUIREMENTS/i;

export function checkBuildType(f: ModelField, sources: ProfileSource[]): Checked<'new' | 'remodel' | 'tenant'> {
  const v = String(f.value ?? '').toLowerCase().trim();
  if (v !== 'new' && v !== 'remodel' && v !== 'tenant') return { ok: false, hard: true, notes: ['unknown build type'] };
  const g = grounded(f, sources, false);
  if (g.fail) return g.fail;
  const segs = segments(f.quote).filter(s => BUILD_EVIDENCE[v].test(s));
  if (!segs.length) return { ok: false, hard: true, notes: [`no explicit ${v} wording in the quote`] };
  if (segs.every(s => NA_RE.test(s) || SPEC_INDEX_RE.test(s))) return { ok: false, hard: true, notes: ['an N/A or spec-index line, not the scope'] };
  return { ok: true, value: v, cap: 'high', notes: g.notes };
}

// ── Notable systems ─────────────────────────────────────────────────────────

export type SystemKey = 'fuel' | 'site_lighting' | 'fire_alarm' | 'generator' | 'ev';
export const SYSTEM_KEYS: SystemKey[] = ['fuel', 'site_lighting', 'fire_alarm', 'generator', 'ev'];

/** Whole-word evidence per system. A bare "UST" never counts ("AD UST" is
 *  ADJUST split by the layout text). */
export const SYSTEM_EVIDENCE: Record<SystemKey, RegExp> = {
  fuel: /\bFUEL\b|\bDISPENSERS?\b|\bGASOLINE\b|\bDIESEL\b|UNDERGROUND\s+STORAGE\s+TANKS?|\bUSTS?\s+(TANK|SUMP|MONITOR|SYSTEM|AREA)|TANK\s+MONITOR|\bSTP\b|SUBMERSIBLE\s+(TURBINE\s+)?PUMP/i,
  site_lighting: /\bSITE\s+LIGHT|PHOTOMETRIC|\bPOLE\s+LIGHT|\bLIGHT\s+POLE|\bAREA\s+LIGHT|PARKING\s+(LOT\s+)?LIGHT/i,
  fire_alarm: /\bFIRE\s+ALARM\b|\bFACP\b|\bF\.A\.C\.P\.?/i,
  generator: /\bGENERATORS?\b|\bGENSET\b|\bGEN\s+SET\b/i,
  ev: /\bEV\s*(CHARG|STATION|CHARGER)|ELECTRIC\s+VEHICLE|\bEVSE\b/i,
};
const ABSENT_RE = /\bNO\b|\bNOT\b|\bNONE\b|N\.?\s?I\.?\s?C\.?|EXCLUDED|BY\s+OTHERS|\bFUTURE\b/i;

export interface SystemEvidence { value: boolean | null; sheet: string | null; quote: string | null; notes?: string[] }
export interface ModelSystem { present: 'yes' | 'no' | 'unknown'; sheet: string; quote: string }

export function checkSystem(key: SystemKey, s: ModelSystem | undefined, sources: ProfileSource[]): SystemEvidence {
  const unknown: SystemEvidence = { value: null, sheet: null, quote: null };
  if (!s || s.present === 'unknown' || !s.quote) return unknown;
  const f: ModelField = { value: '', sheet: s.sheet, quote: s.quote, confidence: 'high' };
  const { src } = locate(f, sources);
  if (!src) return { ...unknown, notes: ['the quoted text is not on any sheet that was read'] };
  if (src.why !== 'electrical') return { ...unknown, notes: ['systems are read from electrical sheets only'] };
  const segs = segments(s.quote).filter(x => SYSTEM_EVIDENCE[key].test(x));
  if (!segs.length) return { ...unknown, notes: ['no whole-word evidence in the quote'] };
  if (s.present === 'no') {
    return segs.some(x => ABSENT_RE.test(x)) ? { value: false, sheet: src.sheet, quote: s.quote } : unknown;
  }
  if (segs.every(x => ABSENT_RE.test(x))) return { ...unknown, notes: ['the quote says it is not provided'] };
  return { value: true, sheet: src.sheet, quote: s.quote };
}
