/**
 * Text-extract first (the playbook's rule #1 — see Takeoff_Process.md).
 * -----------------------------------------------------------------------------
 * `pdftotext -layout` pulls the literal text layer out of a PDF — for schedules
 * (luminaire schedules, panel/feeder tables, equipment schedules) that text IS
 * the number, machine-read, not an OCR guess off a rasterized tile. This module
 * makes NO LLM calls; it only shells out to pdftotext and formats the result
 * into Agent-1 content blocks.
 *
 * Deploy requirement: poppler-utils (`pdftotext`) — same Aptfile entry that
 * already provides `pdftoppm` for documentPrep.ts. If `pdftotext` is missing at
 * runtime, callers degrade to tile-only (today's behavior) — never hard-fail.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';
import { sanitizeForPrompt } from './sanitizeForPrompt';

const execFileP = promisify(execFile);

/** Cap on a single page's extracted text sent to Agent 1. */
export const PAGE_TEXT_CAP = 12_000;
/** Cap on total extracted text across an entire run (all files, all pages). */
export const TOTAL_TEXT_CAP = 150_000;
/** Pages with less extracted text than this are treated as raster/drawing-only — no text block. */
export const MIN_CHARS_FOR_TEXT_BLOCK = 200;

/* ---------------------------------------------------------------------------
 * pdftotext availability — cached, same ENOENT-means-missing pattern as
 * documentPrep.ts's isPdftoppmAvailable.
 * ------------------------------------------------------------------------- */
let pdftotextAvailable: boolean | null = null;

export async function isPdftotextAvailable(): Promise<boolean> {
  if (pdftotextAvailable !== null) return pdftotextAvailable;
  try {
    await execFileP('pdftotext', ['-v']);
    pdftotextAvailable = true;
  } catch (err) {
    pdftotextAvailable = (err as { code?: string })?.code !== 'ENOENT';
  }
  if (!pdftotextAvailable) {
    logger.warn('[pdfText] pdftotext (poppler-utils) not found — page text extraction disabled');
  }
  return pdftotextAvailable;
}

/**
 * Pure: split `pdftotext -layout` stdout into per-page strings, each trimmed.
 * pdftotext separates pages with a single form-feed (\f) and typically emits a
 * trailing \f after the last page — that trailing empty page is dropped, but a
 * genuinely empty page in the middle of the document is preserved (as an empty
 * string) so page numbering stays 1:1 with the PDF.
 */
export function splitFormFeedPages(stdout: string): string[] {
  const parts = stdout.split('\f');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.map(p => p.trim());
}

/**
 * Run `pdftotext -layout` once on the whole PDF and split the result into
 * per-page text. Throws on failure (missing binary, corrupt PDF, etc.) —
 * callers are expected to catch and degrade to tile-only.
 */
export async function extractPdfPageTexts(pdfBuffer: Buffer): Promise<string[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-pdftext-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdfBuffer);
    const { stdout } = await execFileP('pdftotext', ['-layout', pdfPath, '-'], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    });
    return splitFormFeedPages(stdout);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export interface Agent1TextBlock {
  type: 'text';
  text: string;
}

/**
 * Pure: build the Agent-1 content block for one page's extracted text, capping
 * a single page at PAGE_TEXT_CAP chars with a visible truncation marker
 * (mirrors truncateWithMarker in agent4Message.ts).
 */
export function pageTextBlock(
  sheetLabel: string,
  pageNo: number,
  text: string,
  opts: { cap?: number } = {}
): Agent1TextBlock {
  const cap = opts.cap ?? PAGE_TEXT_CAP;
  // Phase 4 Task 6.1 (Phase 2 F8) — sanitize BEFORE capping: the extracted
  // text is untrusted (it's the PDF's own text layer) and must never be
  // able to embed a line that impersonates this function's own "--- Sheet
  // ... ---" delimiter grammar.
  const clean = sanitizeForPrompt(text);
  const capped = clean.length > cap ? `${clean.slice(0, cap)}\n[TEXT TRUNCATED]` : clean;
  return {
    type: 'text',
    text: `--- Sheet ${sheetLabel} p${pageNo} — EXTRACTED TEXT (machine-read, treat as FIRM source) ---\n${capped}`,
  };
}
