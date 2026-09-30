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
import { alignSheets, type Alignment, type RelationSheet } from '../evidence/sheetRelation';
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

/** Fix round S8 — the classes with a seeded demolition labor unit (Builder
 *  B's DEMOLITION_ITEMS, names matched exactly). Every other class never
 *  becomes a takeoff line on its own (it would fuzzy-map to a WRONG unit):
 *  it is a blocking review item — the estimator enters the count to add it
 *  as a Demolition line, or marks it not on this job. */
export const PRICED_DEMO_CLASSES = new Set(['DEMO-FIXTURE', 'DEMO-HIGHBAY', 'DEMO-EXIT', 'DEMO-RECEPTACLE', 'DEMO-SWITCH', 'DEMO-SWITCH3', 'DEMO-JBOX']);

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
}

/** Price accuracy D3 — a counted NEW-WORK plan: every mark on it, with its
 *  status (existing / relocated = still there after the work). */
export interface NewPlanMarks {
  key: string;
  label: string;
  geometry: { widthPt: number; heightPt: number; rotation: number; originX?: number; originY?: number } | null;
  marks: Array<{ typeKey: string; x: number; y: number; status?: MarkStatus }>;
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
}

export interface DemolitionQuestion {
  classKey: string;
  item: string;
  sheets: Array<{ label: string; count: number }>;
  keep: number;
  sum: number;
}

export interface DemolitionResult {
  lines: DemolitionLine[];
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

/** Price accuracy D3 — the new-work plan a demolition sheet registers with:
 *  the plans are aligned by their shared marks (the sheet-pair logic's mark
 *  vote, by removal class), and the plan whose marks pair up best wins.
 *  A bare same-size frame is NOT a registration. null = none. */
export function registerDemolitionSheet(
  demo: Pick<DemoSheetMarks, 'key' | 'label' | 'geometry'> & { marks: Array<{ classKey: string; x: number; y: number }> },
  plans: Array<Pick<NewPlanMarks, 'key' | 'label' | 'geometry'> & { marks: Array<{ classKey: string; x: number; y: number }> }>,
): { plan: string; al: Alignment; paired: number } | null {
  if (!demo.geometry) return null;
  const rel = (s: { key: string; label: string; geometry: Geom | null; marks: Array<{ classKey: string; x: number; y: number }> }): RelationSheet => ({
    key: s.key, label: s.label, geometry: s.geometry ? geomOf(s.geometry) : null, viewports: null,
    marks: s.marks.map(m => ({ typeKey: m.classKey, x: m.x, y: m.y })),
  });
  const a = rel(demo);
  let best: { plan: string; al: Alignment; paired: number } | null = null;
  for (const p of plans) {
    if (!p.geometry) continue;
    const al = alignSheets(a, rel(p));
    if (!al || al.kind !== 'marks') continue;
    let paired = 0;
    for (const c of new Set(demo.marks.map(m => m.classKey))) {
      const A = demo.marks.filter(m => m.classKey === c).map(m => pdfToDisplayedIn(m.x, m.y, geomOf(demo.geometry!)));
      const B = p.marks.filter(m => m.classKey === c).map(m => al.map(pdfToDisplayedIn(m.x, m.y, geomOf(p.geometry!))));
      paired += pairUp(A, B, al.tol).length;
    }
    if (paired >= 3 && (!best || paired > best.paired)) best = { plan: p.key, al, paired };
  }
  return best;
}

export function buildDemolition(sheets: DemoSheetMarks[], targets: CountTarget[], newPlans: NewPlanMarks[] = []): DemolitionResult {
  const tByKey = new Map(targets.map(t => [t.key, t]));
  const classOf = (k: string): DemoClass => {
    const t = tByKey.get(k);
    return t ? demoClassOf(t) : (CLASS_BY_KEY.get(k) ?? CLASS_BY_KEY.get('DEMO-DEVICE')!);
  };
  const marks = sheets.flatMap(s => s.marks.map(m => ({ sheetKey: s.key, typeKey: m.typeKey, classKey: classOf(m.typeKey).key, x: m.x, y: m.y, ...(m.marked ? { marked: true } : {}) })));
  const lines: DemolitionLine[] = [];
  const questions: DemolitionQuestion[] = [];
  const comparisons: DemolitionComparison[] = [];
  const suggestions: DemolitionSuggestion[] = [];
  // D3 — each whole demolition sheet's registered new-work plan (if any).
  const planMarks = newPlans.map(p => ({ ...p, marks: p.marks.map(m => ({ ...m, classKey: classOf(m.typeKey).key })) }));
  const registered = new Map<string, ReturnType<typeof registerDemolitionSheet>>();
  const regOf = (s: DemoSheetMarks) => {
    if (!registered.has(s.key)) registered.set(s.key, s.demolition && planMarks.length ? registerDemolitionSheet({ ...s, marks: marks.filter(m => m.sheetKey === s.key) }, planMarks) : null);
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
    for (const x of perSheet) {
      if (!x.s.demolition || !x.s.geometry) continue;
      const own = kept.get(x.s.key)!;
      const marked = own.filter(m => m.marked).length;
      const shown = own.map((m, i) => ({ m, i })).filter(o => !o.m.marked);
      const reg = regOf(x.s);
      if (reg) {
        const plan = planMarks.find(p => p.key === reg.plan)!;
        const ex = plan.marks.filter(m => m.classKey === c.key && STILL_THERE.has(m.status));
        if (!ex.length) continue;
        const pairs = pairUp(shown.map(o => pdfToDisplayedIn(o.m.x, o.m.y, geomOf(x.s.geometry!))), ex.map(m => reg.al.map(pdfToDisplayedIn(m.x, m.y, geomOf(plan.geometry!)))), reg.al.tol);
        const gone = new Set(pairs.map(([i]) => shown[i].i));
        kept.set(x.s.key, own.filter((_, i) => !gone.has(i)));
        comparisons.push({
          classKey: c.key, item: demolitionItem(c), sheetKey: x.s.key, label: x.s.label, planKey: plan.key, planLabel: plan.label,
          shown: own.length, marked, remain: gone.size, demo: own.length - gone.size, alignment: reg.al.note,
        });
        if (gone.size) remain.push({ label: x.s.label, planLabel: plan.label, count: gone.size });
        continue;
      }
      const ex = planMarks.flatMap(p => p.marks.filter(m => m.classKey === c.key && STILL_THERE.has(m.status)).map(() => p.label));
      if (!ex.length) continue;
      const exBy = new Map<string, number>();
      for (const l of ex) exBy.set(l, (exBy.get(l) ?? 0) + 1);
      suggestions.push({
        classKey: c.key, item: demolitionItem(c), sheets: [{ label: x.s.label, count: own.length }], demoCount: own.length, marked,
        existing: [...exBy.entries()].map(([label, count]) => ({ label, count })),
        suggested: marked + Math.max(0, shown.length - ex.length),
        why: newPlans.some(p => p.geometry) ? 'its drawing could not be lined up with the new-work plans (too few shared marks in the same places)' : 'the new-work plans have no page geometry',
      });
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
  return { lines, questions, marks, ...(comparisons.length ? { comparisons } : {}), ...(suggestions.length ? { suggestions } : {}) };
}

/** Demolition lines as drawing-analysis quantity rows (Agent 2 copies
 *  counted rows exactly; the pricing side maps the Demolition category). */
export function demolitionRows(result: DemolitionResult): Record<string, unknown>[] {
  return result.lines.filter(l => PRICED_DEMO_CLASSES.has(l.classKey)).map(l => ({
    category: DEMOLITION_CATEGORY,
    item: l.item,
    qty: l.qty,
    unit: 'EA',
    sourceSheet: [...new Set(l.sheets.map(s => s.label.split(' ')[0]))].join(', '),
    confidence: 'ASSUMED',
    countedBy: 'counter',
    countType: l.classKey,
    spec: `Existing to be removed — counted ${l.sheets.map(s => `${s.label.split(' ')[0]} ${s.count}`).join(', ')} (${l.byType.map(b => `${b.type} ${b.count}`).join(', ')})${l.dedupedAcross ? `; ${l.dedupedAcross} shown on two sheets counted once` : ''}${(l.remain ?? []).map(r => `; ${r.count} more on ${r.label.split(' ')[0]} still shown as existing on ${r.planLabel.split(' ')[0]} — not removed`).join('')}`,
  }));
}
