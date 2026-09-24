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
import { readPageGeometry, renderCountTiles, type RenderedCountPage, type PageGeometry } from './countRender';
import { runCounter, type SheetCountResult } from './counter';
import { mergeCountsIntoTakeoff, isSiteFixtureCategory, type CountMergeResult, type CountMergeEvidenceResult, type SheetCountInput } from './countMerge';
import { logger } from '../utils/logger';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { runEvidenceStage, type EvidenceCache, type EvidencePage, type EvidenceStageOutput, type EvidenceUsage } from './evidence/evidenceStage';
import { resolveSheetMarks, viewportPromptBlock, type EnlargedDecision } from './evidence/viewportResolve';
import { hostTargets, type TypicalPackage } from './evidence/typicals';
import { scheduleCounts, type ScheduleCount, type ScheduleTable } from './evidence/schedules';
import type { Viewport } from './evidence/viewports';

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
  /** Evidence round 1.2 — marks not counted as devices, per type, with why. */
  excluded?: Array<{ typeKey: string; count: number; reasons: string[] }>;
  /** Evidence round 1.3 — enlarged plan vs main plan, per type. */
  enlarged?: EnlargedDecision[];
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
  unmappedTypical: CountMergeEvidenceResult['unmappedTypical'];
  tables: ScheduleTable[];
  families: CountMergeEvidenceResult['families'];
  symbolDefinitions: CountMergeEvidenceResult['symbolDefinitions'];
  circuitRows: number;
  /** Types whose quantity the schedule parser owns (never sent to the counter). */
  scheduleOwned: string[];
  /** Panels the drawing analysis found (panels[]). */
  panelsExpected: number;
  /** Panel-schedule viewports the viewport reader identified whose table
   *  could not be read completely — their branch circuits have no source
   *  (3.4: Agent 1 no longer states them). */
  panelsUnread: string[];
}

/** One counted symbol, in PDF points on its page (est_markups space). */
export interface CountMark { sheetKey: string; typeKey: string; x: number; y: number }

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
}

export interface CountingStageOutput {
  agent1: Record<string, unknown>;
  countResult: CountResult;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
}

const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

interface FinishEvidence {
  ev: EvidenceStageOutput;
  schedCounts: Map<string, ScheduleCount>;
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
): { agent1: Record<string, unknown>; countResult: CountResult } {
  // Evidence round 1.2 / 1.3 — attribute every mark to its viewport and
  // reconcile enlarged plans with the main plan, before any cross-sheet rule.
  const vpBy = new Map((evidence?.ev.pages ?? []).map(p => [p.key, p]));
  const extra = new Map<string, Pick<CountResultSheet, 'viewports' | 'viewportSource' | 'viewportNote' | 'excluded' | 'enlarged'>>();
  const mergeInputs: SheetCountInput[] = sheetResults.map(r => {
    const page = vpBy.get(r.sheet.key);
    if (!evidence || r.status !== 'counted' || !page) return r;
    const res = resolveSheetMarks(r.placed, page.viewports.viewports, r.geometry ?? page.geometry);
    const exBy = new Map<string, { count: number; reasons: Set<string> }>();
    for (const m of res.excluded) {
      const e = exBy.get(m.typeKey) ?? { count: 0, reasons: new Set<string>() };
      e.count++; e.reasons.add(m.reason);
      exBy.set(m.typeKey, e);
    }
    extra.set(r.sheet.key, {
      viewports: page.viewports.viewports, viewportSource: page.viewports.source,
      ...(page.viewports.note ? { viewportNote: page.viewports.note } : {}),
      ...(exBy.size ? { excluded: [...exBy.entries()].map(([typeKey, e]) => ({ typeKey, count: e.count, reasons: [...e.reasons] })) } : {}),
      ...(res.enlarged.length ? { enlarged: res.enlarged } : {}),
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
    ? r.placed.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ sheetKey: r.sheet.key, typeKey: p.typeKey, x: Math.round(p.x! * 100) / 100, y: Math.round(p.y! * 100) / 100 }))
    : []);
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
      status: r.status, ...(r.error ? { error: r.error } : {}),
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
        unmappedTypical: merged.evidence?.unmappedTypical ?? [],
        tables: evidence.ev.tables,
        families: merged.evidence?.families ?? [],
        symbolDefinitions: merged.evidence?.symbolDefinitions ?? [],
        circuitRows: merged.evidence?.circuitRows ?? 0,
        scheduleOwned: [...evidence.schedCounts.keys()],
        panelsExpected: Array.isArray(input.agent1.panels) ? input.agent1.panels.length : 0,
        panelsUnread: evidence.ev.pages.flatMap(p => p.viewports.viewports
          .filter(v => v.kind === 'schedule' && /\bPANEL(BOARD)?\b/i.test(v.title) && !/\bLOAD\b/i.test(v.title))
          .filter(v => !evidence.ev.tables.some(t => t.viewportId === v.id && t.kind === 'panel' && !t.warnings.length))
          .map(v => `${v.title} (${p.label})`)),
      },
    } : {}),
  };
  // Agent 2/3/4 read agent1_output: counted rows replace Agent 1's, and a
  // short summary rides along so QC sees what was counted and what is held.
  const pending = merged.types.filter(t => t.status !== 'counted' && t.status !== 'merged' && !t.host).map(t => `${t.type} (${t.reason})`);
  const agent1 = {
    ...input.agent1,
    quantities: merged.quantities,
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

export async function runCountingStage(input: CountingStageInput): Promise<CountingStageOutput> {
  const { targets, notes: targetNotes } = buildCountTargets(input.agent1);
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
      pages, pdfs: input.pdfs, targets, cache: input.evidence.cache, shouldStop: input.shouldStop,
    });
    const hosts = hostTargets(ev.typicals, targets);
    const schedCounts = scheduleCounts(targets, ev.tables);
    allTargets = [...targets, ...hosts];
    counterTargets = allTargets.filter(t => !schedCounts.has(t.key));
    sheetNotes = new Map(ev.pages.filter(p => p.viewports.viewports.length).map(p => [p.key, viewportPromptBlock(p.viewports.viewports, sanitizeForPrompt)]));
    evidence = { ev, schedCounts };
    logger.info({ pages: ev.pages.length, calls: ev.calls, cached: ev.cached, typicals: ev.typicals.length, tables: ev.tables.length, hosts: hosts.length, scheduleOwned: schedCounts.size, errors: ev.errors }, '[counting] evidence readers done');
  }

  // A truncated call throws AgentTruncatedError out of here (the run fails);
  // every other per-sheet failure is recorded on that sheet by runCounter.
  const run = counterTargets.length
    ? await countSheets(input, counterTargets, selection.counted, input.onProgress, sheetNotes)
    : { sheets: selection.counted.map(sheet => ({ sheet, status: 'counted' as const, geometryOk: false, geometry: null, placed: [], mergedDuplicates: 0, unreadable: [], rejected: [], notes: ['every type on this job is owned by the schedules — nothing to count'], calls: 0, tiles: 0 })), usage: { ...ZERO_USAGE } };
  const { agent1, countResult } = finish(input, allTargets, targetNotes, run.sheets, selection.skipped, true, undefined, evidence);
  return { agent1, countResult, usage: run.usage };
}

function sheetLabelOf(p: InventoryPage): string {
  const no = p.sheetNo.trim(), t = p.title.trim();
  return no && t ? `${no} "${t}"` : no || (t ? `"${t}"` : `${p.file} p${p.page}`);
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
): Promise<{ sheets: SheetCountResult[]; usage: CountingStageOutput['usage'] }> {
  const spec = counterTileSpec(input.model);
  const run = await runCounter({
    client: input.client, model: input.model, maxTokens: input.maxTokens, targets,
    sheets: await renderSheets(sheets, input.pdfs, { limits: spec.limits, tileIn: spec.tileIn }),
    shouldStop: input.shouldStop, onProgress, sheetNotes,
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
    shouldStop: input.shouldStop, sheetNotes,
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
  const placed = prior.marks.filter(m => m.sheetKey === sheet.key).map(m => ({ typeKey: m.typeKey, tileIds: [], x: m.x, y: m.y }));
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
  const { targets, notes: targetNotes } = buildCountTargets(input.agent1);
  if (targets.length === 0) return runCountingStage(input);
  const priorKeys = new Set(input.prior.targets.map(t => t.key));
  const newTargets = targets.filter(t => !priorKeys.has(t.key));
  const selection = selectCountSheets([...input.priorInventory.filter(p => !input.newFiles.has(p.file)), ...input.inventory.filter(p => input.newFiles.has(p.file))]);
  const isNew = (s: CountSheet) => input.newFiles.has(s.file);
  const newSheets = selection.counted.filter(isNew);
  const oldSheets = selection.counted.filter(s => !isNew(s));
  const usage = { ...ZERO_USAGE };
  const add = (u: typeof usage) => { for (const k of Object.keys(usage) as Array<keyof typeof usage>) usage[k] += u[k]; };

  const results: SheetCountResult[] = oldSheets.map(s => priorSheetResult(s, input.prior));
  if (newSheets.length) {
    const run = await countSheets(input, targets, newSheets, input.onProgress);
    add(run.usage);
    results.push(...run.sheets);
  }
  if (newTargets.length && oldSheets.length) {
    const available = oldSheets.filter(s => input.pdfs.has(s.file));
    const run = available.length
      ? await countSheets(input, newTargets, available)
      : { sheets: [] as SheetCountResult[], usage: { ...ZERO_USAGE } };
    add(run.usage);
    for (const r of results.filter(x => !isNew(x.sheet))) {
      const again = run.sheets.find(x => x.sheet.key === r.sheet.key);
      if (again && again.status === 'counted') {
        r.placed.push(...again.placed);
        r.unreadable.push(...again.unreadable);
      } else if (r.status === 'counted') {
        const why = again?.error ?? 'its PDF was not available to the supplement pass';
        r.unreadable.push(...newTargets.map(t => ({ typeKey: t.key, tileId: null, note: `new type not re-read on this sheet: ${why}` })));
      }
    }
  }
  const { agent1, countResult } = finish(input, targets, targetNotes, results, selection.skipped, true, undefined);
  // Rows the earlier merge held as unscheduled are gone from the takeoff
  // already — keep them held (review items), never dropped by a re-merge.
  const seen = new Set(countResult.removedRows.map(r => JSON.stringify(r.row)));
  countResult.removedRows = [...countResult.removedRows, ...input.prior.removedRows.filter(r => !seen.has(JSON.stringify(r.row)))];
  return { agent1, countResult, usage };
}

