// Remodel round A1 / A2 / A3 — what the counting stage does with the
// counter's statuses, unlisted tags and the legend's zero-count noise. Pure:
// no I/O, no AI (the counting stage calls these from finish()).
import type { CountTarget } from '../countTargets';
import type { PlacedMark } from '../counter';
import type { CountSheet } from '../countSheets';
import { pdfToDisplayedIn, viewportAt, type SheetGeom, type Viewport } from '../evidence/viewports';
import { buildDemolition, demolitionRows, type DemolitionResult } from './demolition';
import { classifySheetTitles, isDemolitionTitle, parseConventions, type MarkStatus, type StatusConvention } from './status';
import { aggregateUnlisted, type UnlistedTag } from './unlisted';
import { evidenceCorpus, legendUnusedKeys } from './legendUnused';

export interface RemodelResult {
  /** Why the job is a remodel (shown to the estimator). */
  reasons: string[];
  /** Every printed / answered new-existing-demo rule, with its evidence. */
  conventions: StatusConvention[];
  demolitionSheets: Array<{ key: string; label: string; titles: string[]; status: 'counted' | 'failed'; error?: string; marks: number }>;
  /** A demolition drawing beside a new-work drawing on one counted sheet:
   *  the marks inside the demolition drawing are demolition. */
  mixedSheets: Array<{ key: string; label: string; demoTitles: string[]; moved: number }>;
  /** Existing-to-remain devices: listed, never priced. */
  existing: Array<{ typeKey: string; type: string; count: number; sheets: Array<{ label: string; count: number }> }>;
  demolition: DemolitionResult;
  /** Install marks whose status the counter could not tell (counted as new
   *  for now — a count is never lowered silently — and asked). */
  unknownStatus: Array<{ typeKey: string; type: string; count: number; total: number; sheets: Array<{ label: string; count: number }> }>;
  /** Remodel with no convention anywhere: ONE blocking question. */
  conventionQuestion: boolean;
  /** Fix round B2 — statuses ignored for want of a rule (counted as new). */
  ignoredStatuses?: Array<{ label: string; count: number }>;
  /** The estimator's answer applied on this run, if any. */
  answer?: string;
  /** Every non-install mark (PDF points), for the Plans view / a supplement. */
  marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number; status: MarkStatus }>;
  titleReads?: { calls: number; cached: number; errors: string[]; pages: Array<{ key: string; label: string; titles: string[]; source: string }> };
}

export interface RemodelContext {
  reasons: string[];
  /** Conventions known before counting (text layer, sheet titles reader, the
   *  estimator's answer), by sheet key ('*' = every sheet). */
  known: StatusConvention[];
  answer?: string;
  titleReads?: RemodelResult['titleReads'];
  /** Fix round B2 — statuses the counter gave on sheets with NO printed or
   *  answered rule: ignored (every mark counted as new), and said. */
  ignoredStatuses?: Array<{ label: string; count: number }>;
}

export interface SheetForRemodel {
  sheet: CountSheet;
  status: 'counted' | 'failed';
  error?: string;
  geometry: SheetGeom | null;
  placed: PlacedMark[];
  statusMarks?: PlacedMark[];
  conventions?: unknown[];
  unlisted?: Array<{ tag: string; symbol: string; placed: PlacedMark[] }>;
}

const PLAN_KINDS = new Set(['main_plan', 'enlarged_plan']);

function onPlan(vps: Viewport[] | undefined | null, g: SheetGeom | null, m: { x: number; y: number }): boolean {
  if (!vps?.length || !g) return true;
  const p = pdfToDisplayedIn(m.x, m.y, g);
  const v = viewportAt(vps, p.x, p.y);
  return !v || PLAN_KINDS.has(v.kind);
}

/** A1 — on a counted sheet that ALSO carries a demolition drawing, the
 *  install marks inside that drawing move to `statusMarks` as demolition.
 *  Mutates the sheet; returns the titles and how many moved. */
export function moveDemoViewportMarks(r: SheetForRemodel, vps: Viewport[] | undefined | null): { demoTitles: string[]; moved: number } | null {
  if (!vps?.length || !r.geometry || r.sheet.demolition) return null;
  const cls = classifySheetTitles(vps.map(v => v.title));
  if (!cls.demoTitles.length) return null;
  const demoIds = new Set(vps.filter(v => isDemolitionTitle(v.title)).map(v => v.id));
  const g = r.geometry;
  const inDemo = (m: PlacedMark) => {
    const p = pdfToDisplayedIn(m.x, m.y, g);
    const v = viewportAt(vps, p.x, p.y);
    return !!v && demoIds.has(v.id);
  };
  const moved = r.placed.filter(inDemo);
  if (moved.length) {
    r.statusMarks = [...(r.statusMarks ?? []), ...moved.map(m => ({ ...m, status: 'demo' as const }))];
    r.placed = r.placed.filter(m => !inDemo(m));
  }
  return { demoTitles: cls.demoTitles, moved: moved.length };
}

function perType(marks: Array<{ typeKey: string; label: string }>, tByKey: Map<string, CountTarget>) {
  const by = new Map<string, Map<string, number>>();
  for (const m of marks) {
    if (!by.has(m.typeKey)) by.set(m.typeKey, new Map());
    const s = by.get(m.typeKey)!;
    s.set(m.label, (s.get(m.label) ?? 0) + 1);
  }
  return [...by.entries()].map(([typeKey, s]) => ({
    typeKey, type: tByKey.get(typeKey)?.type ?? typeKey,
    count: [...s.values()].reduce((a, b) => a + b, 0),
    sheets: [...s.entries()].map(([label, count]) => ({ label, count })),
  })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** A1 — the remodel result from the counted sheets (after the demolition-
 *  drawing move), with the demolition lines. */
export function buildRemodelResult(
  ctx: RemodelContext,
  sheets: Array<SheetForRemodel & { viewports?: Viewport[] | null; mixed?: { demoTitles: string[]; moved: number } | null }>,
  installMarks: Array<{ sheetKey: string; typeKey: string; status?: MarkStatus }>,
  targets: CountTarget[],
): RemodelResult {
  const tByKey = new Map(targets.map(t => [t.key, t]));
  const conventions: StatusConvention[] = [...ctx.known];
  for (const s of sheets) {
    for (const c of parseConventions(s.conventions, { key: s.sheet.key, label: s.sheet.label }, 'counter')) {
      if (!conventions.some(o => o.sheetKey === c.sheetKey && o.quote.toUpperCase() === c.quote.toUpperCase())) conventions.push(c);
    }
  }
  const nonInstall = sheets.flatMap(s => (s.statusMarks ?? [])
    .filter(m => s.sheet.demolition || onPlan(s.viewports, s.geometry, m))
    .map(m => ({ sheetKey: s.sheet.key, label: s.sheet.label, typeKey: m.typeKey, x: m.x, y: m.y, status: (s.sheet.demolition ? 'demo' : m.status ?? 'existing') as MarkStatus })));
  const existing = perType(nonInstall.filter(m => m.status === 'existing'), tByKey);
  const demolition = buildDemolition(sheets
    .filter(s => s.status === 'counted')
    .map(s => ({
      key: s.sheet.key, label: s.sheet.label, demolition: !!s.sheet.demolition, geometry: s.geometry,
      marks: nonInstall.filter(m => m.sheetKey === s.sheet.key && m.status === 'demo').map(m => ({ typeKey: m.typeKey, x: m.x, y: m.y })),
    })), targets);
  const labelOf = new Map(sheets.map(s => [s.sheet.key, s.sheet.label]));
  const unknown = perType(installMarks.filter(m => m.status === 'unknown').map(m => ({ typeKey: m.typeKey, label: labelOf.get(m.sheetKey) ?? m.sheetKey })), tByKey)
    .map(u => ({ ...u, total: installMarks.filter(m => m.typeKey === u.typeKey).length }));
  // The question is about the COUNTED (new-work) sheets: a rule printed on
  // a demolition sheet says nothing about how E1.0 shows new vs existing.
  const counted = sheets.filter(s => !s.sheet.demolition && s.status === 'counted');
  const countedKeys = new Set(counted.map(s => s.sheet.key));
  return {
    reasons: ctx.reasons,
    conventions,
    demolitionSheets: sheets.filter(s => s.sheet.demolition).map(s => ({
      key: s.sheet.key, label: s.sheet.label, titles: s.sheet.demolitionTitles ?? [], status: s.status, ...(s.error ? { error: s.error } : {}),
      marks: (s.statusMarks ?? []).length,
    })),
    mixedSheets: sheets.filter(s => s.mixed).map(s => ({ key: s.sheet.key, label: s.sheet.label, demoTitles: s.mixed!.demoTitles, moved: s.mixed!.moved })),
    existing,
    demolition,
    unknownStatus: unknown,
    conventionQuestion: counted.length > 0 && !ctx.answer && !conventions.some(c => c.sheetKey === '*' || countedKeys.has(c.sheetKey)),
    ...(ctx.answer ? { answer: ctx.answer } : {}),
    ...(ctx.ignoredStatuses?.length ? { ignoredStatuses: ctx.ignoredStatuses } : {}),
    marks: nonInstall.map(({ label: _l, ...m }) => m),
    ...(ctx.titleReads ? { titleReads: ctx.titleReads } : {}),
  };
}

/** A1.5 — the demolition lines as drawing-analysis rows. */
export { demolitionRows };

/** A2 — every counted (non-demolition) sheet's unlisted tags, guarded. */
export function collectUnlisted(sheets: SheetForRemodel[], targets: CountTarget[], panels: string[], conventions: StatusConvention[]): { tags: UnlistedTag[]; rejected: Array<{ tag: string; reason: string }> } | null {
  const input = sheets.filter(s => !s.sheet.demolition && s.status === 'counted' && s.unlisted?.length).map(s => ({
    sheetKey: s.sheet.key, label: s.sheet.label,
    items: s.unlisted!.map(u => ({ tag: u.tag, symbol: u.symbol, marks: u.placed.map(p => ({ x: p.x, y: p.y })) })),
  }));
  if (!input.length) return null;
  const targetKeys = new Set(targets.flatMap(t => [t.key, t.type.toUpperCase()]));
  const statusMarkers = [...new Set(conventions.flatMap(c => [...c.quote.matchAll(/\(([A-Z]{1,2})\)/g)].map(m => m[1])))];
  const res = aggregateUnlisted(input, { panels, targetKeys, statusMarkers });
  return res.tags.length || res.rejected.length ? res : null;
}

/** A3 — which zero-count legend types have no other evidence. */
export function legendUnused(
  types: Parameters<typeof legendUnusedKeys>[0],
  targets: CountTarget[],
  agent1: Record<string, unknown>,
  tableRows: string[][],
): Set<string> {
  return new Set(legendUnusedKeys(types, targets, evidenceCorpus(agent1, tableRows)).filter(d => d.unused).map(d => d.key));
}
