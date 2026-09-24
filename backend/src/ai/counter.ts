// Takeoff accuracy, Task 4 — the counter agent (Agent 1C, Decision 1).
//
// CALL SPLIT: one call per sheet — the full type list plus every tile of
// that sheet — and a split into tile-groups (whole rows kept together) only
// when a sheet exceeds the per-call image budget (20 images / 24 MB of
// base64). Why per sheet: the model sees the whole plan, so it can tell a
// symbol cut by a tile edge from a new one, recognizes the same tag style
// across tiles, and handles the overlap bands itself (we still de-duplicate
// in code). A standard 24x36 sheet is exactly 20 tiles (countRender.ts), so
// in practice this is one call per sheet. Splitting is correctness-neutral
// because overlap de-dup is done in PDF points after all calls return.
//
// Everything that can be pure is: content building, response parsing, overlap
// de-duplication. runCounter is the thin I/O orchestrator (≤ 3 concurrent
// calls, retries via callWithRetry, truncation fails the run).
import type Anthropic from '@anthropic-ai/sdk';
import { COUNTER_SYSTEM } from './prompts';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { callWithRetry } from './retry';
import { RunCancelledError, runSignalOf } from './runControl';
import { assertNotTruncated, AgentTruncatedError, isAgentTruncatedError } from './stopReason';
import { parseAIJSON } from './json';
import { normalizeTypeKey, type CountTarget } from './countTargets';
import type { CountSheet } from './countSheets';
import { isSiteFixtureCategory } from './countMerge';
import { groupTilesForCalls, tileToPdfPoint, type CountTile, type PageGeometry, type RenderedCountPage } from './countRender';
import { runWithConcurrencyLimit } from '../utils/concurrencyLimit';
import { logger } from '../utils/logger';

export const COUNTER_CONCURRENCY = 3;
/** Two marks of the same type from DIFFERENT tiles within this distance of
 *  each other (midpoint inside both tiles) may be one symbol seen twice in an
 *  overlap band. Fix round 1 / S2: was 0.25", which assumed the model places a
 *  symbol to within ~0.18"; its position error is more like 1-3% of a tile
 *  (0.1-0.25"). 0.83" was tuned on the seeded jittered-counter simulation in
 *  counter.test.ts. Pairing is one-to-one and nearest-first, so two real
 *  fixtures that both tiles report still pair with their own copies. */
export const OVERLAP_DEDUP_RADIUS_PT = 60;
/** A paired symbol's midpoint must lie inside every reporting tile, padded by
 *  this much (a copy reported at the very edge of a tile, clamped by the
 *  parser, still pairs). */
const PAIR_TILE_PAD_IN = 0.25;
/** A reported position may overshoot the tile edge slightly; beyond this it
 *  is rejected rather than clamped. */
const EDGE_TOLERANCE = 0.02;

export interface RawMark { typeKey: string; tileId: string; nx: number; ny: number;
  /** Fix round 3 / S19 — the circuit tag printed at the symbol ("A-31"), when the counter read one. */
  circuit?: string }

/** "A-31" / "A31" / "a 31" -> "A31"; anything that is not a circuit tag -> undefined. */
export function normalizeCircuit(v: unknown): string | undefined {
  const t = String(v ?? '').toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-Z]{0,4}\d{1,3}(?:[,/&]\d{1,3})*$/.test(t) && /\d/.test(t) ? t : undefined;
}
export interface ParsedCounterResponse {
  marks: RawMark[];
  unreadable: Array<{ typeKey: string; tileId: string | null; note: string }>;
  rejected: Array<{ raw: string; reason: string }>;
  notes: string[];
}

// ── Pure: prompt content ───────────────────────────────────────────────────

function targetLine(t: CountTarget): string {
  const parts = [
    `${sanitizeForPrompt(t.type)}`,
    categoryLabel(t),
    sanitizeForPrompt(t.description) || '(no description)',
  ];
  if (t.symbolHint) parts.push(`drawn as: ${sanitizeForPrompt(t.symbolHint)}`);
  if (t.category === 'site_lighting') parts.push('POLE-MOUNTED — mark each pole once');
  if (t.role === 'host') parts.push('HOST MARKER — mark each drawn instance of this tag/symbol on the plans once (it multiplies a typical)');
  return `- ${parts.join(' | ')}`;
}

function categoryLabel(t: CountTarget): string {
  switch (t.category) {
    case 'interior_lighting': return t.emergency ? 'interior emergency/exit fixture' : 'interior light fixture';
    case 'exterior_building': return 'building-mounted exterior fixture';
    case 'site_lighting': return 'site pole light';
    case 'lighting_control': return 'lighting control device';
    case 'device': return 'device';
    case 'equipment': return 'equipment connection';
    case 'panel_circuit': return 'circuit load (fallback — no schedule found)';
  }
}

export function buildCounterContent(
  sheet: Pick<CountSheet, 'label'>,
  targets: CountTarget[],
  tiles: CountTile[],
  group: { index: number; of: number },
  sheetNote = '',
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const scope = group.of > 1
    ? ` — tile-group ${group.index} of ${group.of} (the other tiles of this sheet are counted in separate calls; count only what these tiles show)`
    : '';
  blocks.push({
    type: 'text',
    text: `SHEET: ${sanitizeForPrompt(sheet.label)}${scope}\n\nCOUNT TARGETS (tag | kind | description | how drawn):\n${targets.map(targetLine).join('\n')}${sheetNote}`,
  });
  for (const t of tiles) {
    blocks.push({ type: 'text', text: `Tile ${t.id} (row ${t.row}, column ${t.col})` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: t.jpeg.toString('base64') } });
  }
  blocks.push({
    type: 'text',
    text: `Count every instance of every COUNT TARGET on the ${tiles.length} tile(s) above. Tile ids: ${tiles.map(t => t.id).join(', ')}. Return the strict JSON only.`,
  });
  return blocks;
}

// ── Pure: response parsing ─────────────────────────────────────────────────

/** Fix round 1 / S1 — the reply must have the requested SHAPE: an object
 *  whose `marks` is an array (or, accepted explicitly, a bare top-level array
 *  of marks). Anything else — `{"symbols":[...]}`, a single mark object, a
 *  prose answer — is null, so the sheet FAILS instead of counting zero. */
export function counterReplyShape(text: string): { marks: unknown[]; unreadable: unknown[]; notes: unknown[] } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith('[')) {
    try {
      const v = JSON.parse(body.slice(0, body.lastIndexOf(']') + 1)) as unknown;
      if (Array.isArray(v)) return { marks: v, unreadable: [], notes: [] };
    } catch { /* not a bare array — fall through to the object parse */ }
  }
  const parsed = parseAIJSON(text);
  if (!parsed || !Array.isArray(parsed.marks)) return null;
  return {
    marks: parsed.marks,
    unreadable: Array.isArray(parsed.unreadable) ? parsed.unreadable : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}


/** Tolerant parse of the counter's JSON. Accepts marks as [type, tile, x, y]
 *  arrays (the requested compact form) or {type, tile, x, y} objects. Every
 *  mark is validated: the type must be a listed target, the tile must be one
 *  sent in THIS call, x/y must be finite and within the tile (small overshoot
 *  clamped). Anything else is rejected with a reason — never silently kept. */
export function parseCounterResponse(
  text: string,
  targetKeys: Set<string>,
  tileIds: Set<string>,
): ParsedCounterResponse | null {
  const shape = counterReplyShape(text);
  if (!shape) return null;
  const parsed = shape;
  const out: ParsedCounterResponse = { marks: [], unreadable: [], rejected: [], notes: [] };
  const rawMarks = parsed.marks;
  for (const m of rawMarks) {
    let type: unknown, tile: unknown, x: unknown, y: unknown, circuit: unknown;
    if (Array.isArray(m)) [type, tile, x, y, circuit] = m;
    else if (m && typeof m === 'object') ({ type, tile, x, y, circuit } = m as Record<string, unknown>);
    const raw = JSON.stringify(m).slice(0, 120);
    const typeKey = normalizeTypeKey(String(type ?? ''));
    const tileId = String(tile ?? '').trim().toUpperCase().replace(/^TILE\s+/, '');
    const nx = typeof x === 'number' ? x : Number(x);
    const ny = typeof y === 'number' ? y : Number(y);
    if (!typeKey || !targetKeys.has(typeKey)) { out.rejected.push({ raw, reason: 'type is not a count target' }); continue; }
    if (!tileIds.has(tileId)) { out.rejected.push({ raw, reason: 'tile id was not sent in this call' }); continue; }
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) { out.rejected.push({ raw, reason: 'position is not a number' }); continue; }
    if (nx < -EDGE_TOLERANCE || nx > 1 + EDGE_TOLERANCE || ny < -EDGE_TOLERANCE || ny > 1 + EDGE_TOLERANCE) {
      out.rejected.push({ raw, reason: 'position is outside the tile' });
      continue;
    }
    const ckt = normalizeCircuit(circuit);
    out.marks.push({ typeKey, tileId, nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)), ...(ckt ? { circuit: ckt } : {}) });
  }
  for (const u of parsed.unreadable) {
    if (!u || typeof u !== 'object') continue;
    const r = u as Record<string, unknown>;
    const typeKey = normalizeTypeKey(String(r.type ?? ''));
    if (!targetKeys.has(typeKey)) continue;
    const tileId = String(r.tile ?? '').trim().toUpperCase();
    out.unreadable.push({ typeKey, tileId: tileIds.has(tileId) ? tileId : null, note: String(r.note ?? '').slice(0, 200) });
  }
  for (const n of parsed.notes) {
    if (typeof n === 'string' && n.trim()) out.notes.push(n.trim().slice(0, 200));
    if (out.notes.length >= 5) break;
  }
  return out;
}

// ── Pure: tile -> PDF points and overlap de-duplication ─────────────────────

export interface PlacedMark {
  typeKey: string;
  /** Fix round 3 / S19 — the circuit tag read at the symbol, if any. */
  circuit?: string;
  /** Every tile that reported this symbol (>1 after an overlap merge). */
  tileIds: string[];
  x: number;
  y: number;
}

interface TileArea { id: string; leftIn: number; topIn: number; widthIn: number; heightIn: number }

const EPS = 1e-6;

/** Fix round 1 / S2 — each tile OWNS the core of its area: its rectangle
 *  with every side that overlaps a neighbour pulled in to the middle of that
 *  overlap band. The cores tile the page exactly once. Bounds in displayed
 *  inches: [left, right) x [top, bottom). */
export function tileCores(tiles: TileArea[]): Map<string, { left: number; right: number; top: number; bottom: number }> {
  const out = new Map<string, { left: number; right: number; top: number; bottom: number }>();
  for (const t of tiles) {
    let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
    const tRight = t.leftIn + t.widthIn, tBottom = t.topIn + t.heightIn;
    for (const u of tiles) {
      if (u === t) continue;
      const uRight = u.leftIn + u.widthIn, uBottom = u.topIn + u.heightIn;
      const sameRow = Math.abs(u.topIn - t.topIn) < EPS;
      const sameCol = Math.abs(u.leftIn - t.leftIn) < EPS;
      if (sameRow && u.leftIn > t.leftIn + EPS && u.leftIn < tRight - EPS) right = Math.min(right, (u.leftIn + tRight) / 2);
      if (sameRow && u.leftIn < t.leftIn - EPS && uRight > t.leftIn + EPS) left = Math.max(left, (t.leftIn + uRight) / 2);
      if (sameCol && u.topIn > t.topIn + EPS && u.topIn < tBottom - EPS) bottom = Math.min(bottom, (u.topIn + tBottom) / 2);
      if (sameCol && u.topIn < t.topIn - EPS && uBottom > t.topIn + EPS) top = Math.max(top, (t.topIn + uBottom) / 2);
    }
    out.set(t.id, { left, right, top, bottom });
  }
  return out;
}

/** Converts raw marks to PDF points and resolves overlap-band duplicates.
 *  1. Pairing: same type, DIFFERENT tiles, within `radiusPt`, midpoint inside
 *     every tile involved — merged nearest-first, one mark per tile per
 *     symbol (two marks from the SAME tile are never merged: the model
 *     reported them as distinct symbols). A merged symbol is kept once.
 *  2. Ownership: a mark no other tile paired with is kept only when its
 *     position lies in its own tile's core — a mark outside it is the
 *     neighbour's to report. So a duplicate that position error kept out of
 *     pairing is still counted once unless its two copies land on opposite
 *     wrong sides of the band's midline, which needs an error close to half
 *     the band on both reports. */
export function placeAndDedupe(
  marks: RawMark[],
  tiles: TileArea[],
  geom: PageGeometry,
  radiusPt = OVERLAP_DEDUP_RADIUS_PT,
): { placed: PlacedMark[]; mergedDuplicates: number; outsideCore: number } {
  const byId = new Map(tiles.map(t => [t.id, t]));
  const cores = tileCores(tiles);
  const radiusIn = radiusPt / 72;
  const pts = marks.filter(m => byId.has(m.tileId)).map(m => {
    const tile = byId.get(m.tileId)!;
    return { m, dx: tile.leftIn + m.nx * tile.widthIn, dy: tile.topIn + m.ny * tile.heightIn };
  });
  // Union-find over marks, nearest pairs first.
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tilesOf = pts.map(p => new Set([p.m.tileId]));
  const pairs: Array<{ i: number; j: number; d: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if (a.m.typeKey !== b.m.typeKey || a.m.tileId === b.m.tileId) continue;
      const d = Math.hypot(a.dx - b.dx, a.dy - b.dy);
      if (d > radiusIn) continue;
      pairs.push({ i, j, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
  const pad = PAIR_TILE_PAD_IN + EPS;
  const inTile = (t: TileArea, x: number, y: number) =>
    x >= t.leftIn - pad && x <= t.leftIn + t.widthIn + pad && y >= t.topIn - pad && y <= t.topIn + t.heightIn + pad;
  for (const { i, j } of pairs) {
    const ri = find(i), rj = find(j);
    if (ri === rj) continue;
    const ti = tilesOf[ri], tj = tilesOf[rj];
    if ([...ti].some(t => tj.has(t))) continue; // one mark per tile per symbol
    const mx = (pts[i].dx + pts[j].dx) / 2, my = (pts[i].dy + pts[j].dy) / 2;
    if (![...ti, ...tj].every(id => inTile(byId.get(id)!, mx, my))) continue;
    parent[rj] = ri;
    tj.forEach(t => ti.add(t));
  }
  const clusters = new Map<number, number[]>();
  pts.forEach((_, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  });
  const placed: PlacedMark[] = [];
  let mergedDuplicates = 0;
  let outsideCore = 0;
  const ordered = [...clusters.values()].sort((a, b) => a[0] - b[0]);
  for (const members of ordered) {
    const first = pts[members[0]];
    if (members.length === 1) {
      const c = cores.get(first.m.tileId)!;
      const inCore = first.dx >= c.left - EPS && first.dx < c.right && first.dy >= c.top - EPS && first.dy < c.bottom;
      if (!inCore) { outsideCore++; continue; }
    }
    mergedDuplicates += members.length - 1;
    const dx = members.reduce((s, i) => s + pts[i].dx, 0) / members.length;
    const dy = members.reduce((s, i) => s + pts[i].dy, 0) / members.length;
    const p = displayedInToPdf(dx, dy, geom);
    const circuit = members.map(i => pts[i].m.circuit).find(Boolean);
    placed.push({ typeKey: first.m.typeKey, tileIds: members.map(i => pts[i].m.tileId), x: p.x, y: p.y, ...(circuit ? { circuit } : {}) });
  }
  return { placed, mergedDuplicates, outsideCore };
}

function displayedInToPdf(dxIn: number, dyIn: number, geom: PageGeometry): { x: number; y: number } {
  return tileToPdfPoint({ leftIn: 0, topIn: 0, widthIn: 1, heightIn: 1 }, dxIn, dyIn, geom);
}

// ── I/O orchestration ──────────────────────────────────────────────────────

export interface SheetCountResult {
  sheet: CountSheet;
  status: 'counted' | 'failed';
  error?: string;
  /** false when the raster disagreed with pdf.js's page size — counts are
   *  kept, positions are not trusted (no markers written). */
  geometryOk: boolean;
  geometry: PageGeometry | null;
  placed: PlacedMark[];
  mergedDuplicates: number;
  unreadable: ParsedCounterResponse['unreadable'];
  rejected: ParsedCounterResponse['rejected'];
  notes: string[];
  calls: number;
  tiles: number;
  /** Next round A5 — the dense-area retry: the sheet came back with symbols
   *  that could not be read reliably, so it was counted again at a higher
   *  effective resolution. Both passes are reported. */
  retry?: {
    firstTileIn: number;
    tileIn: number;
    firstCounts: Record<string, number>;
    firstUnreadable: string[];
    retryCounts: Record<string, number>;
    /** Which pass the counts come from. */
    used: 'retry' | 'first';
    error?: string;
    /** Fix round S2 — types the recount found FEWER of: never accepted
     *  silently (a blocking review item asks the estimator). */
    lower?: Array<{ typeKey: string; first: number; retry: number }>;
  };
  /** Real-run fix 5 — the consistency pass on a shifted tile grid, per
   *  dense / high-count type of this sheet, and the marks only one pass
   *  found (SUGGESTED, not in `placed`). */
  consistency?: import('./evidence/consistency').ConsistencyEntry[];
  consistencySuggested?: import('./evidence/consistency').ConsistencySuggestion[];
}

export interface CounterRunInput {
  client: Anthropic;
  model: string;
  maxTokens: number;
  targets: CountTarget[];
  sheets: Array<{ sheet: CountSheet; rendered: RenderedCountPage | null; renderError?: string }>;
  /** Stop analysis — checked before every call; true = start nothing new
   *  and throw RunCancelledError once the in-flight calls settle. */
  shouldStop?: () => boolean;
  /** Live progress: sheets whose every call has finished, of all sheets. */
  onProgress?: (done: number, total: number) => void;
  /** Evidence round 1.2 — per sheet key, extra instructions appended to the
   *  target list (the sheet's viewports). */
  sheetNotes?: Map<string, string>;
}

export interface CounterRunResult {
  sheets: SheetCountResult[];
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number };
}

/** Models that accept output_config.effort (Haiku does not). */
export function supportsEffort(model: string): boolean {
  return !/haiku/i.test(model);
}

function extractText(resp: Anthropic.Message): string {
  return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
}

/** Next round A3 — a photometric sheet is asked only about site and
 *  building-exterior fixture types (countMerge uses it only as a fallback). */
export function targetsForSheet(sheet: CountSheet, targets: CountTarget[]): CountTarget[] {
  return sheet.photometric ? targets.filter(t => isSiteFixtureCategory(t.category)) : targets;
}

export async function runCounter(input: CounterRunInput): Promise<CounterRunResult> {
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const results: SheetCountResult[] = input.sheets.map(({ sheet, rendered, renderError }) => ({
    sheet,
    status: rendered ? 'counted' : 'failed',
    ...(rendered ? {} : { error: renderError || 'sheet could not be rendered' }),
    geometryOk: rendered?.geometryOk ?? false,
    geometry: rendered?.geometry ?? null,
    placed: [], mergedDuplicates: 0, unreadable: [], rejected: [], notes: [],
    calls: 0, tiles: rendered?.tiles.length ?? 0,
  }));

  // One work item per call: (sheet index, tile group).
  const work: Array<{ si: number; tiles: CountTile[]; index: number; of: number }> = [];
  const rawBySheet = new Map<number, RawMark[]>();
  input.sheets.forEach(({ rendered }, si) => {
    if (!rendered) return;
    if (rendered.tiles.length === 0) {
      // N3 — nothing was sent, so nothing was counted: never "counted 0".
      results[si].status = 'failed';
      results[si].error = 'the sheet rendered to no tiles';
      return;
    }
    const groups = groupTilesForCalls(rendered.tiles);
    groups.forEach((g, gi) => work.push({ si, tiles: g.tiles, index: gi + 1, of: groups.length }));
    rawBySheet.set(si, []);
  });

  let truncation: AgentTruncatedError | null = null;
  // Progress by sheet: a sheet is done when all of its calls have settled.
  const callsLeft = new Map<number, number>();
  for (const w of work) callsLeft.set(w.si, (callsLeft.get(w.si) ?? 0) + 1);
  const sheetsTotal = callsLeft.size;
  let sheetsDone = 0;
  input.onProgress?.(0, sheetsTotal);
  const settle = (si: number) => {
    const left = (callsLeft.get(si) ?? 1) - 1;
    callsLeft.set(si, left);
    if (left === 0) { sheetsDone++; input.onProgress?.(sheetsDone, sheetsTotal); }
  };
  await runWithConcurrencyLimit(work, COUNTER_CONCURRENCY, async (w) => {
    if (truncation) return; // a truncated call fails the run — start nothing new
    if (input.shouldStop?.()) return; // Stop analysis — start nothing new
    try { await countOne(w); } finally { settle(w.si); }
  });
  if (input.shouldStop?.()) throw new RunCancelledError();
  if (truncation) throw truncation;

  input.sheets.forEach(({ rendered }, si) => {
    const r = results[si];
    if (!rendered || r.status !== 'counted') return;
    const { placed, mergedDuplicates, outsideCore } = placeAndDedupe(rawBySheet.get(si) ?? [], rendered.tiles, rendered.geometry);
    r.placed = placed;
    r.mergedDuplicates = mergedDuplicates + outsideCore;
  });
  return { sheets: results, usage };

  async function countOne(w: { si: number; tiles: CountTile[]; index: number; of: number }): Promise<void> {
    const r = results[w.si];
    if (r.status === 'failed') return;
    const targets = targetsForSheet(r.sheet, input.targets);
    const content = buildCounterContent(r.sheet, targets, w.tiles, { index: w.index, of: w.of }, input.sheetNotes?.get(r.sheet.key) ?? '');
    try {
      const resp = await callWithRetry(() => input.client.messages.stream({
        model: input.model,
        max_tokens: input.maxTokens,
        system: [{ type: 'text', text: COUNTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        ...(supportsEffort(input.model) ? { output_config: { effort: 'high' as const } } : {}),
      }).finalMessage(), { signal: runSignalOf(input.client), onRetry: (a, _e, d) => logger.warn(`[counter] ${r.sheet.label} retry ${a} in ${d}ms`) });
      r.calls++;
      usage.input_tokens += resp.usage?.input_tokens ?? 0;
      usage.output_tokens += resp.usage?.output_tokens ?? 0;
      usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
      usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
      if (resp.stop_reason === 'refusal') throw new Error('the model declined to count this sheet');
      assertNotTruncated(resp, `Counter (Agent 1C) on ${r.sheet.label}`, input.maxTokens);
      const parsed = parseCounterResponse(extractText(resp), new Set(targets.map(t => t.key)), new Set(w.tiles.map(t => t.id)));
      if (!parsed) throw new Error('the counter reply was not in the expected shape (a JSON object with a "marks" array)');
      if (parsed.marks.length === 0 && parsed.rejected.length > 0) {
        throw new Error(`every mark the counter returned was rejected (${[...new Set(parsed.rejected.map(x => x.reason))].join('; ')})`);
      }
      rawBySheet.get(w.si)!.push(...parsed.marks);
      r.unreadable.push(...parsed.unreadable);
      r.rejected.push(...parsed.rejected);
      r.notes.push(...parsed.notes);
    } catch (err) {
      if (isAgentTruncatedError(err)) { truncation = err as AgentTruncatedError; return; }
      // Any other failure loses THIS sheet only; its types that end at zero
      // become "unreadable" in the review list (never assumed zero).
      r.status = 'failed';
      r.error = err instanceof Error ? err.message : String(err);
      logger.warn({ err, sheet: r.sheet.label }, '[counter] sheet count failed');
    }
  }
}
