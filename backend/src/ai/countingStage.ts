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
import { selectCountSheets, type InventoryPage, type CountSheet } from './countSheets';
import { readPageGeometry, renderCountTiles, type RenderedCountPage, type PageGeometry } from './countRender';
import { runCounter, type SheetCountResult } from './counter';
import { mergeCountsIntoTakeoff, isSiteFixtureCategory, type CountMergeResult } from './countMerge';
import { logger } from '../utils/logger';

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
  onProgress?: (done: number, total: number) => void;
}

export interface CountingStageOutput {
  agent1: Record<string, unknown>;
  countResult: CountResult;
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
}

const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function finish(
  input: CountingStageInput,
  targets: CountTarget[],
  targetNotes: string[],
  sheetResults: SheetCountResult[],
  skippedSheets: CountResult['skippedSheets'],
  ran: boolean,
  notRunReason: string | undefined,
): { agent1: Record<string, unknown>; countResult: CountResult } {
  const merged = mergeCountsIntoTakeoff(input.agent1, targets, sheetResults, { countingRan: ran, notRunReason });
  const marks: CountMark[] = sheetResults.flatMap(r => r.status === 'counted'
    ? r.placed.map(p => ({ sheetKey: r.sheet.key, typeKey: p.typeKey, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }))
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
    })),
    skippedSheets,
    types: merged.types,
    loadCheck: merged.loadCheck,
    removedRows: merged.removedRows,
    flags: merged.flags,
    marks,
  };
  // Agent 2/3/4 read agent1_output: counted rows replace Agent 1's, and a
  // short summary rides along so QC sees what was counted and what is held.
  const pending = merged.types.filter(t => t.status !== 'counted').map(t => `${t.type} (${t.reason})`);
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

  const rendered = await renderSheets(selection.counted, input.pdfs);

  // A truncated call throws AgentTruncatedError out of here (the run fails);
  // every other per-sheet failure is recorded on that sheet by runCounter.
  const run = await runCounter({ client: input.client, model: input.model, maxTokens: input.maxTokens, targets, sheets: rendered, shouldStop: input.shouldStop, onProgress: input.onProgress });
  const { agent1, countResult } = finish(input, targets, targetNotes, run.sheets, selection.skipped, true, undefined);
  return { agent1, countResult, usage: run.usage };
}

type RenderedSheet = { sheet: CountSheet; rendered: RenderedCountPage | null; renderError?: string };

/** Render sequentially (one 300 DPI raster in memory at a time); keep only
 *  the JPEG tiles for the calls. */
async function renderSheets(sheetsIn: CountSheet[], pdfs: Map<string, Buffer>): Promise<RenderedSheet[]> {
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
        rendered.push({ sheet: s, rendered: await renderCountTiles(pdf, s.page, g) });
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
    const run = await runCounter({ client: input.client, model: input.model, maxTokens: input.maxTokens, targets, sheets: await renderSheets(newSheets, input.pdfs), shouldStop: input.shouldStop, onProgress: input.onProgress });
    add(run.usage);
    results.push(...run.sheets);
  }
  if (newTargets.length && oldSheets.length) {
    const available = oldSheets.filter(s => input.pdfs.has(s.file));
    const run = available.length
      ? await runCounter({ client: input.client, model: input.model, maxTokens: input.maxTokens, targets: newTargets, sheets: await renderSheets(available, input.pdfs), shouldStop: input.shouldStop })
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

