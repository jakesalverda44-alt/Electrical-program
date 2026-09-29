// Remodel round A1.1 / A1.3 — the I/O half: on a REMODEL job only, read
// each candidate sheet's drawing titles and printed status rules.
//   * a sheet with a text layer: from the text (no model call);
//   * a scanned sheet the analysis does not count (an architectural
//     "…DEMOLITIONS" plan): ONE vision call on the sheet overview;
//   * a scanned COUNTED sheet: nothing here — the viewport reader already
//     read its titles and the counter reads its legend / notes itself at
//     full resolution.
// Every call is cached by the file's content hash. Failure policy like the
// evidence readers: a truncation fails the run, a stop stops, anything else
// loses only that sheet's titles (recorded in `errors`).
import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../retry';
import { RunCancelledError, runSignalOf } from '../runControl';
import { assertNotTruncated, isAgentTruncatedError } from '../stopReason';
import { sanitizeForPrompt } from '../sanitizeForPrompt';
import { supportsEffort } from '../counter';
import { imageLimitsFor } from '../modelLimits';
import { parseAIJSON } from '../json';
import { runWithConcurrencyLimit } from '../../utils/concurrencyLimit';
import { logger } from '../../utils/logger';
import { REMODEL_PROMPT_VERSION, SHEET_TITLES_SYSTEM } from '../prompts';
import { readPagesText, renderRegion, type EvidenceCache, type EvidenceUsage } from '../evidence/evidenceStage';
import { drawingTextChars, MIN_DRAWING_TEXT_CHARS } from '../evidence/viewports';
import { parseConventions, textConventions, textTitles, type StatusConvention } from './status';

export interface TitlePage { key: string; file: string; page: number; label: string; counted: boolean }

export interface TitlePageResult {
  key: string;
  label: string;
  titles: string[];
  conventions: StatusConvention[];
  source: 'text' | 'vision' | 'none';
  geometry: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number } | null;
  error?: string;
}

export interface TitleReadOutput {
  pages: TitlePageResult[];
  usage: EvidenceUsage;
  calls: number;
  cached: number;
  errors: string[];
}

/** Cost guard: sheets read per run. */
export const MAX_TITLE_PAGES = 12;

/** Validates the titles reader's reply. */
export function parseTitlesReply(text: string, sheet: { key: string; label: string }): { titles: string[]; conventions: StatusConvention[] } | null {
  const parsed = parseAIJSON(text);
  if (!parsed || !Array.isArray(parsed.titles)) return null;
  const titles = [...new Set((parsed.titles as unknown[]).filter((t): t is string => typeof t === 'string').map(t => t.replace(/\s+/g, ' ').trim()).filter(t => t && t.length <= 120))].slice(0, 20);
  return { titles, conventions: parseConventions(parsed.conventions, sheet, 'title') };
}

export async function readSheetTitles(input: {
  client: Anthropic; model: string; maxTokens: number;
  pages: TitlePage[]; pdfs: Map<string, Buffer>;
  cache?: EvidenceCache; shouldStop?: () => boolean;
}): Promise<TitleReadOutput> {
  const out: TitleReadOutput = { pages: [], usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, calls: 0, cached: 0, errors: [] };
  // The cap is on model calls: counted sheets never call the model here.
  const others = input.pages.filter(p => !p.counted);
  const pages = [...input.pages.filter(p => p.counted), ...others.slice(0, MAX_TITLE_PAGES)];
  if (others.length > MAX_TITLE_PAGES) out.errors.push(`${others.length - MAX_TITLE_PAGES} sheet(s) past the cap of ${MAX_TITLE_PAGES} were not read for demolition titles`);
  const limits = imageLimitsFor(input.model);
  const cacheKey = `${input.model}|${REMODEL_PROMPT_VERSION}`;
  const byFile = new Map<string, TitlePage[]>();
  for (const p of pages) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file)!.push(p); }
  type Ctx = { p: TitlePage; pdf: Buffer; sha: string; geometry: TitlePageResult['geometry'] & object; runs: Array<{ str: string }>; hasText: boolean };
  const ctxs: Ctx[] = [];
  for (const [file, ps] of byFile) {
    const pdf = input.pdfs.get(file);
    if (!pdf) { out.errors.push(`${file}: not available`); continue; }
    try {
      const texts = await readPagesText(pdf, ps.map(p => p.page));
      const sha = crypto.createHash('sha256').update(pdf).digest('hex');
      for (const p of ps) {
        const t = texts.get(p.page);
        if (!t) { out.errors.push(`${p.label}: page not in the PDF`); continue; }
        ctxs.push({ p, pdf, sha, geometry: t.geometry, runs: t.runs, hasText: drawingTextChars(t.runs, t.geometry) >= MIN_DRAWING_TEXT_CHARS });
      }
    } catch (err) {
      out.errors.push(`${file}: could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  await runWithConcurrencyLimit(ctxs, 3, async (c) => {
    if (input.shouldStop?.()) return;
    const sheet = { key: c.p.key, label: c.p.label };
    if (c.hasText) {
      const text = c.runs.map(r => r.str).join('\n');
      out.pages.push({ ...sheet, titles: textTitles(c.runs.map(r => r.str)), conventions: textConventions(text, sheet), source: 'text', geometry: c.geometry });
      return;
    }
    if (c.p.counted) {
      out.pages.push({ ...sheet, titles: [], conventions: [], source: 'none', geometry: c.geometry });
      return;
    }
    try {
      let hit: { titles: string[]; conventions: StatusConvention[] } | null = null;
      if (input.cache) {
        try {
          hit = await input.cache.get(c.sha, c.p.page, 'remodel-titles', cacheKey) as typeof hit;
          if (hit) out.cached++;
        } catch (err) { logger.warn({ err }, '[remodel] titles cache read failed'); }
      }
      if (!hit) {
        if (input.shouldStop?.()) throw new RunCancelledError();
        const img = await renderRegion(c.pdf, c.p.page, c.geometry, null, limits, 150);
        const resp = await callWithRetry(() => input.client.messages.stream({
          model: input.model,
          max_tokens: input.maxTokens,
          system: [{ type: 'text', text: SHEET_TITLES_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [
            { type: 'text', text: `SHEET: ${sanitizeForPrompt(c.p.label)} — the whole sheet, ${img.width}x${img.height} px.` },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.png.toString('base64') } },
            { type: 'text', text: 'List the drawing titles. Strict JSON only.' },
          ] }],
          ...(supportsEffort(input.model) ? { output_config: { effort: 'low' as const } } : {}),
        }).finalMessage(), { signal: runSignalOf(input.client), onRetry: (a, _e, d) => logger.warn(`[remodel] titles ${c.p.label} retry ${a} in ${d}ms`) });
        out.calls++;
        out.usage.input_tokens += resp.usage?.input_tokens ?? 0;
        out.usage.output_tokens += resp.usage?.output_tokens ?? 0;
        out.usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
        out.usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
        if (resp.stop_reason === 'refusal') throw new Error('the model declined');
        assertNotTruncated(resp, `Sheet titles (${c.p.label})`, input.maxTokens);
        const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
        hit = parseTitlesReply(text, sheet);
        if (!hit) throw new Error('the titles reply was not in the expected shape');
        if (input.cache) await input.cache.set(c.sha, c.p.page, 'remodel-titles', cacheKey, hit).catch(err => logger.warn({ err }, '[remodel] titles cache write failed'));
      }
      // A cached entry was stored under another sheet key: re-key it.
      out.pages.push({ ...sheet, titles: hit.titles, conventions: hit.conventions.map(cv => ({ ...cv, sheetKey: sheet.key, sheetLabel: sheet.label })), source: 'vision', geometry: c.geometry });
    } catch (err) {
      // Fix round S5 — titles are optional input: a truncated / failed call
      // loses only this sheet's titles (not a demolition sheet, a note).
      // Only a stop stops the run.
      if (err instanceof RunCancelledError) throw err;
      if (isAgentTruncatedError(err)) logger.warn({ sheet: c.p.label }, '[remodel] titles call truncated — the sheet is treated as not demolition');
      const msg = `${c.p.label}: drawing titles could not be read (${err instanceof Error ? err.message : String(err)})`;
      out.errors.push(msg);
      out.pages.push({ ...sheet, titles: [], conventions: [], source: 'none', geometry: c.geometry, error: msg });
    }
  });
  const order = new Map(pages.map((p, i) => [p.key, i]));
  out.pages.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return out;
}
