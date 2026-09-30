// Remodel round A1.3 / A1.5 — demolition counts become "Demolition" takeoff
// lines. Pure: no I/O, no AI.
//
// Demolition marks come from two places: every mark on a DEMOLITION sheet
// (any discipline — the 36th Street set draws it on the architectural A2.0 /
// A3.0 "…DEMOLITIONS" plans), and 'demo'-status marks on the electrical
// sheets. They are grouped into the removal classes an estimator prices
// (Chris's BOM rows): fixture up to 2x4, HID high bay, exit/em, receptacle,
// 1-pole switch, 3-way switch, … — one line per class, with its evidence.
// The line names are the seeded demolition labor units' own names (Builder
// B, seed/laborUnits.ts DEMOLITION_ITEMS), so the mapper pairs them exactly.
import type { CountTarget } from '../countTargets';
import type { Alignment } from '../evidence/sheetRelation';
import { pdfToDisplayedIn } from '../evidence/viewports';
import type { MarkStatus } from './status';

export interface DemoClass { key: string; label: string }

export const DEMO_CLASSES: DemoClass[] = [
  { key: 'DEMO-FIXTURE', label: 'fluorescent fixture up to 2x4' },
  { key: 'DEMO-HIGHBAY', label: 'HID high bay fixture' },
  { key: 'DEMO-EXIT', label: 'exit/emergency light' },
  { key: 'DEMO-RECEPTACLE', label: 'receptacle' },
  { key: 'DEMO-SWITCH', label: 'single-pole switch' },
  { key: 'DEMO-SWITCH3', label: '3-way switch' },
  { key: 'DEMO-JBOX', label: 'junction box' },
  { key: 'DEMO-CONTROL', label: 'lighting control device (sensor / timer)' },
  { key: 'DEMO-DEVICE', label: 'device (other)' },
  { key: 'DEMO-EQUIPMENT', label: 'equipment connection / disconnect' },
  { key: 'DEMO-EXTERIOR', label: 'building-mounted exterior fixture' },
  { key: 'DEMO-SITE-POLE', label: 'site pole light' },
];
const CLASS_BY_KEY = new Map(DEMO_CLASSES.map(c => [c.key, c]));

/** Fix round S8 — the classes with a demolition labor unit. A class not
 *  here never becomes a takeoff line on its own (it would fuzzy-map to a
 *  WRONG unit): it is a blocking review item — the estimator enters the
 *  count to add it as a Demolition line, or marks it not on this job.
 *
 *  Price accuracy D4 — every class now has a unit: Builder B's seven
 *  (seed/laborUnits.ts DEMOLITION_ITEMS) and the five Builder C adds in C5
 *  (NECA-style defaults, "default — confirm"). Each line's item text is the
 *  unit's exact name, `Demolition — <label>` (DEMO_UNIT_NAMES), so the
 *  mapper pairs them exactly. */
export const PRICED_DEMO_CLASSES = new Set(DEMO_CLASSES.map(c => c.key));

/** D4 — each class's line text. The first seven are Builder B's unit names;
 *  the last five are the ALIASES of C5's units (seed codes DEMO-CONTROL,
 *  DEMO-DEVICE, DEMO-EQUIP, DEMO-EXTFIX, DEMO-SITEPOLE, named "… (default —
 *  confirm)"): coordinate any rename with that seed. */
export const DEMO_UNIT_NAMES: Record<string, string> = Object.fromEntries(DEMO_CLASSES.map(c => [c.key, `Demolition — ${c.label}`]));

/** Category of the demolition takeoff lines (the pricing side maps it). */
export const DEMOLITION_CATEGORY = 'Demolition';

/** Generic demolition targets, asked ONLY on demolition sheets: an existing
 *  item that matches none of the job's schedule / legend types still gets
 *  counted (the removed 400W high bays are on no new-work schedule). */
export const GENERIC_DEMO_TARGETS: CountTarget[] = [
  demoTarget('DEMO-FIXTURE', 'interior_lighting', 'Existing light fixture up to 2x4 (troffer, strip, wrap, downlight, wall light) to be removed', '2x4 / 2x2 / 1x4 rectangle, strip, circle — any existing fixture that matches no listed type'),
  demoTarget('DEMO-HIGHBAY', 'interior_lighting', 'Existing HID / high-bay fixture to be removed', 'large circle or square high-bay symbol, often tagged HB / MH / HID'),
  demoTarget('DEMO-EXIT', 'interior_lighting', 'Existing exit sign or emergency light to be removed', 'exit sign (with arrows) or twin-head emergency unit', true),
  demoTarget('DEMO-RECEPTACLE', 'device', 'Existing receptacle to be removed', 'receptacle symbol (circle with two lines) that matches no listed type'),
  demoTarget('DEMO-SWITCH', 'lighting_control', 'Existing single-pole switch to be removed', '$ or S'),
  demoTarget('DEMO-SWITCH3', 'lighting_control', 'Existing 3-way / 4-way switch to be removed', '$3 / $4 / S3'),
  demoTarget('DEMO-JBOX', 'equipment', 'Existing junction box to be removed', 'J in a circle or square'),
  demoTarget('DEMO-EQUIPMENT', 'equipment', 'Existing disconnect or equipment connection to be removed', 'disconnect or equipment connection symbol'),
  demoTarget('DEMO-SITE-POLE', 'site_lighting', 'Existing site pole light to be removed (one mark per pole)', 'pole-mounted area light symbol'),
];

function demoTarget(key: string, category: CountTarget['category'], description: string, symbolHint: string, emergency = false): CountTarget {
  return {
    type: key, key, description, symbolHint, wattage: null, category, source: 'legend', sourceSheet: 'demolition',
    headsPerPole: null, emergency,
  };
}

export function isGenericDemoTarget(t: Pick<CountTarget, 'key'>): boolean {
  return CLASS_BY_KEY.has(t.key);
}

/** The job's types a demolition sheet is asked about: fixture-schedule and
 *  legend types (the symbols the architect uses), never a host marker, an
 *  alias, or an equipment-schedule / panel-circuit row. */
export function isDemoEligibleTarget(t: CountTarget): boolean {
  if (isGenericDemoTarget(t)) return true;
  if (t.role === 'host' || (t.mergedInto?.length ?? 0) > 0) return false;
  return t.source === 'fixture_schedule' || t.source === 'legend';
}

/** The removal class a counted type belongs to. */
export function demoClassOf(t: Pick<CountTarget, 'key' | 'type' | 'description' | 'symbolHint' | 'category' | 'emergency'>): DemoClass {
  if (CLASS_BY_KEY.has(t.key)) return CLASS_BY_KEY.get(t.key)!;
  const text = `${t.type} ${t.description} ${t.symbolHint ?? ''}`;
  const c = (k: string) => CLASS_BY_KEY.get(k)!;
  switch (t.category) {
    // Fix round S8 — a site pole is never a "fixture up to 2x4".
    case 'site_lighting': return c('DEMO-SITE-POLE');
    case 'interior_lighting': case 'exterior_building':
      if (t.emergency || /\b(exit|emergency|egress|em)\b/i.test(text)) return c('DEMO-EXIT');
      if (/\b(high[\s-]?bays?|low[\s-]?bays?|HID|metal\s+halide|MH|HPS|mercury\s+vapor)\b/i.test(text)) return c('DEMO-HIGHBAY');
      if (t.category === 'exterior_building' || /\b(wall\s*packs?|canopy|flood)\b/i.test(text)) return c('DEMO-EXTERIOR');
      return c('DEMO-FIXTURE');
    case 'lighting_control':
      if (/\b(occupancy|vacancy|motion|sensors?|timer|time\s*clock|photo\s*cell|photocell|OS|TC)\b/i.test(text)) return c('DEMO-CONTROL');
      if (/\$\s*[34]|\bS[34]\b|\b[34][\s-]?way\b|\b(three|four)[\s-]?way\b|\btwo\/three\b|\bthree\/four\b/i.test(text)) return c('DEMO-SWITCH3');
      return c('DEMO-SWITCH');
    case 'device':
      if (/\b(recept\w*|duplex|simplex|quad\w*|fourplex|gfci?|gfi|afci|outlets?|plugs?|WP|AF|220V|250V)\b/i.test(text)) return c('DEMO-RECEPTACLE');
      return c('DEMO-DEVICE');
    default:
      if (/\b(junction|j-?box)\b|^J$/i.test(`${t.description} ${t.symbolHint ?? ''}`) || /^J$/i.test(t.type.trim())) return c('DEMO-JBOX');
      return c('DEMO-EQUIPMENT');
  }
}

export interface DemoSheetMarks {
  key: string;
  label: string;
  /** A sheet titled DEMOLITION (every mark on it is demolition). */
  demolition: boolean;
  geometry: { widthPt: number; heightPt: number; rotation: number; originX?: number; originY?: number } | null;
  /** `marked` (D3) — the symbol itself is marked for removal. */
  marks: Array<{ typeKey: string; x: number; y: number; marked?: boolean }>;
  /** Review B3 — the level / area the sheet shows ('' = not stated). */
  level?: string;
  area?: string;
}

/** Price accuracy D3 — a counted NEW-WORK plan: every mark on it, with its
 *  status (existing / relocated = still there after the work). */
export interface NewPlanMarks {
  key: string;
  label: string;
  geometry: { widthPt: number; heightPt: number; rotation: number; originX?: number; originY?: number } | null;
  /** `uncertain` (review S2) — the close-up check could not confirm the
   *  status, or itself lowered it: never used to lower demolition. */
  marks: Array<{ typeKey: string; x: number; y: number; status?: MarkStatus; uncertain?: boolean }>;
  level?: string;
  area?: string;
}

/** D3 — a demolition sheet compared with its registered new-work plan. */
export interface DemolitionComparison {
  classKey: string;
  item: string;
  sheetKey: string;
  label: string;
  planKey: string;
  planLabel: string;
  /** Kept on the demolition sheet for this class (after de-duplication). */
  shown: number;
  /** Of those, marked for removal on the demolition sheet. */
  marked: number;
  /** Still drawn as existing / relocated at the same place on the plan. */
  remain: number;
  demo: number;
  /** Decision 4 — of `demo`, drawn as NEW at the same place (replaced). */
  replaced: number;
  alignment: string;
}

/** D3 — the demolition sheet could not be registered with a new-work plan
 *  that shows existing items of the class: a SUGGESTION (count on the demo
 *  plan − existing on the new plans), asked; the line keeps the full count. */
export interface DemolitionSuggestion {
  classKey: string;
  item: string;
  sheets: Array<{ label: string; count: number }>;
  demoCount: number;
  marked: number;
  existing: Array<{ label: string; count: number }>;
  suggested: number;
  why: string;
  /** The plan draws them at the same place but gives no status (they may
   *  stay or be replaced). */
  unstated?: boolean;
  /** Hedged reuse notes naming this equipment (context, never an answer). */
  context?: string[];
}

export interface DemolitionLine {
  classKey: string;
  item: string;
  qty: number;
  sheets: Array<{ sheetKey: string; label: string; count: number }>;
  byType: Array<{ typeKey: string; type: string; count: number }>;
  /** Marks shown on two same-size sheets at the same place — counted once. */
  dedupedAcross: number;
  /** D3 — still shown as existing on the new-work plan: not removed. */
  remain?: Array<{ label: string; planLabel: string; count: number }>;
  /** Decision 4 — removed old devices a new one replaces at the same place. */
  replaced?: number;
  /** Decision 5 — equipment at the same place, noted for reuse: not removed. */
  reused?: number;
}

export interface DemolitionQuestion {
  classKey: string;
  item: string;
  sheets: Array<{ label: string; count: number }>;
  keep: number;
  sum: number;
}

/** Decision 5 — equipment drawn at the same place on the new-work plan that
 *  the analysis / plans note as reused or existing to remain. */
export interface DemolitionReuse {
  classKey: string;
  item: string;
  sheetKey: string;
  label: string;
  planLabel: string;
  count: number;
  byType: Array<{ typeKey: string; type: string; count: number }>;
  quotes: string[];
  alignment: string;
}

export interface DemolitionResult {
  lines: DemolitionLine[];
  reused?: DemolitionReuse[];
  /** Price accuracy D3. */
  comparisons?: DemolitionComparison[];
  suggestions?: DemolitionSuggestion[];
  /** A class drawn on sheets whose positions can't be compared: the same
   *  items twice, or different items? (blocking; the line carries the sum). */
  questions: DemolitionQuestion[];
  marks: Array<{ sheetKey: string; typeKey: string; classKey: string; x: number; y: number; marked?: boolean }>;
}

/** Two demolition marks of one class on two same-size sheets within this
 *  distance are the same existing item drawn twice (a floor-plan demo and a
 *  ceiling-plan demo of one building). */
export const DEMO_DEDUP_RADIUS_PT = 36;

function sameGeometry(a: DemoSheetMarks['geometry'], b: DemoSheetMarks['geometry']): boolean {
  if (!a || !b) return false;
  return Math.abs(a.widthPt - b.widthPt) <= 2 && Math.abs(a.heightPt - b.heightPt) <= 2 && a.rotation === b.rotation;
}

/** Nearest-first, one-to-one pairs within DEMO_DEDUP_RADIUS_PT (or `tol`). */
function pairUp(a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>, tol = DEMO_DEDUP_RADIUS_PT): Array<[number, number]> {
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  a.forEach((m, i) => b.forEach((p, j) => {
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d <= tol) pairs.push({ i, j, d });
  }));
  pairs.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
  const usedI = new Set<number>(), usedJ = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const p of pairs) {
    if (usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i); usedJ.add(p.j); out.push([p.i, p.j]);
  }
  return out;
}

export function demolitionItem(c: DemoClass): string {
  return `Demolition — ${c.label}`;
}

type Geom = NonNullable<DemoSheetMarks['geometry']>;
const geomOf = (g: Geom) => ({ originX: 0, originY: 0, ...g });
const STILL_THERE = new Set<MarkStatus | undefined>(['existing', 'relocated']);
const FIXTURE_CLASSES = new Set(['DEMO-FIXTURE', 'DEMO-HIGHBAY', 'DEMO-EXIT', 'DEMO-EXTERIOR', 'DEMO-SITE-POLE']);
const EQUIPMENT_CLASSES = new Set(['DEMO-EQUIPMENT', 'DEMO-JBOX']);

/** Decision 5 — a note saying equipment is reused / existing to remain. */
export const REUSE_RE = /\b(re-?use[ds]?|reusing|existing\s+to\s+remain|to\s+remain|remains?\s+in\s+place|E\.?T\.?R\.?)\b/i;
const EQUIPMENT_NOUNS: Array<[string, RegExp]> = [
  ['panel', /\bpanel(?:board)?s?\b|\bMLO\b|\bMCB\b/i],
  ['disconnect', /\bdisconnects?\b|\bdisc\b|\bsafety\s+switch(?:es)?\b/i],
  ['switchboard', /\bswitchboards?\b|\bswitchgear\b/i],
  ['transformer', /\btransformers?\b|\bxfmr\b/i],
  ['meter', /\bmeters?\b/i],
  ['wireway', /\bwireways?\b|\bgutters?\b/i],
  ['jbox', /\bj-?box(?:es)?\b|\bjunction\s+box(?:es)?\b/i],
];

/** Coordinator follow-up — a hedged note ("reuse scope unclear", "verify if
 *  the panel can be reused", "TBD") is not evidence: it never answers the
 *  question, it is shown with it as context. */
export const HEDGE_RE = /\b(unclear|unknown|verify|verified|confirm|if|may|might|TBD|possibly|perhaps|whether)\b|\bfield[\s-]+verify\b|\bor\b[^.]*\?|\?/i;
/** Review B2 — a negation (it cancels a reuse clause) and a removal (it
 *  cancels on its own: "Remove existing panel"). */
export const NOT_RE = /\b(not|no|never|none|don'?t|do\s+not|shall\s+not|cannot|can'?t|won'?t|not\s+permitted)\b|n't\b/i;
export const REMOVE_RE = /\b(remove[ds]?|removal|removing|demolish(?:ed|ing)?|demolition|demo|replace[ds]?|replacing|replacement|relocate[ds]?|abandon(?:ed)?)\b/i;

/** Review B2 — clauses: sentences and ";" parts, and a comma part that
 *  starts a new action ("… - do not reuse, remove and replace"). */
export function noteClauses(note: string): string[] {
  return note.split(/[;.!?\n]+|,(?=\s*(?:and\s+|but\s+|then\s+)?(?:re-?use|remove|demolish|replace|relocate|provide|install|retain|keep|abandon)\b)/i)
    .map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

type KindTags = Map<string, Set<string>>;
const TAG_STOPWORDS = new Set(['TO', 'IN', 'ON', 'OF', 'AT', 'IS', 'BE', 'AS', 'BY', 'OR', 'NO', 'AND', 'THE', 'FOR', 'ARE', 'MLO', 'MCB', 'SUB', 'NEW', 'ALL', 'PER', 'SEE', 'WAS', 'NOT', 'MAY', 'CAN']);
/** The equipment kinds a clause names, each with the tags it names
 *  ("Panels A & B" → panel {A, B}; "panel" → panel {}). */
function kindsIn(clause: string): KindTags {
  const out: KindTags = new Map();
  for (const [k, re] of EQUIPMENT_NOUNS) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(clause))) {
      const tags = out.get(k) ?? new Set<string>();
      const after = clause.slice(m.index + m[0].length);
      // Re-check N2 — a tag may be quoted or parenthesized ("A", (A), 'A')
      // and hyphenated (LP-1); plain words are never tags.
      const TAG = `["'(\u201C\u2018]?(?:[A-Z]{1,3}(?:-?\\d{1,3})?|\\d{1,2}[A-Z]?)["')\u201D\u2019]?(?![A-Za-z0-9])`;
      const tm = new RegExp(`^[\\s-]*(${TAG}(?:\\s*(?:,|&|and|AND)\\s*${TAG})*)`).exec(after);
      if (tm) {
        for (const raw of tm[1].split(/\s*(?:,|&|\band\b|\bAND\b)\s*/)) {
          const x = raw.replace(/["'()\u201C\u201D\u2018\u2019]/g, '').toUpperCase();
          if (x && !TAG_STOPWORDS.has(x) && !/^\d{2,}$/.test(x)) tags.add(x);
        }
      }
      out.set(k, tags);
    }
  }
  return out;
}

/** An equipment type's kinds and its own tag ("PANEL A" → panel / A;
 *  "DISC-A" → disconnect / A; "Electrical panel" → panel / none). */
export function equipmentKindOf(t: Pick<CountTarget, 'type' | 'description'> | undefined, typeKey: string): { kinds: string[]; tag: string | null } {
  // The type's OWN identity: its name, else the head of its description —
  // never a reference in it ("A/C Comp Unit #1, Panel A ckts 15,17" is not
  // a panel).
  const name = `${t?.type ?? typeKey}`;
  const head = (t?.description ?? '').split(/,|;|\s[-–—]\s|\(|\bfed\b|\bfrom\b|\bckts?\b|\bcircuits?\b/i)[0];
  const kindsOf = (x: string) => EQUIPMENT_NOUNS.filter(([, re]) => re.test(x)).map(([k]) => k);
  const kinds = kindsOf(name).length ? kindsOf(name) : kindsOf(head);
  let tag: string | null = null;
  for (const [k, ts] of kindsIn(`${t?.type ?? typeKey}`)) if (kinds.includes(k) && ts.size === 1) tag = [...ts][0];
  return { kinds, tag };
}

/** Review B2 — the reuse evidence for one equipment type, clause by clause:
 *  a clause is RELEVANT when it names the same kind and (for a tagged type)
 *  its tag or no tag; an untagged type treats every clause naming its kind
 *  as relevant. Evidence = a relevant clause saying reuse / to remain with no
 *  negation, removal or hedge. ANY relevant clause that negates, removes or
 *  hedges cancels it (the question stays; hedges and cancels are context). */
export function reuseEvidenceFor(t: Pick<CountTarget, 'type' | 'description'> | undefined, typeKey: string, notes: string[]): { quote: string | null; quotes: string[]; context: string[] } {
  const { kinds, tag } = equipmentKindOf(t, typeKey);
  if (!kinds.length) return { quote: null, quotes: [], context: [] };
  let quote: string | null = null;
  const all: string[] = [];
  const context: string[] = [];
  let cancel = false;
  for (const note of notes) {
    for (const cl of noteClauses(note)) {
      const named = kindsIn(cl);
      const relevant = kinds.some(k => named.has(k) && (!tag || named.get(k)!.size === 0 || named.get(k)!.has(tag)));
      if (!relevant) continue;
      const reuse = REUSE_RE.test(cl);
      if (REMOVE_RE.test(cl) || (reuse && (NOT_RE.test(cl) || HEDGE_RE.test(cl)))) {
        cancel = true;
        context.push(cl.slice(0, 160));
        continue;
      }
      if (reuse) { if (!quote) quote = cl.slice(0, 160); all.push(cl.slice(0, 160)); }
    }
  }
  return { quote: cancel ? null : quote, quotes: cancel ? [] : [...new Set(all)].slice(0, 4), context: [...new Set(cancel && quote ? [quote, ...context] : context)].slice(0, 3) };
}

/** Decision 5 / review B2 — the reuse quote for this equipment, or null. */
export function reuseQuoteFor(t: Pick<CountTarget, 'type' | 'description'> | undefined, typeKey: string, notes: string[]): string | null {
  return reuseEvidenceFor(t, typeKey, notes).quote;
}

/** The notes that keep the question (hedged / negated), as context. */
export function hedgedReuseNotesFor(t: Pick<CountTarget, 'type' | 'description'> | undefined, typeKey: string, notes: string[]): string[] {
  return reuseEvidenceFor(t, typeKey, notes).context;
}

/** Review B2 — a note worth reading for reuse evidence: it names equipment. */
export function isEquipmentNote(n: string): boolean {
  return EQUIPMENT_NOUNS.some(([, re]) => re.test(n));
}

/** Review B3 — registration thresholds (paper inches / fractions). */
export const REG_VOTE_TOL_IN = 0.3;
export const REG_MAX_OFFSET_IN = 3;
export const REG_PAIR_TOL_IN = 0.5;
/** Mean distance of the paired marks after the offset is refined. */
export const REG_MAX_RESIDUAL_IN = 0.15;
/** A second offset (another grid period) or a mirror scoring this close to
 *  the best is ambiguous: never registered. */
export const REG_AMBIGUITY_FRAC = 0.9;
/** Of a class's demolition marks, the share that must pair with the plan's
 *  marks of that class (any status) for the class to be compared. */
export const REG_CLASS_MATCH_FRAC = 0.6;

type P = { x: number; y: number };
function voteOffsets(A: Map<string, P[]>, B: Map<string, P[]>): Array<{ off: P; votes: number }> {
  const cands: P[] = [];
  for (const [c, as] of A) for (const a of as) for (const b of B.get(c) ?? []) {
    const off = { x: a.x - b.x, y: a.y - b.y };
    if (Math.hypot(off.x, off.y) <= REG_MAX_OFFSET_IN) cands.push(off);
  }
  const scored = cands.map(off => {
    let votes = 0;
    for (const [c, as] of A) votes += pairUp(as, (B.get(c) ?? []).map(q => ({ x: q.x + off.x, y: q.y + off.y })), REG_VOTE_TOL_IN).length;
    return { off, votes };
  });
  return scored.sort((a, b) => b.votes - a.votes);
}

/** Price accuracy D3 / review B3 — the new-work plan a demolition sheet
 *  registers with. Its shared marks (by removal class) vote for ONE
 *  translation, and the registration is rejected when:
 *    - fewer than 3 marks agree;
 *    - another offset at least one grid period away scores nearly as well
 *      (a regular layout aliases onto itself);
 *    - the plan mirrored left-right or top-bottom fits nearly as well (a
 *      mirror / reflection);
 *    - the mean residual of the paired marks is over REG_MAX_RESIDUAL_IN.
 *  The caller passes only plans on the same level / area. null = none. */
export function registerDemolitionSheet(
  demo: Pick<DemoSheetMarks, 'key' | 'label' | 'geometry'> & { marks: Array<{ classKey: string; x: number; y: number }> },
  plans: Array<Pick<NewPlanMarks, 'key' | 'label' | 'geometry'> & { marks: Array<{ classKey: string; x: number; y: number }> }>,
): { plan: string; al: Alignment; paired: number; rejected?: string } | null {
  if (!demo.geometry) return null;
  const byClass = (ms: Array<{ classKey: string; x: number; y: number }>, g: Geom, f: (p: P) => P = p => p) => {
    const m = new Map<string, P[]>();
    for (const k of ms) { const p = f(pdfToDisplayedIn(k.x, k.y, geomOf(g))); if (!m.has(k.classKey)) m.set(k.classKey, []); m.get(k.classKey)!.push(p); }
    return m;
  };
  const A = byClass(demo.marks, demo.geometry);
  let best: { plan: string; al: Alignment; paired: number } | null = null;
  for (const p of plans) {
    if (!p.geometry) continue;
    const W = displayedWidthIn(p.geometry), H = displayedHeightIn(p.geometry);
    const B = byClass(p.marks, p.geometry);
    const votes = voteOffsets(A, B);
    const top = votes[0];
    // At least 3 marks, and at least half of the marks the two sheets could
    // share (the sheet-pair vote's own bar).
    const sharedMin = [...A].reduce((n, [c, as]) => n + Math.min(as.length, B.get(c)?.length ?? 0), 0);
    if (!top || top.votes < 3 || top.votes < sharedMin / 2) continue;
    const second = votes.find(v => Math.hypot(v.off.x - top.off.x, v.off.y - top.off.y) > 2 * REG_VOTE_TOL_IN);
    if (second && second.votes >= REG_AMBIGUITY_FRAC * top.votes) continue; // grid aliasing
    const mirrorX = voteOffsets(A, byClass(p.marks, p.geometry, q => ({ x: W - q.x, y: q.y })))[0];
    const mirrorY = voteOffsets(A, byClass(p.marks, p.geometry, q => ({ x: q.x, y: H - q.y })))[0];
    if (Math.max(mirrorX?.votes ?? 0, mirrorY?.votes ?? 0) >= REG_AMBIGUITY_FRAC * top.votes) continue; // mirror / reflection
    // Refine the offset on the pairs, then check the residual.
    const pairs: Array<[P, P]> = [];
    for (const [c, as] of A) {
      const bs = (B.get(c) ?? []).map(q => ({ x: q.x + top.off.x, y: q.y + top.off.y }));
      for (const [i, j] of pairUp(as, bs, REG_VOTE_TOL_IN)) pairs.push([as[i], (B.get(c) ?? [])[j]]);
    }
    const off = { x: pairs.reduce((a, [u, v]) => a + u.x - v.x, 0) / pairs.length, y: pairs.reduce((a, [u, v]) => a + u.y - v.y, 0) / pairs.length };
    const residual = pairs.reduce((a, [u, v]) => a + Math.hypot(u.x - v.x - off.x, u.y - v.y - off.y), 0) / pairs.length;
    if (residual > REG_MAX_RESIDUAL_IN) continue;
    if (!best || pairs.length > best.paired) {
      best = {
        plan: p.key, paired: pairs.length,
        al: { kind: 'marks', tol: REG_PAIR_TOL_IN, note: `${pairs.length} shared marks agree on an offset of ${off.x.toFixed(2)}", ${off.y.toFixed(2)}" (mean residual ${residual.toFixed(2)}"; no other offset or mirror fits)`, map: q => ({ x: q.x + off.x, y: q.y + off.y }) },
      };
    }
  }
  return best;
}

function displayedWidthIn(g: Geom): number { const r = ((g.rotation % 360) + 360) % 360; return (r === 90 || r === 270 ? g.heightPt : g.widthPt) / 72; }
function displayedHeightIn(g: Geom): number { const r = ((g.rotation % 360) + 360) % 360; return (r === 90 || r === 270 ? g.widthPt : g.heightPt) / 72; }

/** Review B3 — a demolition sheet may only be compared with a new-work plan
 *  of the same level / area. A sheet whose level is not stated is compared
 *  when the job names at most one level. */
export function sameLevel(a: { level?: string; area?: string }, b: { level?: string; area?: string }, jobLevels: number, planLevels: Set<string> = new Set()): boolean {
  if (a.area && b.area && a.area !== b.area) return false;
  if (a.level && b.level) return a.level === b.level;
  // Final check R2 — an UNLABELLED sheet pairs with a LABELLED one only when
  // that level is the ground / first / main level AND no new-work plan of
  // any other level is on the job ("FLOOR PLAN" vs "SECOND FLOOR PLAN" or
  // "MEZZANINE" never pairs automatically; the arithmetic is asked).
  // Final check R3 — AND every stated level on the job, demolition sheets
  // included, is that same level (jobLevels <= 1).
  const known = a.level || b.level;
  if (known) return GROUND_LEVELS.has(known) && jobLevels <= 1 && [...planLevels].every(l => l === known);
  // Both unlabelled: when the job names at most one level (re-check N1).
  return jobLevels <= 1;
}

const GROUND_LEVELS = new Set(['1', 'G', 'GROUND', 'MAIN', 'FIRST']);

export function buildDemolition(sheets: DemoSheetMarks[], targets: CountTarget[], newPlans: NewPlanMarks[] = [], reuseNotes: string[] = []): DemolitionResult {
  const tByKey = new Map(targets.map(t => [t.key, t]));
  const classOf = (k: string): DemoClass => {
    const t = tByKey.get(k);
    return t ? demoClassOf(t) : (CLASS_BY_KEY.get(k) ?? CLASS_BY_KEY.get('DEMO-DEVICE')!);
  };
  const marks = sheets.flatMap(s => s.marks.map(m => ({ sheetKey: s.key, typeKey: m.typeKey, classKey: classOf(m.typeKey).key, x: m.x, y: m.y, ...(m.marked ? { marked: true } : {}) })));
  const lines: DemolitionLine[] = [];
  const questions: DemolitionQuestion[] = [];
  const comparisons: DemolitionComparison[] = [];
  const reused: DemolitionReuse[] = [];
  const suggestions: DemolitionSuggestion[] = [];
  // D3 — each whole demolition sheet's registered new-work plan (if any).
  const planMarks = newPlans.map(p => ({ ...p, marks: p.marks.map(m => ({ ...m, classKey: classOf(m.typeKey).key })) }));
  const jobLevels = new Set([...sheets, ...newPlans].map(x => x.level ?? '').filter(Boolean)).size;
  const planLevels = new Set(newPlans.map(p => p.level ?? '').filter(Boolean));
  const plansFor = (s: DemoSheetMarks) => planMarks.filter(p => sameLevel(s, p, jobLevels, planLevels));
  const registered = new Map<string, ReturnType<typeof registerDemolitionSheet>>();
  const regOf = (s: DemoSheetMarks) => {
    if (!registered.has(s.key)) registered.set(s.key, s.demolition && plansFor(s).length ? registerDemolitionSheet({ ...s, marks: marks.filter(m => m.sheetKey === s.key) }, plansFor(s)) : null);
    return registered.get(s.key)!;
  };
  // Fix round S2 — two sheets are REGISTERED (their drawings line up) only
  // when they are the same size AND their shared-class marks actually pair
  // up (at least 2 pairs, 60% of the smaller side), like the sheet-pair
  // logic aligns plans by their marks. Only registered sheets are
  // de-duplicated by position; otherwise a class on both is a question.
  const regKey = (a: string, b: string) => [a, b].sort().join('|');
  const registration = new Map<string, boolean>();
  for (const [i, sa] of sheets.entries()) {
    for (const sb of sheets.slice(i + 1)) {
      let paired = 0, base = 0;
      if (sameGeometry(sa.geometry, sb.geometry)) {
        for (const c of DEMO_CLASSES) {
          const A = marks.filter(m => m.sheetKey === sa.key && m.classKey === c.key);
          const B = marks.filter(m => m.sheetKey === sb.key && m.classKey === c.key);
          if (!A.length || !B.length) continue;
          paired += pairUp(A, B).length;
          base += Math.min(A.length, B.length);
        }
      }
      registration.set(regKey(sa.key, sb.key), base > 0 && paired >= 2 && paired / base >= 0.6);
    }
  }
  const isRegistered = (a: string, b: string) => registration.get(regKey(a, b)) === true;
  for (const c of DEMO_CLASSES) {
    const mine = marks.filter(m => m.classKey === c.key);
    if (!mine.length) continue;
    // Per sheet, then same-size sheets de-duplicated by position (nearest
    // first, one-to-one); the first sheet in order keeps its marks.
    const perSheet = sheets.map(s => ({ s, marks: mine.filter(m => m.sheetKey === s.key) })).filter(x => x.marks.length);
    const kept = new Map<string, typeof mine>();
    let deduped = 0;
    for (const cur of perSheet) {
      let own = cur.marks.slice();
      for (const [prevKey, prevMarks] of kept) {
        if (!isRegistered(prevKey, cur.s.key)) continue;
        const usedI = new Set(pairUp(own, prevMarks).map(([i]) => i));
        deduped += usedI.size;
        own = own.filter((_, i) => !usedI.has(i));
      }
      kept.set(cur.s.key, own);
    }
    // D3 — demolition by comparison: on a whole demolition sheet (which
    // shows ALL existing work), an item still drawn as EXISTING / RELOCATED
    // at the same place on its registered new-work plan is not removed; one
    // marked for removal on the demolition sheet always is. A new-work plan
    // that shows no existing item of the class changes nothing (a new
    // lighting plan replacing every fixture: every fixture is removed).
    const remain: NonNullable<DemolitionLine['remain']> = [];
    let replacedIn = 0;
    let reusedIn = 0;
    const failed: Array<{ label: string; own: number; marked: number; plans: string[]; why: string }> = [];
    for (const x of perSheet) {
      if (!x.s.demolition || !x.s.geometry) continue;
      const own = kept.get(x.s.key)!;
      const marked = own.filter(m => m.marked).length;
      const shown = own.map((m, i) => ({ m, i })).filter(o => !o.m.marked);
      const reg0 = regOf(x.s);
      // Review B3 — the class is compared only when most of its demolition
      // marks (60%) pair with the plan's marks of the class (any status).
      const classOk = (r: NonNullable<typeof reg0>) => {
        const pl = planMarks.find(p => p.key === r.plan)!;
        const all = pl.marks.filter(m => m.classKey === c.key).map(m => r.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(pl.geometry!))));
        return all.length > 0 && pairUp(own.map(m => pdfToDisplayedIn(m.x, m.y, geomOf(x.s.geometry!))), all, r.al.tol).length >= REG_CLASS_MATCH_FRAC * own.length;
      };
      const reg = reg0 && classOk(reg0) ? reg0 : null;
      if (reg) {
        const plan = planMarks.find(p => p.key === reg.plan)!;
        // Review S2 — only CONFIDENT statuses lower demolition; an uncertain
        // "existing" at the same place is asked (blocking), never subtracted.
        const ex = plan.marks.filter(m => m.classKey === c.key && STILL_THERE.has(m.status) && !m.uncertain);
        const exU = plan.marks.filter(m => m.classKey === c.key && STILL_THERE.has(m.status) && m.uncertain);
        if (!ex.length && !exU.length) {
          // The plan draws this class with NO status (no rule on it covers
          // it — D1): an item at the same place may stay or be replaced.
          // Asked, never lowered silently; fixtures keep today's behaviour
          // (a new lighting plan replaces the fixtures).
          const same = plan.marks.filter(m => m.classKey === c.key);
          if (FIXTURE_CLASSES.has(c.key) || !same.length || same.some(m => m.status) || !shown.length) continue;
          const pairedIdx = pairUp(shown.map(o => pdfToDisplayedIn(o.m.x, o.m.y, geomOf(x.s.geometry!))), same.map(m => reg.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(plan.geometry!)))), reg.al.tol).map(([i]) => shown[i]);
          if (!pairedIdx.length) continue;
          // Decision 5 — equipment / panels drawn at the same place that
          // the analysis or the plans say are reused / existing to remain:
          // 0 demolition for them (non-blocking, with the quote).
          const reusedIdx = EQUIPMENT_CLASSES.has(c.key)
            ? pairedIdx.map(o => ({ o, ...(() => { const e = reuseEvidenceFor(tByKey.get(o.m.typeKey), o.m.typeKey, reuseNotes); return { quote: e.quote, all: e.quotes }; })() })).filter(r => r.quote)
            : [];
          if (reusedIdx.length) {
            const drop = new Set(reusedIdx.map(r => r.o.i));
            kept.set(x.s.key, own.filter((_, i) => !drop.has(i)));
            const byType = new Map<string, number>();
            for (const r of reusedIdx) byType.set(r.o.m.typeKey, (byType.get(r.o.m.typeKey) ?? 0) + 1);
            reused.push({
              classKey: c.key, item: demolitionItem(c), sheetKey: x.s.key, label: x.s.label, planLabel: plan.label, count: reusedIdx.length,
              byType: [...byType.entries()].map(([typeKey, count]) => ({ typeKey, type: tByKey.get(typeKey)?.type ?? typeKey, count })),
              quotes: [...new Set(reusedIdx.flatMap(r => r.all))].slice(0, 4), alignment: reg.al.note,
            });
            reusedIn += reusedIdx.length;
          }
          const paired = pairedIdx.length - reusedIdx.length;
          if (!paired) continue;
          const left = own.length - reusedIdx.length;
          const context = EQUIPMENT_CLASSES.has(c.key)
            ? [...new Set(pairedIdx.flatMap(o => hedgedReuseNotesFor(tByKey.get(o.m.typeKey), o.m.typeKey, reuseNotes)))].slice(0, 3)
            : [];
          suggestions.push({
            classKey: c.key, item: demolitionItem(c), sheets: [{ label: x.s.label, count: left }], demoCount: left, marked,
            existing: [{ label: plan.label, count: paired }], suggested: left - paired, unstated: true,
            ...(context.length ? { context } : {}),
            why: `${plan.label} draws ${paired} of them at the same place without saying whether they are new or existing (${reg.al.note})`,
          });
          continue;
        }
        const pairs = ex.length ? pairUp(shown.map(o => pdfToDisplayedIn(o.m.x, o.m.y, geomOf(x.s.geometry!))), ex.map(m => reg.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(plan.geometry!)))), reg.al.tol) : [];
        const gone = new Set(pairs.map(([i]) => shown[i].i));
        if (exU.length) {
          const rest = shown.filter(o => !gone.has(o.i));
          const nU = pairUp(rest.map(o => pdfToDisplayedIn(o.m.x, o.m.y, geomOf(x.s.geometry!))), exU.map(m => reg.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(plan.geometry!)))), reg.al.tol).length;
          if (nU) {
            suggestions.push({
              classKey: c.key, item: demolitionItem(c), sheets: [{ label: x.s.label, count: own.length - gone.size }], demoCount: own.length - gone.size, marked,
              existing: [{ label: plan.label, count: nU }], suggested: own.length - gone.size - nU, unstated: true,
              why: `${plan.label} draws ${nU} of them at the same place as existing, but the close-up check could not confirm that reading (${reg.al.note})`,
            });
          }
        }
        kept.set(x.s.key, own.filter((_, i) => !gone.has(i)));
        // Decision 4 — a NEW device drawn where an old one was: the old one
        // is still removed (APT pays to pull it), and the line says so.
        const left = shown.filter(o => !gone.has(o.i));
        const fresh = plan.marks.filter(m => m.classKey === c.key && m.status && !STILL_THERE.has(m.status) && m.status !== 'demo');
        const replaced = left.length && fresh.length
          ? pairUp(left.map(o => pdfToDisplayedIn(o.m.x, o.m.y, geomOf(x.s.geometry!))), fresh.map(m => reg.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(plan.geometry!)))), reg.al.tol).length
          : 0;
        comparisons.push({
          classKey: c.key, item: demolitionItem(c), sheetKey: x.s.key, label: x.s.label, planKey: plan.key, planLabel: plan.label,
          shown: own.length, marked, remain: gone.size, demo: own.length - gone.size, replaced, alignment: reg.al.note,
        });
        if (gone.size) remain.push({ label: x.s.label, planLabel: plan.label, count: gone.size });
        replacedIn += replaced;
        continue;
      }
      // Not registered: collected per class, subtracted ONCE (review S3).
      // Re-check N1 — no same-level plan at all: the arithmetic still uses
      // every new-work plan and is ASKED (never a silent full count).
      const same = plansFor(x.s);
      failed.push({ label: x.s.label, own: own.length, marked, plans: (same.length ? same : planMarks).map(p => p.key), why: !same.length ? 'no new-work plan is on the same level / area (by the sheet titles), so the plans could not be compared' : reg0 ? `only part of this class lines up with ${planMarks.find(p => p.key === reg0.plan)!.label} (fewer than ${Math.round(REG_CLASS_MATCH_FRAC * 100)}% of its marks)` : newPlans.some(p => p.geometry) ? 'its drawing could not be lined up unambiguously with a new-work plan of the same level (too few shared marks in the same places, another offset or a mirror fits as well, or the residual is too large)' : 'the new-work plans have no page geometry' });
    }
    if (failed.length) {
      const keys = new Set(failed.flatMap(f => f.plans));
      const exOf = (ps: typeof planMarks) => {
        const m = new Map<string, number>();
        for (const p of ps) {
          const n = p.marks.filter(k => k.classKey === c.key && STILL_THERE.has(k.status)).length;
          if (n) m.set(p.label, n);
        }
        return m;
      };
      let exBy = exOf(planMarks.filter(p => keys.has(p.key)));
      // Final check R3 — the compatible plans show none of this class as
      // existing, but another plan does: still ASKED (never a silent count).
      if (!exBy.size) {
        exBy = exOf(planMarks);
        if (exBy.size) for (const f of failed) f.why = `no new-work plan of the same level shows this class as existing; ${[...exBy.keys()].join(', ')} ${exBy.size === 1 ? 'does' : 'do'}, but on another or unstated level`;
      }
      const nEx = [...exBy.values()].reduce((a, b) => a + b, 0);
      if (nEx) {
        const demoCount = failed.reduce((a, f) => a + f.own, 0), markedSum = failed.reduce((a, f) => a + f.marked, 0);
        suggestions.push({
          classKey: c.key, item: demolitionItem(c), sheets: failed.map(f => ({ label: f.label, count: f.own })), demoCount, marked: markedSum,
          existing: [...exBy.entries()].map(([label, count]) => ({ label, count })),
          suggested: markedSum + Math.max(0, demoCount - markedSum - nEx),
          why: failed[0].why,
        });
      }
    }
    const sheetCounts = perSheet.map(x => ({ sheetKey: x.s.key, label: x.s.label, count: kept.get(x.s.key)!.length })).filter(x => x.count > 0);
    const qty = sheetCounts.reduce((n, x) => n + x.count, 0);
    const byType = new Map<string, number>();
    for (const m of [...kept.values()].flat()) byType.set(m.typeKey, (byType.get(m.typeKey) ?? 0) + 1);
    lines.push({
      classKey: c.key, item: demolitionItem(c), qty, sheets: sheetCounts,
      byType: [...byType.entries()].map(([typeKey, count]) => ({ typeKey, type: tByKey.get(typeKey)?.type ?? typeKey, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      dedupedAcross: deduped,
      ...(remain.length ? { remain } : {}),
      ...(replacedIn ? { replaced: replacedIn } : {}),
      ...(reusedIn ? { reused: reusedIn } : {}),
    });
    // Two sheets that are not registered both show this class: the same
    // items twice, or more? Asked — never a silent double count.
    const incomparable = sheetCounts.filter((a, i) => sheetCounts.some((b, j) => j !== i && !isRegistered(a.sheetKey, b.sheetKey)));
    if (incomparable.length >= 2) {
      questions.push({
        classKey: c.key, item: demolitionItem(c), sheets: sheetCounts.map(x => ({ label: x.label, count: x.count })),
        keep: Math.max(...sheetCounts.map(x => x.count)), sum: qty,
      });
    }
  }
  return { lines, questions, marks, ...(comparisons.length ? { comparisons } : {}), ...(suggestions.length ? { suggestions } : {}), ...(reused.length ? { reused } : {}) };
}

/** Demolition lines as drawing-analysis quantity rows (Agent 2 copies
 *  counted rows exactly; the pricing side maps the Demolition category). */
export function demolitionRows(result: DemolitionResult): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = result.lines.filter(l => PRICED_DEMO_CLASSES.has(l.classKey)).map(l => ({
    category: DEMOLITION_CATEGORY,
    item: l.item,
    qty: l.qty,
    unit: 'EA',
    sourceSheet: [...new Set(l.sheets.map(s => s.label.split(' ')[0]))].join(', '),
    confidence: 'ASSUMED',
    countedBy: 'counter',
    countType: l.classKey,
    spec: `Existing to be removed — counted ${l.sheets.map(s => `${s.label.split(' ')[0]} ${s.count}`).join(', ')} (${l.byType.map(b => `${b.type} ${b.count}`).join(', ')})${l.dedupedAcross ? `; ${l.dedupedAcross} shown on two sheets counted once` : ''}${(l.remain ?? []).map(r => `; ${r.count} more on ${r.label.split(' ')[0]} still shown as existing on ${r.planLabel.split(' ')[0]} — not removed`).join('')}${l.replaced ? `; includes ${l.replaced} device${l.replaced === 1 ? '' : 's'} replaced in place` : ''}${l.reused ? `; ${l.reused} more noted for reuse are on their own line (new install or existing reused?)` : ''}`,
  }));
  // Coordinator follow-up — equipment noted for reuse is its OWN demolition
  // row (never dropped): ONE question per equipment item sets both this row
  // and the install line. countType = "<class>/<type>".
  for (const g of reusedGroups(result)) {
    if (!PRICED_DEMO_CLASSES.has(g.classKey)) continue;
    rows.push({
      category: DEMOLITION_CATEGORY, item: g.item, qty: g.count, unit: 'EA',
      sourceSheet: g.sheets.join(', '), confidence: 'ASSUMED', countedBy: 'counter', countType: g.rowKey,
      spec: `${g.type} ${g.count} — noted for reuse ("${g.quotes[0] ?? ''}"); counted as removed until answered: new install or existing reused?`,
    });
  }
  return rows;
}

/** The reused-equipment demolition rows: one per (class, equipment type). */
export function reusedGroups(result: DemolitionResult): Array<{ classKey: string; typeKey: string; type: string; item: string; rowKey: string; count: number; sheets: string[]; quotes: string[] }> {
  const by = new Map<string, { classKey: string; typeKey: string; type: string; item: string; rowKey: string; count: number; sheets: string[]; quotes: string[] }>();
  for (const r of result.reused ?? []) for (const b of r.byType) {
    const rowKey = `${r.classKey}/${b.typeKey}`;
    const g = by.get(rowKey) ?? { classKey: r.classKey, typeKey: b.typeKey, type: b.type, item: r.item, rowKey, count: 0, sheets: [], quotes: [] };
    g.count += b.count;
    g.sheets = [...new Set([...g.sheets, r.label.split(' ')[0]])];
    g.quotes = [...new Set([...g.quotes, ...r.quotes])];
    by.set(rowKey, g);
  }
  return [...by.values()];
}
