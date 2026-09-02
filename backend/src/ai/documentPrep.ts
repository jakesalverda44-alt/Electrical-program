/**
 * Stage 0 — Document Prep  (runs inside the AI takeoff pipeline, BEFORE Agent 1)
 * -----------------------------------------------------------------------------
 * Purpose: turn uploaded plan PDFs/images into vision blocks Agent 1 can actually
 * read. CAD sheets (24x36) sent as `document` blocks render too coarse — the
 * Anthropic vision API downscales every image to <=1568px on the long edge, so a
 * whole sheet ends up ~43 px/in (illegible 8-pt schedule text). Fix = rasterize
 * each sheet at high DPI, then TILE it into overlapping regions small enough that
 * each tile stays legible after the downscale (~120 px/in).
 *
 * This module is deterministic — it makes NO LLM calls. It only rasterizes,
 * crops, and re-encodes image bytes into Anthropic content blocks.
 *
 * Deploy requirements:
 *   - poppler-utils  (provides `pdftoppm`)  -> Aptfile entry "poppler-utils"
 *   - npm i sharp
 * If `pdftoppm` is missing at runtime we fall back to a single `document` block
 * per PDF so production never hard-fails (just lower fidelity, the old behavior).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import {
  isPdftotextAvailable,
  extractPdfPageTexts,
  pageTextBlock,
  MIN_CHARS_FOR_TEXT_BLOCK,
  TOTAL_TEXT_CAP,
} from './pdfText';

const execFileP = promisify(execFile);

export type SheetClass = 'schedule' | 'plan' | 'detail';

type ImageBlock = Anthropic.ImageBlockParam;
type DocumentBlock = Anthropic.DocumentBlockParam;
type TextBlock = Anthropic.TextBlockParam;
export type Agent1Block = ImageBlock | DocumentBlock | TextBlock;

export interface PrepFile {
  filename: string;
  buffer: Buffer;
  /** lower-cased extension without dot, e.g. "pdf", "jpg", "heic" */
  ext: string;
}

/** Image extensions that already map to a Claude-supported media type. */
const IMG_MEDIA: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

/* ---------------------------------------------------------------------------
 * 1) Classify a sheet by filename -> decides how aggressively we tile.
 *    schedule  = dense tables/diagrams (one-line, panel sched, MCC, matrices) -> tightest tiles
 *    detail    = details/legend/notes -> medium tiles
 *    plan      = floor/site/photometric plans -> looser tiles (counting symbols)
 * ------------------------------------------------------------------------- */
export function classifySheet(filename: string): SheetClass {
  const n = filename.toLowerCase();
  const schedule = [
    'single-line', 'single line', 'one-line', 'one line', 'riser',
    'panel-sched', 'panel schedule', 'panel-schedule', 'schedule',
    'motor-control', 'motor control', 'mcc',
    'equipment-list', 'equipment list', 'matrix',
    'fixture', 'luminaire', 'transformer', 'fault', 'wiring-diagram', 'wiring diagram',
  ];
  const detail = ['detail', 'legend', 'notes', 'abbreviation', 'symbol'];
  const plan = [
    'floor-plan', 'floor plan', 'site-plan', 'site plan',
    'lighting-plan', 'power-plan', 'photometric', 'layout', 'ceiling', 'roof',
  ];

  if (schedule.some(k => n.includes(k))) return 'schedule';
  if (plan.some(k => n.includes(k))) return 'plan';
  if (detail.some(k => n.includes(k))) return 'detail';
  // default: treat unknown electrical sheets as schedule (safer = more detail)
  return 'schedule';
}

/** real-inches per tile target for each class (smaller = higher effective resolution) */
function tileInchesFor(cls: SheetClass): number {
  switch (cls) {
    case 'schedule': return 11; // ~120-140 px/in after downscale — reads 8-pt schedule text
    case 'detail':   return 14;
    case 'plan':     return 16; // counting symbols needs less detail
  }
}

/* ---------------------------------------------------------------------------
 * pdftoppm availability — cached. ENOENT means poppler-utils is not installed,
 * which is the one case we fall back from. Any other exit is treated as present.
 * ------------------------------------------------------------------------- */
let pdftoppmAvailable: boolean | null = null;

export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailable !== null) return pdftoppmAvailable;
  try {
    await execFileP('pdftoppm', ['-v']);
    pdftoppmAvailable = true;
  } catch (err) {
    pdftoppmAvailable = (err as { code?: string })?.code !== 'ENOENT';
  }
  if (!pdftoppmAvailable) {
    logger.warn('[docprep] pdftoppm (poppler-utils) not found — PDFs will fall back to document blocks');
  }
  return pdftoppmAvailable;
}

/** Tiles for a single rasterized PDF page, grouped so callers (e.g. buildAgent1Content)
 *  can interleave a per-page EXTRACTED TEXT block before that page's tiles. */
export interface PdfPageTiles {
  /** 1-based page number, matching pdftotext's page order. */
  page: number;
  tiles: ImageBlock[];
}

/* ---------------------------------------------------------------------------
 * 2) Rasterize a PDF to PNG pages, then tile each page into overlapping crops,
 *    grouped by page. Throws if pdftoppm is unavailable or rasterization fails
 *    — callers fall back.
 * ------------------------------------------------------------------------- */
export async function pdfToTiledImageBlocksByPage(
  pdfBuffer: Buffer,
  opts: { dpi?: number; tileInches?: number; overlap?: number; maxTilesPerPage?: number; maxLongEdge?: number } = {}
): Promise<PdfPageTiles[]> {
  const { dpi = 170, tileInches = 11, overlap = 0.08, maxTilesPerPage = 9, maxLongEdge = 1568 } = opts;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-prep-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdfBuffer);
    await execFileP('pdftoppm', ['-png', '-r', String(dpi), pdfPath, path.join(tmp, 'pg')]);
    const pages = (await fs.readdir(tmp)).filter(f => f.endsWith('.png')).sort();

    const result: PdfPageTiles[] = [];
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const file = path.join(tmp, pages[pageIdx]);
      const meta = await sharp(file).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) continue;

      const tilePx = Math.round(tileInches * dpi);
      let cols = Math.max(1, Math.ceil(width / tilePx));
      let rows = Math.max(1, Math.ceil(height / tilePx));
      while (cols * rows > maxTilesPerPage && (cols > 1 || rows > 1)) {
        if (cols >= rows) cols--; else rows--;
      }
      const cw = Math.ceil(width / cols);
      const ch = Math.ceil(height / rows);
      const ox = Math.round(cw * overlap);
      const oy = Math.round(ch * overlap);

      const tiles: ImageBlock[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const left = Math.max(0, c * cw - ox);
          const top = Math.max(0, r * ch - oy);
          const w = Math.min(width - left, cw + 2 * ox);
          const h = Math.min(height - top, ch + 2 * oy);
          if (w <= 0 || h <= 0) continue;
          const out = await sharp(file)
            .extract({ left, top, width: w, height: h })
            .resize({ width: maxLongEdge, height: maxLongEdge, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
          tiles.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: out.toString('base64') },
          });
        }
      }
      result.push({ page: pageIdx + 1, tiles });
    }
    return result;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Flat convenience wrapper over pdfToTiledImageBlocksByPage — page grouping discarded. */
export async function pdfToTiledImageBlocks(
  pdfBuffer: Buffer,
  opts: { dpi?: number; tileInches?: number; overlap?: number; maxTilesPerPage?: number; maxLongEdge?: number } = {}
): Promise<ImageBlock[]> {
  const grouped = await pdfToTiledImageBlocksByPage(pdfBuffer, opts);
  return grouped.flatMap(g => g.tiles);
}

/** A single `document` block for a PDF — the low-fidelity fallback path. */
function pdfDocumentBlock(buffer: Buffer): DocumentBlock {
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
  };
}

/* ---------------------------------------------------------------------------
 * 3) Normalize a raw image (incl. HEIC) into a single Claude-ready image block.
 *    Fixes the HEIC bug: the uploader accepts .heic but Claude has no heic media
 *    type, so we transcode it (and any non-standard type) to jpeg via sharp.
 *    Returns null if the bytes can't be decoded at all.
 * ------------------------------------------------------------------------- */
async function imageToBlock(buffer: Buffer, ext: string): Promise<ImageBlock | null> {
  const passthrough = IMG_MEDIA[ext];
  if (passthrough) {
    return { type: 'image', source: { type: 'base64', media_type: passthrough, data: buffer.toString('base64') } };
  }
  // heic / tif / anything else Claude can't take -> transcode to jpeg via sharp (libheif).
  try {
    const jpg = await sharp(buffer)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } };
  } catch (err) {
    logger.warn({ err, ext }, '[docprep] could not transcode image — dropping it');
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * 4) Orchestrator: files -> ordered Agent-1 content blocks.
 *    Schedule sheets are tiled tightest and placed FIRST (where Agent 1 reads
 *    them best). Append the existing Agent-1 instruction text block after this.
 * ------------------------------------------------------------------------- */
export async function buildAgent1Content(
  files: PrepFile[],
  opts: { maxTilesPerPage?: number } = {}
): Promise<Agent1Block[]> {
  const popplerOk = await isPdftoppmAvailable();
  const pdftotextOk = await isPdftotextAvailable();

  // order: schedules first, then details, then plans
  const order: Record<SheetClass, number> = { schedule: 0, detail: 1, plan: 2 };
  const sorted = [...files].sort(
    (a, b) => order[classifySheet(a.filename)] - order[classifySheet(b.filename)]
  );

  const blocks: Agent1Block[] = [];

  // Text-extract-first budget: shared across every PDF in this run (Task 1 —
  // playbook rule #1). Once the total cap is hit, one marker block is emitted
  // and no further page text is added — tiles keep flowing normally either way.
  let totalTextChars = 0;
  let totalCapHit = false;
  const addTextBlockForPage = (sheetLabel: string, pageTexts: string[], pageNo: number) => {
    if (totalCapHit) return;
    const text = pageTexts[pageNo - 1];
    if (!text || text.length < MIN_CHARS_FOR_TEXT_BLOCK) return;
    const block = pageTextBlock(sheetLabel, pageNo, text);
    if (totalTextChars + block.text.length > TOTAL_TEXT_CAP) {
      blocks.push({ type: 'text', text: '[additional page text omitted — cap reached]' });
      totalCapHit = true;
      return;
    }
    blocks.push(block);
    totalTextChars += block.text.length;
  };

  for (const f of sorted) {
    const cls = classifySheet(f.filename);
    // A tiny label block so Agent 1 knows which sheet the following tiles belong to.
    blocks.push({ type: 'text', text: `--- Sheet: ${f.filename} (${cls}) ---` });

    if (f.ext === 'pdf') {
      // Extract page text first (independent of tiling — schedules are sometimes
      // raster and plans always need vision, so text is additive, never a
      // replacement). Extraction failure is non-fatal: continue tile-only.
      let pageTexts: string[] = [];
      if (pdftotextOk) {
        try {
          pageTexts = await extractPdfPageTexts(f.buffer);
        } catch (err) {
          logger.warn({ err, file: f.filename }, '[docprep] pdftotext extraction failed — continuing without page text');
        }
      }

      if (!popplerOk) {
        // No tiling available. Fallback matrix: pdftotext present -> text blocks
        // + document block (an improvement over today's document-only); pdftotext
        // absent -> today's behavior exactly (document block only).
        pageTexts.forEach((_, i) => addTextBlockForPage(f.filename, pageTexts, i + 1));
        blocks.push(pdfDocumentBlock(f.buffer));
        continue;
      }
      try {
        const pageGroups = await pdfToTiledImageBlocksByPage(f.buffer, {
          tileInches: tileInchesFor(cls),
          maxTilesPerPage: opts.maxTilesPerPage,
        });
        if (pageGroups.length) {
          for (const group of pageGroups) {
            addTextBlockForPage(f.filename, pageTexts, group.page);
            blocks.push(...group.tiles);
          }
        } else {
          // empty rasterization -> fall back
          pageTexts.forEach((_, i) => addTextBlockForPage(f.filename, pageTexts, i + 1));
          blocks.push(pdfDocumentBlock(f.buffer));
        }
      } catch (err) {
        logger.warn({ err, file: f.filename }, '[docprep] PDF tiling failed — falling back to document block');
        pageTexts.forEach((_, i) => addTextBlockForPage(f.filename, pageTexts, i + 1));
        blocks.push(pdfDocumentBlock(f.buffer));
      }
    } else {
      const block = await imageToBlock(f.buffer, f.ext);
      if (block) blocks.push(block);
    }
  }
  return blocks;
}
