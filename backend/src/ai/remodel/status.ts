// Remodel round A1 — new / existing / demolition status. Pure: no I/O, no AI.
//
// A remodel plan set draws three kinds of work with the same symbols: NEW
// work (priced as install), EXISTING work to remain (listed, never priced)
// and DEMOLITION (priced as removal labour). How they are told apart is a
// per-sheet convention printed in its legend or notes ("SHADED SYMBOL
// DENOTES NEW RECEPTACLE", "(E) = EXISTING", "DASHED = TO BE REMOVED"), or a
// whole sheet / drawing titled DEMOLITION.
//
// Remodel mode is switched ONLY by a remodel signal (the bid's build type,
// or the drawings' own words). A new-build job never enters it: its counter
// prompt, its marks and its counts stay exactly as before (every mark new).

export type MarkStatus = 'new' | 'existing' | 'demo' | 'relocated' | 'unknown';
export type ConventionStatus = Exclude<MarkStatus, 'unknown'>;

export interface StatusConvention {
  status: ConventionStatus;
  /** Short rule in the drawing's terms ("shaded symbol = new"). */
  rule: string;
  /** The printed words, verbatim (max 200 characters). */
  quote: string;
  sheetKey: string;
  sheetLabel: string;
  /** counter = read by the counter on the sheet; text = the sheet's text
   *  layer; title = a drawing titled DEMOLITION; estimator = the answer to
   *  "how are new vs existing shown?". */
  source: 'counter' | 'text' | 'title' | 'estimator';
}

/** Normalizes a status the counter returned. Anything unrecognizable is
 *  'unknown' (never silently new); empty is undefined (not stated). */
export function normalizeMarkStatus(v: unknown): MarkStatus | undefined {
  const s = String(v ?? '').trim().toLowerCase().replace(/[()]/g, '').replace(/[\s_-]+/g, ' ');
  if (!s) return undefined;
  if (/^(new|n|proposed|new work)$/.test(s)) return 'new';
  if (/^(existing|e|ex|existing to remain|to remain|remain|etr)$/.test(s)) return 'existing';
  if (/^(demo|demolition|demolish|demolished|remove|removed|to be removed|existing to be removed|d|x)$/.test(s)) return 'demo';
  if (/^(relocated?|relocation|r|rl|er|existing relocated)$/.test(s)) return 'relocated';
  return 'unknown';
}

/** Only new and relocated work is install work. 'unknown' (a rule exists but
 *  the counter could not tell) stays COUNTED — a count is never lowered
 *  silently — and gets a blocking review item; undefined = no status asked
 *  (a new-build sheet) = new. */
export function isInstallStatus(s: MarkStatus | undefined): boolean {
  return s === undefined || s === 'new' || s === 'relocated' || s === 'unknown';
}

/** Validates the counter's / a reader's `conventions` array. */
export function parseConventions(raw: unknown, sheet: { key: string; label: string }, source: StatusConvention['source']): StatusConvention[] {
  const out: StatusConvention[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const status = normalizeMarkStatus(r.status);
    const quote = String(r.quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const rule = String(r.rule ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!status || status === 'unknown' || !quote) continue;
    if (out.some(o => o.quote.toUpperCase() === quote.toUpperCase() && o.status === status)) continue;
    out.push({ status, rule: rule || quote, quote, sheetKey: sheet.key, sheetLabel: sheet.label, source });
    if (out.length >= 8) break;
  }
  return out;
}

// ── Remodel signal ─────────────────────────────────────────────────────────

/** Words in the drawing analysis that say the job alters an existing
 *  building. Deliberately NOT "demolition" / "demo": a new build on a cleared
 *  site has a site demolition plan (Kissimmee D0.1) and notes like "confirm
 *  demo of existing electrical is by sitework sub" — neither is a remodel. */
const REMODEL_TEXT_RE = /\b(remodel(?:ing|ed)?|renovat(?:e|ed|ion|ions)|alterations?|tenant\s+(?:improvement|build[\s-]?out|fit[\s-]?out)s?|interior\s+build[\s-]?out|build[\s-]?out|change\s+of\s+occupancy|existing\s+(?:building|shell|tenant\s+space|suite|warehouse|space)(?!\s+to\s+be\s+(?:demolished|removed)))\b/i;
/** Sheet titles that say the set shows an existing building's alteration. */
const REMODEL_TITLE_RE = /\b(ALTERATIONS?|EXISTING|RENOVATIONS?|REMODEL(?:ING)?)\b/i;

export interface RemodelSignal {
  remodel: boolean;
  /** Why (shown to the estimator). */
  reasons: string[];
}

function textsOf(agent1: Record<string, unknown>): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  const p = (agent1.project ?? {}) as Record<string, unknown>;
  for (const k of ['name', 'projectType']) if (typeof p[k] === 'string') out.push({ where: `project ${k}`, text: p[k] as string });
  for (const n of Array.isArray(agent1.scopeNotes) ? agent1.scopeNotes : []) if (typeof n === 'string') out.push({ where: 'scope note', text: n });
  for (const f of Array.isArray(agent1.flags) ? agent1.flags : []) {
    const r = (f ?? {}) as Record<string, unknown>;
    out.push({ where: 'flag', text: `${String(r.item ?? '')} ${String(r.issue ?? '')}` });
  }
  return out;
}

/** Is this a remodel / tenant job? The bid's build type decides when it is
 *  set ('new' switches remodel mode off whatever the text says); otherwise
 *  the sheet titles (ALTERATIONS / EXISTING / RENOVATION / REMODEL on an
 *  electrical or architectural sheet) or the drawing analysis's own words. */
export function remodelSignal(input: {
  buildType?: string | null;
  agent1: Record<string, unknown>;
  inventory: Array<{ sheetNo: string; title: string; discipline: string }>;
}): RemodelSignal {
  const bt = String(input.buildType ?? '').trim().toLowerCase();
  if (bt === 'new') return { remodel: false, reasons: ['the bid is a new building'] };
  const reasons: string[] = [];
  if (bt === 'remodel' || bt === 'tenant') reasons.push(`the bid's build type is ${bt}`);
  for (const p of input.inventory) {
    if (!['electrical', 'architectural', 'fuel', 'other', 'unknown', 'cover'].includes(p.discipline)) continue;
    const m = REMODEL_TITLE_RE.exec(p.title);
    if (m) { reasons.push(`sheet ${p.sheetNo || '?'} is titled "${p.title.trim()}"`); break; }
  }
  for (const t of textsOf(input.agent1)) {
    const m = REMODEL_TEXT_RE.exec(t.text);
    if (m) { reasons.push(`the drawing analysis's ${t.where} says "${t.text.trim().slice(0, 80)}"`); break; }
  }
  return { remodel: reasons.length > 0, reasons };
}

// ── Titles ─────────────────────────────────────────────────────────────────

/** A drawing title for a DEMOLITION plan ("EXISTING FLOOR PLAN -
 *  DEMOLITIONS", "ELECTRICAL DEMOLITION PLAN", "DEMO RCP"). "DEMOLITION
 *  NOTES" is not a plan. */
export function isDemolitionTitle(t: string): boolean {
  return /\bDEMO(?:LITION)?S?\b/i.test(t) && /\b(PLANS?|LAYOUT|RCP|CEILING)\b/i.test(t) && !/\bNOTES?\b/i.test(t);
}

/** A drawing title for a plan of any kind (not notes, a legend, a schedule
 *  or a key plan). */
export function isPlanTitle(t: string): boolean {
  return /\b(PLANS?|LAYOUT|RCP)\b/i.test(t) && !/\bKEY\s*PLAN\b|\bNOTES?\b|\bLEGEND\b|\bSCHEDULES?\b|\bDETAILS?\b/i.test(t);
}

/** 'demolition' = every plan drawn on the sheet is a demolition plan (the
 *  sheet is counted for demolition only); 'mixed' = a demolition plan beside
 *  a new-work plan (marks inside the demolition drawing are demolition);
 *  'none' otherwise. */
export function classifySheetTitles(titles: string[]): { kind: 'demolition' | 'mixed' | 'none'; demoTitles: string[]; otherPlanTitles: string[] } {
  const clean = [...new Set(titles.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const demoTitles = clean.filter(isDemolitionTitle);
  const otherPlanTitles = clean.filter(t => isPlanTitle(t) && !isDemolitionTitle(t));
  if (!demoTitles.length) return { kind: 'none', demoTitles, otherPlanTitles };
  return { kind: otherPlanTitles.length ? 'mixed' : 'demolition', demoTitles, otherPlanTitles };
}

// ── Text layer ─────────────────────────────────────────────────────────────

const CONVENTION_TEXT: Array<{ re: RegExp; status: (m: RegExpExecArray) => ConventionStatus | null }> = [
  // "SHADED SYMBOL DENOTES NEW RECEPTACLE", "DASHED LINES INDICATE EXISTING TO BE REMOVED"
  {
    re: /\b(SHADED|FILLED|SOLID|BOLD|HEAVY|DARK|HATCHED|DASHED|LIGHT|LIGHTER|HALFTONE|HALF-TONE|SCREENED|GR[AE]Y(?:ED)?|OPEN|UNSHADED)\s+(?:LINE\s+)?(?:SYMBOLS?|DEVICES?|LINES?|ITEMS?|FIXTURES?|OUTLETS?)?\s*(?:DENOTES?|INDICATES?|REPRESENTS?|=|ARE|IS|SHOWS?)\s+([A-Z ]{3,40})/gi,
    status: m => statusWords(m[2]),
  },
  // "(E) = EXISTING", "(E) DENOTES EXISTING TO REMAIN", "(R) RELOCATED"
  { re: /\((E|ER|R|RL|N|D|X)\)\s*(?:=|-|:|DENOTES?|INDICATES?)?\s*([A-Z ]{3,40})/gi, status: m => statusWords(m[2]) },
];

function statusWords(s: string): ConventionStatus | null {
  const t = s.toUpperCase();
  if (/\bRELOCAT/.test(t)) return 'relocated';
  if (/\b(REMOVED?|DEMO(LITION|LISH(ED)?)?)\b/.test(t)) return 'demo';
  if (/\bEXISTING\b/.test(t)) return 'existing';
  if (/\bNEW\b/.test(t)) return 'new';
  return null;
}

/** Conventions printed on a sheet with a text layer (no model call). */
export function textConventions(text: string, sheet: { key: string; label: string }): StatusConvention[] {
  const out: StatusConvention[] = [];
  const flat = text.replace(/\s+/g, ' ');
  for (const { re, status } of CONVENTION_TEXT) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat))) {
      const st = status(m);
      if (!st) continue;
      const quote = m[0].trim().slice(0, 200);
      if (out.some(o => o.quote === quote)) continue;
      out.push({ status: st, rule: quote.toLowerCase(), quote, sheetKey: sheet.key, sheetLabel: sheet.label, source: 'text' });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/** Drawing titles in a sheet's text layer: short runs naming a plan. */
export function textTitles(runs: string[]): string[] {
  return [...new Set(runs.map(r => r.replace(/\s+/g, ' ').trim()).filter(r => r.length >= 6 && r.length <= 90 && isPlanTitle(r)))];
}

// ── The estimator's answer to "how are new vs existing shown?" ─────────────

export const CONVENTION_OPTIONS = [
  'All devices on these plans are new — count everything',
  'Shaded / filled symbols are new; open symbols are existing — re-run the analysis to apply',
  '(E)-tagged devices are existing; untagged are new — re-run the analysis to apply',
  'Dashed symbols are demolition; solid symbols are new — re-run the analysis to apply',
  'Something else — I will correct the counts myself',
] as const;

/** The convention an answer stands for (applied on the next run), or null
 *  (all new / the estimator corrects the counts). */
export function conventionFromAnswer(answer: string | null | undefined): Omit<StatusConvention, 'sheetKey' | 'sheetLabel'> | null {
  switch (answer) {
    case CONVENTION_OPTIONS[1]: return { status: 'new', rule: 'shaded / filled symbol = new; open symbol = existing', quote: 'Estimator: shaded / filled symbols are new; open symbols are existing', source: 'estimator' };
    case CONVENTION_OPTIONS[2]: return { status: 'existing', rule: '(E) tag = existing; untagged = new', quote: 'Estimator: (E)-tagged devices are existing; untagged are new', source: 'estimator' };
    case CONVENTION_OPTIONS[3]: return { status: 'demo', rule: 'dashed symbol = demolition; solid = new', quote: 'Estimator: dashed symbols are demolition; solid symbols are new', source: 'estimator' };
    default: return null;
  }
}

/** The sheet note that asks the counter for each mark's status (remodel
 *  mode only). No line starts with "- " (the target list's own format). */
export function statusPromptBlock(known: Array<Pick<StatusConvention, 'status' | 'rule' | 'quote' | 'source'>>, sanitize: (s: string) => string): string {
  const knownText = known.length
    ? `\nKNOWN RULES for this job (apply them; report any others you find): ${known.map(k => `${k.status.toUpperCase()}: ${sanitize(k.rule)} ("${sanitize(k.quote).slice(0, 120)}")`).join('; ')}.`
    : '';
  return `\n\nSTATUS (remodel job): this job alters an existing building. Read this sheet's legend and notes for how NEW, EXISTING (to remain), DEMOLITION (to be removed) and RELOCATED items are drawn — e.g. "SHADED SYMBOL DENOTES NEW RECEPTACLE", "(E) = EXISTING", "DASHED = TO BE REMOVED". Report every such rule under "conventions": [{"status":"new|existing|demo|relocated","rule":"shaded symbol = new","quote":"the words exactly as printed"}].${knownText}
Give EVERY mark a sixth element, its status: "new", "existing", "demo", "relocated" or "unknown" ("unknown" = a rule exists but you cannot tell which applies to that symbol). When the sheet states no rule at all and none is known, use "new". On this sheet, count existing-to-remain and to-be-removed items too, with their status (this replaces the rule about skipping existing items) — they are listed for the estimator and never priced as new work.`;
}

/** The sheet note for a DEMOLITION sheet (every mark is demolition). */
export function demolitionPromptBlock(titles: string[], sanitize: (s: string) => string): string {
  return `\n\nDEMOLITION SHEET${titles.length ? ` (${titles.map(t => `"${sanitize(t)}"`).join(', ')})` : ''}: this sheet shows EXISTING work to be removed. Count every existing electrical item drawn on the plan — light fixtures, exit/emergency units, receptacles, switches, sensors, disconnects, junction boxes and equipment connections — whether or not a keyed note is attached. Report each under the listed tag whose symbol it matches; an item that matches no listed tag goes under the closest DEMO- target (DEMO-FIXTURE for any light fixture up to 2x4, DEMO-HIGHBAY for an HID / high-bay fixture, DEMO-EXIT for exit / emergency units, and so on). Never count architectural items (doors, walls, ceilings, plumbing, HVAC diffusers).`;
}
