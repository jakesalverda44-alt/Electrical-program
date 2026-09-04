/**
 * FIX-2 (phase 2 post-review) — batch Agent 1 by estimated input-token budget,
 * not by file count.
 * -----------------------------------------------------------------------------
 * Before this module, Stage 0 split work into one Agent 1 call per BATCH_SIZE
 * *files* (1 file/call whenever more than one PDF was uploaded, otherwise the
 * whole upload in a single call). That has nothing to do with how much content
 * a call actually carries: a single combined PDF with 19 selected pages went
 * out as ONE call — tiles for ~19 pages at up to 15 tiles/page (Task 3's
 * schedule-class cap) is comfortably north of 200k estimated input tokens,
 * over the context window, and (per the plan's own headline scenario) the kind
 * of call that times out around 400s instead of failing fast.
 *
 * This module packs individual PAGES (not files) into batches sized to stay
 * under a token budget, regardless of how many files those pages came from —
 * a big combined set now goes out as N right-sized calls; several small files
 * that easily fit together still go out as one call, same as before.
 *
 * Pure and unit-tested — no AI calls, no file IO. The caller (preconstruction.ts)
 * is responsible for building one Agent1WorkUnit per page/file up front (Task 2's
 * classification + Task 1's text extraction, run ONCE per file — see FIX-2(a))
 * and for turning a packed batch of units into actual Agent 1 content blocks.
 */

import type { SheetClass, Agent1Block, PdfPageSelection } from './documentPrep';
import {
  tileSettingsFor, tilesForSelectedPdfPages, pdfDocumentBlock, imageToBlock,
  type TileSettingsOverrides,
} from './documentPrep';
import { pageTextBlock, MIN_CHARS_FOR_TEXT_BLOCK, TOTAL_TEXT_CAP } from './pdfText';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { logger } from '../utils/logger';

/**
 * Anthropic's vision pricing is approximately (width_px * height_px) / 750
 * tokens per image, post the 1568px-long-edge downscale documentPrep.ts's
 * tileSettingsFor already targets. A tile at that ceiling (up to 1568x1568)
 * costs up to ~1568*1568/750 ≈ 3277 tokens; most tiles land close to that
 * ceiling since tileInches * dpi is chosen to just clear it (Task 3). 3000 is
 * a deliberately simple, slightly conservative flat per-tile estimate rather
 * than rasterizing to measure each tile's actual pixel dimensions before
 * deciding how to batch — the whole point is estimating BEFORE paying the
 * rasterization cost.
 */
export const TOKENS_PER_TILE = 3000;

/** Small fixed per-page overhead for the sheet-label text block and message
 *  structure around each page's content — not itself a meaningful cost driver,
 *  just keeps the estimate from being an exact undercount. */
export const PAGE_TOKEN_OVERHEAD = 200;

/** Target ceiling for one Agent 1 call's ESTIMATED input tokens. Well under
 *  Claude's context window (200k) — the estimate is approximate (flat
 *  per-tile cost, not measured pixels), so the budget leaves headroom rather
 *  than cutting it as close as the true window allows. */
export const AGENT1_INPUT_BUDGET = 100_000;

/** Pure — the tile count a class is estimated to need. Uses each class's
 *  maxTilesPerPage (Task 3): that cap IS the natural full-grid tile count for
 *  a standard 36x24 sheet at that class's target tile size (e.g. schedule's
 *  8" tiles grid a 36x24 sheet into exactly 5x3 = 15 — its cap, not a
 *  worst-case ceiling), so it doubles as a reasonable per-page estimate
 *  before the page has actually been rasterized. */
export function tilesForClass(cls: SheetClass, overrides?: TileSettingsOverrides): number {
  return tileSettingsFor(cls, overrides).maxTilesPerPage;
}

/** Pure — one page's estimated Agent 1 input-token cost: its tiles' image
 *  cost, plus its extracted text (Task 1) at ~4 chars/token, plus a small
 *  fixed overhead. */
export function estimatePageTokens(
  cls: SheetClass,
  textChars: number,
  overrides?: TileSettingsOverrides
): number {
  return tilesForClass(cls, overrides) * TOKENS_PER_TILE + Math.ceil(textChars / 4) + PAGE_TOKEN_OVERHEAD;
}

/** One page (or whole-file unit) of Stage 0 work, ready to be packed and then
 *  turned into Agent 1 content blocks. A discriminated union: 'pdf-page' is
 *  the normal, page-selected case this fix targets; 'image' is an un-paginated
 *  non-PDF file; 'document-fallback' is the last-resort whole-PDF-as-one-block
 *  case (poppler unavailable, or page count couldn't be determined at all). */
export type Agent1WorkUnit =
  | {
      kind: 'pdf-page';
      filename: string;
      buffer: Buffer;
      page: number;
      label: string;
      cls: SheetClass;
      pageText: string;
      estTokens: number;
    }
  | {
      kind: 'image';
      filename: string;
      buffer: Buffer;
      ext: string;
      cls: SheetClass;
      estTokens: number;
    }
  | {
      kind: 'document-fallback';
      filename: string;
      buffer: Buffer;
      cls: SheetClass;
      pageTexts: string[];
      estTokens: number;
    };

/** Class ordering used both for the old whole-file sort and this page-level
 *  one: schedules first (read best when Agent 1 sees them first), then
 *  details, then plans. */
const CLASS_ORDER: Record<SheetClass, number> = { schedule: 0, detail: 1, plan: 2 };

/** Pure — schedule-first ordering across the WHOLE upload (not just within one
 *  file): a stable sort so pages within the same class keep their original
 *  (file, then page) order. Must run before packPagesByBudget — the packer
 *  itself never reorders. */
export function orderScheduleFirst<T extends { cls: SheetClass }>(units: T[]): T[] {
  return units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => CLASS_ORDER[a.u.cls] - CLASS_ORDER[b.u.cls] || a.i - b.i)
    .map(({ u }) => u);
}

/** Pure — greedily pack an ORDERED list of units into batches whose estimated
 *  token total stays under `budget`. Never reorders (the caller is expected
 *  to have already applied schedule-first ordering across the whole upload).
 *  A single unit whose own estimate exceeds the budget gets its own batch
 *  rather than blocking the packer or being silently dropped. */
export function packPagesByBudget<T extends { estTokens: number }>(units: T[], budget: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const u of units) {
    if (current.length > 0 && currentTokens + u.estTokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(u);
    currentTokens += u.estTokens;
    if (current.length === 1 && u.estTokens > budget) {
      // Oversized single unit — isolate it now rather than let more units
      // pile onto a batch that's already over budget.
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Turn one packed batch (an ordered list of Agent1WorkUnit) into Agent 1
 * content blocks — the non-pure counterpart to the packing functions above.
 * A batch commonly interleaves pages from several different files (that's the
 * whole point of packing by budget rather than by file); PDF-page units are
 * grouped by filename here so each file needs only one tilesForSelectedPdfPages
 * call per batch (one pdftoppm invocation per class-group within it) no matter
 * how the packer interleaved its pages with other files', then reassembled
 * back into the batch's original (schedule-first) order.
 *
 * FIX-2 note: the total-extracted-text cap (TOTAL_TEXT_CAP, Task 1) is scoped
 * PER BATCH here, not per whole run — its purpose was always to protect a
 * single Agent 1 call's context window, which is now this batch's job exactly
 * once per call rather than once for the entire (possibly multi-call) upload.
 */
export async function buildBlocksForBatch(
  units: Agent1WorkUnit[],
  opts: { tileOverrides?: TileSettingsOverrides } = {}
): Promise<Agent1Block[]> {
  const byFile = new Map<string, { buffer: Buffer; pages: PdfPageSelection[] }>();
  for (const u of units) {
    if (u.kind !== 'pdf-page') continue;
    if (!byFile.has(u.filename)) byFile.set(u.filename, { buffer: u.buffer, pages: [] });
    byFile.get(u.filename)!.pages.push({ page: u.page, label: u.label, cls: u.cls });
  }

  const tilesByKey = new Map<string, Agent1Block[]>();
  for (const [filename, { buffer, pages }] of byFile) {
    try {
      const groups = await tilesForSelectedPdfPages(buffer, pages, opts.tileOverrides);
      for (const g of groups) tilesByKey.set(`${filename}#${g.page}`, g.tiles);
    } catch (err) {
      logger.warn({ err, filename }, '[agent1Batching] batch PDF tiling failed for this file — its pages fall back to text-only');
    }
  }

  let totalTextChars = 0;
  let totalCapHit = false;
  const blocks: Agent1Block[] = [];
  const addText = (label: string, pageNo: number, text: string) => {
    if (totalCapHit || !text || text.length < MIN_CHARS_FOR_TEXT_BLOCK) return;
    const block = pageTextBlock(label, pageNo, text);
    if (totalTextChars + block.text.length > TOTAL_TEXT_CAP) {
      blocks.push({ type: 'text', text: '[additional page text omitted — cap reached]' });
      totalCapHit = true;
      return;
    }
    blocks.push(block);
    totalTextChars += block.text.length;
  };

  for (const u of units) {
    if (u.kind === 'image') {
      const block = await imageToBlock(u.buffer, u.ext);
      if (block) blocks.push(block);
      continue;
    }
    if (u.kind === 'document-fallback') {
      // u.filename is the raw uploaded filename — attacker-controlled — and lands
      // inside this delimiter grammar; sanitize it (audit: Security #10, High —
      // this module's buildBlocksForBatch is what the live route actually calls).
      blocks.push({ type: 'text', text: `--- Sheet: ${sanitizeForPrompt(u.filename)} (${sanitizeForPrompt(u.cls)}) ---` });
      u.pageTexts.forEach((text, i) => addText(u.filename, i + 1, text));
      blocks.push(pdfDocumentBlock(u.buffer));
      continue;
    }
    // 'pdf-page' — u.label is built from the vision classifier's echoed sheet
    // number/title, also attacker-influenceable via a hostile title block.
    blocks.push({ type: 'text', text: `--- Sheet: ${sanitizeForPrompt(u.label)} (${sanitizeForPrompt(u.cls)}) ---` });
    addText(u.label, u.page, u.pageText);
    const tiles = tilesByKey.get(`${u.filename}#${u.page}`);
    if (tiles) blocks.push(...tiles);
  }
  return blocks;
}
