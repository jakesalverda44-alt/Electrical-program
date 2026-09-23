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
import { assertNotTruncated, AgentTruncatedError, isAgentTruncatedError } from './stopReason';
import { parseAIJSON } from './json';
import { normalizeTypeKey, type CountTarget } from './countTargets';
import type { CountSheet } from './countSheets';
import { groupTilesForCalls, tileToPdfPoint, type CountTile, type PageGeometry, type RenderedCountPage } from './countRender';
import { runWithConcurrencyLimit } from '../utils/concurrencyLimit';
import { logger } from '../utils/logger';

export const COUNTER_CONCURRENCY = 3;
/** Two marks of the same type from DIFFERENT tiles within this distance of
 *  each other, inside both tiles' areas, are the same symbol seen twice in an
 *  overlap band. 0.25" on paper — well under the spacing of two real fixtures
 *  (4 ft at 1/8" scale = 0.5") and well over the model's position error on a
 *  196 px/in tile. */
export const OVERLAP_DEDUP_RADIUS_PT = 18;
/** A reported position may overshoot the tile edge slightly; beyond this it
 *  is rejected rather than clamped. */
const EDGE_TOLERANCE = 0.02;

export interface RawMark { typeKey: string; tileId: string; nx: number; ny: number }
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
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const scope = group.of > 1
    ? ` — tile-group ${group.index} of ${group.of} (the other tiles of this sheet are counted in separate calls; count only what these tiles show)`
    : '';
  blocks.push({
    type: 'text',
    text: `SHEET: ${sanitizeForPrompt(sheet.label)}${scope}\n\nCOUNT TARGETS (tag | kind | description | how drawn):\n${targets.map(targetLine).join('\n')}`,
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
  const parsed = parseAIJSON(text);
  if (!parsed) return null;
  const out: ParsedCounterResponse = { marks: [], unreadable: [], rejected: [], notes: [] };
  const rawMarks = Array.isArray(parsed.marks) ? parsed.marks : [];
  for (const m of rawMarks) {
    let type: unknown, tile: unknown, x: unknown, y: unknown;
    if (Array.isArray(m)) [type, tile, x, y] = m;
    else if (m && typeof m === 'object') ({ type, tile, x, y } = m as Record<string, unknown>);
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
    out.marks.push({ typeKey, tileId, nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) });
  }
  for (const u of Array.isArray(parsed.unreadable) ? parsed.unreadable : []) {
    if (!u || typeof u !== 'object') continue;
    const r = u as Record<string, unknown>;
    const typeKey = normalizeTypeKey(String(r.type ?? ''));
    if (!targetKeys.has(typeKey)) continue;
    const tileId = String(r.tile ?? '').trim().toUpperCase();
    out.unreadable.push({ typeKey, tileId: tileIds.has(tileId) ? tileId : null, note: String(r.note ?? '').slice(0, 200) });
  }
  for (const n of Array.isArray(parsed.notes) ? parsed.notes : []) {
    if (typeof n === 'string' && n.trim()) out.notes.push(n.trim().slice(0, 200));
    if (out.notes.length >= 5) break;
  }
  return out;
}

// ── Pure: tile -> PDF points and overlap de-duplication ─────────────────────

export interface PlacedMark {
  typeKey: string;
  /** Every tile that reported this symbol (>1 after an overlap merge). */
  tileIds: string[];
  x: number;
  y: number;
}

interface TileArea { id: string; leftIn: number; topIn: number; widthIn: number; heightIn: number }

/** Displayed-inch bounds of a tile. Displayed coords are what the overlap
 *  test needs; PDF points are what we store. */
function inTileDisplayed(tile: TileArea, dxIn: number, dyIn: number, padIn: number): boolean {
  return dxIn >= tile.leftIn - padIn && dxIn <= tile.leftIn + tile.widthIn + padIn
    && dyIn >= tile.topIn - padIn && dyIn <= tile.topIn + tile.heightIn + padIn;
}

/** Converts raw marks to PDF points and merges overlap-band duplicates: the
 *  same type, reported from DIFFERENT tiles, within `radiusPt`, whose merged
 *  position lies inside both tiles (padded by the radius). Two marks from the
 *  SAME tile are never merged — the model reported them as distinct symbols. */
export function placeAndDedupe(
  marks: RawMark[],
  tiles: TileArea[],
  geom: PageGeometry,
  radiusPt = OVERLAP_DEDUP_RADIUS_PT,
): { placed: PlacedMark[]; mergedDuplicates: number } {
  const byId = new Map(tiles.map(t => [t.id, t]));
  type Work = PlacedMark & { dIn: { x: number; y: number } };
  const clusters: Work[] = [];
  let merged = 0;
  const sorted = [...marks].sort((a, b) =>
    a.typeKey.localeCompare(b.typeKey) || a.tileId.localeCompare(b.tileId) || a.ny - b.ny || a.nx - b.nx);
  const padIn = radiusPt / 72;
  for (const m of sorted) {
    const tile = byId.get(m.tileId);
    if (!tile) continue;
    const p = tileToPdfPoint(tile, m.nx, m.ny, geom);
    const dIn = { x: tile.leftIn + m.nx * tile.widthIn, y: tile.topIn + m.ny * tile.heightIn };
    let target: Work | undefined;
    let best = Infinity;
    for (const c of clusters) {
      if (c.typeKey !== m.typeKey || c.tileIds.includes(m.tileId)) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > radiusPt || d >= best) continue;
      const mid = { x: (c.dIn.x + dIn.x) / 2, y: (c.dIn.y + dIn.y) / 2 };
      const allTiles = [...c.tileIds, m.tileId].map(id => byId.get(id)!);
      if (!allTiles.every(t => inTileDisplayed(t, mid.x, mid.y, padIn))) continue;
      target = c;
      best = d;
    }
    if (target) {
      const n = target.tileIds.length;
      target.x = (target.x * n + p.x) / (n + 1);
      target.y = (target.y * n + p.y) / (n + 1);
      target.dIn = { x: (target.dIn.x * n + dIn.x) / (n + 1), y: (target.dIn.y * n + dIn.y) / (n + 1) };
      target.tileIds.push(m.tileId);
      merged++;
    } else {
      clusters.push({ typeKey: m.typeKey, tileIds: [m.tileId], x: p.x, y: p.y, dIn });
    }
  }
  return { placed: clusters.map(({ dIn: _d, ...rest }) => rest), mergedDuplicates: merged };
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
}

export interface CounterRunInput {
  client: Anthropic;
  model: string;
  maxTokens: number;
  targets: CountTarget[];
  sheets: Array<{ sheet: CountSheet; rendered: RenderedCountPage | null; renderError?: string }>;
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

export async function runCounter(input: CounterRunInput): Promise<CounterRunResult> {
  const targetKeys = new Set(input.targets.map(t => t.key));
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
    if (!rendered || rendered.tiles.length === 0) return;
    const groups = groupTilesForCalls(rendered.tiles);
    groups.forEach((g, gi) => work.push({ si, tiles: g.tiles, index: gi + 1, of: groups.length }));
    rawBySheet.set(si, []);
  });

  let truncation: AgentTruncatedError | null = null;
  await runWithConcurrencyLimit(work, COUNTER_CONCURRENCY, async (w) => {
    if (truncation) return; // a truncated call fails the run — start nothing new
    const r = results[w.si];
    if (r.status === 'failed') return;
    const content = buildCounterContent(r.sheet, input.targets, w.tiles, { index: w.index, of: w.of });
    try {
      const resp = await callWithRetry(() => input.client.messages.stream({
        model: input.model,
        max_tokens: input.maxTokens,
        system: [{ type: 'text', text: COUNTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        ...(supportsEffort(input.model) ? { output_config: { effort: 'high' as const } } : {}),
      }).finalMessage(), { onRetry: (a, _e, d) => logger.warn(`[counter] ${r.sheet.label} retry ${a} in ${d}ms`) });
      r.calls++;
      usage.input_tokens += resp.usage?.input_tokens ?? 0;
      usage.output_tokens += resp.usage?.output_tokens ?? 0;
      usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
      usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
      assertNotTruncated(resp, `Counter (Agent 1C) on ${r.sheet.label}`, input.maxTokens);
      if (resp.stop_reason === 'refusal') throw new Error('the model declined to count this sheet');
      const parsed = parseCounterResponse(extractText(resp), targetKeys, new Set(w.tiles.map(t => t.id)));
      if (!parsed) throw new Error('the counter did not return parseable JSON');
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
  });
  if (truncation) throw truncation;

  input.sheets.forEach(({ rendered }, si) => {
    const r = results[si];
    if (!rendered || r.status !== 'counted') return;
    const { placed, mergedDuplicates } = placeAndDedupe(rawBySheet.get(si) ?? [], rendered.tiles, rendered.geometry);
    r.placed = placed;
    r.mergedDuplicates = mergedDuplicates;
  });
  return { sheets: results, usage };
}
