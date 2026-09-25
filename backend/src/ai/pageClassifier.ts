/**
 * Classify pages by title block, not filename (playbook rule — see
 * Takeoff_Process.md: "identify sheet types by title block, not filename").
 * -----------------------------------------------------------------------------
 * A combined building set filters per-FILE today (documentPrep.ts's
 * classifySheet + preconstruction.ts's isElectricalSheet), so a 62-page combined
 * set with electrical on pp. 44-62 gets sent in its entirety — 40+ non-electrical
 * pages rasterized, tiled, and billed. This module rasterizes a cheap low-res
 * crop of each page's title-block strip, sends batches of those crops to a cheap
 * model for classification, and selects which pages are worth full-fidelity
 * tiling — page-level, not file-level.
 *
 * renderTitleBlockCrops is deterministic (no LLM call). classifyPages is the one
 * AI-touching function here and stays thin — all decision logic (selectPages,
 * formatSheetLabel, parseClassifierJSON) is pure and unit-tested without any live
 * AI call.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from './retry';
import { runSignalOf } from './runControl';
import { assertNotTruncated } from './stopReason';
import { PAGE_CLASSIFIER_SYSTEM } from './prompts';
import { sanitizeForPrompt } from './sanitizeForPrompt';
import { logger } from '../utils/logger';
import { isElectricalSheet, type SheetClass } from './documentPrep';

const execFileP = promisify(execFile);

export type Discipline =
  | 'electrical' | 'fuel' | 'lowvoltage' | 'cover'
  | 'architectural' | 'civil' | 'structural' | 'mechanical' | 'plumbing' | 'other'
  // Plans-panel fix round, Task 3 — a specifications / project-manual page:
  // running text, no drawing, no sheet number. Kept apart from 'other' (a
  // real, unusual drawing sheet) so the sheet check can report "142 sheets in
  // the set" without silently counting a 100+ page spec book as sheets.
  | 'spec'
  // Internal sentinel — not a value the model is asked to return. Used when a
  // page is missing from the model's response entirely (call/parse failure).
  | 'unknown';

export interface PageClassification {
  page: number;
  sheetNo: string;
  title: string;
  discipline: Discipline;
  cls: SheetClass;
}

const VALID_DISCIPLINES = new Set<Discipline>([
  'electrical', 'fuel', 'lowvoltage', 'cover',
  'architectural', 'civil', 'structural', 'mechanical', 'plumbing', 'other', 'spec',
]);
const VALID_CLASSES = new Set<SheetClass>(['schedule', 'plan', 'detail']);

/** Disciplines page selection includes — electrical scope can live on any of
 *  these, plus 'unknown' (the classifier failed to place the page at all —
 *  default-include, matching the current filter's philosophy). */
export const SELECT_DISCIPLINES = new Set<Discipline>(['electrical', 'fuel', 'lowvoltage', 'cover', 'unknown']);

/* ---------------------------------------------------------------------------
 * Pure: crop geometry — the right 25% strip, full height. Title blocks on
 * arch/eng sheet formats live on the right edge or bottom-right corner; a
 * full-height right strip covers both without knowing the sheet format.
 * ------------------------------------------------------------------------- */
export function titleBlockCropRect(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(width * 0.75));
  return { left, top: 0, width: Math.max(1, width - left), height: Math.max(1, height) };
}

/** Result of selectPages — the guard signals when it had to fall back to
 *  including every page (FIX-1, phase 2 post-review) so callers can decide
 *  whether that fallback is actually safe for this file (see
 *  shouldDropWholeFile below) instead of blindly trusting it. */
export interface PageSelectionResult {
  pages: number[];
  /** true when SELECT_DISCIPLINES matched nothing and `pages` is the
   *  include-everything guard fallback, not a real selection. */
  allExcluded: boolean;
}

/* ---------------------------------------------------------------------------
 * Pure: which pages to actually tile at full fidelity. Never excludes
 * everything — same guard as today's whole-file isElectricalSheet filter.
 * ------------------------------------------------------------------------- */
export function selectPages(inventory: PageClassification[]): PageSelectionResult {
  if (inventory.length === 0) return { pages: [], allExcluded: false };
  const selected = inventory.filter(p => SELECT_DISCIPLINES.has(p.discipline)).map(p => p.page);
  if (selected.length > 0) return { pages: selected, allExcluded: false };
  return { pages: inventory.map(p => p.page), allExcluded: true };
}

/* ---------------------------------------------------------------------------
 * Pure — FIX-1 (phase 2 post-review): a purely architectural/other-discipline
 * PDF (e.g. "A101 Architectural.pdf") makes selectPages' all-excluded guard
 * fire and fall back to including every page — tiling and billing a file that
 * is clearly not electrical scope. Trust that fallback only when the filename
 * ITSELF is ambiguous/electrical; when the filename also reads as non-electrical
 * (isElectricalSheet returns false), the whole file should be dropped instead.
 * A real (non-guard) page selection always wins regardless of filename.
 * ------------------------------------------------------------------------- */
export function shouldDropWholeFile(inventory: PageClassification[], filename: string): boolean {
  return selectPages(inventory).allExcluded && !isElectricalSheet(filename);
}

/* ---------------------------------------------------------------------------
 * Pure — FIX-1: the whole-upload safety net. shouldDropWholeFile can fire for
 * every PDF in an upload (e.g. the estimator mistakenly uploaded only an
 * architectural set) — dropping all of them would send Agent 1 nothing at
 * all. Mirrors the pre-existing isElectricalSheet-based filesToSend guard for
 * non-PDF images: never drop every file, revert every drop instead when that
 * would be the outcome.
 * ------------------------------------------------------------------------- */
export function reviveIfAllDropped<T extends { dropFile: boolean }>(files: T[]): T[] {
  if (files.length > 0 && files.every(f => f.dropFile)) {
    return files.map(f => ({ ...f, dropFile: false }));
  }
  return files;
}

/* ---------------------------------------------------------------------------
 * Pure: real sheet identity for the Agent 1 sheet label, e.g.
 * `E1.1 "Panel Schedules"` instead of the filename. Falls back gracefully when
 * the classifier couldn't read a sheet number and/or title.
 * ------------------------------------------------------------------------- */
export function formatSheetLabel(sheetNo: string, title: string, fallback: string): string {
  const no = sheetNo.trim();
  const t = title.trim();
  if (no && t) return `${no} "${t}"`;
  if (no) return no;
  if (t) return `"${t}"`;
  return fallback;
}

/* ---------------------------------------------------------------------------
 * Pure — FIX-5 (post-review): tolerate a classifier response numbered 1..N
 * relative to its own batch instead of echoing the ABSOLUTE page numbers the
 * "Page N:" labels give it (batch 2+ of a large PDF would otherwise come back
 * silently mis-keyed — every byPage lookup misses and every page falls back
 * to unclassified). Detected ONLY when the raw response is EXACTLY the
 * relative sequence [1, 2, ..., N] in order and that is not ALSO what was
 * actually expected (a single-batch run legitimately starts at page 1, and
 * must not be "corrected" into something else) — anything else (a partial
 * response, out-of-order pages, genuine absolute numbers) is left untouched.
 * ------------------------------------------------------------------------- */
export function reoffsetIfRelative(rawPages: number[], expectedPages: number[]): number[] {
  if (rawPages.length === 0 || rawPages.length !== expectedPages.length) return rawPages;
  const isRelativeSequence = rawPages.every((p, i) => p === i + 1);
  const alreadyAbsolute = expectedPages.every((p, i) => p === i + 1);
  if (isRelativeSequence && !alreadyAbsolute) return expectedPages;
  return rawPages;
}

/* ---------------------------------------------------------------------------
 * Pure: tolerant JSON-array parse for the classifier response. Strips markdown
 * fences, tolerates missing/invalid fields per entry, re-offsets a relative-
 * numbered batch back to absolute page numbers (FIX-5, reoffsetIfRelative
 * above), and guarantees one entry per expected page — any page missing from
 * the parsed array (total parse failure, or the model just skipped it) is
 * filled in as 'unknown'/'schedule' (FIX-5: schedule, not plan — the lowest-
 * detail class must never be the silent default; schedule matches
 * documentPrep.ts's own "safer = more detail" philosophy for an unknown
 * sheet) so it is never silently dropped from the inventory or degraded to
 * the lowest fidelity (default-include philosophy).
 * ------------------------------------------------------------------------- */
export function parseClassifierJSON(text: string, expectedPages: number[]): PageClassification[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? text).trim();
  const start = source.indexOf('[');
  let arr: unknown = null;
  if (start >= 0) {
    try {
      arr = JSON.parse(source.slice(start));
    } catch {
      arr = null;
    }
  }

  const rawEntries: Array<{ r: Record<string, unknown>; page: number }> = [];
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const page = Number(r.page);
      if (!Number.isFinite(page)) continue;
      rawEntries.push({ r, page });
    }
  }

  const correctedPages = reoffsetIfRelative(rawEntries.map(e => e.page), expectedPages);

  const byPage = new Map<number, PageClassification>();
  rawEntries.forEach(({ r }, i) => {
    const page = correctedPages[i];
    const disciplineRaw = typeof r.discipline === 'string' ? r.discipline : '';
    const clsRaw = typeof r.cls === 'string' ? r.cls : '';
    byPage.set(page, {
      page,
      sheetNo: typeof r.sheetNo === 'string' ? r.sheetNo : '',
      title: typeof r.title === 'string' ? r.title : '',
      discipline: VALID_DISCIPLINES.has(disciplineRaw as Discipline) ? (disciplineRaw as Discipline) : 'unknown',
      cls: VALID_CLASSES.has(clsRaw as SheetClass) ? (clsRaw as SheetClass) : 'schedule',
    });
  });

  return expectedPages.map(page => byPage.get(page) ?? {
    page, sheetNo: '', title: '', discipline: 'unknown', cls: 'schedule',
  });
}

/* ---------------------------------------------------------------------------
 * renderTitleBlockCrops — the one deterministic (no-LLM) rasterization step.
 * Low-res (100 DPI) is deliberate: this crop only needs to be legible enough
 * for a cheap model to read a sheet number/title, not for a takeoff.
 * ------------------------------------------------------------------------- */
export interface TitleBlockCrop {
  page: number;
  jpeg: Buffer;
}

export async function renderTitleBlockCrops(pdfBuffer: Buffer, opts: { dpi?: number; maxLongEdge?: number } = {}): Promise<TitleBlockCrop[]> {
  const { dpi = 100, maxLongEdge = 800 } = opts;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-classify-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdfBuffer);
    await execFileP('pdftoppm', ['-png', '-r', String(dpi), pdfPath, path.join(tmp, 'pg')]);
    const files = (await fs.readdir(tmp)).filter(f => f.endsWith('.png'));

    const pageFiles: { page: number; file: string }[] = [];
    for (const f of files) {
      const m = f.match(/-(\d+)\.png$/);
      if (!m) continue;
      pageFiles.push({ page: Number(m[1]), file: path.join(tmp, f) });
    }
    pageFiles.sort((a, b) => a.page - b.page);

    const crops: TitleBlockCrop[] = [];
    for (const { page, file } of pageFiles) {
      const meta = await sharp(file).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) continue;
      const rect = titleBlockCropRect(width, height);
      const jpeg = await sharp(file)
        .extract(rect)
        .resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      crops.push({ page, jpeg });
    }
    return crops;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------------
 * classifyPages — the one AI-touching function. Batches of <=20 crops per call
 * (keeps each call small and cheap). Never throws on a bad/unparseable
 * response for one batch — parseClassifierJSON always returns an entry per
 * page (worst case 'unknown', which selectPages default-includes) — but a
 * transport-level failure (after callWithRetry exhausts retries) does throw,
 * so the caller can fall back to today's whole-file behavior for this PDF.
 * ------------------------------------------------------------------------- */
const CLASSIFY_BATCH_SIZE = 20;
/** Fixed classifier output budget — ~60 tokens per page x 20 pages is ~1,200,
 *  so 2,500 leaves 2x headroom. Takeoff accuracy Task 1: a response that still
 *  hits it throws (AgentTruncatedError) instead of silently degrading every
 *  missing page to 'unknown'. */
export const CLASSIFIER_MAX_TOKENS = 2500;

export interface ClassifyPagesResult {
  classifications: PageClassification[];
  usage: { input_tokens: number; output_tokens: number };
}

export async function classifyPages(
  client: Anthropic,
  model: string,
  crops: TitleBlockCrop[],
  filename: string
): Promise<ClassifyPagesResult> {
  const classifications: PageClassification[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  // Phase 4 Task 6.1 (Phase 2 F8) — the uploaded filename is untrusted and
  // gets interpolated straight into the classification prompt below; never
  // let it impersonate the pipeline's own delimiter grammar.
  const safeFilename = sanitizeForPrompt(filename);

  for (let i = 0; i < crops.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = crops.slice(i, i + CLASSIFY_BATCH_SIZE);
    const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
    for (const c of batch) {
      // FIX-5 (post-review): c.page is the page's ABSOLUTE number in the full
      // document (renderTitleBlockCrops preserves pdftoppm's real page
      // numbers) — never 1-based within this batch, even for batch 2+ of a
      // >20-page PDF. The instruction below makes that explicit so the model
      // echoes it back rather than renumbering from 1.
      content.push({ type: 'text', text: `Page ${c.page} (absolute page number in the full document):` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.jpeg.toString('base64') } });
    }
    content.push({
      type: 'text',
      text: `Classify each of the ${batch.length} title-block crops above from "${safeFilename}", in the order given. Each crop's "Page N" label states its ABSOLUTE page number in the full document — echo that exact number back in the "page" field of your JSON output; do NOT renumber starting from 1 for this batch. Return the STRICT JSON array only.`,
    });

    const resp = await callWithRetry(() => client.messages.stream({
      model,
      max_tokens: CLASSIFIER_MAX_TOKENS,
      temperature: 0,
      system: [{ type: 'text', text: PAGE_CLASSIFIER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    }).finalMessage(), { signal: runSignalOf(client), onRetry: (a, _e, d) => logger.warn(`[pageClassifier] retry ${a} in ${d}ms`) });

    assertNotTruncated(resp, 'Page classifier', CLASSIFIER_MAX_TOKENS, 'the classifier budget is fixed in code at 2,500 tokens per 20-page batch, not a Settings field');
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
    const expectedPages = batch.map(c => c.page);
    classifications.push(...parseClassifierJSON(text, expectedPages));
    if (resp.usage) {
      usage.input_tokens += resp.usage.input_tokens ?? 0;
      usage.output_tokens += resp.usage.output_tokens ?? 0;
    }
  }

  return { classifications, usage };
}
