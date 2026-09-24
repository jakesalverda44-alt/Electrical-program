// Evidence round 4.3 / 4.4 — the I/O half of gap-fill and crop-check. One
// gap-fill call per (type, sheet) job proposes SUGGESTED marks; one
// crop-check call per job (batching every candidate the job produced into
// one call, the same way the counter batches tiles) turns each into
// accepted / rejected / reclassified. Nothing here counts on its own —
// only an "accept" (or, later, the estimator via a review item for a
// candidate this stage never got to) adds a mark.
//
// Failure policy, same as the other evidence readers: a truncated call
// throws (the run fails, never a silent truncation); a stop throws; any
// other failure loses only that job's candidates (recorded in `errors`) —
// the type's count is simply not raised, never assumed.
import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../retry';
import { RunCancelledError, runSignalOf } from '../runControl';
import { assertNotTruncated, isAgentTruncatedError } from '../stopReason';
import { sanitizeForPrompt } from '../sanitizeForPrompt';
import { supportsEffort } from '../counter';
import { runWithConcurrencyLimit } from '../../utils/concurrencyLimit';
import { logger } from '../../utils/logger';
import { CROP_CHECK_SYSTEM, GAP_FILL_SYSTEM } from '../prompts';
import { renderRegion } from './evidenceStage';
import { imageLimitsFor, type ModelImageLimits } from '../modelLimits';
import type { CountTarget } from '../countTargets';
import type { TypeCountResult } from '../countMerge';
import type { RectIn, SheetGeom } from './viewports';
import { candidateToPdfPoint, dedupeAgainstExisting, parseGapFillReply, type GapFillCandidate } from './gapFill';
import { parseCropCheckReply, type CropCheckDecision } from './cropCheck';
import type { ReconcileFinding } from './reconcile';
import { screenPosition } from '../../estimating/pageGeometry';

export interface GapFillJob {
  typeKey: string;
  sheetKey: string;
  reason: string;
  findingKind: ReconcileFinding['kind'];
}

/** Pure: one job per (type, sheet it is counted from), de-duplicated — a
 *  finding that names several types ("S1+S2", one catalog family sharing an
 *  untagged schedule row) becomes one job per type. A type with no eligible
 *  sheet (never counted, or only failed sheets) gets no job — gap-fill
 *  never invents a sheet to search. */
export function buildGapFillJobs(findings: ReconcileFinding[], types: Pick<TypeCountResult, 'key' | 'sheets'>[]): GapFillJob[] {
  const byKey = new Map(types.map(t => [t.key, t]));
  const jobs: GapFillJob[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    for (const key of f.typeKey.split('+')) {
      const t = byKey.get(key);
      const sheet = t?.sheets.find(s => s.used);
      if (!sheet) continue;
      const jobKey = `${key}@${sheet.sheetKey}`;
      if (seen.has(jobKey)) continue;
      seen.add(jobKey);
      jobs.push({ typeKey: key, sheetKey: sheet.sheetKey, reason: f.reason, findingKind: f.kind });
    }
  }
  return jobs;
}

export interface GapFillSheetAsset {
  page: number;
  pdf: Buffer;
  geometry: SheetGeom;
  /** Every mark already counted on this sheet, any type (PDF points) —
   *  the same-type ones exclude re-reports; one is rendered as the
   *  "confirmed example" crop. */
  existingMarks: Array<{ typeKey: string; x: number; y: number }>;
  /** The type's own legend/schedule definition on this sheet, when the
   *  viewport reader found one — rendered as a second few-shot example. */
  legendRect?: RectIn | null;
  /** Defaults to the whole sheet. */
  searchRect?: RectIn | null;
}

export interface GapFillUsage { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }

export interface GapFillCandidateOut {
  typeKey: string;
  sheetKey: string;
  x: number;
  y: number;
  confidence: GapFillCandidate['confidence'];
  note: string;
  reason: string;
  decision: CropCheckDecision | 'pending';
  decisionNote: string;
  /** Only set when the crop check reclassified this candidate. */
  reclassKey?: string;
}

export interface GapFillStageOutput {
  candidates: GapFillCandidateOut[];
  usage: GapFillUsage;
  calls: number;
  errors: string[];
}

export interface GapFillStageInput {
  client: Anthropic;
  model: string;
  maxTokens: number;
  jobs: GapFillJob[];
  targets: CountTarget[];
  assets: Map<string, GapFillSheetAsset>;
  limits?: ModelImageLimits;
  shouldStop?: () => boolean;
  concurrency?: number;
}

const ZERO: GapFillUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
export const GAPFILL_CONCURRENCY = 3;
/** Half-width of a small crop around one candidate/example mark. */
const EXAMPLE_HALF_IN = 0.6;

function imageBlock(png: Buffer): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } };
}

function extractText(resp: Anthropic.Message): string {
  return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
}

function displayedInchesOf(g: SheetGeom): { width: number; height: number } {
  const rot = ((g.rotation % 360) + 360) % 360;
  return rot === 90 || rot === 270 ? { width: g.heightPt / 72, height: g.widthPt / 72 } : { width: g.widthPt / 72, height: g.heightPt / 72 };
}

function clampRect(r: RectIn, page: { width: number; height: number }): RectIn {
  const left = Math.max(0, Math.min(r.left, page.width));
  const top = Math.max(0, Math.min(r.top, page.height));
  return { left, top, width: Math.max(0.1, Math.min(r.width, page.width - left)), height: Math.max(0.1, Math.min(r.height, page.height - top)) };
}

/** PDF user-space point -> displayed inches (mirrors viewports.ts's
 *  pdfToDisplayedIn; kept local to avoid a dependency on that module for
 *  one helper). */
function pdfToDisplayedInLocal(x: number, y: number, g: SheetGeom): { x: number; y: number } {
  const p = screenPosition(x, y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
  return { x: p.x / 72, y: p.y / 72 };
}

export async function runGapFillStage(input: GapFillStageInput): Promise<GapFillStageOutput> {
  const out: GapFillStageOutput = { candidates: [], usage: { ...ZERO }, calls: 0, errors: [] };
  const targetByKey = new Map(input.targets.map(t => [t.key, t]));
  const targetKeys = new Set(input.targets.map(t => t.key));
  const limits = input.limits ?? imageLimitsFor(input.model);

  async function call(system: string, content: Anthropic.ContentBlockParam[], label: string): Promise<string> {
    if (input.shouldStop?.()) throw new RunCancelledError();
    const resp = await callWithRetry(() => input.client.messages.stream({
      model: input.model,
      max_tokens: input.maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      ...(supportsEffort(input.model) ? { output_config: { effort: 'medium' as const } } : {}),
    }).finalMessage(), { signal: runSignalOf(input.client), onRetry: (a, _e, d) => logger.warn(`[gapfill] ${label} retry ${a} in ${d}ms`) });
    out.calls++;
    out.usage.input_tokens += resp.usage?.input_tokens ?? 0;
    out.usage.output_tokens += resp.usage?.output_tokens ?? 0;
    out.usage.cache_creation_input_tokens += resp.usage?.cache_creation_input_tokens ?? 0;
    out.usage.cache_read_input_tokens += resp.usage?.cache_read_input_tokens ?? 0;
    if (resp.stop_reason === 'refusal') throw new Error('the model declined');
    assertNotTruncated(resp, `Gap-fill (${label})`, input.maxTokens);
    return extractText(resp);
  }

  await runWithConcurrencyLimit(input.jobs, input.concurrency ?? GAPFILL_CONCURRENCY, async (job) => {
    if (input.shouldStop?.()) return;
    const target = targetByKey.get(job.typeKey);
    const asset = input.assets.get(job.sheetKey);
    if (!target || !asset) return;
    const page = displayedInchesOf(asset.geometry);
    const searchRect = asset.searchRect ?? { left: 0, top: 0, width: page.width, height: page.height };
    const sameType = asset.existingMarks.filter(m => m.typeKey === job.typeKey);
    try {
      const content: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `SYMBOL: ${sanitizeForPrompt(target.type)} — ${sanitizeForPrompt(target.description) || '(no description)'}${target.symbolHint ? ` — drawn as: ${sanitizeForPrompt(target.symbolHint)}` : ''}` },
        { type: 'text', text: `WHY: ${sanitizeForPrompt(job.reason)}` },
      ];
      if (sameType.length) {
        const ex = sameType[0];
        const exIn = pdfToDisplayedInLocal(ex.x, ex.y, asset.geometry);
        const exRect = clampRect({ left: exIn.x - EXAMPLE_HALF_IN, top: exIn.y - EXAMPLE_HALF_IN, width: 2 * EXAMPLE_HALF_IN, height: 2 * EXAMPLE_HALF_IN }, page);
        const exImg = await renderRegion(asset.pdf, asset.page, asset.geometry, exRect, limits);
        content.push({ type: 'text', text: 'CONFIRMED EXAMPLE — a real instance already counted on this sheet:' }, imageBlock(exImg.png));
      }
      if (asset.legendRect) {
        const legendImg = await renderRegion(asset.pdf, asset.page, asset.geometry, asset.legendRect, limits);
        content.push({ type: 'text', text: 'THE LEGEND / SCHEDULE ENTRY THAT DEFINES IT:' }, imageBlock(legendImg.png));
      }
      const already = sameType.map(m => {
        const p = pdfToDisplayedInLocal(m.x, m.y, asset.geometry);
        return { x: Math.round(((p.x - searchRect.left) / searchRect.width) * 1000) / 1000, y: Math.round(((p.y - searchRect.top) / searchRect.height) * 1000) / 1000 };
      }).filter(p => p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02);
      const searchImg = await renderRegion(asset.pdf, asset.page, asset.geometry, searchRect, limits);
      content.push(
        { type: 'text', text: `ALREADY-COUNTED POSITIONS in the search area below (fractions; do not report these again): ${already.length ? JSON.stringify(already) : '(none)'}` },
        { type: 'text', text: 'THE SEARCH AREA:' },
        imageBlock(searchImg.png),
        { type: 'text', text: 'Return only NEW instances. Strict JSON only.' },
      );
      const text = await call(GAP_FILL_SYSTEM, content, `${job.typeKey} on ${job.sheetKey}`);
      const parsed = parseGapFillReply(text, searchRect);
      if (!parsed) throw new Error('the gap-fill reply was not in the expected shape');
      const deduped = dedupeAgainstExisting(parsed, sameType, asset.geometry);
      if (!deduped.length) return;

      // 4.3 — one crop-check call for every candidate this job produced.
      const ids = deduped.map((_, i) => `c${i + 1}`);
      const ccContent: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `CANDIDATE SYMBOL: ${sanitizeForPrompt(target.type)} — ${sanitizeForPrompt(target.description) || '(no description)'}` },
      ];
      if (sameType.length) {
        const ex = sameType[0];
        const exIn = pdfToDisplayedInLocal(ex.x, ex.y, asset.geometry);
        const exRect = clampRect({ left: exIn.x - EXAMPLE_HALF_IN, top: exIn.y - EXAMPLE_HALF_IN, width: 2 * EXAMPLE_HALF_IN, height: 2 * EXAMPLE_HALF_IN }, page);
        const exImg = await renderRegion(asset.pdf, asset.page, asset.geometry, exRect, limits);
        ccContent.push({ type: 'text', text: 'CONFIRMED EXAMPLE:' }, imageBlock(exImg.png));
      }
      for (const [i, c] of deduped.entries()) {
        const rect = clampRect({ left: c.xIn - EXAMPLE_HALF_IN, top: c.yIn - EXAMPLE_HALF_IN, width: 2 * EXAMPLE_HALF_IN, height: 2 * EXAMPLE_HALF_IN }, page);
        const img = await renderRegion(asset.pdf, asset.page, asset.geometry, rect, limits);
        ccContent.push({ type: 'text', text: `Candidate ${ids[i]}:` }, imageBlock(img.png));
      }
      ccContent.push({ type: 'text', text: 'Decide every candidate. Strict JSON only.' });
      const ccText = await call(CROP_CHECK_SYSTEM, ccContent, `crop-check ${job.typeKey} on ${job.sheetKey}`);
      const decisions = parseCropCheckReply(ccText, ids, targetKeys);
      for (const [i, c] of deduped.entries()) {
        const p = candidateToPdfPoint(c, asset.geometry);
        const d = decisions?.[i];
        out.candidates.push({
          typeKey: job.typeKey, sheetKey: job.sheetKey, x: p.x, y: p.y, confidence: c.confidence, note: c.note, reason: job.reason,
          decision: d?.decision ?? 'pending', decisionNote: d?.note ?? (decisions ? '' : 'the crop check reply was not in the expected shape'),
          ...(d?.decision === 'reclass' && d.reclassKey ? { reclassKey: d.reclassKey } : {}),
        });
      }
    } catch (err) {
      if (err instanceof RunCancelledError || isAgentTruncatedError(err)) throw err;
      out.errors.push(`${job.typeKey} on ${job.sheetKey}: gap-fill could not run (${err instanceof Error ? err.message : String(err)})`);
    }
  });
  return out;
}

export interface GapFillApplyResult {
  types: TypeCountResult[];
  quantities: Record<string, unknown>[];
  marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number }>;
  accepted: number;
  /** Rejected, or accepted-but-couldn't-be-applied (no such type any more) —
   *  kept for the record, never silently dropped. */
  notApplied: GapFillCandidateOut[];
}

/** Pure: apply the crop check's decisions. ONLY 'accept' (this candidate's
 *  own type) or 'reclass' to a REAL, still-present type ever raises a
 *  count — gap-fill's own proposal, or a crop check that never answered, is
 *  never counted. Every candidate this stage produced is accounted for in
 *  the result: it either raised a type's count or is in `notApplied`. */
export function applyGapFillResults(
  types: TypeCountResult[],
  quantities: Record<string, unknown>[],
  marks: Array<{ sheetKey: string; typeKey: string; x: number; y: number }>,
  candidates: GapFillCandidateOut[],
): GapFillApplyResult {
  const outTypes = types.map(t => ({ ...t, flags: [...t.flags] }));
  const outQuantities = quantities.map(r => ({ ...r }));
  const outMarks = [...marks];
  const byKey = new Map(outTypes.map(t => [t.key, t]));
  let accepted = 0;
  const notApplied: GapFillCandidateOut[] = [];
  for (const c of candidates) {
    const key = c.decision === 'accept' ? c.typeKey : c.decision === 'reclass' && c.reclassKey ? c.reclassKey : null;
    const t = key ? byKey.get(key) : undefined;
    if (!t) { notApplied.push(c); continue; }
    accepted++;
    t.count += 1;
    t.components = { drawn: t.components?.drawn ?? 0, typical: t.components?.typical ?? 0, schedule: t.components?.schedule ?? 0, gapfill: (t.components?.gapfill ?? 0) + 1 };
    t.gapFill = [...(t.gapFill ?? []), { x: c.x, y: c.y, sheetKey: c.sheetKey, confidence: c.confidence, note: c.decisionNote || c.note, reason: c.reason }];
    if (t.status === 'zero' || t.status === 'unreadable') { t.status = 'counted'; t.reason = ''; }
    t.flags.push(`${t.type}: +1 found by a targeted re-search (${c.reason}) — crop-check accepted${c.decision === 'reclass' ? ` as ${t.type} (gap-fill had proposed a different type)` : ''}.`);
    outMarks.push({ sheetKey: c.sheetKey, typeKey: key!, x: c.x, y: c.y });
    const row = outQuantities.find(r => r.countType === t.type);
    if (row) row.qty = (Number(row.qty) || 0) + 1;
  }
  return { types: outTypes, quantities: outQuantities, marks: outMarks, accepted, notApplied };
}
