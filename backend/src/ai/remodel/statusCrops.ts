// Price accuracy round D2 — a mark's new / existing status by a close-up
// crop check (remodel jobs only).
//
// 36th Street's E1.0 prints "SHADED SYMBOL DENOTES NEW RECEPTICLE". At the
// counter's tile scale a shaded and an open receptacle differ by a few
// pixels: the live run read 1 new duplex (Chris: 5 new duplex + 2 GFCI).
// Now, when a rule depends on symbol FILL, or when the tile pass gave a
// confident status for fewer than 80% of a rule-covered type's marks, each
// of those marks gets a zoomed single-symbol crop, several per call, with
// the sheet's own legend as the example, on the evidence model. The crop
// answer sets the status. A low-confidence or unclear answer, a failed
// call, and every mark past the cap keep the tile pass's status and are
// listed in ONE review item (coordinator decision 3).
import crypto from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { CountTarget } from '../countTargets';
import type { PlacedMark } from '../counter';
import { supportsEffort } from '../counter';
import { callWithRetry } from '../retry';
import { RunCancelledError, runSignalOf } from '../runControl';
import { assertNotTruncated } from '../stopReason';
import { sanitizeForPrompt } from '../sanitizeForPrompt';
import { imageLimitsFor } from '../modelLimits';
import { parseAIJSON } from '../json';
import { logger } from '../../utils/logger';
import { STATUS_CROP_PROMPT_VERSION, STATUS_CROP_SYSTEM } from '../prompts';
import { renderRegion, type EvidenceCache, type EvidenceUsage } from '../evidence/evidenceStage';
import { pdfToDisplayedIn, type RectIn, type SheetGeom, type Viewport } from '../evidence/viewports';
import { isInstallStatus, normalizeMarkStatus, type MarkStatus, type StatusConvention } from './status';
import { inScope, typeScopeClass, unionScope, type ScopeClass } from './statusScope';

/** Cost guard: crops per run; the rest go to review. */
export const MAX_STATUS_CROPS = 60;
export const CROPS_PER_CALL = 10;
/** Half-width (paper inches) of one crop. */
export const CROP_HALF_IN = 0.5;

// Review B1 — only a SYMBOL-FILL rule is checked close up: a fill word
// governing a symbol / device noun ("SHADED SYMBOL DENOTES NEW RECEPTACLE",
// "RECEPTACLES SHOWN FILLED ARE NEW"). Line-weight or line-style rules
// ("SOLID LINES INDICATE NEW WORK", "NEW WORK SHOWN DARK", "BOLD", "HEAVY",
// "SCREENED", "HATCHED AREA") never are: a heavy-lined receptacle is still
// a hollow circle, so asking "filled or open?" would turn it existing.
const FILL_WORD = '(?:SHADED|FILLED|SOLID(?:[\\s-]*FILLED)?|HATCHED|DARKENED|BLACKENED|HALF-?TONED?)';
const OPEN_WORD = '(?:OPEN|HOLLOW|UN-?SHADED|UNFILLED|NOT\\s+SHADED|NOT\\s+FILLED)';
const SUBJECT = '(?:SYMBOLS?|DEVICES?|RECEP\\w*|RECPTS?|OUTLETS?|DUPLEX(?:ES)?|SWITCH(?:ES)?|FIXTURES?|LUMINAIRES?|CIRCLES?)';
const LINE_WORDS = /\b(LINES?|LINEWORK|LINE\s*WEIGHT|DASHED|SCREENED|AREAS?|WALLS?)\b/i;
const fillRe = (w: string) => new RegExp(`\\b${w}\\s+(?:\\w+\\s+)?${SUBJECT}\\b|\\b${SUBJECT}\\s+(?:\\w+\\s+){0,3}?(?:SHOWN\\s+|DRAWN\\s+|ARE\\s+|IS\\s+|AS\\s+)${w}\\b`, 'i');
const FILLED_RE = fillRe(FILL_WORD);
const OPEN_RE = fillRe(OPEN_WORD);

export interface FillRule { filled: MarkStatus; open: MarkStatus; quote: string }

function complement(s: MarkStatus): MarkStatus {
  return s === 'new' || s === 'relocated' ? 'existing' : 'new';
}

/** A rule that tells new from existing by SYMBOL FILL ("SHADED SYMBOL
 *  DENOTES NEW RECEPTACLE" → filled = new, open = existing). The printed
 *  quote decides, never the model's paraphrase; a line / area rule is not
 *  a fill rule even if it says SOLID. */
export function fillRuleOf(rules: Array<Pick<StatusConvention, 'status' | 'quote' | 'rule'>>): FillRule | null {
  for (const r of rules) {
    const q = r.quote;
    const open = OPEN_RE.test(q);
    const filled = FILLED_RE.test(q.replace(new RegExp(`\\b${OPEN_WORD}\\b`, 'gi'), ' '));
    if (!open && !filled) continue;
    if (LINE_WORDS.test(q) && !/\bSYMBOLS?\b/i.test(q)) continue;
    if (filled) return { filled: r.status, open: complement(r.status), quote: q };
    return { open: r.status, filled: complement(r.status), quote: q };
  }
  return null;
}


export interface CropSheetInput {
  key: string;
  label: string;
  rules: StatusConvention[];
  placed: PlacedMark[];
}

export interface CropJob {
  sheetKey: string;
  label: string;
  mode: 'fill' | 'rule';
  fill: FillRule | null;
  rules: StatusConvention[];
  /** Indices into the sheet's `placed`. */
  marks: number[];
}

export interface CropPlan {
  jobs: CropJob[];
  /** Past the cap: sent to review, never checked. */
  capped: Array<{ sheetKey: string; index: number }>;
  why: Array<{ sheetKey: string; typeKey: string; reason: string; marks: number }>;
}

/** Pure: which marks get a close-up check, and why. */
export function planStatusCrops(sheets: CropSheetInput[], targets: CountTarget[], cap = MAX_STATUS_CROPS): CropPlan {
  const tByKey = new Map(targets.map(t => [t.key, t]));
  const plan: CropPlan = { jobs: [], capped: [], why: [] };
  let used = 0;
  for (const s of sheets) {
    if (!s.rules.length) continue;
    const scope = unionScope(s.rules);
    const fill = fillRuleOf(s.rules);
    // Review B1 — the close-up check runs ONLY for a symbol-fill rule.
    if (!fill) continue;
    const byType = new Map<string, number[]>();
    s.placed.forEach((p, i) => {
      if (!inScope(scope, tByKey.get(p.typeKey))) return;
      if (!byType.has(p.typeKey)) byType.set(p.typeKey, []);
      byType.get(p.typeKey)!.push(i);
    });
    const queued: number[] = [];
    for (const [typeKey, idx] of byType) {
      const reason = `the rule depends on symbol fill ("${fill.quote.slice(0, 60)}")`;
      plan.why.push({ sheetKey: s.key, typeKey, reason, marks: idx.length });
      queued.push(...idx);
    }
    const take = queued.slice(0, Math.max(0, cap - used));
    for (const i of queued.slice(take.length)) plan.capped.push({ sheetKey: s.key, index: i });
    used += take.length;
    for (let k = 0; k < take.length; k += CROPS_PER_CALL) {
      plan.jobs.push({ sheetKey: s.key, label: s.label, mode: fill ? 'fill' : 'rule', fill, rules: s.rules, marks: take.slice(k, k + CROPS_PER_CALL) });
    }
  }
  return plan;
}

export interface CropAnswer { id: string; answer: string; confidence: 'high' | 'low' }

/** Pure: the reply → one answer per crop id sent; a missing or malformed
 *  entry is "unclear" (never a status by default). null = no usable reply. */
export function parseStatusCropReply(text: string, ids: string[]): CropAnswer[] | null {
  const parsed = parseAIJSON(text);
  const raw = parsed && Array.isArray(parsed.answers) ? (parsed.answers as unknown[]) : null;
  if (!raw) return null;
  const by = new Map<string, CropAnswer>();
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const id = String(r.id ?? '').trim();
    if (!ids.includes(id) || by.has(id)) continue;
    by.set(id, { id, answer: String(r.answer ?? '').trim().toLowerCase().slice(0, 20), confidence: String(r.confidence ?? '').toLowerCase() === 'high' ? 'high' : 'low' });
  }
  return ids.map(id => by.get(id) ?? { id, answer: 'unclear', confidence: 'low' });
}

/** Pure: the status a crop answer stands for, or null (low / unclear). */
export function statusFromAnswer(job: Pick<CropJob, 'mode' | 'fill'>, a: CropAnswer): MarkStatus | null {
  if (a.confidence !== 'high') return null;
  if (job.mode === 'fill' && job.fill) {
    if (a.answer === 'filled' || a.answer === 'shaded' || a.answer === 'solid') return job.fill.filled;
    if (a.answer === 'open' || a.answer === 'hollow' || a.answer === 'unshaded') return job.fill.open;
    return null;
  }
  const s = normalizeMarkStatus(a.answer);
  return s && s !== 'unknown' ? s : null;
}

export interface StatusCropSummary {
  calls: number;
  cached: number;
  crops: number;
  usage: EvidenceUsage;
  errors: string[];
  /** Per sheet and type: what was checked and what it said. */
  checked: Array<{ sheetKey: string; label: string; typeKey: string; reason: string; marks: number; asNew: number; asExisting: number; asOther: number; low: number; reclassified?: number }>;
  /** Marks past the cap (counted as new, in the review item). */
  capped: number;
}

export interface StatusCropSheet extends CropSheetInput {
  file: string;
  page: number;
  geometry: SheetGeom | null;
  viewports: Viewport[] | null;
}

function imageBlock(png: Buffer): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } };
}

function displayedIn(g: SheetGeom): { width: number; height: number } {
  const rot = ((g.rotation % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { width: g.heightPt / 72, height: g.widthPt / 72 } : { width: g.widthPt / 72, height: g.heightPt / 72 };
}

function clampRect(r: RectIn, page: { width: number; height: number }): RectIn {
  const left = Math.max(0, Math.min(r.left, page.width - 0.1));
  const top = Math.max(0, Math.min(r.top, page.height - 0.1));
  return { left, top, width: Math.max(0.1, Math.min(r.width, page.width - left)), height: Math.max(0.1, Math.min(r.height, page.height - top)) };
}

const LEGEND_WORDS: Record<ScopeClass, RegExp> = {
  receptacle: /POWER|DEVICE|RECEP/i, switch: /LIGHTING|CONTROL|DEVICE|SWITCH/i, control: /LIGHTING|CONTROL/i,
  device: /POWER|DEVICE|SYSTEM/i, fixture: /LIGHTING|LUMINAIRE|FIXTURE/i, equipment: /POWER|EQUIPMENT/i,
};

/** The sheet's legend that shows the checked types' symbols. */
export function legendFor(viewports: Viewport[] | null, classes: ScopeClass[]): Viewport | null {
  const legends = (viewports ?? []).filter(v => v.kind === 'legend');
  if (!legends.length) return null;
  return legends.find(v => classes.some(c => LEGEND_WORDS[c].test(v.title))) ?? legends[0];
}

/** Marks the checked statuses on the sheets' `placed` (mutates them): a
 *  clear answer sets the status; a low / unclear / failed / capped one keeps
 *  the tile pass's status and gets `cropLow` (listed for review). */
export async function runStatusCropCheck(input: {
  client: Anthropic; model: string; maxTokens: number;
  sheets: StatusCropSheet[]; targets: CountTarget[]; pdfs: Map<string, Buffer>;
  cache?: EvidenceCache; shouldStop?: () => boolean;
}): Promise<StatusCropSummary | null> {
  const plan = planStatusCrops(input.sheets, input.targets);
  if (!plan.jobs.length && !plan.capped.length) return null;
  const out: StatusCropSummary = { calls: 0, cached: 0, crops: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, errors: [], checked: [], capped: plan.capped.length };
  const tByKey = new Map(input.targets.map(t => [t.key, t]));
  const byKey = new Map(input.sheets.map(s => [s.key, s]));
  // Coordinator decision 3 — a mark the close-up check could not tell keeps
  // the TILE PASS's status (never forced to new); it is only flagged.
  const low = (s: StatusCropSheet, i: number) => { s.placed[i] = { ...s.placed[i], cropLow: true }; };
  for (const c of plan.capped) low(byKey.get(c.sheetKey)!, c.index);
  const limits = imageLimitsFor(input.model);
  const shaOf = new Map<string, string>();
  const legendPng = new Map<string, Buffer | null>();
  const tally = new Map<string, StatusCropSummary['checked'][number]>();
  for (const w of plan.why) {
    const s = byKey.get(w.sheetKey)!;
    tally.set(`${w.sheetKey}|${w.typeKey}`, { sheetKey: w.sheetKey, label: s.label, typeKey: w.typeKey, reason: w.reason, marks: w.marks, asNew: 0, asExisting: 0, asOther: 0, low: 0 });
  }
  for (const job of plan.jobs) {
    if (input.shouldStop?.()) throw new RunCancelledError();
    const s = byKey.get(job.sheetKey)!;
    const pdf = input.pdfs.get(s.file);
    const ids = job.marks.map((_, k) => `c${k + 1}`);
    const apply = (answers: CropAnswer[] | null) => {
      job.marks.forEach((mi, k) => {
        const a = answers?.[k];
        const st = a ? statusFromAnswer(job, a) : null;
        const t = tally.get(`${job.sheetKey}|${s.placed[mi].typeKey}`);
        if (!st) { low(s, mi); if (t) t.low++; return; }
        const was = s.placed[mi].status;
        // Review B1 — a crop answer that LOWERS priced install (tile pass
        // new / unknown → existing / demo) is flagged: one blocking item.
        const lowered = isInstallStatus(was) && !isInstallStatus(st);
        s.placed[mi] = { ...s.placed[mi], status: st, ...(lowered ? { cropChanged: true } : {}) };
        if (lowered && t) t.reclassified = (t.reclassified ?? 0) + 1;
        if (t) { if (st === 'new' || st === 'relocated') t.asNew++; else if (st === 'existing') t.asExisting++; else t.asOther++; }
      });
    };
    if (!pdf || !s.geometry) { out.errors.push(`${s.label}: the sheet could not be rendered for the close-up check`); apply(null); continue; }
    try {
      if (!shaOf.has(s.file)) shaOf.set(s.file, crypto.createHash('sha256').update(pdf).digest('hex'));
      const sha = shaOf.get(s.file)!;
      const g = s.geometry;
      const pts = job.marks.map(i => s.placed[i]);
      const kind = `statuscrop:${crypto.createHash('sha1').update(JSON.stringify([job.mode, job.fill?.quote ?? job.rules.map(r => r.quote), pts.map(p => [p.typeKey, Math.round(p.x), Math.round(p.y)])])).digest('hex').slice(0, 20)}`;
      const cacheKey = `${input.model}|${STATUS_CROP_PROMPT_VERSION}`;
      let answers: CropAnswer[] | null = null;
      if (input.cache) {
        try { answers = (await input.cache.get(sha, s.page, kind, cacheKey)) as CropAnswer[] | null; if (answers) out.cached++; } catch (err) { logger.warn({ err }, '[remodel] status crop cache read failed'); }
      }
      if (!answers) {
        const page = displayedIn(g);
        const content: Anthropic.ContentBlockParam[] = [];
        const rulesText = job.rules.map(r => `"${sanitizeForPrompt(r.quote).slice(0, 160)}" (${r.status})`).join('; ');
        content.push({ type: 'text', text: `SHEET: ${sanitizeForPrompt(s.label)}. PRINTED RULE: ${rulesText}.` });
        const classes = [...new Set(pts.map(p => tByKey.get(p.typeKey)).filter((t): t is CountTarget => !!t).map(typeScopeClass))];
        const lkey = `${s.key}|${classes.join(',')}`;
        if (!legendPng.has(lkey)) {
          const lg = legendFor(s.viewports, classes);
          legendPng.set(lkey, lg ? (await renderRegion(pdf, s.page, g, clampRect(lg.rectIn, page), limits, 150)).png : null);
        }
        const lp = legendPng.get(lkey);
        if (lp) content.push({ type: 'text', text: 'THE SHEET\'S OWN LEGEND (its symbols, drawn as the rule describes — compare the fill):' }, imageBlock(lp));
        for (const [k, p] of pts.entries()) {
          const c = pdfToDisplayedIn(p.x, p.y, g);
          const rect = clampRect({ left: c.x - CROP_HALF_IN, top: c.y - CROP_HALF_IN, width: 2 * CROP_HALF_IN, height: 2 * CROP_HALF_IN }, page);
          const img = await renderRegion(pdf, s.page, g, rect, limits, 300);
          const t = tByKey.get(p.typeKey);
          content.push({ type: 'text', text: `CROP ${ids[k]} — type ${sanitizeForPrompt(p.typeKey)} — at PDF ${p.x.toFixed(2)},${p.y.toFixed(2)}${t ? ` (${sanitizeForPrompt(t.description).slice(0, 60)})` : ''}:` }, imageBlock(img.png));
        }
        content.push({ type: 'text', text: job.mode === 'fill'
          ? 'For each crop: is the symbol at the center FILLED (shaded / solid) or OPEN (hollow)? Strict JSON only.'
          : 'For each crop: by the printed rule, is the symbol at the center new, existing, demo or relocated? Strict JSON only.' });
        const resp = await callWithRetry(() => input.client.messages.stream({
          model: input.model,
          max_tokens: input.maxTokens,
          system: [{ type: 'text', text: STATUS_CROP_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content }],
          ...(supportsEffort(input.model) ? { output_config: { effort: 'low' as const } } : {}),
        }).finalMessage(), { signal: runSignalOf(input.client), onRetry: (a, _e, d) => logger.warn(`[remodel] status crops ${s.label} retry ${a} in ${d}ms`) });
        out.calls++;
        out.usage.input_tokens += resp.usage?.input_tokens ?? 0;
        out.usage.output_tokens += resp.usage?.output_tokens ?? 0;
        out.usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
        out.usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
        if (resp.stop_reason === 'refusal') throw new Error('the model declined');
        assertNotTruncated(resp, `Status close-up check (${s.label})`, input.maxTokens);
        const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
        answers = parseStatusCropReply(text, ids);
        if (!answers) throw new Error('the close-up check reply was not in the expected shape');
        if (input.cache) await input.cache.set(sha, s.page, kind, cacheKey, answers).catch(err => logger.warn({ err }, '[remodel] status crop cache write failed'));
      }
      out.crops += job.marks.length;
      apply(answers);
    } catch (err) {
      // Optional input, like the titles reader: a failure (or a truncation)
      // leaves these marks for the estimator. Only a stop stops the run.
      if (err instanceof RunCancelledError) throw err;
      out.errors.push(`${s.label}: the close-up status check failed (${err instanceof Error ? err.message : String(err)}) — ${job.marks.length} mark(s) left for review`);
      apply(null);
    }
  }
  out.checked = [...tally.values()];
  return out;
}
