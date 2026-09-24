// Evidence round 4.3 / 4.4 — the I/O half of gap-fill and crop-check. One
// gap-fill call per (type, sheet) job proposes SUGGESTED marks; one
// crop-check call per job (batching every candidate the job produced into
// one call, the same way the counter batches tiles) turns each into
// accepted / rejected / reclassified.
//
// Fix round (review a479103) — B2, the core principle: gap-fill and
// crop-check results NEVER change a GC-facing quantity by themselves, no
// matter what the crop check says. An "accept" (or a "reclass" to a real,
// still-present target) only ever produces a SUGGESTED marker — the same
// kind the counter's own marks become (aiMarkers.ts) — plus one review item
// per type. Only the estimator's own confirmation of that marker, through
// the existing Plans-view confirm flow, ever raises a count.
//
// B1 — a candidate is checked against the sheet's OWN viewports (the same
// ones Part 1 uses): the search image is cropped to the countable
// (main/enlarged) viewports only, never the whole sheet, and any candidate
// that still lands in a legend/schedule/notes/detail viewport — or that a
// main-plan/enlarged-plan replacement already excluded — is rejected before
// it ever reaches a crop-check call. The exclusion list gap-fill is told
// about includes every mark Part 1 excluded for that type, not just the
// ones that made it into `count_result.marks`.
//
// Failure policy, same as the other evidence readers: a truncated call
// throws (the run fails, never a silent truncation); a stop throws; any
// other failure loses only that job's candidates (recorded in `errors`) —
// never assumed.
import type Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { callWithRetry } from '../retry';
import { RunCancelledError, runSignalOf } from '../runControl';
import { assertNotTruncated, isAgentTruncatedError } from '../stopReason';
import { sanitizeForPrompt } from '../sanitizeForPrompt';
import { supportsEffort } from '../counter';
import { runWithConcurrencyLimit } from '../../utils/concurrencyLimit';
import { logger } from '../../utils/logger';
import { CROP_CHECK_SYSTEM, EVIDENCE_PROMPT_VERSION, GAP_FILL_SYSTEM } from '../prompts';
import { renderRegion, type EvidenceCache } from './evidenceStage';
import { imageLimitsFor, type ModelImageLimits } from '../modelLimits';
import type { CountTarget } from '../countTargets';
import type { TypeCountResult } from '../countMerge';
import { PLAN_KINDS, viewportAt, type RectIn, type SheetGeom, type Viewport } from './viewports';
import { candidateToPdfPoint, dedupeAgainstExisting, parseGapFillReply, GAPFILL_DEDUP_RADIUS_IN, type GapFillCandidate } from './gapFill';
import { parseCropCheckReply, type CropCheckDecision } from './cropCheck';
import type { ReconcileFinding } from './reconcile';
import { screenPosition } from '../../estimating/pageGeometry';

export interface GapFillJob {
  typeKey: string;
  sheetKey: string;
  reason: string;
  findingKind: ReconcileFinding['kind'];
  /** S4 — the finding this job answers, carried through so the review item
   *  (built in countingStage.ts) can show both sides without re-joining. */
  source: string;
  expected: number;
  actual: number;
  /** B2 — candidates are capped at this many: gap-fill can only ever be
   *  asked to find AT MOST the shortfall, never an open-ended search. */
  diff: number;
}

/** S4 — a cap on how many gap-fill jobs one run pays for, ranked by the
 *  size of the shortfall (a rough $ risk proxy: the bigger the gap, the
 *  more worth a paid re-search). Disclosed on the output (`jobsSkipped`). */
export const MAX_GAPFILL_JOBS = 12;

/** Pure: one job per (type, EACH sheet it is counted from — not just the
 *  first, S4), for UNDER findings only (B2 — an over-count has nothing for
 *  gap-fill to search for), capped at MAX_GAPFILL_JOBS and ranked by the
 *  size of the shortfall. A type with no eligible sheet (never counted, or
 *  only failed sheets) gets no job — gap-fill never invents a sheet to
 *  search. */
export function buildGapFillJobs(
  findings: ReconcileFinding[],
  types: Pick<TypeCountResult, 'key' | 'sheets'>[],
  maxJobs = MAX_GAPFILL_JOBS,
): { jobs: GapFillJob[]; jobsSkipped: number } {
  const byKey = new Map(types.map(t => [t.key, t]));
  const all: GapFillJob[] = [];
  const seen = new Set<string>();
  for (const f of findings.filter(x => x.direction === 'under').sort((a, b) => b.diff - a.diff)) {
    for (const key of f.typeKey.split('+')) {
      const t = byKey.get(key);
      for (const sheet of t?.sheets.filter(s => s.used) ?? []) {
        const jobKey = `${key}@${sheet.sheetKey}`;
        if (seen.has(jobKey)) continue;
        seen.add(jobKey);
        all.push({ typeKey: key, sheetKey: sheet.sheetKey, reason: f.reason, findingKind: f.kind, source: f.source, expected: f.expected, actual: f.actual, diff: f.diff });
      }
    }
  }
  return { jobs: all.slice(0, maxJobs), jobsSkipped: Math.max(0, all.length - maxJobs) };
}

export interface GapFillSheetAsset {
  page: number;
  pdf: Buffer;
  geometry: SheetGeom;
  /** Every mark already COUNTED on this sheet, any type (PDF points). */
  existingMarks: Array<{ typeKey: string; x: number; y: number }>;
  /** B1 — every mark Part 1 EXCLUDED on this sheet, any type, any reason
   *  (a legend symbol, a detail, a main-plan area an enlarged plan
   *  replaced …), PDF points. Combined with `existingMarks` for both the
   *  "already-counted positions" exclusion list and the dedup check — a
   *  real, already-excluded GFCI must never come back as a "new" one. */
  excludedMarks?: Array<{ typeKey: string; x: number; y: number }>;
  /** The type's own legend/schedule definition on this sheet, when the
   *  viewport reader found one — rendered as a second few-shot example. */
  legendRect?: RectIn | null;
  /** B1 — restricted to the countable (main_plan/enlarged_plan) viewports'
   *  bounding box when the sheet's viewports are known; the whole sheet
   *  only when they are not (a legacy/unattributed sheet). */
  searchRect?: RectIn | null;
  /** B1 — this sheet's viewports, for rejecting a candidate that lands
   *  outside every countable one. Absent/empty = no rejection (the sheet's
   *  viewports were never attributed — Part 1's own "nothing changes"
   *  fallback). */
  viewports?: Viewport[] | null;
  /** S4 — this sheet PDF's content hash, for the gap-fill/crop-check cache. */
  sha?: string | null;
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
  /** S4 — jobs answered from the cache (no call spent). */
  cachedJobs: number;
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
  /** S4 — cached by (sheet sha, page, type+finding, model/prompt version),
   *  the same store the other evidence readers use. */
  cache?: EvidenceCache;
}

const ZERO: GapFillUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
export const GAPFILL_CONCURRENCY = 3;
/** Half-width of a small crop around one candidate/example mark. */
const EXAMPLE_HALF_IN = 0.6;
/** N2 — the search area is rendered at up to this DPI (matching the
 *  counter's own tile resolution) rather than the other evidence readers'
 *  200 DPI cap: a whole-sheet-at-evidence-resolution image is exactly what
 *  made small GFCI glyphs illegible before the search area was restricted
 *  to one viewport's bounding box (B1); now that the crop is small, a
 *  higher cap actually reaches it without exceeding the model's image-token
 *  budget. */
const GAPFILL_SEARCH_DPI = 300;
export const GAP_FILL_CACHE_VERSION = `${EVIDENCE_PROMPT_VERSION}|gf2`;

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

/** B1 — the bounding box of every countable (main_plan / enlarged_plan)
 *  viewport on the sheet — never the whole sheet, which is what let a
 *  gap-fill candidate land inside a legend or a schedule in the first
 *  place. null when the sheet's viewports aren't known (falls back to the
 *  whole sheet, Part 1's own "nothing changes" rule). */
export function planSearchRect(viewports: Viewport[] | null | undefined): RectIn | null {
  const plans = (viewports ?? []).filter(v => PLAN_KINDS.has(v.kind));
  if (!plans.length) return null;
  const left = Math.min(...plans.map(v => v.rectIn.left));
  const top = Math.min(...plans.map(v => v.rectIn.top));
  const right = Math.max(...plans.map(v => v.rectIn.left + v.rectIn.width));
  const bottom = Math.max(...plans.map(v => v.rectIn.top + v.rectIn.height));
  return { left, top, width: right - left, height: bottom - top };
}

interface CachedJobResult { candidates: Array<Omit<GapFillCandidateOut, 'typeKey' | 'sheetKey'>> }

export async function runGapFillStage(input: GapFillStageInput): Promise<GapFillStageOutput> {
  const out: GapFillStageOutput = { candidates: [], usage: { ...ZERO }, calls: 0, errors: [], cachedJobs: 0 };
  const targetByKey = new Map(input.targets.map(t => [t.key, t]));
  const targetKeys = new Set(input.targets.map(t => t.key));
  const targetList = input.targets.filter(t => t.role !== 'host')
    .map(t => `- ${sanitizeForPrompt(t.type)} | ${sanitizeForPrompt(t.description) || '(no description)'}`).join('\n');
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
    const searchRect = clampRect(asset.searchRect ?? { left: 0, top: 0, width: page.width, height: page.height }, page);
    // B1 — "already counted" is every mark of this type the sheet has,
    // whether it was COUNTED or EXCLUDED (a legend symbol, a detail, a
    // main-plan area an enlarged plan replaced …). A real, already-known
    // instance must never come back as a "new" one just because it wasn't
    // in the final tally.
    const sameType = [...asset.existingMarks, ...(asset.excludedMarks ?? [])].filter(m => m.typeKey === job.typeKey);
    const cacheKind = `gapfill:${job.typeKey}:${job.expected}-${job.actual}`;
    const cacheKey = `${input.model}|${GAP_FILL_CACHE_VERSION}`;
    try {
      let cached: CachedJobResult | null = null;
      if (input.cache && asset.sha) {
        try { cached = (await input.cache.get(asset.sha, asset.page, cacheKind, cacheKey)) as CachedJobResult | null; } catch (err) { logger.warn({ err }, '[gapfill] cache read failed'); }
      }
      if (cached) {
        out.cachedJobs++;
        out.candidates.push(...cached.candidates.map(c => ({ ...c, typeKey: job.typeKey, sheetKey: job.sheetKey })));
        return;
      }
      const content: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `SYMBOL: ${sanitizeForPrompt(target.type)} — ${sanitizeForPrompt(target.description) || '(no description)'}${target.symbolHint ? ` — drawn as: ${sanitizeForPrompt(target.symbolHint)}` : ''}` },
        { type: 'text', text: `WHY: ${sanitizeForPrompt(job.reason)}` },
      ];
      if (sameType.length) {
        const ex = sameType[0];
        const exIn = pdfToDisplayedInLocal(ex.x, ex.y, asset.geometry);
        const exRect = clampRect({ left: exIn.x - EXAMPLE_HALF_IN, top: exIn.y - EXAMPLE_HALF_IN, width: 2 * EXAMPLE_HALF_IN, height: 2 * EXAMPLE_HALF_IN }, page);
        const exImg = await renderRegion(asset.pdf, asset.page, asset.geometry, exRect, limits);
        content.push({ type: 'text', text: 'CONFIRMED EXAMPLE — a real instance already found on this sheet:' }, imageBlock(exImg.png));
      }
      if (asset.legendRect) {
        const legendImg = await renderRegion(asset.pdf, asset.page, asset.geometry, asset.legendRect, limits);
        content.push({ type: 'text', text: 'THE LEGEND / SCHEDULE ENTRY THAT DEFINES IT:' }, imageBlock(legendImg.png));
      }
      const already = sameType.map(m => {
        const p = pdfToDisplayedInLocal(m.x, m.y, asset.geometry);
        return { x: Math.round(((p.x - searchRect.left) / searchRect.width) * 1000) / 1000, y: Math.round(((p.y - searchRect.top) / searchRect.height) * 1000) / 1000 };
      }).filter(p => p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02);
      const searchImg = await renderRegion(asset.pdf, asset.page, asset.geometry, searchRect, limits, GAPFILL_SEARCH_DPI);
      content.push(
        { type: 'text', text: `ALREADY-COUNTED POSITIONS in the search area below (fractions; do not report these again): ${already.length ? JSON.stringify(already) : '(none)'}` },
        { type: 'text', text: 'THE SEARCH AREA:' },
        imageBlock(searchImg.png),
        { type: 'text', text: `Return at most ${job.diff} NEW instance(s) — the reconciliation shortfall is ${job.diff}. Strict JSON only.` },
      );
      const text = await call(GAP_FILL_SYSTEM, content, `${job.typeKey} on ${job.sheetKey}`);
      const parsed = parseGapFillReply(text, searchRect, job.diff);
      if (!parsed) throw new Error('the gap-fill reply was not in the expected shape');
      let deduped = dedupeAgainstExisting(parsed, sameType, asset.geometry);
      // B1 — reject anything that still lands outside a countable viewport
      // (a legend, schedule, notes or detail block, or simply unattributed)
      // before spending a crop-check call on it. Only when the sheet's
      // viewports are actually known — an unattributed sheet changes
      // nothing, same as Part 1's own rule.
      const rejectedByViewport: typeof deduped = [];
      if (asset.viewports?.length) {
        deduped = deduped.filter(c => {
          const vp = viewportAt(asset.viewports!, c.xIn, c.yIn);
          const ok = !!vp && PLAN_KINDS.has(vp.kind);
          if (!ok) rejectedByViewport.push(c);
          return ok;
        });
      }
      const jobCandidates: GapFillCandidateOut[] = [];
      for (const c of rejectedByViewport) {
        const p = candidateToPdfPoint(c, asset.geometry);
        jobCandidates.push({
          typeKey: job.typeKey, sheetKey: job.sheetKey, x: p.x, y: p.y, confidence: c.confidence, note: c.note, reason: job.reason,
          decision: 'reject', decisionNote: 'landed outside a countable plan viewport (legend, schedule, notes or detail) — never sent to the crop check',
        });
      }
      if (!deduped.length) {
        out.candidates.push(...jobCandidates);
        if (input.cache && asset.sha) await input.cache.set(asset.sha, asset.page, cacheKind, cacheKey, { candidates: jobCandidates.map(({ typeKey: _t, sheetKey: _s, ...rest }) => rest) }).catch(err => logger.warn({ err }, '[gapfill] cache write failed'));
        return;
      }

      // 4.3 — one crop-check call for every candidate this job produced.
      // N1 — the model is given the real target list so a "reclass" names
      // an actual, existing type, not a guess.
      const ids = deduped.map((_, i) => `c${i + 1}`);
      const ccContent: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `CANDIDATE SYMBOL: ${sanitizeForPrompt(target.type)} — ${sanitizeForPrompt(target.description) || '(no description)'}` },
        { type: 'text', text: `COUNT TARGETS (tag | description) — a "reclass" decision must name one of these tags exactly:\n${targetList}` },
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
        jobCandidates.push({
          typeKey: job.typeKey, sheetKey: job.sheetKey, x: p.x, y: p.y, confidence: c.confidence, note: c.note, reason: job.reason,
          decision: d?.decision ?? 'pending', decisionNote: d?.note ?? (decisions ? '' : 'the crop check reply was not in the expected shape'),
          ...(d?.decision === 'reclass' && d.reclassKey ? { reclassKey: d.reclassKey } : {}),
        });
      }
      out.candidates.push(...jobCandidates);
      if (input.cache && asset.sha) await input.cache.set(asset.sha, asset.page, cacheKind, cacheKey, { candidates: jobCandidates.map(({ typeKey: _t, sheetKey: _s, ...rest }) => rest) }).catch(err => logger.warn({ err }, '[gapfill] cache write failed'));
    } catch (err) {
      if (err instanceof RunCancelledError || isAgentTruncatedError(err)) throw err;
      out.errors.push(`${job.typeKey} on ${job.sheetKey}: gap-fill could not run (${err instanceof Error ? err.message : String(err)})`);
    }
  });
  return out;
}

export interface GapFillSuggestion { typeKey: string; sheetKey: string; x: number; y: number; confidence: string; note: string }

export interface GapFillOutcome {
  /** B2 — accept, or a valid reclass: these become SUGGESTED markers only,
   *  never a count. Deduped against the candidates ALREADY at that (type,
   *  sheet, position) — including a reclass landing on another candidate's
   *  own type (N1). */
  suggested: GapFillSuggestion[];
  /** Rejected (by the crop check or the viewport check), or an
   *  accept/reclass this stage could not apply (no such type any more) —
   *  kept for the record, never silently dropped. */
  notApplied: GapFillCandidateOut[];
}

/** Pure: turn the crop check's decisions into suggestions. ONLY 'accept'
 *  (the candidate's own type) or 'reclass' to a REAL, still-present type
 *  ever becomes a suggestion — gap-fill's own proposal, or a crop check
 *  that never answered, never does. Suggestions are deduped against
 *  existing marks (any status) of the RECLASSIFIED type too (N1): a
 *  reclass that lands where that type is already known is dropped, not
 *  duplicated. */
const RECLASS_DEDUP_PT = GAPFILL_DEDUP_RADIUS_IN * 72;

export function resolveGapFillCandidates(
  candidates: GapFillCandidateOut[],
  existingByTypeAndSheet: Map<string, Array<{ x: number; y: number }>>,
): GapFillOutcome {
  const suggested: GapFillSuggestion[] = [];
  const notApplied: GapFillCandidateOut[] = [];
  const suggestedSoFar = new Map<string, Array<{ x: number; y: number }>>();
  for (const c of candidates) {
    const key = c.decision === 'accept' ? c.typeKey : c.decision === 'reclass' && c.reclassKey ? c.reclassKey : null;
    if (!key) { notApplied.push(c); continue; }
    // N1 — a reclass is deduped against the RECLASSIFIED type's own marks
    // (any status) and against every suggestion already made for it this
    // run, in PDF points (25 pt ~ 0.35", the same radius gap-fill's own
    // pre-crop-check dedup uses in displayed inches).
    const dedupKey = `${key}@${c.sheetKey}`;
    const existing = [...(existingByTypeAndSheet.get(dedupKey) ?? []), ...(suggestedSoFar.get(dedupKey) ?? [])];
    const tooClose = existing.some(e => Math.hypot(e.x - c.x, e.y - c.y) <= RECLASS_DEDUP_PT);
    if (tooClose) { notApplied.push({ ...c, decisionNote: `${c.decisionNote} (already known/suggested at this position for ${key})` }); continue; }
    suggested.push({ typeKey: key, sheetKey: c.sheetKey, x: c.x, y: c.y, confidence: c.confidence, note: c.decisionNote || c.note });
    if (!suggestedSoFar.has(dedupKey)) suggestedSoFar.set(dedupKey, []);
    suggestedSoFar.get(dedupKey)!.push({ x: c.x, y: c.y });
  }
  return { suggested, notApplied };
}

/** Content-hash a sheet's PDF bytes for the gap-fill cache (same algorithm
 *  the other evidence readers use). */
export function sha256Of(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
