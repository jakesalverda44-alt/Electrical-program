// Takeoff accuracy, Task 5 — the counting stage as the pipeline runs it:
// type list -> sheet selection -> 300 DPI render -> counter calls -> merge.
// Runs after Agent 1, before Agent 2 (routes/preconstruction.ts runPipeline).
//
// Failure policy (correctness over speed):
//   * a truncated counter call throws AgentTruncatedError — the run fails
//     with "Counter ... ran out of room" (Decision 9);
//   * anything else going wrong (no page classification, a render crash, an
//     API outage on one sheet) never lets Agent 1's own, uncounted numbers
//     through as if they were counts: the affected types become "unreadable"
//     and land in Needs review, which blocks the proposal until resolved.
import type Anthropic from '@anthropic-ai/sdk';
import { buildCountTargets, type CountTarget } from './countTargets';
import { counterTileSpec, retryTileIn, type ModelImageLimits } from './modelLimits';
import { selectCountSheets, type InventoryPage, type CountSheet } from './countSheets';
import { planOffsetTiles, readPageGeometry, renderCountTiles, type RenderedCountPage, type PageGeometry, type TileRectIn } from './countRender';
import { CONSISTENCY_PROMPT_VERSION, MAX_CONSISTENCY_SHEETS, MAX_CONSISTENCY_TILES, agreeRadiusPt, coverRect, consistencyTypes, entryOf, reconcilePasses, type ConsistencyEntry, type ConsistencySuggestion } from './evidence/consistency';
import { runCounter, splitByStatus, type SheetCountResult } from './counter';
import { mergeCountsIntoTakeoff, isSiteFixtureCategory, type CountMergeResult, type CountMergeEvidenceResult, type SheetCountInput } from './countMerge';
import { logger } from '../utils/logger';
import { RunCancelledError } from './runControl';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { runEvidenceStage, type EvidenceCache, type EvidencePage, type EvidenceStageOutput, type EvidenceUsage } from './evidence/evidenceStage';
import { dropCircuitRepeats, resolveSheetMarks, viewportPromptBlock, type EnlargedDecision, type SheetMarkResolution } from './evidence/viewportResolve';
import { hostTargets, type TypicalPackage } from './evidence/typicals';
import { dedupePanels, isCompletePanel, panelChoices, panelNameOf, scheduleCounts, type PanelChoice, type ScheduleCount, type ScheduleTable } from './evidence/schedules';
import { pdfToDisplayedIn, viewportAt, type Viewport } from './evidence/viewports';
import { reconcile, type ReconcileFinding } from './evidence/reconcile';
import { buildGapFillJobs, planSearchRect, resolveGapFillCandidates, runGapFillStage, sha256Of, type GapFillSheetAsset } from './evidence/gapFillStage';
import { bindHostTagMarks, canonicalKey, consolidateTargets, resolveUncertainSynonyms, type Consolidation, type ConsolidationMerge, type ConsolidationQuestion, type UncertainSynonym } from './evidence/consolidate';
import { classifySheetTitles, conventionFromAnswer, CONVENTION_OPTIONS, demolitionPromptBlock, isDemolitionTitle, isInstallStatus, parseConventions, remodelSignal, statusPromptBlock, type StatusConvention } from './remodel/status';
import { GENERIC_DEMO_TARGETS } from './remodel/demolition';
import { buildRemodelResult, collectUnlisted, demolitionRows, legendUnused, moveDemoViewportMarks, type RemodelContext, type RemodelResult } from './remodel/remodelStage';
import { readSheetTitles, type TitlePage, type TitlePageResult } from './remodel/titleReader';
import type { UnlistedTag } from './remodel/unlisted';

export const COUNT_RESULT_VERSION = 2;

export interface CountResultSheet {
  key: string;
  file: string;
  page: number;
  label: string;
  role: CountSheet['role'];
  focus: CountSheet['focus'];
  level: string;
  status: 'counted' | 'failed';
  error?: string;
  calls: number;
  tiles: number;
  geometryOk: boolean;
  geometry: PageGeometry | null;
  mergedDuplicates: number;
  rejected: number;
  notes: string[];
  unreadable: SheetCountResult['unreadable'];
  /** Next round A5 — the dense-area retry, both passes. */
  retry?: SheetCountResult['retry'];
  /** Evidence round 1.1 — the sheet's viewports and where they came from. */
  viewports?: Viewport[];
  viewportSource?: 'text' | 'vision' | 'none';
  viewportNote?: string;
  /** Evidence round 1.2 — marks not counted as devices, per type, with why.
   *  Fix round (B1) — `marks` (PDF points) lets gap-fill treat these as
   *  "already known" too: a real GFCI a main-plan area's replacement
   *  excluded must never come back as a gap-fill "new" one. */
  excluded?: Array<{ typeKey: string; count: number; reasons: string[]; marks: Array<{ x: number; y: number }> }>;
  /** Evidence round 1.3 — enlarged plan vs main plan, per type. */
  enlarged?: EnlargedDecision[];
  /** Evidence round 1.3 — enlarged-plan marks held while the estimator's
   *  "repeats or adds?" is open (kept so a supplement pass re-merges them). */
  pending?: SheetMarkResolution['pending'];
  /** Remodel round A1.3 — counted for demolition only. */
  demolition?: boolean;
}

/** Evidence round Parts 1-3 — what the evidence readers found and cost. */
export interface CountResultEvidence {
  model: string;
  usage: EvidenceUsage;
  calls: number;
  cached: number;
  errors: string[];
  pages: Array<{ key: string; label: string; source: 'text' | 'vision' | 'none'; viewports: number; hasTextLayer: boolean; note?: string }>;
  typicals: TypicalPackage[];
  expansions: CountMergeEvidenceResult['expansions'];
  /** Review fix S1 — one receptacle drawn on two sheets under two classes. */
  classConflicts?: CountMergeEvidenceResult['classConflicts'];
  unmappedTypical: CountMergeEvidenceResult['unmappedTypical'];
  /** Typical fix — untyped hosts shared by several legend types. */
  hostAssignments?: CountMergeEvidenceResult['hostAssignments'];
  tables: ScheduleTable[];
  families: CountMergeEvidenceResult['families'];
  symbolDefinitions: CountMergeEvidenceResult['symbolDefinitions'];
  circuitRows: number;
  /** Types whose quantity the schedule parser owns (never sent to the counter). */
  scheduleOwned: string[];
  /** Panels the drawing analysis found (panels[]). */
  panelsExpected: number;
  /** Fix round 4 / S20 — same-name panel conflicts with their enforced answers. */
  panelChoices?: PanelChoice[];
  /** Real-run fix 5 — the second counting pass on a shifted tile grid for
   *  high-count / density-flagged types, reconciled by location: counted =
   *  the marks BOTH passes found; the rest are SUGGESTED (a review item),
   *  never counted until confirmed. */
  consistency?: { entries: ConsistencyEntry[]; suggested: ConsistencySuggestion[]; notReseen?: ConsistencySuggestion[]; calls: number; usage: EvidenceUsage; tiles: number; cached?: number; warnings?: string[] };
  /** Real-run fix 2 — one canonical entity per thing: every other name of
   *  it (synonyms, a class name, a combined tag, a pole-tag legend) with the
   *  evidence, and the generic legend symbols decided by their marks. */
  consolidation?: { merges: ConsolidationMerge[]; uncertain: UncertainSynonym[]; hostBindings?: Array<{ tag: string; member: string; circuit: string; sheetKey: string }>; questions?: ConsolidationQuestion[] };
  /** Panel-schedule viewports the viewport reader identified whose table
   *  could not be read completely — their branch circuits have no source
   *  (3.4: Agent 1 no longer states them). */
  panelsUnread: string[];
  /** Evidence round 4.2 / 4.3 / 4.4 — reconciliation against independent
   *  second sources, and the targeted gap-fill search + crop check that
   *  ran for every UNDER shortfall it found. Absent only when reconciliation
   *  itself never ran (no evidence input).
   *
   *  Fix round (B2) — gap-fill NEVER changes a GC-facing quantity: `count`
   *  and `agent1.quantities` are untouched by this. `suggested` is written
   *  to the Plans view as SUGGESTED markers (never confirmed), and each
   *  type with one or more gets a `gapfill:<key>` review item; a finding
   *  with no candidates (or an OVER finding) gets a `reconcile:<key>`
   *  review item instead — every reconciliation finding reaches the
   *  estimator one way or the other. */
  gapFill?: {
    /** Every reconciliation finding, both directions — not just the ones
     *  that got a gap-fill job. */
    findings: ReconcileFinding[];
    /** S4 — jobs actually run vs. how many the cap (MAX_GAPFILL_JOBS) left
     *  out, disclosed rather than silently dropped. */
    jobs: number;
    jobsSkipped: number;
    cachedJobs: number;
    /** Candidates the gap-fill call proposed, across every job. */
    candidates: number;
    /** Accept, or a valid reclass — the count SUGGESTED to the estimator,
     *  never counted automatically. */
    suggested: Array<{ typeKey: string; sheetKey: string; x: number; y: number; confidence: string; note: string }>;
    calls: number;
    usage: EvidenceUsage;
    errors: string[];
  };
}

/** One counted symbol, in PDF points on its page (est_markups space). */
export interface CountMark { sheetKey: string; typeKey: string; x: number; y: number; circuit?: string }

/** Persisted as takeoff_results.count_result. */
export interface CountResult {
  version: number;
  ran: boolean;
  notRunReason?: string;
  model: string;
  targets: CountTarget[];
  targetNotes: string[];
  sheets: CountResultSheet[];
  skippedSheets: Array<{ file: string; page: number; label: string; reason: string }>;
  types: CountMergeResult['types'];
  loadCheck: CountMergeResult['loadCheck'];
  removedRows: CountMergeResult['removedRows'];
  flags: string[];
  marks: CountMark[];
  /** Fix round 1 / B2 — Agent 1 found neither a fixture schedule nor a
   *  device/symbol legend: the fixture counts are Agent 1's own, unverified. */
  noScheduleOrLegend?: boolean;
  /** S3 — PDFs the page classifier returned nothing for (whole file never
   *  looked at by the counter). */
  unclassifiedFiles?: string[];
  /** Evidence round Parts 1-3. */
  evidence?: CountResultEvidence;
  /** Remodel round A1 — present only on a remodel job: the new / existing /
   *  demolition rules, existing devices (never priced), demolition lines. */
  remodel?: RemodelResult;
  /** Remodel round A2 — tagged symbols drawn on the plans that are not
   *  count targets (each a SUGGESTION until the estimator names it). */
  unlisted?: { tags: UnlistedTag[]; rejected: Array<{ tag: string; reason: string }> };
}

export interface CountingStageInput {
  client: Anthropic;
  model: string;
  maxTokens: number;
  agent1: Record<string, unknown>;
  inventory: InventoryPage[];
  /** PDF bytes by uploaded filename (the inventory's `file`). */
  pdfs: Map<string, Buffer>;
  /** Stop analysis — see CounterRunInput. */
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number, phase?: 'retry') => void;
  /** Evidence round Parts 1-3 — the narrow readers (viewports, typicals,
   *  schedules). Absent = the counting stage runs exactly as before. */
  evidence?: { model: string; maxTokens: number; cache?: EvidenceCache };
  /** Remodel round A1 — the bid's build type and the estimator's answer to
   *  "how are new vs existing shown?". Absent = no remodel mode at all (the
   *  counting stage runs exactly as before). Remodel mode also needs the
   *  evidence input and a remodel signal (remodel/status.ts). */
  remodel?: { buildType?: string | null; answer?: string | null };
}

export interface CountingStageOutput {
  agent1: Record<string, unknown>;
  countResult: CountResult;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
}

const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** Real-run fix 5 — what the consistency pass cost and what it skipped. */
export interface ConsistencyRun { calls: number; usage: EvidenceUsage; tiles: number; cached: number; warnings: string[] }

interface FinishEvidence {
  ev: EvidenceStageOutput;
  schedCounts: Map<string, ScheduleCount>;
  /** Real-run fix 2. */
  cons?: Consolidation;
  /** Real-run fix 5 — the consistency pass's own calls / usage / tiles. */
  consistencyRun?: ConsistencyRun;
}

/** Real-run fix 2 / review fix S12 — marks under another name of an entity
 *  (a supplement pass over a run counted before consolidation, which may
 *  have counted BOTH names on the same symbols) become the canonical
 *  entity's — and a remapped mark on top of one the entity already has
 *  (within the counter's own overlap radius) is the same symbol, dropped:
 *  never a doubled count. Mutates the sheets; returns how many were dropped. */
export function remapAliasMarks(sheets: Array<{ placed: Array<{ typeKey: string; x?: number; y?: number }>; notes?: string[] }>, aliasOf: Map<string, string>, radiusPt = 0.35 * 72): number {
  let dropped = 0;
  for (const r of sheets) {
    const kept: typeof r.placed = [];
    const remapped: typeof r.placed = [];
    for (const p of r.placed) (aliasOf.has(p.typeKey) ? remapped : kept).push(p);
    for (const p of remapped) {
      const k = canonicalKey(p.typeKey, aliasOf);
      const dup = Number.isFinite(p.x) && kept.some(o => o.typeKey === k && Number.isFinite(o.x) && Math.hypot(o.x! - p.x!, o.y! - p.y!) <= radiusPt);
      if (dup) { dropped++; continue; }
      p.typeKey = k;
      kept.push(p);
    }
    if (remapped.length) {
      const n = remapped.length - remapped.filter(p => kept.includes(p)).length;
      if (n) r.notes?.push(`${n} mark${n === 1 ? '' : 's'} counted under another name of an entity sat on its own marks — counted once.`);
    }
    r.placed = kept;
  }
  return dropped;
}

/** Real-run fix 2 — a typical package the reader bound to another name of
 *  an entity ("DUPLEX") points at its canonical target. */
function remapTypicals(packages: TypicalPackage[], aliasOf: Map<string, string> | undefined): TypicalPackage[] {
  if (!aliasOf?.size) return packages;
  return packages.map(p => ({
    ...p,
    hostTargetKey: p.hostTargetKey ? canonicalKey(p.hostTargetKey, aliasOf) : p.hostTargetKey,
    devices: p.devices.map(d => ({ ...d, targetKey: d.targetKey ? canonicalKey(d.targetKey, aliasOf) : d.targetKey })),
  }));
}

/** Real-run fix 3 — the circuits each schedule-owned type's rows are on
 *  ("PANEL A" row 30 -> A30). */
function scheduleCircuitsOf(sc: Map<string, ScheduleCount>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [k, c] of sc) {
    const set = new Set<string>();
    for (const r of c.rows) {
      const n = Number(/\d+/.exec(r.cells[0] ?? '')?.[0]);
      if (Number.isInteger(n) && n > 0) set.add(`${panelNameOf(r.table)}${n}`);
    }
    out.set(k, set);
  }
  return out;
}

/** Review fix S8 — a consistency suggestion is kept only where a counted
 *  mark could be: a main / enlarged plan viewport (or anywhere, when the
 *  sheet has no viewports). */
function onPlanViewport(vps: Viewport[] | undefined, g: PageGeometry | null, m: { x: number; y: number }): boolean {
  if (!vps?.length || !g) return true;
  const p = pdfToDisplayedIn(m.x, m.y, g);
  const v = viewportAt(vps, p.x, p.y);
  return !!v && (v.kind === 'main_plan' || v.kind === 'enlarged_plan');
}

/** Real-run fix 4 — a viewport that is a PANEL SCHEDULE (whose unread
 *  circuits would have no source), by its title. Live Kissimmee: E-5's
 *  "PANELBOARD - DIAGRAM" and "PANELBOARD - MOUNTING HEIGHT SECTION" were
 *  read as tables, came back with no rows (there are none to read), and
 *  raised "Panel schedules not read completely" although both real panel
 *  schedules (E-4, Panel A and B, 42 rows each) were read completely. A
 *  diagram, section, elevation, detail, riser, one-line, schematic or
 *  mounting drawing of a panel is not its schedule. */
export function isPanelScheduleTitle(title: string): boolean {
  if (!/\bPANEL(BOARD)?S?\b/i.test(title) || /\bLOAD\b/i.test(title)) return false;
  return !/\b(DIAGRAMS?|SECTIONS?|ELEVATIONS?|DETAILS?|RISERS?|ONE[\s-]?LINE|SINGLE[\s-]?LINE|SCHEMATICS?|MOUNTING|LAYOUTS?|PLANS?|ENLARGED|HEIGHTS?|WIRING)\b/i.test(title);
}

/** The panels the drawing analysis found (panels[].name), for circuit identity. */
function panelNamesOf(agent1: Record<string, unknown>): string[] {
  return Array.isArray(agent1.panels) ? (agent1.panels as Array<Record<string, unknown>>).map(p => String(p?.name ?? '')).filter(Boolean) : [];
}

/** Real-run fix 2 — the targets the counter looks for: never another name
 *  of an entity (its canonical target is asked, naming it); a pole-tag
 *  legend is asked as a host marker. */
export function isAliasTarget(t: CountTarget): boolean {
  return !!t.mergedInto?.length && t.role !== 'host';
}

function finish(
  input: CountingStageInput,
  targets: CountTarget[],
  targetNotes: string[],
  sheetResults: SheetCountResult[],
  skippedSheets: CountResult['skippedSheets'],
  ran: boolean,
  notRunReason: string | undefined,
  evidence?: FinishEvidence,
  carry?: CountResultSheet[],
  remodel?: RemodelContext,
): { agent1: Record<string, unknown>; countResult: CountResult } {
  // Evidence round 1.2 / 1.3 — attribute every mark to its viewport and
  // reconcile enlarged plans with the main plan, before any cross-sheet rule.
  const vpBy = new Map((evidence?.ev.pages ?? []).map(p => [p.key, p]));
  const extra = new Map<string, Pick<CountResultSheet, 'viewports' | 'viewportSource' | 'viewportNote' | 'excluded' | 'enlarged' | 'pending'>>();
  // A supplement pass: earlier sheets were resolved in the earlier pass —
  // their stored viewports / exclusions / held enlarged marks carry over.
  for (const c of carry ?? []) {
    if (!c.viewports && !c.excluded && !c.enlarged && !c.pending) continue;
    extra.set(c.key, {
      ...(c.viewports ? { viewports: c.viewports } : {}), ...(c.viewportSource ? { viewportSource: c.viewportSource } : {}),
      ...(c.viewportNote ? { viewportNote: c.viewportNote } : {}), ...(c.excluded ? { excluded: c.excluded } : {}),
      ...(c.enlarged ? { enlarged: c.enlarged } : {}), ...(c.pending?.length ? { pending: c.pending } : {}),
    });
  }
  // Real-run fix 2 — a mark under another name of an entity (a carried
  // supplement mark) is the canonical entity's.
  const aliasOf = evidence?.cons?.aliasOf;
  if (aliasOf?.size) remapAliasMarks(sheetResults, aliasOf);
  // Real-run fix 3 — a pole-tag legend's marks are its members' (bound by
  // the circuit tag each mark carries), BEFORE any viewport / sheet rule, so
  // an enlarged plan's pole #2 is compared with the main plan's pole #2.
  const hostBindings = evidence ? bindHostTagMarks(targets, sheetResults, scheduleCircuitsOf(evidence.schedCounts), panelNamesOf(input.agent1)) : [];
  const equipmentKeys = new Set(targets.filter(t => t.category === 'equipment').map(t => t.key));
  // Remodel round A1 — a demolition drawing beside a new-work drawing on one
  // counted sheet: its marks are demolition, never install work.
  const mixedBySheet = new Map<string, { demoTitles: string[]; moved: number }>();
  if (remodel) {
    const ignored: Array<{ label: string; count: number }> = [];
    for (const r of sheetResults) {
      if (r.status !== 'counted' || r.sheet.demolition) continue;
      const mixed = moveDemoViewportMarks(r, vpBy.get(r.sheet.key)?.viewports.viewports ?? extra.get(r.sheet.key)?.viewports);
      if (mixed) mixedBySheet.set(r.sheet.key, mixed);
      // Fix round B2 — a mark's status filters the count ONLY where a rule
      // with evidence exists (printed on the sheet — its quote — or the
      // estimator's chosen convention). Otherwise every mark is new,
      // whatever the model tagged, and that is said.
      const hasRule = remodel.known.some(k => k.sheetKey === r.sheet.key || k.sheetKey === '*')
        || parseConventions(r.conventions, { key: r.sheet.key, label: r.sheet.label }, 'counter').length > 0;
      if (hasRule) { splitByStatus(r); continue; }
      const n = r.placed.filter(p => p.status && !isInstallStatus(p.status)).length;
      if (n) ignored.push({ label: r.sheet.label, count: n });
      r.placed = r.placed.map(({ status: _s, ...p }) => p);
    }
    remodel = { ...remodel, ...(ignored.length ? { ignoredStatuses: ignored } : {}) };
  }
  // A demolition sheet never feeds an install count (a failed one never
  // makes an install type "unreadable").
  const mergeInputs: SheetCountInput[] = sheetResults.filter(r => !r.sheet.demolition).map(r => {
    const page = vpBy.get(r.sheet.key);
    if (!evidence || r.status !== 'counted' || !page) {
      const c = extra.get(r.sheet.key);
      if (!c) return r;
      // Fix round B4 — a carried sheet's stored marks lost their viewport:
      // re-attribute them (they were counted marks already) so the sheet-pair
      // relation maps enlarged-plan marks onto the main plan again.
      const g = r.geometry;
      const placed = c.viewports && g ? r.placed.map(m => {
        const p = pdfToDisplayedIn(m.x, m.y, g);
        return { ...m, viewportId: viewportAt(c.viewports!, p.x, p.y)?.id ?? null };
      }) : r.placed;
      return { ...r, placed, ...(c.viewports ? { viewports: c.viewports } : {}), ...(c.pending ? { pendingEnlarged: c.pending } : {}) };
    }
    const res = resolveSheetMarks(r.placed, page.viewports.viewports, r.geometry ?? page.geometry);
    dropCircuitRepeats(res, equipmentKeys);
    const exBy = new Map<string, { count: number; reasons: Set<string>; marks: Array<{ x: number; y: number }> }>();
    for (const m of res.excluded) {
      const e = exBy.get(m.typeKey) ?? { count: 0, reasons: new Set<string>(), marks: [] };
      e.count++; e.reasons.add(m.reason);
      if (Number.isFinite(m.x) && Number.isFinite(m.y)) e.marks.push({ x: m.x, y: m.y });
      exBy.set(m.typeKey, e);
    }
    extra.set(r.sheet.key, {
      viewports: page.viewports.viewports, viewportSource: page.viewports.source,
      ...(page.viewports.note ? { viewportNote: page.viewports.note } : {}),
      ...(exBy.size ? { excluded: [...exBy.entries()].map(([typeKey, e]) => ({ typeKey, count: e.count, reasons: [...e.reasons], marks: e.marks })) } : {}),
      ...(res.enlarged.length ? { enlarged: res.enlarged } : {}),
      ...(res.pending.length ? { pending: res.pending } : {}),
    });
    if (res.notes.length) r.notes.push(...res.notes);
    return {
      ...r,
      placed: res.counted.map(m => ({ ...m, tileIds: m.tileIds ?? [] })),
      geometry: r.geometry ?? page.geometry,
      viewports: page.viewports.viewports,
      pendingEnlarged: res.pending,
    } as SheetCountInput & SheetCountResult;
  });
  if (evidence?.ev.errors.length) logger.warn({ errors: evidence.ev.errors }, '[counting] evidence readers: some pieces could not be read');
  const merged = mergeCountsIntoTakeoff(input.agent1, targets, mergeInputs, {
    countingRan: ran, notRunReason,
    ...(evidence ? { evidence: { scheduleCounts: evidence.schedCounts, typicals: evidence.ev.typicals, tables: evidence.ev.tables } } : {}),
  });
  // Excluded marks per type, for the review detail and the evidence.
  for (const t of merged.types) {
    const n = [...extra.values()].reduce((s, e) => s + (e.excluded?.find(x => x.typeKey === t.key)?.count ?? 0), 0);
    if (n) t.excludedMarks = n;
  }
  const marks: CountMark[] = mergeInputs.flatMap(r => r.status === 'counted'
    ? r.placed.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ sheetKey: r.sheet.key, typeKey: p.typeKey, x: Math.round(p.x! * 100) / 100, y: Math.round(p.y! * 100) / 100, ...(p.circuit ? { circuit: p.circuit } : {}) }))
    : []);
  // Remodel round A1 — statuses, existing devices, demolition lines.
  const remodelResult = remodel ? buildRemodelResult(
    remodel,
    sheetResults.map(r => ({ ...r, viewports: vpBy.get(r.sheet.key)?.viewports.viewports ?? extra.get(r.sheet.key)?.viewports ?? null, mixed: mixedBySheet.get(r.sheet.key) ?? null })),
    mergeInputs.flatMap(r => r.status === 'counted' ? r.placed.map(p => ({ sheetKey: r.sheet.key, typeKey: p.typeKey, status: (p as { status?: import('./remodel/status').MarkStatus }).status })) : []),
    targets,
  ) : undefined;
  // Remodel round A2 — unlisted tags (every job).
  const unlisted = collectUnlisted(sheetResults, targets, input.agent1, remodelResult?.conventions ?? []);
  // Remodel round A3 — legend types with no evidence anywhere: flagged, and
  // their 0-qty pending rows never reach the takeoff.
  // Switched by the evidence round, like the review grouping it feeds (a run
  // without it behaves exactly as before).
  // A1 — a type drawn only as EXISTING is not "not found": it is on the
  // plans, and none of it is new work (listed, never priced).
  const existingOnly = new Set<string>();
  for (const e of remodelResult?.existing ?? []) {
    const t = merged.types.find(x => x.key === e.typeKey);
    if (!t) continue;
    t.existingMarks = e.count;
    if (t.status === 'zero') { t.reason = `shown only as existing to remain (${e.count}) on the counted sheets — no new work`; existingOnly.add(t.type); }
  }
  // Fix round B4 / S7 — computed AFTER the existing marks are known: a type
  // with any mark (counted, excluded or existing) never collapses.
  const unused = evidence ? legendUnused(merged.types, targets, input.agent1, evidence.ev.tables.flatMap(t => t.rows.map(r => r.cells))) : new Set<string>();
  for (const t of merged.types) if (unused.has(t.key)) t.legendUnused = true;
  // Real-run fix 2 — generic legend symbols: folded when zero, a question
  // when their marks sit on a candidate's, a different device otherwise.
  // Remodel round A1 — a candidate's EXISTING marks still show where that
  // symbol is drawn (a status never makes two symbols the same device).
  const uncertainKeys = new Set((evidence?.cons?.uncertain ?? []).map(u => u.key));
  const statusOnPlans: CountMark[] = remodel ? mergeInputs.flatMap(r => (sheetResults.find(x => x.sheet.key === r.sheet.key)?.statusMarks ?? [])
    .filter(p => p.status === 'existing' && !uncertainKeys.has(p.typeKey)).map(p => ({ sheetKey: r.sheet.key, typeKey: p.typeKey, x: p.x, y: p.y }))) : [];
  if (evidence?.cons?.uncertain.length) resolveUncertainSynonyms(merged.types, evidence.cons.uncertain, [...marks, ...statusOnPlans], undefined, { scheduleOwned: new Set(evidence.schedCounts.keys()) });
  const classified = new Set(input.inventory.map(p => p.file));
  const unclassifiedFiles = input.inventory.length ? [...input.pdfs.keys()].filter(f => !classified.has(f)) : [];
  const countResult: CountResult = {
    version: COUNT_RESULT_VERSION,
    ran,
    noScheduleOrLegend: !targets.some(t => t.source === 'fixture_schedule' || t.source === 'legend'),
    ...(unclassifiedFiles.length ? { unclassifiedFiles } : {}),
    ...(notRunReason ? { notRunReason } : {}),
    model: input.model,
    targets,
    targetNotes,
    sheets: sheetResults.map(r => ({
      key: r.sheet.key, file: r.sheet.file, page: r.sheet.page, label: r.sheet.label,
      role: r.sheet.role, focus: r.sheet.focus, level: r.sheet.level,
      status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.sheet.demolition ? { demolition: true } : {}),
      calls: r.calls, tiles: r.tiles, geometryOk: r.geometryOk, geometry: r.geometry,
      mergedDuplicates: r.mergedDuplicates, rejected: r.rejected.length, notes: r.notes, unreadable: r.unreadable,
      ...(r.retry ? { retry: r.retry } : {}),
      ...(extra.get(r.sheet.key) ?? {}),
    })),
    skippedSheets,
    types: merged.types,
    loadCheck: merged.loadCheck,
    removedRows: merged.removedRows,
    flags: [...merged.flags, ...(evidence?.ev.errors ?? []).map(e => `Evidence not read — ${e}.`)],
    marks,
    ...(evidence ? {
      evidence: {
        model: evidence.ev.model, usage: evidence.ev.usage, calls: evidence.ev.calls, cached: evidence.ev.cached, errors: evidence.ev.errors,
        pages: evidence.ev.pages.map(p => ({ key: p.key, label: p.label, source: p.viewports.source, viewports: p.viewports.viewports.length, hasTextLayer: p.hasTextLayer, ...(p.viewports.note ? { note: p.viewports.note } : {}) })),
        typicals: evidence.ev.typicals,
        expansions: merged.evidence?.expansions ?? [],
        ...(merged.evidence?.classConflicts?.length ? { classConflicts: merged.evidence.classConflicts } : {}),
        unmappedTypical: merged.evidence?.unmappedTypical ?? [],
        ...(merged.evidence?.hostAssignments?.length ? { hostAssignments: merged.evidence.hostAssignments } : {}),
        tables: evidence.ev.tables,
        families: merged.evidence?.families ?? [],
        symbolDefinitions: merged.evidence?.symbolDefinitions ?? [],
        circuitRows: merged.evidence?.circuitRows ?? 0,
        scheduleOwned: [...evidence.schedCounts.keys()],
        panelsExpected: Array.isArray(input.agent1.panels) ? input.agent1.panels.length : 0,
        // Fix round 4 / S20 — what each answer to a panel conflict changes.
        panelChoices: panelChoices(targets, evidence.ev.tables),
        ...(evidence.cons ? { consolidation: { merges: evidence.cons.merges, uncertain: evidence.cons.uncertain, hostBindings, questions: evidence.cons.questions } } : {}),
        ...(sheetResults.some(r => r.consistency?.length) || evidence.consistencyRun?.warnings.length ? { consistency: {
          entries: sheetResults.flatMap(r => r.consistency ?? []),
          // Review fix S8 — a suggestion obeys the viewport rules: only on a
          // plan viewport, never a legend / schedule / notes / detail one.
          suggested: sheetResults.flatMap(r => (r.consistencySuggested ?? []).filter(m => onPlanViewport(extra.get(r.sheet.key)?.viewports, r.geometry, m))),
          notReseen: sheetResults.flatMap(r => r.consistencyNotReseen ?? []),
          calls: evidence.consistencyRun?.calls ?? 0, usage: evidence.consistencyRun?.usage ?? { ...ZERO_USAGE }, tiles: evidence.consistencyRun?.tiles ?? 0,
          cached: evidence.consistencyRun?.cached ?? 0, warnings: evidence.consistencyRun?.warnings ?? [],
        } } : {}),
        panelsUnread: evidence.ev.pages.flatMap(p => p.viewports.viewports
          .filter(v => isPanelScheduleTitle(v.title))
          .filter(v => !evidence.ev.tables.some(t => t.viewportId === v.id && isCompletePanel(t)))
          .map(v => `${v.title} (${p.label})`)),
      },
    } : {}),
    ...(remodelResult ? { remodel: remodelResult } : {}),
    ...(unlisted ? { unlisted } : {}),
  };
  // Agent 2/3/4 read agent1_output: counted rows replace Agent 1's, and a
  // short summary rides along so QC sees what was counted and what is held.
  const pending = merged.types.filter(t => t.status !== 'counted' && t.status !== 'merged' && !t.host && !t.legendUnused && !existingOnly.has(t.type)).map(t => `${t.type} (${t.reason})`);
  const unusedTypes = new Set(merged.types.filter(t => t.legendUnused).map(t => t.type));
  const agent1 = {
    ...input.agent1,
    quantities: [
      // A3 — a collapsed legend symbol's "COUNT PENDING" row is not a line.
      ...merged.quantities.filter(q => !(q.countedBy === 'counter' && (unusedTypes.has(String(q.countType)) || existingOnly.has(String(q.countType))) && !(Number(q.qty) > 0))),
      // A1.5 — demolition lines (Agent 2 copies counted rows as they are).
      ...(remodelResult ? demolitionRows(remodelResult.demolition) : []),
    ],
    countingSummary: {
      ran,
      countedSheets: countResult.sheets.filter(s => s.status === 'counted').map(s => s.label),
      failedSheets: countResult.sheets.filter(s => s.status === 'failed').map(s => `${s.label}: ${s.error ?? 'failed'}`),
      notCounted: skippedSheets.map(s => `${s.label}: ${s.reason}`),
      pendingEstimatorReview: pending,
      flags: merged.flags.slice(0, 12),
    },
  };
  return { agent1, countResult };
}

/** Evidence round 4.2 / 4.3 / 4.4 — after the merge, check every independent
 *  second source against it (reconcile) and, for a real UNDER shortfall,
 *  run one targeted gap-fill + crop-check job per (type, sheet it is
 *  counted from). Fix round (B2) — this NEVER touches `countResult.types`
 *  or `agent1.quantities`: the crop check's "accept" only ever produces a
 *  SUGGESTED marker (written to the Plans view by the caller, same as the
 *  counter's own marks) plus a review item. A run with no evidence input
 *  never calls this (Part 4 is switched by the same `evidence` input as
 *  Parts 1-3). */
async function runGapFillPass(
  input: Pick<CountingStageInput, 'client' | 'pdfs' | 'shouldStop'>,
  evidenceCfg: { model: string; maxTokens: number; cache?: EvidenceCache },
  countResult: CountResult,
  allTargets: CountTarget[],
  tables: ScheduleTable[],
): Promise<void> {
  const findings = reconcile(countResult.types, allTargets, tables);
  const { jobs, jobsSkipped } = buildGapFillJobs(findings, countResult.types);
  const empty = { findings, jobs: 0, jobsSkipped, cachedJobs: 0, candidates: 0, suggested: [] as NonNullable<CountResultEvidence['gapFill']>['suggested'], calls: 0, usage: { ...ZERO_USAGE }, errors: [] as string[] };
  if (!jobs.length) {
    if (countResult.evidence) countResult.evidence.gapFill = empty;
    return;
  }
  const assets = new Map<string, GapFillSheetAsset>();
  const unusable: string[] = [];
  for (const job of jobs) {
    if (assets.has(job.sheetKey)) continue;
    const sheet = countResult.sheets.find(s => s.key === job.sheetKey);
    const pdf = sheet ? input.pdfs.get(sheet.file) : undefined;
    if (!sheet?.geometry || !pdf) { unusable.push(job.sheetKey); continue; }
    const excludedMarks = (sheet.excluded ?? []).flatMap(e => e.marks.map(m => ({ typeKey: e.typeKey, x: m.x, y: m.y })));
    assets.set(job.sheetKey, {
      page: sheet.page, pdf, geometry: sheet.geometry,
      existingMarks: countResult.marks.filter(m => m.sheetKey === job.sheetKey),
      excludedMarks,
      searchRect: planSearchRect(sheet.viewports),
      viewports: sheet.viewports ?? null,
      sha: sha256Of(pdf),
    });
  }
  const usableJobs = jobs.filter(j => assets.has(j.sheetKey));
  if (!usableJobs.length) {
    if (countResult.evidence) countResult.evidence.gapFill = { ...empty, jobs: 0, errors: [...new Set(unusable)].map(k => `${k}: no sheet PDF or geometry was available for gap-fill`) };
    return;
  }
  const gf = await runGapFillStage({
    client: input.client, model: evidenceCfg.model, maxTokens: evidenceCfg.maxTokens,
    jobs: usableJobs, targets: allTargets, assets, shouldStop: input.shouldStop, cache: evidenceCfg.cache,
  });
  // B1 — a reclass is deduped against the RECLASSIFIED type's own marks
  // (counted + excluded) too, not just the type gap-fill originally asked
  // about.
  const existingByTypeAndSheet = new Map<string, Array<{ x: number; y: number }>>();
  for (const [sheetKey, asset] of assets) {
    for (const m of [...asset.existingMarks, ...(asset.excludedMarks ?? [])]) {
      const k = `${m.typeKey}@${sheetKey}`;
      if (!existingByTypeAndSheet.has(k)) existingByTypeAndSheet.set(k, []);
      existingByTypeAndSheet.get(k)!.push({ x: m.x, y: m.y });
    }
  }
  const { suggested } = resolveGapFillCandidates(gf.candidates, existingByTypeAndSheet);
  if (countResult.evidence) {
    countResult.evidence.gapFill = {
      findings, jobs: usableJobs.length, jobsSkipped, cachedJobs: gf.cachedJobs,
      candidates: gf.candidates.length, suggested, calls: gf.calls, usage: gf.usage, errors: gf.errors,
    };
    for (const k of Object.keys(countResult.evidence.usage) as Array<keyof EvidenceUsage>) countResult.evidence.usage[k] += gf.usage[k];
    countResult.evidence.calls += gf.calls;
  }
}

export async function runCountingStage(input: CountingStageInput): Promise<CountingStageOutput> {
  const built = buildCountTargets(input.agent1);
  let targets = built.targets;
  const targetNotes = built.notes;
  // Real-run fix 2 — one canonical entity per thing, before counting and
  // review (switched by the evidence round, like the rest of it).
  const cons = input.evidence && targets.length ? consolidateTargets(targets, { panels: panelNamesOf(input.agent1) }) : undefined;
  if (cons) {
    targets = cons.targets;
    targetNotes.push(...cons.merges.map(m => `${m.type}: ${m.basis}.`));
  }
  if (targets.length === 0) {
    const { agent1, countResult } = finish(input, [], targetNotes, [], [], false, 'no fixture schedule, legend, equipment schedule or lighting circuits to count');
    return { agent1, countResult, usage: { ...ZERO_USAGE } };
  }
  if (input.inventory.length === 0) {
    const { agent1, countResult } = finish(input, targets, targetNotes, [], [], false,
      'the page classifier did not run, so the plan sheets could not be identified for counting');
    return { agent1, countResult, usage: { ...ZERO_USAGE } };
  }

  const selection = selectCountSheets(input.inventory);
  // Next round A3 — a photometric sheet is only worth a counter call when
  // there are site / exterior fixture types to look for.
  if (!targets.some(t => isSiteFixtureCategory(t.category))) {
    for (const s of selection.counted.filter(c => c.photometric)) {
      selection.skipped.push({ file: s.file, page: s.page, label: s.label, reason: 'photometric sheet — no site fixture types to count' });
    }
    selection.counted = selection.counted.filter(c => !c.photometric);
  }
  if (selection.counted.length === 0) {
    const { agent1, countResult } = finish(input, targets, targetNotes, [], selection.skipped, false,
      'no electrical plan sheets were found in the upload to count on');
    return { agent1, countResult, usage: { ...ZERO_USAGE } };
  }

  // Evidence round Parts 1-3 — viewports, typicals and schedules first: the
  // counter then counts host markers, skips schedule-owned types, and is
  // told each sheet's viewports.
  let evidence: FinishEvidence | undefined;
  let counterTargets = targets;
  let allTargets = targets;
  let sheetNotes: Map<string, string> | undefined;
  if (input.evidence) {
    const counted = selection.counted.filter(c => !c.photometric);
    const countedKeys = new Set(counted.map(c => c.key));
    const pages: EvidencePage[] = [
      ...counted.map(c => ({ key: c.key, file: c.file, page: c.page, label: c.label, counted: true })),
      ...input.inventory
        .filter(p => p.included && p.discipline === 'electrical' && p.role !== 'reference' && (p.cls === 'schedule' || p.cls === 'detail')
          && !countedKeys.has(`${p.file}#${p.page}`) && !/^PH/i.test(p.sheetNo.trim()))
        .map(p => ({ key: `${p.file}#${p.page}`, file: p.file, page: p.page, label: sheetLabelOf(p), counted: false })),
    ];
    const ev = await runEvidenceStage({
      client: input.client, model: input.evidence.model, maxTokens: input.evidence.maxTokens,
      pages, pdfs: input.pdfs, targets: targets.filter(t => !isAliasTarget(t)), cache: input.evidence.cache, shouldStop: input.shouldStop,
    });
    ev.typicals = remapTypicals(ev.typicals, cons?.aliasOf);
    // Fix round 3 / B12 — one table per panel identity and content, the
    // same-name conflicts flagged ON THE STORED TABLES (the review list reads them).
    ev.tables = dedupePanels(ev.tables);
    const hosts = hostTargets(ev.typicals, targets);
    const schedCounts = scheduleCounts(targets, ev.tables);
    allTargets = [...targets, ...hosts];
    counterTargets = allTargets.filter(t => !schedCounts.has(t.key) && !isAliasTarget(t));
    sheetNotes = new Map(ev.pages.filter(p => p.viewports.viewports.length).map(p => [p.key, viewportPromptBlock(p.viewports.viewports, sanitizeForPrompt)]));
    evidence = { ev, schedCounts, ...(cons ? { cons } : {}) };
    logger.info({ pages: ev.pages.length, calls: ev.calls, cached: ev.cached, typicals: ev.typicals.length, tables: ev.tables.length, hosts: hosts.length, scheduleOwned: schedCounts.size, errors: ev.errors }, '[counting] evidence readers done');
  }

  // Remodel round A1 — remodel mode: only with a remodel signal (a new
  // build never enters it — Kissimmee runs exactly as before).
  let remodelCtx: RemodelContext | undefined;
  let sheetsToCount = selection.counted;
  if (input.remodel && input.evidence && evidence) {
    // Fix round B1 — the counted electrical sheets' text layers first (no
    // model call): their drawing titles and printed rules are signals.
    const counted = selection.counted.filter(c => !c.photometric);
    const pre = await readSheetTitles({
      client: input.client, model: input.evidence.model, maxTokens: Math.min(input.evidence.maxTokens, 4000),
      pages: counted.map(c => ({ key: c.key, file: c.file, page: c.page, label: c.label, counted: true })),
      pdfs: input.pdfs, cache: input.evidence.cache, shouldStop: input.shouldStop,
    });
    const preBy = new Map(pre.pages.map(p => [p.key, p]));
    const electricalTitles = [
      ...input.inventory.filter(p => p.discipline === 'electrical' && p.cls === 'plan' && p.included).map(p => ({ sheet: sheetLabelOf(p), title: p.title })),
      ...counted.flatMap(c => [...(evidence!.ev.pages.find(p => p.key === c.key)?.viewports.viewports.map(v => v.title) ?? []), ...(preBy.get(c.key)?.titles ?? [])]
        .map(title => ({ sheet: c.label, title }))),
    ];
    const signal = remodelSignal({ buildType: input.remodel.buildType, electricalTitles, conventions: pre.pages.flatMap(p => p.conventions), answer: input.remodel.answer });
    if (signal.remodel) {
      const prep = await prepareRemodel(input, selection.counted, evidence, signal.reasons, preBy);
      remodelCtx = prep.ctx;
      sheetsToCount = prep.sheets;
      sheetNotes = sheetNotes ?? new Map();
      for (const [k, note] of prep.notes) sheetNotes.set(k, `${sheetNotes.get(k) ?? ''}${note}`);
      logger.info({ reasons: signal.reasons, demolitionSheets: prep.sheets.filter(x => x.demolition).map(x => x.label), known: prep.ctx.known.length }, '[counting] remodel mode');
    }
  }
  const demoTargets = sheetsToCount.some(x => x.demolition) ? GENERIC_DEMO_TARGETS : [];
  // A truncated call throws AgentTruncatedError out of here (the run fails);
  // every other per-sheet failure is recorded on that sheet by runCounter.
  const run: Awaited<ReturnType<typeof countSheets>> = counterTargets.length
    ? await countSheets(input, [...counterTargets, ...demoTargets], sheetsToCount, input.onProgress, sheetNotes, { consistency: !!input.evidence, cache: input.evidence?.cache, statusMode: !!remodelCtx && !NO_STATUS_ANSWERS.has(input.remodel?.answer ?? '') })
    : { sheets: sheetsToCount.map(sheet => ({ sheet, status: 'counted' as const, geometryOk: false, geometry: null, placed: [], mergedDuplicates: 0, unreadable: [], rejected: [], notes: ['every type on this job is owned by the schedules — nothing to count'], calls: 0, tiles: 0 })), usage: { ...ZERO_USAGE } };
  if (evidence && run.consistency) evidence.consistencyRun = run.consistency;
  const { agent1, countResult } = finish(input, allTargets, targetNotes, run.sheets, selection.skipped, true, undefined, evidence, undefined, remodelCtx);
  if (input.evidence && evidence) {
    await runGapFillPass(input, input.evidence, countResult, allTargets, evidence.ev.tables);
  }
  return { agent1, countResult, usage: run.usage };
}

function sheetLabelOf(p: InventoryPage): string {
  const no = p.sheetNo.trim(), t = p.title.trim();
  return no && t ? `${no} "${t}"` : no || (t ? `"${t}"` : `${p.file} p${p.page}`);
}

/** Fix round B3 — "all new" / "I will correct the counts myself": the
 *  counter is not asked for statuses at all (every mark new). */
const NO_STATUS_ANSWERS = new Set<string>([CONVENTION_OPTIONS[0], CONVENTION_OPTIONS[4]]);

/** Disciplines whose plan sheets may be DEMOLITION plans of electrical work
 *  (the 36th Street set draws it on the architectural A2.0 / A3.0). Civil,
 *  structural, mechanical and plumbing demolition plans are not read. */
const DEMO_DISCIPLINES = new Set(['electrical', 'architectural', 'fuel', 'other', 'unknown', 'cover']);

/** Remodel round A1 — before counting: which sheets are DEMOLITION sheets
 *  (their drawing titles — text layer, the viewport reader, or one titles
 *  call per scanned candidate sheet), the conventions already known (text
 *  layer, the estimator's answer), and the sheet notes that ask the counter
 *  for each mark's status. */
async function prepareRemodel(input: CountingStageInput, counted: CountSheet[], evidence: FinishEvidence, reasons: string[], pre: Map<string, TitlePageResult>): Promise<{ ctx: RemodelContext; sheets: CountSheet[]; notes: Map<string, string> }> {
  const countedKeys = new Set(counted.map(c => c.key));
  const candidates = input.inventory
    .filter(p => !countedKeys.has(`${p.file}#${p.page}`) && p.cls === 'plan' && DEMO_DISCIPLINES.has(p.discipline) && !/^PH/i.test(p.sheetNo.trim()) && input.pdfs.has(p.file))
    .sort((a, b) => Number(isDemolitionTitle(b.title)) - Number(isDemolitionTitle(a.title)));
  // The counted sheets were read already (their text layers, no call).
  const pages: TitlePage[] = candidates.map(p => ({ key: `${p.file}#${p.page}`, file: p.file, page: p.page, label: sheetLabelOf(p), counted: false }));
  const reads = await readSheetTitles({
    client: input.client, model: input.evidence!.model, maxTokens: Math.min(input.evidence!.maxTokens, 4000),
    pages, pdfs: input.pdfs, cache: input.evidence!.cache, shouldStop: input.shouldStop,
  });
  for (const k of Object.keys(evidence.ev.usage) as Array<keyof EvidenceUsage>) evidence.ev.usage[k] += reads.usage[k];
  evidence.ev.calls += reads.calls;
  const readBy = new Map([...pre, ...reads.pages.map(p => [p.key, p] as const)]);
  const known: StatusConvention[] = [];
  const answered = conventionFromAnswer(input.remodel?.answer);
  if (answered) known.push({ ...answered, sheetKey: '*', sheetLabel: 'every sheet' });
  const sheets: CountSheet[] = [];
  const notes = new Map<string, string>();
  for (const c of counted) {
    const r = readBy.get(c.key);
    const vpTitles = evidence.ev.pages.find(p => p.key === c.key)?.viewports.viewports.map(v => v.title) ?? [];
    const titles = [...(r?.titles ?? []), ...vpTitles];
    const cls = classifySheetTitles(titles.length ? titles : [c.title]);
    known.push(...(r?.conventions ?? []));
    // Fix round S1 — a combined "demolition and new work" drawing: counted
    // for both, with a status per mark; the title itself is the rule.
    for (const t of cls.combinedTitles) known.push({ status: 'demo', rule: 'demolition and new work in one drawing — status per mark', quote: t, sheetKey: c.key, sheetLabel: c.label, source: 'title' });
    if (cls.kind === 'demolition' && !cls.combinedTitles.length && !c.photometric) {
      sheets.push({ ...c, demolition: true, demolitionTitles: cls.demoTitles });
      notes.set(c.key, demolitionPromptBlock(cls.demoTitles, sanitizeForPrompt));
      continue;
    }
    sheets.push(c);
    if (!c.photometric && !NO_STATUS_ANSWERS.has(input.remodel?.answer ?? '')) notes.set(c.key, statusPromptBlock(known.filter(k => k.sheetKey === c.key || k.sheetKey === '*'), sanitizeForPrompt));
  }
  for (const p of candidates) {
    const key = `${p.file}#${p.page}`;
    const r = readBy.get(key);
    // A non-counted sheet's title-block title names the project, not its
    // drawings: only its drawing titles decide (the inventory title when
    // nothing was read).
    const cls = classifySheetTitles(r?.titles.length ? r.titles : [p.title]);
    if (cls.kind === 'none') continue;
    const onlyCombined = !cls.demoTitles.length;
    if (onlyCombined) cls.demoTitles.push(...cls.combinedTitles);
    known.push(...(r?.conventions ?? []));
    sheets.push({
      key, file: p.file, page: p.page, sheetNo: p.sheetNo.trim(), title: p.title.trim(),
      label: `${p.sheetNo.trim() || `${p.file} p${p.page}`} "${cls.demoTitles[0]}"`,
      role: 'building', focus: 'combined', level: '', area: '', partial: false, demolition: true, demolitionTitles: cls.demoTitles,
    });
    notes.set(key, demolitionPromptBlock(cls.demoTitles, sanitizeForPrompt)
      + (cls.kind === 'mixed' ? ` Count ONLY inside the drawing${cls.demoTitles.length === 1 ? '' : 's'} titled ${cls.demoTitles.map(t => `"${sanitizeForPrompt(t)}"`).join(', ')}.` : '')
      + (onlyCombined ? ' That drawing shows demolition AND new work: count ONLY the items it shows to be removed (existing / dashed / keyed to be removed), never the new work.' : ''));
  }
  return {
    ctx: {
      reasons, known, ...(input.remodel?.answer ? { answer: input.remodel.answer } : {}),
      titleReads: { calls: reads.calls, cached: reads.cached, errors: reads.errors, pages: [...readBy.values()].map(p => ({ key: p.key, label: p.label, titles: p.titles, source: p.source })) },
    },
    sheets, notes,
  };
}

type RenderedSheet = { sheet: CountSheet; rendered: RenderedCountPage | null; renderError?: string };

function countsByType(placed: Array<{ typeKey: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of placed) out[p.typeKey] = (out[p.typeKey] ?? 0) + 1;
  return out;
}

/** Next round A5 — render + count a set of sheets with tiles sized to the
 *  counter model (modelLimits.ts), then the dense-area retry: a sheet that
 *  came back with symbols it could not read reliably is counted ONCE more
 *  at a higher effective resolution (smaller tiles). The retry's counts are
 *  used when it succeeds; both passes are kept on the sheet. */
export async function countSheets(
  input: Pick<CountingStageInput, 'client' | 'model' | 'maxTokens' | 'pdfs' | 'shouldStop'>,
  targets: CountTarget[],
  sheets: CountSheet[],
  onProgress?: (done: number, total: number, phase?: 'retry') => void,
  sheetNotes?: Map<string, string>,
  opts: { consistency?: boolean; cache?: EvidenceCache; statusMode?: boolean } = {},
): Promise<{ sheets: SheetCountResult[]; usage: CountingStageOutput['usage']; consistency?: ConsistencyRun }> {
  const run = await countSheetsOnce(input, targets, sheets, onProgress, sheetNotes, opts.statusMode);
  if (!opts.consistency || input.shouldStop?.()) return run;
  const c = await consistencyPass(input, targets, run.sheets, sheetNotes, opts.cache, opts.statusMode);
  if (!c) return run;
  for (const k of Object.keys(run.usage) as Array<keyof typeof run.usage>) run.usage[k] += c.usage[k];
  return { ...run, consistency: c };
}

/** Real-run fix 5 — the second counting pass on a SHIFTED tile grid for
 *  each sheet's high-count / density-flagged types (only the shifted tiles
 *  that cover their marks), reconciled by location: the marks both passes
 *  found stay counted; a mark only one pass found leaves the count and is
 *  SUGGESTED (sheet.consistencySuggested). Mutates the sheets' `placed`.
 *  A pass that fails keeps the first pass and says so (never a silent
 *  change). Returns null when no sheet needed it. */
async function consistencyPass(
  input: Pick<CountingStageInput, 'client' | 'model' | 'maxTokens' | 'pdfs' | 'shouldStop'>,
  targets: CountTarget[],
  results: SheetCountResult[],
  sheetNotes?: Map<string, string>,
  cache?: EvidenceCache,
  statusMode?: boolean,
): Promise<{ calls: number; usage: CountingStageOutput['usage']; tiles: number; cached: number; warnings: string[] } | null> {
  const hostKeys = new Set(targets.filter(t => t.role === 'host').map(t => t.key));
  const all = results.filter(r => r.status === 'counted' && r.geometry && r.geometryOk !== false)
    .map(r => ({ r, types: consistencyTypes(r.placed, r.unreadable, k => hostKeys.has(k)) }))
    .filter(j => j.types.length);
  if (!all.length) return null;
  const warnings: string[] = [];
  // Review fix S8 — a per-run cap: the densest sheets first.
  const denseCount = (j: typeof all[number]) => j.r.placed.filter(p => j.types.some(t => t.typeKey === p.typeKey)).length;
  const jobs = all.slice().sort((p, q) => denseCount(q) - denseCount(p)).slice(0, MAX_CONSISTENCY_SHEETS);
  for (const j of all.filter(x => !jobs.includes(x))) {
    j.r.notes.push(`Consistency pass not run on this sheet (the per-run cap of ${MAX_CONSISTENCY_SHEETS} sheets) — its counts stand, unchecked.`);
    warnings.push(`${j.r.sheet.label}: consistency pass skipped (per-run cap)`);
  }
  const spec = counterTileSpec(input.model);
  // Review fix S8 — the dense sheets are exactly where the first pass's big
  // tiles miss symbols: the check reads at the retry's (smaller) tile size.
  const tileIn = retryTileIn(spec.tileIn, spec.limits);
  const cacheKey = `${input.model}|${CONSISTENCY_PROMPT_VERSION}`;
  const zero = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const secondBySheet = new Map<string, SheetCountResult['placed']>();
  const kindBySheet = new Map<string, string>();
  const rendered: Array<{ sheet: CountSheet; rendered: RenderedCountPage | null; renderError?: string }> = [];
  const pending: typeof jobs = [];
  let cached = 0;
  let tiles = 0;
  for (const j of jobs) {
    const g = j.r.geometry!;
    const pdf = input.pdfs.get(j.r.sheet.file);
    const shown = g.rotation === 90 || g.rotation === 270 ? { w: g.heightPt / 72, h: g.widthPt / 72 } : { w: g.widthPt / 72, h: g.heightPt / 72 };
    // One cover per type (never one box over every dense type).
    const rectById = new Map<string, TileRectIn>();
    for (const t of j.types) {
      const within = coverRect(j.r.placed.filter(p => p.typeKey === t.typeKey && Number.isFinite(p.x)).map(p => pdfToDisplayedIn(p.x, p.y, g)));
      for (const r of planOffsetTiles(shown.w, shown.h, { tileIn, within })) rectById.set(r.id, r);
    }
    const rects = [...rectById.values()];
    if (!pdf || !rects.length) { j.r.notes.push('Consistency pass could not run: the PDF for this sheet was not available — the first pass stands, unchecked.'); continue; }
    if (rects.length > MAX_CONSISTENCY_TILES) {
      j.r.notes.push(`Consistency pass not run: it would need ${rects.length} shifted tiles (cap ${MAX_CONSISTENCY_TILES}) — the first pass stands, unchecked.`);
      warnings.push(`${j.r.sheet.label}: consistency pass skipped (${rects.length} tiles over the cap)`);
      continue;
    }
    // Review fix N7 — the cache key carries the shifted tiles covered and a
    // hash of the first pass's marks: a re-run whose first pass differs
    // never reuses a stale second pass.
    const firstHash = sha256Of(Buffer.from(JSON.stringify(j.r.placed.filter(p => j.types.some(t => t.typeKey === p.typeKey)).map(p => [p.typeKey, Math.round(p.x ?? 0), Math.round(p.y ?? 0)]).sort()))).slice(0, 16);
    const kind = `consistency:${j.types.map(t => t.typeKey).join('+')}:${tileIn}:${rects.map(r => r.id).sort().join(',')}:${firstHash}`;
    kindBySheet.set(j.r.sheet.key, kind);
    const sha = sha256Of(pdf);
    if (cache) {
      try {
        const hit = await cache.get(sha, j.r.sheet.page, kind, cacheKey) as { placed?: SheetCountResult['placed'] } | null;
        if (hit?.placed) { secondBySheet.set(j.r.sheet.key, hit.placed); cached++; continue; }
      } catch (err) { logger.warn({ err }, '[counting] consistency cache read failed'); }
    }
    try {
      const page = await renderCountTiles(pdf, j.r.sheet.page, g, { limits: spec.limits, rects });
      tiles += page.tiles.length;
      rendered.push({ sheet: j.r.sheet, rendered: page });
      pending.push(j);
    } catch (err) {
      j.r.notes.push(`Consistency pass could not render this sheet (${err instanceof Error ? err.message : String(err)}) — the first pass stands, unchecked.`);
    }
  }
  let calls = 0;
  let usage = { ...zero };
  if (rendered.length) {
    const allKeys = new Set(pending.flatMap(j => j.types.map(t => t.typeKey)));
    logger.info({ sheets: pending.map(j => j.r.sheet.label), types: [...allKeys], tileIn }, '[counting] consistency pass on a shifted tile grid');
    try {
      const second = await runCounter({
        client: input.client, model: input.model, maxTokens: input.maxTokens, targets: targets.filter(t => allKeys.has(t.key)),
        sheets: rendered, shouldStop: input.shouldStop, statusMode,
        sheetNotes: new Map(pending.map(j => [j.r.sheet.key, `${sheetNotes?.get(j.r.sheet.key) ?? ''}\n\nCONSISTENCY PASS: these tiles are the same sheet on a grid shifted by half a tile — count every instance of the targets they show, as always.`])),
      });
      usage = second.usage;
      for (const j of pending) {
        const s2 = second.sheets.find(x => x.sheet.key === j.r.sheet.key);
        calls += s2?.calls ?? 0;
        if (!s2 || s2.status !== 'counted') {
          j.r.notes.push(`Consistency pass (shifted tiles) could not run for ${j.types.map(t => t.typeKey).join(', ')}: ${s2?.error ?? 'not rendered'} — the first pass's counts stand, unchecked.`);
          warnings.push(`${j.r.sheet.label}: consistency pass failed (${s2?.error ?? 'not rendered'})`);
          continue;
        }
        secondBySheet.set(j.r.sheet.key, s2.placed);
        if (cache) {
          const pdf = input.pdfs.get(j.r.sheet.file)!;
          await cache.set(sha256Of(pdf), j.r.sheet.page, kindBySheet.get(j.r.sheet.key)!, cacheKey, { placed: s2.placed })
            .catch(err => logger.warn({ err }, '[counting] consistency cache write failed'));
        }
      }
    } catch (err) {
      // Review fix S8 — a truncated / failed second pass is a skipped check
      // with a warning, never a failed run. A stop still stops.
      if (err instanceof RunCancelledError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      for (const j of pending) j.r.notes.push(`Consistency pass (shifted tiles) failed (${msg}) — the first pass's counts stand, unchecked.`);
      warnings.push(`consistency pass failed: ${msg}`);
      logger.warn({ err }, '[counting] consistency pass failed — skipped');
    }
  }
  for (const j of jobs) {
    const p2 = secondBySheet.get(j.r.sheet.key);
    if (!p2) continue;
    const entries: ConsistencyEntry[] = [];
    const suggested: ConsistencySuggestion[] = [];
    const notReseen: ConsistencySuggestion[] = [];
    for (const t of j.types) {
      const firstMarks = j.r.placed.filter(p => p.typeKey === t.typeKey);
      const radius = agreeRadiusPt(firstMarks);
      const rec = reconcilePasses(firstMarks, p2.filter(p => p.typeKey === t.typeKey), radius);
      // Review fix N6 — a second-pass mark within the radius of ANY counted
      // mark is that symbol reported twice, never a suggestion.
      rec.onlySecond = rec.onlySecond.filter(m => !firstMarks.some(f => Math.hypot(f.x - m.x, f.y - m.y) <= radius));
      entries.push(entryOf(j.r.sheet.key, j.r.sheet.label, t.typeKey, t.why, rec));
      // Review fix B1 — pass 1's marks stay counted, re-found or not; only
      // pass-2-only marks are suggestions (possible additions).
      suggested.push(...rec.onlySecond.map(m => ({ typeKey: t.typeKey, sheetKey: j.r.sheet.key, x: m.x, y: m.y, pass: 'second' as const })));
      notReseen.push(...rec.onlyFirst.map(m => ({ typeKey: t.typeKey, sheetKey: j.r.sheet.key, x: m.x, y: m.y, pass: 'first' as const })));
    }
    j.r.consistency = entries;
    j.r.consistencySuggested = suggested;
    j.r.consistencyNotReseen = notReseen;
    j.r.notes.push(`Consistency pass (shifted tiles, ${tileIn}"): ${entries.map(e => `${e.typeKey} ${e.first} counted, ${e.agreed} re-found (${Math.round(e.agreement * 100)}%), ${e.onlySecond} more suggested${e.lowAgreement ? ' — low agreement, review' : ''}`).join('; ')}.`);
  }
  return { calls, usage, tiles, cached, warnings };
}

async function countSheetsOnce(
  input: Pick<CountingStageInput, 'client' | 'model' | 'maxTokens' | 'pdfs' | 'shouldStop'>,
  targets: CountTarget[],
  sheets: CountSheet[],
  onProgress?: (done: number, total: number, phase?: 'retry') => void,
  sheetNotes?: Map<string, string>,
  statusMode?: boolean,
): Promise<{ sheets: SheetCountResult[]; usage: CountingStageOutput['usage'] }> {
  const spec = counterTileSpec(input.model);
  const run = await runCounter({
    client: input.client, model: input.model, maxTokens: input.maxTokens, targets,
    sheets: await renderSheets(sheets, input.pdfs, { limits: spec.limits, tileIn: spec.tileIn }),
    shouldStop: input.shouldStop, onProgress, sheetNotes, statusMode,
  });
  const dense = run.sheets.filter(r => r.status === 'counted' && r.unreadable.length > 0);
  if (!dense.length || input.shouldStop?.()) return run;
  // Fix round S2 — once per sheet, only for the types it could not read:
  // every other type keeps the first pass's count (a different tile grid
  // must not silently change a count that was read fine).
  const flaggedBy = new Map(dense.map(d => [d.sheet.key, new Set(d.unreadable.map(u => u.typeKey))]));
  const flaggedAll = new Set([...flaggedBy.values()].flatMap(x => [...x]));
  const tileIn = retryTileIn(spec.tileIn, spec.limits);
  logger.info({ sheets: dense.map(d => d.sheet.label), types: [...flaggedAll], tileIn }, '[counting] dense-area retry at a higher resolution');
  const again = await runCounter({
    client: input.client, model: input.model, maxTokens: input.maxTokens, targets: targets.filter(t => flaggedAll.has(t.key)),
    sheets: await renderSheets(dense.map(d => d.sheet), input.pdfs, { limits: spec.limits, tileIn }),
    shouldStop: input.shouldStop, sheetNotes, statusMode,
    onProgress: onProgress ? (d, t) => onProgress(d, t, 'retry') : undefined,
  });
  for (const k of Object.keys(run.usage) as Array<keyof typeof run.usage>) run.usage[k] += again.usage[k];
  run.sheets = run.sheets.map(r => {
    if (!dense.includes(r)) return r;
    const flagged = flaggedBy.get(r.sheet.key)!;
    const a = again.sheets.find(x => x.sheet.key === r.sheet.key);
    const firstCounts = countsByType(r.placed.filter(p => flagged.has(p.typeKey)));
    const base = {
      firstTileIn: spec.tileIn, tileIn,
      firstCounts,
      firstUnreadable: [...flagged],
    };
    if (a && a.status === 'counted') {
      const retryPlaced = a.placed.filter(p => flagged.has(p.typeKey));
      const retryCounts = countsByType(retryPlaced);
      const lower = [...flagged].filter(k => (retryCounts[k] ?? 0) < (firstCounts[k] ?? 0))
        .map(k => ({ typeKey: k, first: firstCounts[k] ?? 0, retry: retryCounts[k] ?? 0 }));
      const diff = [...flagged].filter(k => (firstCounts[k] ?? 0) !== (retryCounts[k] ?? 0))
        .map(k => `${k} ${firstCounts[k] ?? 0}→${retryCounts[k] ?? 0}`);
      return {
        ...r,
        placed: [...r.placed.filter(p => !flagged.has(p.typeKey)), ...retryPlaced],
        ...(r.statusMarks || a.statusMarks ? { statusMarks: [...(r.statusMarks ?? []).filter(p => !flagged.has(p.typeKey)), ...(a.statusMarks ?? []).filter(p => flagged.has(p.typeKey))] } : {}),
        unreadable: a.unreadable.filter(u => flagged.has(u.typeKey)),
        mergedDuplicates: r.mergedDuplicates + a.mergedDuplicates,
        calls: r.calls + a.calls,
        retry: { ...base, retryCounts, used: 'retry' as const, ...(lower.length ? { lower } : {}) },
        notes: [...r.notes, `Re-counted ${[...flagged].join(', ')} at a higher resolution (${tileIn}" tiles; first pass ${spec.tileIn}") because they could not be read reliably${diff.length ? ` — ${diff.join(', ')}` : ' — same counts'}.`],
      };
    }
    return { ...r, retry: { ...base, retryCounts: {}, used: 'first' as const, error: a?.error ?? 'the retry could not run' } };
  });
  return run;
}

/** Render sequentially (one 300 DPI raster in memory at a time); keep only
 *  the JPEG tiles for the calls. */
async function renderSheets(sheetsIn: CountSheet[], pdfs: Map<string, Buffer>, opts: { limits?: ModelImageLimits; tileIn?: number } = {}): Promise<RenderedSheet[]> {
  const rendered: RenderedSheet[] = [];
  const byFile = new Map<string, CountSheet[]>();
  for (const s of sheetsIn) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file)!.push(s);
  }
  for (const [file, sheets] of byFile) {
    const pdf = pdfs.get(file);
    let geo = new Map<number, PageGeometry>();
    let geoError = '';
    if (pdf) {
      try { geo = await readPageGeometry(pdf, sheets.map(s => s.page)); } catch (err) { geoError = err instanceof Error ? err.message : String(err); }
    }
    for (const s of sheets) {
      const g = geo.get(s.page);
      if (!pdf || !g) {
        rendered.push({ sheet: s, rendered: null, renderError: !pdf ? 'the PDF for this sheet was not available to the counter' : `page geometry could not be read${geoError ? `: ${geoError}` : ''}` });
        continue;
      }
      try {
        rendered.push({ sheet: s, rendered: await renderCountTiles(pdf, s.page, g, opts) });
      } catch (err) {
        logger.warn({ err, sheet: s.label }, '[counting] render failed');
        rendered.push({ sheet: s, rendered: null, renderError: `could not be rendered for counting: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
  return rendered;
}

// ── Next round A4 — the supplement pass ─────────────────────────────────────

export interface SupplementCountingInput extends CountingStageInput {
  /** The run's count result before the supplement. */
  prior: CountResult;
  /** The run's page inventory before the supplement (prep_inventory). */
  priorInventory: InventoryPage[];
  /** Files the supplement added (their pages are counted for every type). */
  newFiles: Set<string>;
}

/** Pure: an earlier sheet's result, rebuilt from the stored count result
 *  (status, the placed marks and what was unreadable) — never re-counted. */
export function priorSheetResult(sheet: CountSheet, prior: CountResult): SheetCountResult {
  const stored = prior.sheets.find(x => x.key === sheet.key);
  const placed = prior.marks.filter(m => m.sheetKey === sheet.key).map(m => ({ typeKey: m.typeKey, tileIds: [], x: m.x, y: m.y, ...(m.circuit ? { circuit: m.circuit } : {}) }));
  return {
    sheet,
    status: stored?.status ?? 'failed',
    ...(stored?.error ? { error: stored.error } : !stored ? { error: 'not counted in the earlier pass' } : {}),
    geometryOk: stored?.geometryOk ?? false,
    geometry: stored?.geometry ?? null,
    placed,
    mergedDuplicates: stored?.mergedDuplicates ?? 0,
    unreadable: [...(stored?.unreadable ?? [])],
    rejected: [],
    notes: [...(stored?.notes ?? [])],
    calls: stored?.calls ?? 0,
    tiles: stored?.tiles ?? 0,
    // Review fix S8 — the earlier pass's consistency check (and so its
    // review item and answer) survives a supplement pass.
    ...consistencyOf(prior, sheet.key),
  };
}

function consistencyOf(prior: CountResult, sheetKey: string): Pick<SheetCountResult, 'consistency' | 'consistencySuggested' | 'consistencyNotReseen'> {
  const c = prior.evidence?.consistency;
  const entries = c?.entries.filter(e => e.sheetKey === sheetKey) ?? [];
  if (!entries.length) return {};
  return {
    consistency: entries,
    consistencySuggested: (c!.suggested ?? []).filter(x => x.sheetKey === sheetKey),
    consistencyNotReseen: (c!.notReseen ?? []).filter(x => x.sheetKey === sheetKey),
  };
}

/** Counting after a supplement pass (a referenced sheet uploaded after the
 *  run): only what the new sheets can change is counted —
 *    * every type on the NEW plan sheets;
 *    * types that are NEW (the added sheet carried schedule rows the run had
 *      not seen) on the earlier sheets, when their PDFs are available —
 *      otherwise those types are marked unreadable there (never assumed 0);
 *  every other count comes from the earlier pass unchanged. Then the one
 *  merge runs over all of it. */
export async function runSupplementCounting(input: SupplementCountingInput): Promise<CountingStageOutput> {
  const built = buildCountTargets(input.agent1);
  if (built.targets.length === 0) return runCountingStage(input);
  const cons = input.evidence ? consolidateTargets(built.targets, { panels: panelNamesOf(input.agent1) }) : undefined;
  const targets = cons ? cons.targets : built.targets;
  const targetNotes = [...built.notes, ...(cons?.merges ?? []).map(m => `${m.type}: ${m.basis}.`)];
  const priorKeys = new Set(input.prior.targets.map(t => t.key));
  const selection = selectCountSheets([...input.priorInventory.filter(p => !input.newFiles.has(p.file)), ...input.inventory.filter(p => input.newFiles.has(p.file))]);
  const isNew = (s: CountSheet) => input.newFiles.has(s.file);
  const newSheets = selection.counted.filter(isNew);
  const oldSheets = selection.counted.filter(s => !isNew(s));
  const usage = { ...ZERO_USAGE };
  const add = (u: typeof usage) => { for (const k of Object.keys(usage) as Array<keyof typeof usage>) usage[k] += u[k]; };

  // Evidence round — the new pages are read like a full run; the earlier
  // pass's typicals and schedule tables are carried over (never re-read,
  // never dropped), so schedule-owned types, typical expansions and fixture
  // families survive the re-merge.
  let evidence: FinishEvidence | undefined;
  let allTargets = targets;
  let counterTargets = targets;
  let sheetNotes: Map<string, string> | undefined;
  if (input.evidence) {
    const pages: EvidencePage[] = [
      ...newSheets.filter(c => !c.photometric).map(c => ({ key: c.key, file: c.file, page: c.page, label: c.label, counted: true })),
      ...input.inventory.filter(p => input.newFiles.has(p.file) && p.included && p.discipline === 'electrical' && p.role !== 'reference'
        && (p.cls === 'schedule' || p.cls === 'detail') && !/^PH/i.test(p.sheetNo.trim()))
        .map(p => ({ key: `${p.file}#${p.page}`, file: p.file, page: p.page, label: sheetLabelOf(p), counted: false })),
    ];
    const ev: EvidenceStageOutput = pages.length
      ? await runEvidenceStage({ client: input.client, model: input.evidence.model, maxTokens: input.evidence.maxTokens, pages, pdfs: input.pdfs, targets: targets.filter(t => !isAliasTarget(t)), cache: input.evidence.cache, shouldStop: input.shouldStop })
      : { pages: [], typicals: [], tables: [], usage: { ...ZERO_USAGE }, calls: 0, cached: 0, errors: [], model: input.evidence.model };
    ev.typicals = remapTypicals([...(input.prior.evidence?.typicals ?? []), ...ev.typicals], cons?.aliasOf);
    ev.tables = dedupePanels([...(input.prior.evidence?.tables ?? []), ...ev.tables]);
    const schedCounts = scheduleCounts(targets, ev.tables);
    allTargets = [...targets, ...hostTargets(ev.typicals, targets)];
    counterTargets = allTargets.filter(t => !schedCounts.has(t.key) && !isAliasTarget(t));
    sheetNotes = new Map(ev.pages.filter(p => p.viewports.viewports.length).map(p => [p.key, viewportPromptBlock(p.viewports.viewports, sanitizeForPrompt)]));
    evidence = { ev, schedCounts, ...(cons ? { cons } : {}) };
  }
  const newCounterTargets = counterTargets.filter(t => !priorKeys.has(t.key));

  const results: SheetCountResult[] = oldSheets.map(s => priorSheetResult(s, input.prior));
  if (newSheets.length && counterTargets.length) {
    const run = await countSheets(input, counterTargets, newSheets, input.onProgress, sheetNotes, { consistency: !!input.evidence, cache: input.evidence?.cache });
    if (evidence && run.consistency) evidence.consistencyRun = run.consistency;
    add(run.usage);
    results.push(...run.sheets);
  }
  if (newCounterTargets.length && oldSheets.length) {
    const available = oldSheets.filter(s => input.pdfs.has(s.file));
    const run = available.length
      ? await countSheets(input, newCounterTargets, available)
      : { sheets: [] as SheetCountResult[], usage: { ...ZERO_USAGE } };
    add(run.usage);
    for (const r of results.filter(x => !isNew(x.sheet))) {
      const again = run.sheets.find(x => x.sheet.key === r.sheet.key);
      if (again && again.status === 'counted') {
        r.placed.push(...again.placed);
        r.unreadable.push(...again.unreadable);
      } else if (r.status === 'counted') {
        const why = again?.error ?? 'its PDF was not available to the supplement pass';
        r.unreadable.push(...newCounterTargets.map(t => ({ typeKey: t.key, tileId: null, note: `new type not re-read on this sheet: ${why}` })));
      }
    }
  }
  const { agent1, countResult } = finish(input, allTargets, targetNotes, results, selection.skipped, true, undefined, evidence, input.prior.sheets.filter(s => !input.newFiles.has(s.file)));
  // Rows the earlier merge held as unscheduled are gone from the takeoff
  // already — keep them held (review items), never dropped by a re-merge.
  const seen = new Set(countResult.removedRows.map(r => JSON.stringify(r.row)));
  countResult.removedRows = [...countResult.removedRows, ...input.prior.removedRows.filter(r => !seen.has(JSON.stringify(r.row)))];
  // Remodel round A1 / A2 — the earlier pass's remodel result (statuses,
  // existing devices, demolition lines) and unlisted tags are carried over
  // unchanged: a supplement never re-counts demolition sheets.
  if (input.prior.remodel && !countResult.remodel) {
    countResult.remodel = input.prior.remodel;
    (agent1.quantities as Record<string, unknown>[]).push(...demolitionRows(input.prior.remodel.demolition));
  }
  if (input.prior.unlisted && !countResult.unlisted) countResult.unlisted = input.prior.unlisted;
  if (input.evidence && evidence) {
    await runGapFillPass(input, input.evidence, countResult, allTargets, evidence.ev.tables);
  }
  return { agent1, countResult, usage };
}

