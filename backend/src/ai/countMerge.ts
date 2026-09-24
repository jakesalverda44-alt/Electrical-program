// Takeoff accuracy, Task 5 — merge the counting stage into the takeoff
// (Decisions 5-7). Pure: no I/O, no AI.
//
// 1. Per type, per sheet: how many de-duplicated marks.
// 2. Cross-sheet rules (Decision 7) — ONE line per type:
//    * photometric / calc / schedule sheets were never counted (countSheets);
//    * site pole types count only on the site sheet; building-mounted
//      exterior and interior types only on the building plan(s) — a count on
//      the wrong kind of sheet is ignored (recorded, never silently);
//    * a lighting type counted on both a lighting plan and a power plan keeps
//      the lighting plan's count (and vice versa for devices);
//    * sheets for DIFFERENT levels are summed; two sheets for the same area
//      keep the larger count and flag it;
//    * an enlarged/partial plan that shows a type also on the main plan is
//      flagged and the larger count kept — never summed.
//    If a category has no sheet of its preferred kind at all (one sheet
//    carries site and building), every counted sheet is allowed for it.
// 3. Poles and heads are separate lines (S1 x2 + S2 x1 = 3 poles; heads from
//    the schedule's heads-per-pole).
// 4. Load cross-check (Decision 5): counted fixture watts vs the panel
//    schedules' lighting circuit loads; > 20% apart is flagged, not blocked.
// 5. Agent 1's own rows for counted types are REPLACED (not summed) by the
//    counted rows; Agent 1 fixture rows that match no scheduled type are
//    removed too (that is where Kissimmee's stacked "4 site lights" came
//    from) and listed so the estimator can see exactly what left the takeoff.
import { isFixtureCategory, normalizeTypeKey, type CountTarget, type TargetCategory } from './countTargets';
import type { CountSheet, SheetRole, SheetFocus } from './countSheets';
import { relateSheets, type SheetRelation } from './evidence/sheetRelation';
import type { SheetGeom, Viewport } from './evidence/viewports';
import type { SheetMarkResolution } from './evidence/viewportResolve';
import { circuitSummaryRows, isCircuitCountRow, type ScheduleCount, type ScheduleTable } from './evidence/schedules';
import { expandTypicals, hostKeyOf, type HostMark, type TypicalExpansion, type TypicalPackage, type UnmappedTypicalDevice } from './evidence/typicals';
import { applyFamilies, applyScheduleLegendEquivalence, applySymbolDefinitions, catalogOf, type FamilyDecision } from './evidence/families';

export interface SheetCountInput {
  sheet: CountSheet;
  status: 'counted' | 'failed';
  error?: string;
  /** Evidence round 1.2 — positions (PDF points) and the viewport each mark
   *  was attributed to, when known. */
  placed: Array<{ typeKey: string; x?: number; y?: number; viewportId?: string | null }>;
  unreadable: Array<{ typeKey: string; tileId: string | null; note: string }>;
  /** Evidence round 1.1 / 1.4 — the sheet's geometry and viewports (the
   *  sheet-pair relationship aligns marks with them). */
  geometry?: SheetGeom | null;
  viewports?: Viewport[] | null;
  /** Evidence round 1.3 — enlarged-plan marks held while "repeats the main
   *  plan or adds devices?" is open (not in `placed`). */
  pendingEnlarged?: SheetMarkResolution['pending'];
}

/** Evidence round 3.3 — 'merged': the same fixture as another type (a
 *  catalog-number family member or a legend symbol's definition); its count
 *  is carried by that type, never stacked. */
export type TypeCountStatus = 'counted' | 'zero' | 'unreadable' | 'merged';

export interface TypeSheetCount {
  sheetKey: string;
  label: string;
  count: number;
  used: boolean;
  /** Why a non-zero count on this sheet was not used. */
  ignoredReason?: string;
  /** Fix round 1 / S15 — the merge would take this type's count from this
   *  sheet (allowed kind of sheet, not the anti-focus plan). Confirmed
   *  markers count toward the type only on eligible sheets. */
  eligible?: boolean;
}

/** Fix round 1 / B4 — two or more sheets of one level show the type and the
 *  titles don't say whether they are the same area or partitions of it. */
export interface AreaQuestion {
  sheets: Array<{ label: string; count: number }>;
  /** The total if they show the same area (larger kept). */
  keep: number;
  /** The total if they are different areas (summed). */
  sum: number;
}

export interface TypeCountResult {
  key: string;
  type: string;
  description: string;
  category: TargetCategory;
  /** Final quantity (poles, for a site pole type). */
  count: number;
  /** Site pole types only: poles x heads-per-pole, or null when the schedule
   *  gives no heads-per-pole (then the heads line needs the estimator). */
  heads: number | null;
  status: TypeCountStatus;
  /** Why the status is zero/unreadable, in the estimator's words. */
  reason: string;
  sheets: TypeSheetCount[];
  flags: string[];
  wattage: number | null;
  /** B4 — blocking: same area or different areas? */
  areaQuestion?: AreaQuestion;
  /** Next round A3/A7 — counted only on a photometric sheet (the fallback). */
  photometricOnly?: boolean;
  /** S3 — blocking: the count covers only part of what should have been
   *  counted (no plan of the right kind, only the power plan for lighting,
   *  only an enlarged or partial plan). */
  coverage?: string[];
  /** Evidence round 1.4 — how same-level sheets were related for this type. */
  relations?: Array<{ sheets: [string, string]; kind: SheetRelation['kind']; reason: string }>;
  /** Evidence round 1.3 — blocking: an enlarged plan whose area on the main
   *  plan is unknown shows this type too. keep = as counted; add = with the
   *  enlarged marks added. */
  viewportQuestion?: { keep: number; add: number; items: Array<{ sheet: string; viewport: string; count: number }> };
  /** Evidence round — where the count comes from. */
  components?: { drawn: number; typical: number; schedule: number };
  /** Evidence round 3.2 — schedule rows that own this quantity. */
  scheduleRows?: Array<{ sheetKey: string; sheetLabel: string; tableId: string; table: string; rowIdx: number; cells: string[]; qty: number }>;
  /** Evidence round 2.2 — typical packages expanded into this type. */
  typical?: Array<{ packageId: string; host: string; hostCount: number | null; perHost: number; drawnAtHosts: number; expanded: number; quote: string }>;
  /** Evidence round 3.3 — for a 'merged' type: the type(s) it is part of. */
  mergedInto?: string;
  mergedCount?: number;
  /** Evidence round 2.2 — a host marker type (multiplier only). */
  host?: boolean;
  /** Evidence round 1.2 — marks of this type not counted as devices
   *  (legend / schedule / notes / detail / repeated in an enlarged plan). */
  excludedMarks?: number;
}

export interface LoadCheck {
  ran: boolean;
  skippedReason?: string;
  countedWatts: number;
  circuitVA: number;
  /** (circuit - counted) / circuit, e.g. 0.35 = counted load is 35% under. */
  gapPct: number | null;
  discrepancy: boolean;
  perPanel: Array<{ panel: string; va: number; circuits: number }>;
  suspectCircuits: Array<{ panel: string; circuit: string; loadVA: number; note: string }>;
}

export interface RemovedRow {
  row: Record<string, unknown>;
  reason: string;
  replacedByType: string | null;
  /** B3 — an Agent 1 fixture row that matches no scheduled type. Removed so
   *  it can't stack on the counted types, but NEVER silently: it becomes a
   *  blocking review item (count it / not on this job). */
  unscheduled?: boolean;
}

export interface CountMergeResult {
  types: TypeCountResult[];
  loadCheck: LoadCheck;
  /** Agent 1 quantities after the merge. */
  quantities: Record<string, unknown>[];
  removedRows: RemovedRow[];
  flags: string[];
}

const LOAD_GAP_THRESHOLD = 0.2;
/** A lighting circuit load under 10 "VA" is almost certainly kVA mis-entered;
 *  it is excluded from the comparison and flagged, never auto-converted. */
const SUSPECT_VA_BELOW = 10;

function preferredRole(c: TargetCategory): SheetRole {
  return c === 'site_lighting' ? 'site' : 'building';
}

/** The sheet focus that is the WRONG place to count a category, if any. */
function antiFocus(c: TargetCategory): SheetFocus | null {
  if (c === 'interior_lighting' || c === 'exterior_building' || c === 'site_lighting' || c === 'lighting_control') return 'power';
  if (c === 'device' || c === 'equipment') return 'lighting';
  return null;
}

const CATEGORY_ROW: Record<TargetCategory, string> = {
  interior_lighting: 'Interior Lighting',
  exterior_building: 'Exterior Site Lighting',
  site_lighting: 'Exterior Site Lighting',
  lighting_control: 'Lighting Controls',
  device: 'Branch Power',
  equipment: 'Branch Power',
  panel_circuit: 'Branch Power',
};

const FIXTURE_ROW_CATEGORIES = new Set(['interior lighting', 'exterior site lighting', 'exterior / site lighting']);
const TYPE_ROW_CATEGORIES = new Set([...FIXTURE_ROW_CATEGORIES, 'lighting controls', 'branch power']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How strongly an Agent 1 quantity row describes this type: 3 = an explicit
 *  tag form ("Type A", "(A)", "A - ...", or a distinctive tag with a digit
 *  like "S1" anywhere), 2 = the schedule description exactly, 1 = one
 *  contains the other (multi-word), 0 = no match. A bare one-letter tag only
 *  matches in an explicit tag form, never as a word. */
export function rowMatchScore(row: Record<string, unknown>, t: CountTarget): number {
  const item = String(row.item ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  const text = `${item} ${String(row.spec ?? '').toUpperCase().replace(/\s+/g, ' ').trim()}`.trim();
  if (!text) return 0;
  const k = escapeRe(t.key);
  const tagForms = [
    new RegExp(`\\bTYPE\\s*[:#-]?\\s*${k}(?![A-Z0-9])`),
    new RegExp(`\\(\\s*${k}\\s*\\)`),
    new RegExp(`^${k}\\s*[-–—:]`),
  ];
  if (t.key.length >= 2 && /\d/.test(t.key)) {
    tagForms.push(new RegExp(`(?:^|[^A-Z0-9-])${k}(?![A-Z0-9])`));
  }
  if (tagForms.some(re => re.test(text))) return 3;
  const desc = t.description.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!desc || desc.split(' ').length < 2) return 0;
  if (item === desc) return 2;
  if (item.length > 6 && (item.includes(desc) || desc.includes(item))) return 1;
  return 0;
}

/** The target this row belongs to (highest score; first on ties), if any. */
export function matchRowToTarget(row: Record<string, unknown>, targets: CountTarget[]): CountTarget | undefined {
  let best: CountTarget | undefined;
  let bestScore = 0;
  for (const t of targets) {
    const sc = rowMatchScore(row, t);
    if (sc > bestScore) { best = t; bestScore = sc; }
  }
  return best;
}

type CombineResult = Pick<TypeCountResult, 'count' | 'sheets' | 'flags' | 'areaQuestion' | 'coverage' | 'photometricOnly' | 'relations'> & { allowedFailed: string[]; unreadableOn: string[] };

export interface CombineOptions {
  /** Evidence round 1.4 — host-marker types are left out of the sheets'
   *  content histograms. */
  isHost?: (typeKey: string) => boolean;
  /** Evidence round 1.4 — decide same-level sheets from their content and
   *  mark placement. Off = the title-only rule (a blocking question). The
   *  whole evidence round is switched by the counting stage's `evidence`
   *  input, so turning it off restores the previous behaviour exactly. */
  relations?: boolean;
}

/** Evidence round 1.4 — the relationship of the sheets in one level group
 *  for this type: complementary only when EVERY pair is, duplicate only when
 *  every pair is; otherwise unclear. Legacy inputs (no positions) are
 *  unclear, which keeps the old blocking question. */
export function relateGroup(
  t: CountTarget,
  group: SheetCountInput[],
  opts: CombineOptions = {},
): { kind: SheetRelation['kind']; pairs: Array<{ sheets: [string, string]; kind: SheetRelation['kind']; reason: string }> } {
  const withPos = (s: SheetCountInput) => !!s.geometry && s.placed.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  const pairs: Array<{ sheets: [string, string]; kind: SheetRelation['kind']; reason: string }> = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (!withPos(a) || !withPos(b)) {
        pairs.push({ sheets: [a.sheet.label, b.sheet.label], kind: 'unclear', reason: 'mark positions are not available' });
        continue;
      }
      const rel = relateSheets(t.key,
        { key: a.sheet.key, label: a.sheet.label, geometry: a.geometry ?? null, viewports: a.viewports ?? null, marks: a.placed.map(p => ({ typeKey: p.typeKey, x: p.x!, y: p.y!, viewportId: p.viewportId ?? null })) },
        { key: b.sheet.key, label: b.sheet.label, geometry: b.geometry ?? null, viewports: b.viewports ?? null, marks: b.placed.map(p => ({ typeKey: p.typeKey, x: p.x!, y: p.y!, viewportId: p.viewportId ?? null })) },
        opts.isHost);
      pairs.push({ sheets: [a.sheet.label, b.sheet.label], kind: rel.kind, reason: rel.reason });
    }
  }
  const kinds = new Set(pairs.map(p => p.kind));
  const kind = kinds.size === 1 ? pairs[0].kind : 'unclear';
  return { kind, pairs };
}

/** Next round A3 — site and building-exterior fixture types only. */
export function isSiteFixtureCategory(c: TargetCategory): boolean {
  return c === 'site_lighting' || c === 'exterior_building';
}

/** Photometric sheets (countSheets `photometric`) are a FALLBACK, never
 *  stacked: a site / exterior type is taken from them only when the
 *  electrical plans show none of it and none of those plans failed or was
 *  unreadable for it; every other type ignores them. */
export function combineSheetCounts(t: CountTarget, sheets: SheetCountInput[], opts: CombineOptions = {}): CombineResult {
  const photo = sheets.filter(s => s.sheet.photometric);
  if (!photo.length) return combineCore(t, sheets, opts);
  const others = sheets.filter(s => !s.sheet.photometric);
  const photoEntry = (s: SheetCountInput, reason: string): TypeSheetCount => {
    const count = s.status === 'counted' ? s.placed.filter(p => p.typeKey === t.key).length : 0;
    return { sheetKey: s.sheet.key, label: s.sheet.label, count, used: false, eligible: false, ...(count > 0 ? { ignoredReason: reason } : {}) };
  };
  const base = combineCore(t, others, opts);
  if (!isSiteFixtureCategory(t.category)) {
    base.sheets.push(...photo.map(s => photoEntry(s, 'only site fixture types are taken from a photometric sheet')));
    return base;
  }
  const photoHas = photo.some(s => s.status === 'counted' && s.placed.some(p => p.typeKey === t.key));
  if (base.count > 0 || !photoHas || base.allowedFailed.length || base.unreadableOn.length) {
    base.sheets.push(...photo.map(s => photoEntry(s, "the electrical plans' count is used — a photometric sheet is never stacked on them")));
    return base;
  }
  const role = preferredRole(t.category);
  const alt = combineCore(t, photo.map(s => ({ ...s, sheet: { ...s.sheet, role } })), opts);
  const used = alt.sheets.filter(x => x.used).map(x => x.label);
  alt.sheets = [...base.sheets, ...alt.sheets];
  alt.flags.push(`${t.type}: not shown on the electrical plans — ${alt.count} counted on the photometric sheet ${used.join(', ')}.`);
  return { ...alt, ...(alt.count > 0 ? { photometricOnly: true } : {}) };
}

function combineCore(
  t: CountTarget,
  sheets: SheetCountInput[],
  opts: CombineOptions = {},
): CombineResult {
  const flags: string[] = [];
  const coverage: string[] = [];
  const relations: NonNullable<TypeCountResult['relations']> = [];
  const counted = sheets.filter(s => s.status === 'counted');
  const role = preferredRole(t.category);
  const hasPreferredRole = counted.some(s => s.sheet.role === role);
  const allowed = (s: SheetCountInput) => s.sheet.role === 'enlarged' || !hasPreferredRole || s.sheet.role === role;
  const anti = antiFocus(t.category);
  const hasNonAnti = counted.some(s => allowed(s) && s.sheet.role !== 'enlarged' && s.sheet.focus !== anti);

  const perSheet: TypeSheetCount[] = sheets.map(s => ({
    sheetKey: s.sheet.key,
    label: s.sheet.label,
    count: s.placed.filter(p => p.typeKey === t.key).length,
    used: false,
    eligible: false,
  }));

  const usable: Array<{ s: SheetCountInput; c: TypeSheetCount }> = [];
  sheets.forEach((s, i) => {
    const c = perSheet[i];
    if (s.status !== 'counted') { c.ignoredReason = 'sheet could not be counted'; return; }
    if (!allowed(s)) {
      if (c.count > 0) {
        c.ignoredReason = t.category === 'site_lighting'
          ? 'site pole fixtures are counted only on the site plan'
          : 'building fixtures and devices are counted only on the building plan';
        flags.push(`${t.type}: ${c.count} on ${s.sheet.label} ignored — ${c.ignoredReason}.`);
      }
      return;
    }
    if (anti && s.sheet.role !== 'enlarged' && s.sheet.focus === anti && hasNonAnti) {
      if (c.count > 0) {
        c.ignoredReason = anti === 'power' ? 'lighting is taken from the lighting plan' : 'devices are taken from the power plan';
        flags.push(`${t.type}: ${c.count} on ${s.sheet.label} ignored — ${c.ignoredReason}.`);
      }
      return;
    }
    c.eligible = true;
    usable.push({ s, c });
  });

  // Main (non-enlarged) sheets: summed across levels; within a level, summed
  // across named areas (AREA A + AREA B), larger kept within one area; when
  // the titles can't tell same-area from partitions, a blocking question.
  const main = usable.filter(u => u.s.sheet.role !== 'enlarged');
  const byLevel = new Map<string, Array<{ s: SheetCountInput; c: TypeSheetCount }>>();
  for (const u of main) {
    const lv = u.s.sheet.level;
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(u);
  }
  let mainTotal = 0;
  let ambiguousExtra = 0; // sum-if-different-areas minus keep, over ambiguous levels
  const ambiguousSheets: AreaQuestion['sheets'] = [];
  for (const group of byLevel.values()) {
    const nonzero = group.filter(g => g.c.count > 0);
    if (nonzero.length === 0) continue;
    if (nonzero.length === 1) {
      const only = nonzero[0];
      only.c.used = true;
      mainTotal += only.c.count;
      if (only.s.sheet.partial && !only.s.sheet.area) {
        coverage.push(`${t.type} was counted only on the partial plan ${only.s.sheet.label} (${only.c.count}) — the rest of that level may not have been counted.`);
      }
      continue;
    }
    if (nonzero.every(g => g.s.sheet.area)) {
      // Named partitions: max within an area, sum across areas.
      const byArea = new Map<string, typeof nonzero>();
      for (const g of nonzero) {
        const a = g.s.sheet.area!;
        if (!byArea.has(a)) byArea.set(a, []);
        byArea.get(a)!.push(g);
      }
      const parts: string[] = [];
      for (const [area, gs] of byArea) {
        const best = gs.reduce((a, b) => (b.c.count > a.c.count ? b : a));
        best.c.used = true;
        mainTotal += best.c.count;
        parts.push(`${best.s.sheet.label} (${best.c.count})`);
        for (const g of gs) {
          if (g === best) continue;
          g.c.ignoredReason = `same area (${area}) as ${best.s.sheet.label} — larger count kept`;
          flags.push(`${t.type} counted on both ${best.s.sheet.label} (${best.c.count}) and ${g.s.sheet.label} (${g.c.count}), both ${area} — kept ${best.c.count}, not summed.`);
        }
      }
      if (byArea.size > 1) flags.push(`${t.type}: different areas of one level summed — ${parts.join(' + ')}.`);
      continue;
    }
    // Evidence round 1.4 — the sheets' own content and mark placement decide
    // complementary layers (sum) vs the same devices drawn twice (keep the
    // larger); only an unclear relationship goes to the estimator.
    const rel = opts.relations ? relateGroup(t, nonzero.map(g => g.s), opts) : { kind: 'unclear' as const, pairs: [] };
    relations.push(...rel.pairs);
    if (rel.kind === 'complementary') {
      for (const g of nonzero) { g.c.used = true; mainTotal += g.c.count; }
      flags.push(`${t.type}: ${nonzero.map(g => `${g.s.sheet.label} (${g.c.count})`).join(' + ')} summed — ${rel.pairs[0].reason}.`);
      continue;
    }
    if (rel.kind === 'duplicate') {
      const keep = nonzero.reduce((a, b) => (b.c.count > a.c.count ? b : a));
      keep.c.used = true;
      mainTotal += keep.c.count;
      for (const g of nonzero) if (g !== keep) g.c.ignoredReason = `the same devices as ${keep.s.sheet.label} — larger count kept`;
      flags.push(`${t.type}: ${nonzero.map(g => `${g.s.sheet.label} (${g.c.count})`).join(' and ')} show the same devices — kept ${keep.c.count}, not summed (${rel.pairs[0].reason}).`);
      continue;
    }
    // Unclear: provisionally keep the larger; the estimator decides.
    const best = nonzero.reduce((a, b) => (b.c.count > a.c.count ? b : a));
    best.c.used = true;
    mainTotal += best.c.count;
    const sum = nonzero.reduce((acc, g) => acc + g.c.count, 0);
    ambiguousExtra += sum - best.c.count;
    for (const g of nonzero) {
      ambiguousSheets.push({ label: g.s.sheet.label, count: g.c.count });
      if (g !== best) g.c.ignoredReason = `same area as ${best.s.sheet.label}? — needs the estimator (larger kept for now)`;
    }
    flags.push(`${t.type} counted on ${nonzero.map(g => `${g.s.sheet.label} (${g.c.count})`).join(' and ')} — the titles don't say whether these show the same area or different parts of the level. Needs review.`);
  }

  // Enlarged plans: never summed with the main plan.
  const enlarged = usable.filter(u => u.s.sheet.role === 'enlarged' && u.c.count > 0);
  let count = mainTotal;
  if (enlarged.length) {
    const bestEnl = enlarged.reduce((a, b) => (b.c.count > a.c.count ? b : a));
    if (mainTotal > 0) {
      flags.push(`${t.type} appears on the enlarged plan ${bestEnl.s.sheet.label} (${bestEnl.c.count}) and on the main plan (${mainTotal}) — kept the larger (${Math.max(mainTotal, bestEnl.c.count)}), not summed. Confirm the main plan shows that area.`);
      if (bestEnl.c.count > mainTotal) {
        for (const u of main) if (u.c.used) { u.c.used = false; u.c.ignoredReason = `enlarged plan ${bestEnl.s.sheet.label} shows more`; }
        bestEnl.c.used = true;
        count = bestEnl.c.count;
      } else {
        bestEnl.c.ignoredReason = 'enlarged plan — main plan count kept';
      }
    } else {
      bestEnl.c.used = true;
      count = bestEnl.c.count;
      const msg = `${t.type} was counted only on the enlarged plan${enlarged.length > 1 ? 's' : ''} ${enlarged.map(u => `${u.s.sheet.label} (${u.c.count})`).join(', ')} — no main plan count; kept ${bestEnl.c.count}.`;
      flags.push(msg);
      coverage.push(msg);
    }
    for (const u of enlarged) if (u !== bestEnl && !u.c.ignoredReason) u.c.ignoredReason = `enlarged plan — ${bestEnl.s.sheet.label} kept`;
  }

  // S3 — coverage: the count stands on the wrong kind of sheet.
  if (count > 0 && !hasPreferredRole && counted.length) {
    const msg = `No ${role === 'site' ? 'site' : 'building'} plan was counted — ${t.type} was taken from ${usable.filter(u => u.c.used).map(u => u.s.sheet.label).join(', ') || 'the counted sheets'}.`;
    flags.push(msg);
    coverage.push(msg);
  }
  if (count > 0 && anti && !hasNonAnti && usable.some(u => u.c.used && u.s.sheet.focus === anti)) {
    coverage.push(`${t.type} was counted only on the ${anti} plan (${usable.filter(u => u.c.used).map(u => u.s.sheet.label).join(', ')}) — no ${anti === 'power' ? 'lighting' : 'power'} plan was counted for it.`);
  }

  const allowedFailed = sheets.filter(s => s.status === 'failed' && allowed(s)).map(s => s.sheet.label);
  const unreadableOn = [...new Set(sheets.filter(s => s.status === 'counted' && allowed(s))
    .filter(s => s.unreadable.some(u => u.typeKey === t.key)).map(s => s.sheet.label))];
  return {
    count, sheets: perSheet, flags, allowedFailed, unreadableOn,
    ...(ambiguousSheets.length ? { areaQuestion: { sheets: ambiguousSheets, keep: count, sum: count + ambiguousExtra } } : {}),
    ...(coverage.length ? { coverage } : {}),
    ...(relations.length ? { relations } : {}),
  };
}

export function computeLoadCheck(types: TypeCountResult[], panelCircuits: unknown): LoadCheck {
  const circuits = Array.isArray(panelCircuits) ? panelCircuits.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object') : [];
  const suspect: LoadCheck['suspectCircuits'] = [];
  const perPanel = new Map<string, { va: number; circuits: number }>();
  let circuitVA = 0;
  for (const c of circuits) {
    const va = Number(c.loadVA);
    const panel = String(c.panel ?? '').trim() || '(unnamed panel)';
    const circuit = String(c.circuit ?? '').trim();
    if (!Number.isFinite(va) || va <= 0) continue;
    if (va < SUSPECT_VA_BELOW) {
      suspect.push({ panel, circuit, loadVA: va, note: `${va} VA is implausibly small for a lighting circuit — probably kVA; excluded from the comparison, not converted` });
      continue;
    }
    circuitVA += va;
    const p = perPanel.get(panel) ?? { va: 0, circuits: 0 };
    p.va += va; p.circuits++;
    perPanel.set(panel, p);
  }
  const fixtures = types.filter(t => isFixtureCategory(t.category));
  const base: LoadCheck = {
    ran: false, countedWatts: 0, circuitVA, gapPct: null, discrepancy: false,
    perPanel: [...perPanel.entries()].map(([panel, v]) => ({ panel, ...v })),
    suspectCircuits: suspect,
  };
  if (circuitVA <= 0) return { ...base, skippedReason: 'no lighting circuit loads on the panel schedules' };
  const missingWatts = fixtures.filter(t => t.count > 0 && t.wattage == null).map(t => t.type);
  if (missingWatts.length) return { ...base, skippedReason: `no wattage on the schedule for type(s) ${missingWatts.join(', ')}` };
  if (fixtures.some(t => t.status !== 'counted')) return { ...base, skippedReason: 'some fixture types still need review' };
  // Site types: the schedule wattage is taken per scheduled luminaire (pole
  // assembly), times the pole count. LED power factor ~1, so W ~ VA.
  const countedWatts = fixtures.reduce((s, t) => s + t.count * (t.wattage ?? 0), 0);
  const gapPct = (circuitVA - countedWatts) / circuitVA;
  return { ...base, ran: true, countedWatts, gapPct, discrepancy: Math.abs(gapPct) > LOAD_GAP_THRESHOLD };
}

export function countedRowItem(t: CountTarget): string {
  const desc = t.description || t.type;
  if (t.source === 'legend') return normalizeTypeKey(t.description) === t.key ? desc : `${desc} (${t.type})`;
  return t.category === 'equipment' ? `${t.type} — ${desc} (connection)` : `Type ${t.type} — ${desc}`;
}

export interface MergeEvidence {
  /** 3.2 — schedule-owned quantities (equipment-schedule types). */
  scheduleCounts?: Map<string, ScheduleCount>;
  /** 2.1 — typical packages read from legends / notes. */
  typicals?: TypicalPackage[];
  /** 3.1/3.4 — parsed schedule tables (branch-circuit rows come from these). */
  tables?: ScheduleTable[];
}

export interface CountMergeEvidenceResult {
  expansions: TypicalExpansion[];
  unmappedTypical: UnmappedTypicalDevice[];
  families: FamilyDecision[];
  symbolDefinitions: Array<{ key: string; into: string }>;
  circuitRows: number;
}

export function mergeCountsIntoTakeoff(
  agent1: Record<string, unknown>,
  targets: CountTarget[],
  sheets: SheetCountInput[],
  opts: { countingRan: boolean; notRunReason?: string; evidence?: MergeEvidence },
): CountMergeResult & { evidence?: CountMergeEvidenceResult } {
  const flags: string[] = [];
  let types: TypeCountResult[] = [];
  const hostKeys = new Set(targets.filter(t => t.role === 'host').map(t => t.key));
  const isHost = (k: string) => hostKeys.has(k);
  const sched = opts.evidence?.scheduleCounts ?? new Map<string, ScheduleCount>();
  const evidenceOn = !!opts.evidence;

  for (const t of targets) {
    if (!opts.countingRan) {
      types.push({
        key: t.key, type: t.type, description: t.description, category: t.category, wattage: t.wattage,
        count: 0, heads: null, status: 'unreadable', reason: opts.notRunReason || 'the counting stage did not run',
        sheets: [], flags: [], ...(t.role === 'host' ? { host: true } : {}),
      });
      continue;
    }
    // 3.2 — the schedule parser owns this quantity; the evidence is the row.
    const sc = sched.get(t.key);
    if (sc) {
      types.push({
        key: t.key, type: t.type, description: t.description, category: t.category, wattage: t.wattage,
        count: sc.qty, heads: null, status: 'counted', reason: '', sheets: [], flags: [`${t.type}: ${sc.qty} from the schedules — ${sc.note}.`],
        components: { drawn: 0, typical: 0, schedule: sc.qty },
        scheduleRows: sc.rows.map(r => ({ sheetKey: r.sheetKey, sheetLabel: r.sheetLabel, tableId: r.tableId, table: r.table, rowIdx: r.rowIdx, cells: r.cells, qty: r.qty })),
      });
      continue;
    }
    const c = combineSheetCounts(t, sheets, { isHost, relations: evidenceOn });
    let status: TypeCountStatus = 'counted';
    let reason = '';
    if (c.unreadableOn.length) {
      status = 'unreadable';
      reason = `symbols could not be read reliably on ${c.unreadableOn.join(', ')}`;
    } else if (c.allowedFailed.length) {
      status = 'unreadable';
      reason = `${c.allowedFailed.join(', ')} could not be counted`;
    } else if (c.count === 0) {
      status = 'zero';
      const elsewhere = c.sheets.filter(x => x.count > 0 && !x.used);
      reason = elsewhere.length
        ? `found only on ${elsewhere.map(x => `${x.label} (${x.count})`).join(', ')} — not counted there (${elsewhere[0].ignoredReason ?? 'not a sheet this type is counted on'})`
        : sheets.some(s => s.status === 'counted') ? 'not found on any counted plan sheet' : 'no plan sheets were counted';
    }
    // 1.3 — enlarged-plan marks held for the estimator: what the count
    // would be with them added (the same cross-sheet rules applied).
    let viewportQuestion: TypeCountResult['viewportQuestion'];
    const pend = sheets.flatMap(s => (s.pendingEnlarged ?? []).filter(p => p.typeKey === t.key).map(p => ({ s, p })));
    if (pend.length && status === 'counted') {
      const withPending = sheets.map(s => {
        const add = (s.pendingEnlarged ?? []).filter(p => p.typeKey === t.key).flatMap(p => p.marks);
        return add.length ? { ...s, placed: [...s.placed, ...add] } : s;
      });
      const alt = combineSheetCounts(t, withPending, { isHost, relations: evidenceOn });
      if (alt.count !== c.count) {
        viewportQuestion = { keep: c.count, add: alt.count, items: pend.map(({ s, p }) => ({ sheet: s.sheet.label, viewport: p.viewportLabel, count: p.marks.length })) };
        c.flags.push(`${t.type}: ${pend.map(({ s, p }) => `${s.sheet.label} ${p.viewportLabel} (${p.marks.length})`).join(', ')} — an enlarged plan whose place on the main plan is not known; ${c.count} as counted, ${alt.count} if it adds devices. Needs review.`);
      }
    }
    let heads: number | null = null;
    if (t.category === 'site_lighting') {
      heads = t.headsPerPole != null ? c.count * t.headsPerPole : null;
      if (c.count > 0 && t.headsPerPole == null) {
        c.flags.push(`${t.type}: heads per pole is not on the schedule — the heads line needs a count.`);
      }
    }
    types.push({
      key: t.key, type: t.type, description: t.description, category: t.category, wattage: t.wattage,
      count: c.count, heads, status, reason, sheets: c.sheets, flags: c.flags,
      ...(c.areaQuestion && status === 'counted' ? { areaQuestion: c.areaQuestion } : {}),
      ...(c.coverage && status === 'counted' ? { coverage: c.coverage } : {}),
      ...(c.photometricOnly && status === 'counted' ? { photometricOnly: true } : {}),
      ...(c.relations ? { relations: c.relations } : {}),
      ...(viewportQuestion ? { viewportQuestion } : {}),
      components: { drawn: status === 'counted' ? c.count : 0, typical: 0, schedule: 0 },
      ...(t.role === 'host' ? { host: true } : {}),
    });
  }

  // ── 2.2 Typical expansion ────────────────────────────────────────────────
  let evidenceOut: CountMergeEvidenceResult | undefined;
  if (opts.countingRan && opts.evidence) {
    evidenceOut = { expansions: [], unmappedTypical: [], families: [], symbolDefinitions: [], circuitRows: 0 };
    const packages = opts.evidence.typicals ?? [];
    if (packages.length) {
      const hostCounts = new Map<string, { count: number | null; sheets: string[]; marks: HostMark[]; reason?: string }>();
      for (const p of packages) {
        const hk = hostKeyOf(p);
        if (hostCounts.has(hk)) continue;
        const ty = types.find(x => x.key === hk);
        if (!ty) { hostCounts.set(hk, { count: null, sheets: [], marks: [], reason: `the host "${p.host}" was not counted` }); continue; }
        const usedSheets = ty.sheets.filter(x => x.used).map(x => x.sheetKey);
        const marks = sheets.filter(s => usedSheets.includes(s.sheet.key))
          .flatMap(s => s.placed.filter(m => m.typeKey === hk && Number.isFinite(m.x)).map(m => ({ sheetKey: s.sheet.key, x: m.x!, y: m.y! })));
        hostCounts.set(hk, {
          count: ty.status === 'counted' && ty.count > 0 ? ty.count : null,
          sheets: ty.sheets.filter(x => x.used).map(x => x.label),
          marks,
          ...(ty.status !== 'counted' || ty.count === 0 ? { reason: ty.status === 'unreadable' ? `the ${p.host.toLowerCase()} markers could not be read (${ty.reason})` : `no ${p.host.toLowerCase()} was found on the plans${p.hostTag ? ` (tag ${p.hostTag})` : ''}` } : {}),
        });
      }
      const deviceMarks = sheets.flatMap(s => s.placed.filter(m => Number.isFinite(m.x)).map(m => ({ sheetKey: s.sheet.key, typeKey: m.typeKey, x: m.x!, y: m.y! })));
      const { expansions, unmapped } = expandTypicals(packages, hostCounts, deviceMarks);
      evidenceOut.expansions = expansions;
      evidenceOut.unmappedTypical = unmapped;
      for (const e of expansions) {
        const ty = types.find(x => x.key === e.deviceKey);
        if (!ty) continue;
        ty.typical = [...(ty.typical ?? []), { packageId: e.packageId, host: e.host, hostCount: e.hostCount, perHost: e.perHost, drawnAtHosts: e.drawnAtHosts, expanded: e.expanded, quote: e.quote }];
        if (e.status !== 'expanded' || e.expanded <= 0) continue;
        if (ty.status === 'unreadable') {
          ty.flags.push(`${ty.type}: ${e.expanded} more at ${e.host.toLowerCase()}s (typical, ${e.reason}) — added once the drawn count is resolved.`);
          continue;
        }
        if (ty.status === 'zero' || ty.status === 'counted') {
          if (ty.status === 'zero') { ty.status = 'counted'; ty.reason = ''; }
          ty.count += e.expanded;
          ty.components = { drawn: ty.components?.drawn ?? 0, typical: (ty.components?.typical ?? 0) + e.expanded, schedule: ty.components?.schedule ?? 0 };
          if (ty.viewportQuestion) { ty.viewportQuestion.keep += e.expanded; ty.viewportQuestion.add += e.expanded; }
          if (ty.areaQuestion) { ty.areaQuestion.keep += e.expanded; ty.areaQuestion.sum += e.expanded; }
          const msg = `${ty.type}: +${e.expanded} at ${e.host.toLowerCase()}s (typical — ${e.reason}, per ${e.viewportLabel || 'the legend'}).`;
          ty.flags.push(msg);
          flags.push(msg);
        }
      }
    }
    // ── 3.3 Families and legend symbol definitions ──────────────────────────
    const fam = applyFamilies(types, targets);
    types = fam.types;
    evidenceOut.families = fam.decisions;
    for (const d of fam.decisions) flags.push(...d.flags);
    const defs = applySymbolDefinitions(types, targets);
    types = defs.types;
    const eq = applyScheduleLegendEquivalence(types, targets);
    types = eq.types;
    evidenceOut.symbolDefinitions = [...defs.merged, ...eq.merged];
  }
  for (const t of types) flags.push(...t.flags.filter(f => !flags.includes(f)));

  const loadCheck = computeLoadCheck(types.filter(t => !t.host && t.status !== 'merged'), agent1.panelCircuits);
  if (loadCheck.discrepancy && loadCheck.gapPct != null) {
    const dir = loadCheck.gapPct > 0 ? 'under' : 'over';
    flags.push(`Counted fixture load ${Math.round(loadCheck.countedWatts)} W is ${Math.round(Math.abs(loadCheck.gapPct) * 100)}% ${dir} the panel schedules' lighting circuits (${Math.round(loadCheck.circuitVA)} VA) — check the lighting counts.`);
  }
  for (const s of loadCheck.suspectCircuits) flags.push(`Panel ${s.panel} circuit ${s.circuit}: ${s.note}.`);

  // ── Replace Agent 1's rows ────────────────────────────────────────────────
  // When counting never ran there is nothing to replace them WITH: Agent 1's
  // rows stay exactly as they were (they are the only numbers there are) and
  // every type goes to review as unreadable.
  if (!opts.countingRan) {
    const quantities = Array.isArray(agent1.quantities) ? [...agent1.quantities] as Record<string, unknown>[] : [];
    return { types, loadCheck, quantities, removedRows: [], flags };
  }
  const original = Array.isArray(agent1.quantities) ? agent1.quantities.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
  const removedRows: RemovedRow[] = [];
  const kept: Record<string, unknown>[] = [];
  const lineTargets = targets.filter(t => t.role !== 'host');
  const fixtureTargetsCounted = opts.countingRan && lineTargets.some(t => isFixtureCategory(t.category))
    && sheets.some(s => s.status === 'counted');
  const equipmentTargetsCounted = opts.countingRan && lineTargets.some(t => t.category === 'equipment')
    && sheets.some(s => s.status === 'counted');
  // S4 — a counted device/equipment type (a legend disconnect, say) also
  // replaces Agent 1's row for it in ANY category (Service & Distribution),
  // and the counted line takes that row's category, so it never stacks.
  const deviceTargets = lineTargets.filter(t => t.category === 'equipment' || t.category === 'device');
  // 3.3 — a fixture row carrying a family's catalog number is that family.
  const catalogTargets = lineTargets.map(t => ({ t, c: catalogOf(t.description) })).filter(x => x.c);
  const siteTypes = types.filter(t => t.category === 'site_lighting' && t.status === 'counted' && t.count > 0);
  const sitePolesCounted = siteTypes.length ? siteTypes.map(t => `${t.type} ×${t.count}`).join(' + ') : '';
  // 3.4 — branch-circuit counts are the schedule parser's when it read the
  // panels; the parser's own rows (with their evidence) replace Agent 1's.
  const circuitRows = opts.evidence?.tables ? circuitSummaryRows(opts.evidence.tables) : [];
  if (evidenceOut) evidenceOut.circuitRows = circuitRows.length;
  const categoryByType = new Map<string, string>();
  for (const row of original) {
    const cat = String(row.category ?? '').trim().toLowerCase();
    const match = TYPE_ROW_CATEGORIES.has(cat) ? matchRowToTarget(row, lineTargets) : matchRowToTarget(row, deviceTargets);
    if (match) {
      removedRows.push({ row, reason: `replaced by the counted quantity for type ${match.type}`, replacedByType: match.type });
      if (!categoryByType.has(match.key) && String(row.category ?? '').trim()) categoryByType.set(match.key, String(row.category).trim());
      continue;
    }
    if (evidenceOn && isCircuitCountRow(row)) {
      if (circuitRows.length) {
        removedRows.push({ row, reason: 'branch-circuit count — replaced by the schedule parser\'s rows (panel schedules read row by row)', replacedByType: null });
        continue;
      }
      if (FIXTURE_ROW_CATEGORIES.has(cat)) {
        // Never held as an "unscheduled fixture": it is a circuit count.
        kept.push({ ...row, category: 'Branch Power' });
        flags.push(`"${String(row.item ?? '')}" is a branch-circuit count, not a fixture — moved to Branch Power (the panel schedules could not be read to replace it).`);
        continue;
      }
    }
    if (evidenceOn && FIXTURE_ROW_CATEGORIES.has(cat)) {
      const rc = catalogOf(String(row.item ?? '')) ?? catalogOf(String(row.spec ?? ''));
      const fam = rc ? catalogTargets.find(x => x.c!.full === rc.full && x.t.category !== 'device') : undefined;
      if (fam) {
        removedRows.push({ row, reason: `same catalog number as type ${fam.t.type} (${rc!.full}) — counted under that fixture family, never stacked`, replacedByType: fam.t.type });
        continue;
      }
      // 3.3 — the site light POLES themselves ("Light pole, 25' square
      // steel", "Site light pole locations (A-15 …)") are the counted pole
      // lines of the site family: never a second pole line. Bases,
      // foundations and arms are accessories and stay with the estimator.
      if (sitePolesCounted && /\b(light\s+)?poles?\b/i.test(String(row.item ?? ''))
        && /\b(site|light|area|parking)\b/i.test(String(row.item ?? ''))
        && !/\bbases?\b(?!\s+cover)|\b(foundation|footing|arms?|bracket|power\s+poles?|pier|receptacles?|outlets?|gfci|gfi|photocells?|conduit|wire|wiring|j-?box|junction|handhole|pull\s*box)\b/i.test(String(row.item ?? ''))) {
        removedRows.push({ row, reason: `the site light poles — counted as ${sitePolesCounted} (site family), never stacked`, replacedByType: null });
        continue;
      }
    }
    if (equipmentTargetsCounted && cat === 'branch power' && /equipment\s+connection/i.test(String(row.item ?? ''))) {
      removedRows.push({ row, reason: 'aggregate equipment-connection row — replaced by one counted line per equipment tag', replacedByType: null });
      continue;
    }
    if (fixtureTargetsCounted && FIXTURE_ROW_CATEGORIES.has(cat)) {
      removedRows.push({ row, reason: 'fixture row that matches no scheduled type — held for the estimator (count it or mark it not on this job)', replacedByType: null, unscheduled: true });
      continue;
    }
    kept.push(row);
  }

  const counted: Record<string, unknown>[] = [];
  for (const t of lineTargets) {
    const r = types.find(x => x.key === t.key)!;
    if (r.status === 'merged') continue;
    const sheetsUsed = r.sheets.filter(s => s.used).map(s => s.label.split(' ')[0]);
    const fromSchedule = (r.scheduleRows?.length ?? 0) > 0;
    const base = {
      category: (t.category === 'equipment' || t.category === 'device') ? (categoryByType.get(t.key) ?? CATEGORY_ROW[t.category]) : CATEGORY_ROW[t.category],
      unit: 'EA',
      sourceSheet: fromSchedule ? [...new Set(r.scheduleRows!.map(x => x.sheetLabel.split(' ')[0]))].join(', ') : (sheetsUsed.join(', ') || t.sourceSheet),
      // AI symbol counts are visual counts (APPROX), never FIRM — the
      // estimator confirms markers on the plans to make a line FIRM. A
      // schedule-owned quantity is read from the schedule's rows.
      confidence: r.status === 'counted' ? (fromSchedule ? 'VERIFIED' : 'ASSUMED') : 'NOT SHOWN',
      countedBy: fromSchedule ? 'schedule' : 'counter',
      countType: t.type,
    };
    const pending = r.status === 'counted' ? '' : `COUNT PENDING ESTIMATOR REVIEW (${r.reason})`;
    if (t.category === 'site_lighting') {
      counted.push({ ...base, item: `Type ${t.type} — pole (${t.description || 'site light'})`, qty: r.status === 'counted' ? r.count : 0, spec: pending || 'site pole' });
      counted.push({
        ...base,
        item: `Type ${t.type} — fixture heads${t.headsPerPole != null ? ` (${t.headsPerPole} per pole)` : ''}`,
        qty: r.status === 'counted' && r.heads != null ? r.heads : 0,
        spec: pending || (r.heads == null ? 'COUNT PENDING ESTIMATOR REVIEW (heads per pole not on the schedule)' : t.description),
        ...(r.heads == null ? { confidence: 'NOT SHOWN' } : {}),
      });
      continue;
    }
    const typ = r.components?.typical ?? 0;
    const spec = pending || (typ > 0 ? `${t.description} — incl. ${typ} at ${[...new Set((r.typical ?? []).filter(x => x.expanded > 0).map(x => x.host.toLowerCase()))].join(', ')} (typical)` : t.description);
    counted.push({ ...base, item: countedRowItem(t), qty: r.status === 'counted' ? r.count : 0, spec });
  }

  return {
    types, loadCheck, quantities: [...kept, ...circuitRows.map(c => c.row), ...counted], removedRows, flags,
    ...(evidenceOut ? { evidence: evidenceOut } : {}),
  };
}
