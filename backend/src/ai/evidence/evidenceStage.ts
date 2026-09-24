// Evidence round Parts 1-3 — the I/O half: read each evidence page's text
// layer, detect its viewports (text, else ONE vision call on the sheet
// overview), extract typical packages from its legend / notes viewports
// (text, else ONE vision call with the viewport crops), and read its
// schedule tables (text, else one vision call per table crop). Every model
// call is narrow, structured, cached by the file's content hash, and
// validated by the pure modules. Failure policy:
//   * a truncated call throws AgentTruncatedError (the run fails — never a
//     silent truncation, Decision 9 of the accuracy round);
//   * a stop throws RunCancelledError;
//   * anything else loses only that piece of evidence (recorded in
//     `errors`): no viewports = the sheet counts as one plan (as before), no
//     typicals = nothing expanded, no table = the counter keeps the type.
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';
import { openPdfDocument } from '../../estimating/pdfjsLoader';
import { fitImageToLimits, imageLimitsFor, type ModelImageLimits } from '../modelLimits';
import { callWithRetry } from '../retry';
import { RunCancelledError, runSignalOf } from '../runControl';
import { assertNotTruncated, isAgentTruncatedError } from '../stopReason';
import { sanitizeForPrompt } from '../sanitizeForPrompt';
import { supportsEffort } from '../counter';
import { runWithConcurrencyLimit } from '../../utils/concurrencyLimit';
import { logger } from '../../utils/logger';
import { EVIDENCE_PROMPT_VERSION, SCHEDULE_ROWS_SYSTEM, TYPICALS_SYSTEM, VIEWPORT_SYSTEM } from '../prompts';
import type { CountTarget } from '../countTargets';
import {
  drawingTextChars, MIN_DRAWING_TEXT_CHARS, parseViewportReply, rectContains, runsFromPdfItems, TEXTUAL_KINDS,
  viewportLabel, viewportsFromText, type RectIn, type SheetGeom, type SheetViewports, type TextRun, type Viewport,
} from './viewports';
import { parseTypicalsReply, type TypicalPackage } from './typicals';
import { parseScheduleReply, tableFromRuns, type ScheduleTable } from './schedules';

const execFileP = promisify(execFile);

export interface EvidenceCache {
  get(sha: string, page: number, kind: string, cacheKey: string): Promise<unknown | null>;
  set(sha: string, page: number, kind: string, cacheKey: string, value: unknown): Promise<void>;
}

export interface EvidencePage {
  key: string;
  file: string;
  page: number;
  label: string;
  /** Plan sheets are counted; schedule / detail sheets only give evidence. */
  counted: boolean;
}

export interface EvidenceUsage { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }

export interface EvidenceStageInput {
  client: Anthropic;
  model: string;
  maxTokens: number;
  pages: EvidencePage[];
  pdfs: Map<string, Buffer>;
  targets: CountTarget[];
  cache?: EvidenceCache;
  shouldStop?: () => boolean;
  /** Cap on model calls of each kind per run (cost guard). */
  maxPages?: number;
}

export interface EvidencePageResult {
  key: string;
  label: string;
  geometry: SheetGeom | null;
  viewports: SheetViewports;
  hasTextLayer: boolean;
}

export interface EvidenceStageOutput {
  pages: EvidencePageResult[];
  typicals: TypicalPackage[];
  tables: ScheduleTable[];
  usage: EvidenceUsage;
  calls: number;
  cached: number;
  errors: string[];
  model: string;
}

const ZERO: EvidenceUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
export const EVIDENCE_CONCURRENCY = 3;
export const MAX_EVIDENCE_PAGES = 14;
/** Tables / legends are read from crops at no more than this DPI. */
const CROP_MAX_DPI = 200;

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** pdf.js geometry and text runs for the given pages (one open per file; the
 *  caller's Buffer is never handed to pdf.js — openPdfDocument copies). */
export async function readPagesText(pdf: Buffer, pages: number[]): Promise<Map<number, { geometry: SheetGeom; runs: TextRun[] }>> {
  const doc = await openPdfDocument(pdf);
  const out = new Map<number, { geometry: SheetGeom; runs: TextRun[] }>();
  try {
    for (const p of pages) {
      if (p < 1 || p > doc.numPages) continue;
      const page = await doc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      const geometry: SheetGeom = {
        widthPt: Math.abs(x1 - x0), heightPt: Math.abs(y1 - y0), originX: Math.min(x0, x1), originY: Math.min(y0, y1),
        rotation: ((page.rotate % 360) + 360) % 360,
      };
      const tc = await page.getTextContent();
      out.set(p, { geometry, runs: runsFromPdfItems(tc.items as Array<{ str: string; transform: number[]; width?: number; height?: number }>, geometry) });
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** Render a region of a page (displayed inches; null = the whole page) as a
 *  grayscale PNG sized to the model's image limits (never downscaled by the
 *  server), at most CROP_MAX_DPI. */
export async function renderRegion(pdf: Buffer, page: number, g: SheetGeom, rect: RectIn | null, limits: ModelImageLimits, maxDpi = CROP_MAX_DPI): Promise<{ png: Buffer; width: number; height: number; dpi: number }> {
  const rot = ((g.rotation % 360) + 360) % 360;
  const pageIn = rot === 90 || rot === 270 ? { width: g.heightPt / 72, height: g.widthPt / 72 } : { width: g.widthPt / 72, height: g.heightPt / 72 };
  const r = rect ?? { left: 0, top: 0, width: pageIn.width, height: pageIn.height };
  const fit = fitImageToLimits(r.width * 300, r.height * 300, limits);
  const dpi = Math.max(20, Math.min(maxDpi, Math.floor(fit.width / r.width)));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-ev-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdf);
    const args = ['-gray', '-png', '-cropbox', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile'];
    if (rect) {
      args.push('-x', String(Math.max(0, Math.round(r.left * dpi))), '-y', String(Math.max(0, Math.round(r.top * dpi))),
        '-W', String(Math.max(1, Math.round(r.width * dpi))), '-H', String(Math.max(1, Math.round(r.height * dpi))));
    }
    await execFileP('pdftoppm', [...args, pdfPath, path.join(tmp, 'out')], { maxBuffer: 1024 * 1024 });
    const img = sharp(path.join(tmp, 'out.png'));
    const meta = await img.metadata();
    const f2 = fitImageToLimits(meta.width ?? 1, meta.height ?? 1, limits);
    const { data, info } = await img.resize({ width: f2.width, height: f2.height, fit: 'fill', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    return { png: data, width: info.width, height: info.height, dpi };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function imageBlock(png: Buffer): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } };
}

function extractText(resp: Anthropic.Message): string {
  return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
}

export async function runEvidenceStage(input: EvidenceStageInput): Promise<EvidenceStageOutput> {
  const out: EvidenceStageOutput = { pages: [], typicals: [], tables: [], usage: { ...ZERO }, calls: 0, cached: 0, errors: [], model: input.model };
  const limits = imageLimitsFor(input.model);
  const cacheKey = `${input.model}|${EVIDENCE_PROMPT_VERSION}`;
  const stop = () => { if (input.shouldStop?.()) throw new RunCancelledError(); };

  async function call(system: string, content: Anthropic.ContentBlockParam[], label: string): Promise<string> {
    stop();
    const resp = await callWithRetry(() => input.client.messages.stream({
      model: input.model,
      max_tokens: input.maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      ...(supportsEffort(input.model) ? { output_config: { effort: 'medium' as const } } : {}),
    }).finalMessage(), { signal: runSignalOf(input.client), onRetry: (a, _e, d) => logger.warn(`[evidence] ${label} retry ${a} in ${d}ms`) });
    out.calls++;
    out.usage.input_tokens += resp.usage?.input_tokens ?? 0;
    out.usage.output_tokens += resp.usage?.output_tokens ?? 0;
    out.usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
    out.usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
    if (resp.stop_reason === 'refusal') throw new Error('the model declined');
    assertNotTruncated(resp, `Evidence reader (${label})`, input.maxTokens);
    return extractText(resp);
  }

  async function cached<T>(sha: string, page: number, kind: string, key: string, compute: () => Promise<T | null>): Promise<T | null> {
    if (input.cache) {
      try {
        const hit = await input.cache.get(sha, page, kind, key);
        if (hit !== null && hit !== undefined) { out.cached++; return hit as T; }
      } catch (err) { logger.warn({ err }, '[evidence] cache read failed'); }
    }
    const v = await compute();
    if (v !== null && input.cache) await input.cache.set(sha, page, kind, key, v).catch(err => logger.warn({ err }, '[evidence] cache write failed'));
    return v;
  }

  const pages = input.pages.slice(0, input.maxPages ?? MAX_EVIDENCE_PAGES);
  if (input.pages.length > pages.length) out.errors.push(`${input.pages.length - pages.length} page(s) past the evidence cap of ${pages.length} were not read`);
  const byFile = new Map<string, EvidencePage[]>();
  for (const p of pages) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file)!.push(p); }

  type PageCtx = { p: EvidencePage; pdf: Buffer; sha: string; geometry: SheetGeom; runs: TextRun[]; hasText: boolean };
  const ctxs: PageCtx[] = [];
  for (const [file, ps] of byFile) {
    const pdf = input.pdfs.get(file);
    if (!pdf) { out.errors.push(`${file}: not available for evidence`); continue; }
    let texts: Map<number, { geometry: SheetGeom; runs: TextRun[] }>;
    try { texts = await readPagesText(pdf, ps.map(p => p.page)); } catch (err) {
      out.errors.push(`${file}: could not be read (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const sha = sha256(pdf);
    for (const p of ps) {
      const t = texts.get(p.page);
      if (!t) { out.errors.push(`${p.label}: page not in the PDF`); continue; }
      ctxs.push({ p, pdf, sha, geometry: t.geometry, runs: t.runs, hasText: drawingTextChars(t.runs, t.geometry) >= MIN_DRAWING_TEXT_CHARS });
    }
  }

  // ── 1.1 Viewports ────────────────────────────────────────────────────────
  const vpByKey = new Map<string, SheetViewports>();
  await runWithConcurrencyLimit(ctxs, EVIDENCE_CONCURRENCY, async (c) => {
    if (input.shouldStop?.()) return;
    const sheetKey = c.p.key;
    if (c.hasText) {
      const vps = viewportsFromText(c.runs, sheetKey, c.geometry);
      vpByKey.set(sheetKey, { sheetKey, source: vps.length ? 'text' : 'none', viewports: vps, ...(vps.length ? {} : { note: 'the text layer shows no titled viewports — the sheet is one drawing' }) });
      return;
    }
    try {
      const got = await cached<Viewport[]>(c.sha, c.p.page, 'viewports', cacheKey, async () => {
        const img = await renderRegion(c.pdf, c.p.page, c.geometry, null, limits, 150);
        const text = await call(VIEWPORT_SYSTEM, [
          { type: 'text', text: `SHEET: ${sanitizeForPrompt(c.p.label)} — the whole sheet, ${img.width}x${img.height} px.` },
          imageBlock(img.png),
          { type: 'text', text: 'List every viewport. Strict JSON only.' },
        ], `viewports ${c.p.label}`);
        const parsed = parseViewportReply(text, sheetKey, c.geometry);
        if (!parsed) throw new Error('the viewport reply was not in the expected shape');
        if (parsed.rejected.length) logger.info({ sheet: c.p.label, rejected: parsed.rejected }, '[evidence] viewport entries rejected');
        return parsed.viewports;
      });
      const vps = (got ?? []).map(v => ({ ...v, id: v.id.replace(/^.*@/, `${sheetKey}@`) }));
      vpByKey.set(sheetKey, { sheetKey, source: 'vision', viewports: vps });
    } catch (err) {
      if (err instanceof RunCancelledError || isAgentTruncatedError(err)) throw err;
      const msg = `${c.p.label}: viewports could not be read (${err instanceof Error ? err.message : String(err)})`;
      out.errors.push(msg);
      vpByKey.set(sheetKey, { sheetKey, source: 'none', viewports: [], note: msg });
    }
  });
  stop();
  for (const c of ctxs) {
    out.pages.push({ key: c.p.key, label: c.p.label, geometry: c.geometry, viewports: vpByKey.get(c.p.key) ?? { sheetKey: c.p.key, source: 'none', viewports: [] }, hasTextLayer: c.hasText });
  }

  // ── 2.1 Typicals (legend / notes / symbol schedules) ─────────────────────
  const deviceTargets = input.targets.filter(t => t.role !== 'host');
  const targetList = deviceTargets.map(t => `- ${sanitizeForPrompt(t.type)} | ${sanitizeForPrompt(t.description) || '(no description)'}`).join('\n');
  const targetsHash = crypto.createHash('sha256').update(deviceTargets.map(t => `${t.key}|${t.description}`).join('\n')).digest('hex').slice(0, 16);
  const isPanelLike = (v: Viewport) => /\bPANEL\b|\bLOAD\b|\bLUMINAIRE\b|\bFIXTURE\s+SCHEDULE\b/i.test(v.title);
  await runWithConcurrencyLimit(ctxs, EVIDENCE_CONCURRENCY, async (c) => {
    if (input.shouldStop?.()) return;
    const vps = (vpByKey.get(c.p.key)?.viewports ?? []).filter(v => TEXTUAL_KINDS.has(v.kind) && !isPanelLike(v));
    if (!vps.length) return;
    const labels = vps.map(v => ({ id: v.id, label: viewportLabel(v) }));
    try {
      const got = await cached<TypicalPackage[]>(c.sha, c.p.page, `typicals:${vps.map(v => v.id.split('@').pop()).join(',')}`, `${cacheKey}|${targetsHash}`, async () => {
        const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: `COUNT TARGETS (tag | description):\n${targetList || '(none)'}` }];
        if (c.hasText) {
          for (const v of vps) {
            const inside = c.runs.filter(r => rectContains(v.rectIn, (r.x + r.w / 2) / 72, (r.y + r.h / 2) / 72));
            const text = inside.sort((a, b) => a.y - b.y || a.x - b.x).map(r => r.str).join(' ');
            content.push({ type: 'text', text: `--- viewport ${v.id} — ${sanitizeForPrompt(viewportLabel(v))} (text layer) ---\n${sanitizeForPrompt(text).slice(0, 8000)}` });
          }
        } else {
          for (const v of vps) {
            const img = await renderRegion(c.pdf, c.p.page, c.geometry, v.rectIn, limits);
            content.push({ type: 'text', text: `--- viewport ${v.id} — ${sanitizeForPrompt(viewportLabel(v))} (image) ---` });
            content.push(imageBlock(img.png));
          }
        }
        content.push({ type: 'text', text: 'Extract the typical device packages. Strict JSON only.' });
        const text = await call(TYPICALS_SYSTEM, content, `typicals ${c.p.label}`);
        const parsed = parseTypicalsReply(text, { sheetKey: c.p.key, source: c.hasText ? 'text' : 'vision', viewports: labels, targets: input.targets });
        if (!parsed) throw new Error('the typicals reply was not in the expected shape');
        if (parsed.rejected.length) logger.info({ sheet: c.p.label, rejected: parsed.rejected }, '[evidence] typical entries rejected');
        return parsed.packages;
      });
      out.typicals.push(...(got ?? []));
    } catch (err) {
      if (err instanceof RunCancelledError || isAgentTruncatedError(err)) throw err;
      out.errors.push(`${c.p.label}: typicals could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  });
  stop();

  // ── 3.1 Schedules, row by row ────────────────────────────────────────────
  const tableJobs = ctxs.flatMap(c => (vpByKey.get(c.p.key)?.viewports ?? []).filter(v => v.kind === 'schedule').map(v => ({ c, v })));
  await runWithConcurrencyLimit(tableJobs, EVIDENCE_CONCURRENCY, async ({ c, v }) => {
    if (input.shouldStop?.()) return;
    const ctx = { sheetKey: c.p.key, sheetLabel: c.p.label, viewportId: v.id, viewportTitle: v.title, rectIn: v.rectIn };
    try {
      if (c.hasText) {
        const inside = c.runs.filter(r => rectContains(v.rectIn, (r.x + r.w / 2) / 72, (r.y + r.h / 2) / 72));
        const t = tableFromRuns(inside, { sheetKey: c.p.key, sheetLabel: c.p.label, viewportId: v.id, title: v.title });
        if (t) out.tables.push(t);
        return;
      }
      const kind = `table:${v.id.split('@').pop()}:${[v.rectIn.left, v.rectIn.top, v.rectIn.width, v.rectIn.height].map(n => n.toFixed(2)).join(',')}`;
      const got = await cached<ScheduleTable>(c.sha, c.p.page, kind, cacheKey, async () => {
        const img = await renderRegion(c.pdf, c.p.page, c.geometry, v.rectIn, limits);
        const text = await call(SCHEDULE_ROWS_SYSTEM, [
          { type: 'text', text: `TABLE: ${sanitizeForPrompt(viewportLabel(v))} on ${sanitizeForPrompt(c.p.label)}.` },
          imageBlock(img.png),
          { type: 'text', text: 'Transcribe every row. Strict JSON only.' },
        ], `schedule ${c.p.label} ${viewportLabel(v)}`);
        const t = parseScheduleReply(text, ctx);
        if (!t) throw new Error('the schedule reply was not in the expected shape');
        return t;
      });
      if (got) out.tables.push({ ...got, sheetKey: c.p.key, sheetLabel: c.p.label, viewportId: v.id });
    } catch (err) {
      if (err instanceof RunCancelledError || isAgentTruncatedError(err)) throw err;
      out.errors.push(`${c.p.label} ${viewportLabel(v)}: could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  });
  stop();
  // Deterministic order (the readers run concurrently).
  const order = new Map(pages.map((p, i) => [p.key, i]));
  out.typicals.sort((a, b) => (order.get(a.sheetKey)! - order.get(b.sheetKey)!) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  out.tables.sort((a, b) => (order.get(a.sheetKey)! - order.get(b.sheetKey)!) || a.id.localeCompare(b.id));
  return out;
}
