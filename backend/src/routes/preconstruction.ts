import { Router, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, AuthRequest, ownScopeId } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { getSetting } from '../db/getSetting';
import Anthropic from '@anthropic-ai/sdk';
import AdmZip from 'adm-zip';
import { AGENT1_SYSTEM, agent1PromptWithCountingSections, AGENT2_SYSTEM, AGENT3_SYSTEM, AGENT4_SYSTEM, PREBID_COMPARE_SYSTEM } from '../ai/prompts';
import { buildProposalDocx, ProposalJSON, renderBidDocx, legacyProposalWithBidMeta, bidDocxFilename } from '../utils/proposalDocx';
import { callWithRetry } from '../ai/retry';
import { assertNotTruncated, isAgentTruncatedError } from '../ai/stopReason';
import { parseAIJSON, extractJSONText } from '../ai/json';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { drawingUpload, documentUpload } from '../utils/upload';
import { uploadFile, getFileMedia } from '../services/googleDrive';
import {
  isPdftoppmAvailable, computePrepFidelity, parseTileOverrideSetting,
  isElectricalSheet, classifySheet,
  TILE_DPI_MIN, TILE_DPI_MAX, TILE_COUNT_MIN, TILE_COUNT_MAX,
  type Agent1Block, type PdfPageSelection, type TileSettingsOverrides,
} from '../ai/documentPrep';
import { isPdftotextAvailable, extractPdfPageTexts } from '../ai/pdfText';
import {
  renderTitleBlockCrops, classifyPages, selectPages, formatSheetLabel,
  shouldDropWholeFile, reviveIfAllDropped,
  type PageClassification,
} from '../ai/pageClassifier';
import {
  TOKENS_PER_TILE, PAGE_TOKEN_OVERHEAD, AGENT1_INPUT_BUDGET,
  estimatePageTokens, orderScheduleFirst, packPagesByBudget, buildBlocksForBatch,
  type Agent1WorkUnit,
} from '../ai/agent1Batching';
import { extractDocxText, extractPdfText, parseBidDocText } from '../utils/bidDocParse';
import { parseTakeoffWorkbook } from '../utils/takeoffParse';
import { parsePrebidScope } from '../utils/prebidScopeParse';
import { parseAccubidBreakdown } from '../utils/accubidParse';
import { storeDocument } from '../utils/storeDocument';
import { mergeAgent1Batches } from '../ai/mergeAgent1';
import { buildAgent4UserMessage, isAgent4Shape, Agent4Output } from '../ai/agent4Message';
import { parseMoney } from '../utils/money';
import { compactForHandoff } from '../ai/compactPayload';
import { analysisIsEmpty } from '../ai/emptyAnalysis';
import { buildPrebidCrossCheck } from '../ai/agent3CrossCheck';
import { runCountingStage } from '../ai/countingStage';
import { writeAiCountMarkers } from '../estimating/aiMarkers';
import { buildReviewItems, carryOverResolutions, reviewStatus, reviewResolutionsForAgent4, type ReviewItem } from '../ai/reviewItems';
import { takeoffGate, getTakeoffReview, resolveReviewItems, reopenReviewItem } from '../estimating/takeoffReview';
import { composeBidData, ComposeBidRow, SavedConfidenceItem } from '../bidstd/composeBidData';
import { resolveUniqueJobNumber } from '../bidstd/boilerplate';
import { renderTakeoffXlsx } from '../bidstd/takeoffXlsx';
import { renderPrebidScopeDocx, prebidScopeFilename } from '../bidstd/prebidScopeDocx';
import { verifyBidDocx, verifyBidText } from '../bidstd/verifyBid';
import { BidData, validateBidData } from '../bidstd/bidData';
import { graphCreateDraft, isGraphMailConfigured } from '../email/graphMailer';
import { rfiDraftSubject, buildRfiDraftHtml } from '../email/rfiDraftEmail';

// Mirrors frontend/src/features/preconstruction/constants.ts PROJECT_TYPES values.
const PROJECT_TYPES = ['cstore_fuel', 'car_wash', 'self_storage', 'office', 'warehouse', 'restaurant', 'medical', 'retail', 'other'];

const router = Router();
const upload = drawingUpload;

export interface AIConfig {
  model: string;
  modelA2: string;
  modelA3: string;
  modelA4: string;
  /** Task 2 — cheap model used to classify pages by title block before tiling. */
  modelClassifier: string;
  /** Takeoff accuracy — the dedicated counting stage (Agent 1C). */
  modelCounter: string;
  maxTokensCounter: number;
  maxTokensA1: number;
  maxTokensA2: number;
  maxTokensA3: number;
  maxTokensA4: number;
  temperature: number;
  promptA1: string;
  promptA2: string;
  promptA3: string;
  promptA4: string;
  /** Task 3 — per-class DPI / max-tiles-per-page overrides for Stage 0 doc prep. */
  tileOverrides: TileSettingsOverrides;
}

const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS_A1 = 16000;
const DEFAULT_MAX_TOKENS_A2 = 4000;
const DEFAULT_MAX_TOKENS_A3 = 4000;
const DEFAULT_MAX_TOKENS_A4 = 8000;
/** Takeoff accuracy Decision 1 — Opus 5.5 counts symbols. Its thinking cannot
 *  be disabled and thinking tokens count against max_tokens, so the budget is
 *  sized for thinking plus ~200-400 compact marks per sheet (see counter.ts). */
export const DEFAULT_COUNTER_MODEL = 'claude-opus-5-5';
export const DEFAULT_MAX_TOKENS_COUNTER = 32000;
const DEFAULT_TEMPERATURE = 0.3;

function parseNumberSetting(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function loadAIConfig(): Promise<AIConfig> {
  const [
    modelSetting, modelA2Setting, modelA3Setting, modelA4Setting, modelClassifierSetting,
    maxA1Setting, maxA2Setting, maxA3Setting, maxA4Setting,
    temperatureSetting,
    promptA1Setting, promptA2Setting, promptA3Setting, promptA4Setting,
    dpiScheduleSetting, dpiPlanSetting, tilesScheduleSetting, tilesPlanSetting,
    modelCounterSetting, maxCounterSetting,
  ] = await Promise.all([
    getSetting('ai_model'),
    getSetting('ai_takeoff_agent2_model'),
    getSetting('ai_takeoff_agent3_model'),
    getSetting('ai_takeoff_agent4_model'),
    getSetting('ai_prep_classifier_model'),
    getSetting('ai_max_tokens_agent1'),
    getSetting('ai_max_tokens_agent2'),
    getSetting('ai_max_tokens_agent3'),
    getSetting('ai_max_tokens_agent4'),
    getSetting('ai_temperature'),
    getSetting('ai_prompt_agent1'),
    getSetting('ai_prompt_agent2'),
    getSetting('ai_prompt_agent3'),
    getSetting('ai_prompt_agent4'),
    getSetting('ai_prep_dpi_schedule'),
    getSetting('ai_prep_dpi_plan'),
    getSetting('ai_prep_tiles_schedule'),
    getSetting('ai_prep_tiles_plan'),
    getSetting('ai_takeoff_counter_model'),
    getSetting('ai_max_tokens_counter'),
  ]);
  const defaultModel = (process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL).trim();
  return {
    model:   (modelSetting   || defaultModel),
    modelA2: (modelA2Setting || 'claude-haiku-4-5-20251001'),
    modelA3: (modelA3Setting || 'claude-haiku-4-5-20251001'),
    modelA4: (modelA4Setting || 'claude-sonnet-4-6'),
    modelClassifier: (modelClassifierSetting || 'claude-haiku-4-5-20251001'),
    modelCounter: ((modelCounterSetting || '').trim() || DEFAULT_COUNTER_MODEL),
    maxTokensCounter: parseNumberSetting(maxCounterSetting || '', DEFAULT_MAX_TOKENS_COUNTER, 1024, 128000),
    maxTokensA1: parseNumberSetting(maxA1Setting || '', DEFAULT_MAX_TOKENS_A1, 256, 64000),
    maxTokensA2: parseNumberSetting(maxA2Setting || '', DEFAULT_MAX_TOKENS_A2, 256, 64000),
    maxTokensA3: parseNumberSetting(maxA3Setting || '', DEFAULT_MAX_TOKENS_A3, 256, 64000),
    maxTokensA4: parseNumberSetting(maxA4Setting || '', DEFAULT_MAX_TOKENS_A4, 256, 64000),
    temperature: parseNumberSetting(temperatureSetting || process.env.AI_TEMPERATURE || '', DEFAULT_TEMPERATURE, 0, 1),
    promptA1: (promptA1Setting || '').trim(),
    promptA2: (promptA2Setting || '').trim(),
    promptA3: (promptA3Setting || '').trim(),
    promptA4: (promptA4Setting || '').trim(),
    tileOverrides: {
      schedule: {
        dpi: parseTileOverrideSetting(dpiScheduleSetting || '', TILE_DPI_MIN, TILE_DPI_MAX),
        maxTilesPerPage: parseTileOverrideSetting(tilesScheduleSetting || '', TILE_COUNT_MIN, TILE_COUNT_MAX),
      },
      plan: {
        dpi: parseTileOverrideSetting(dpiPlanSetting || '', TILE_DPI_MIN, TILE_DPI_MAX),
        maxTilesPerPage: parseTileOverrideSetting(tilesPlanSetting || '', TILE_COUNT_MIN, TILE_COUNT_MAX),
      },
    },
  };
}

function describeAIError(err: unknown): string {
  // Takeoff accuracy Task 1 — a truncation carries its own estimator-facing
  // message ("Agent N ran out of room — raise its Max Tokens"); never bury it
  // under a generic "AI request failed:" prefix.
  if (isAgentTruncatedError(err)) return (err as Error).message;
  const e = err as { message?: string; status?: number; error?: { message?: string }; response?: { data?: { error?: string; message?: string } } };
  const status = e.status ? `Anthropic ${e.status}` : 'AI request failed';
  const detail = e.error?.message || e.response?.data?.error || e.response?.data?.message || e.message || 'Unknown error';
  return `${status}: ${detail}`;
}

// ── Helper: extract text from Anthropic response ──────────────────────────────
function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

/** Stage 0 prep summary: tile count per sheet + total image/document blocks. */
interface PrepSummary {
  sheets: { sheet: string; tiles: number }[];
  imageBlocks: number;
  documentBlocks: number;
}

function summarizePrep(blocks: Agent1Block[]): PrepSummary {
  const sheets: { sheet: string; tiles: number }[] = [];
  let current: { sheet: string; tiles: number } | null = null;
  let imageBlocks = 0;
  let documentBlocks = 0;
  for (const b of blocks) {
    // FIX-4 (post-review) — a real sheet-label block always starts with
    // '--- Sheet:' (colon). pdfText.ts's EXTRACTED TEXT header starts with
    // '--- Sheet <label> p<N> — EXTRACTED TEXT ...' (no colon) and must never
    // be mistaken for a sheet label — the colon requirement already excludes
    // it, and the explicit exclusion below makes that intent unmistakable
    // rather than relying solely on the colon's presence.
    if (b.type === 'text' && b.text.startsWith('--- Sheet:') && !b.text.includes('EXTRACTED TEXT')) {
      current = { sheet: b.text.replace(/^--- Sheet:\s*/, '').replace(/\s*---$/, ''), tiles: 0 };
      sheets.push(current);
    } else if (b.type === 'image') {
      imageBlocks++;
      if (current) current.tiles++;
    } else if (b.type === 'document') {
      documentBlocks++;
      if (current) current.tiles++;
    }
  }
  return { sheets, imageBlocks, documentBlocks };
}

function logAgent1Request(bidId: string, blocks: Agent1Block[], model: string, maxTokens: number, batchLabel: string, prep: PrepSummary) {
  const blockSummary = (blocks as Array<{ type: string; source?: { media_type?: string; type?: string }; text?: string }>).map(b => ({
    type: b.type,
    ...(b.source ? { source_type: b.source.type, media_type: b.source.media_type } : {}),
    ...(b.text   ? { text_length: b.text.length } : {}),
  }));
  logger.info({
    bidId, batch: batchLabel, model, maxTokens,
    tiles_per_sheet: prep.sheets,
    image_blocks: prep.imageBlocks,
    document_blocks: prep.documentBlocks,
    blocks: blockSummary,
  }, '[takeoff] Agent 1 request');
}

function logAgent1Response(bidId: string, resp: Anthropic.Message, outputText: string, batchLabel: string, prep: PrepSummary) {
  logger.info({
    bidId,
    batch: batchLabel,
    image_blocks: prep.imageBlocks,
    document_blocks: prep.documentBlocks,
    stop_reason: resp.stop_reason,
    content_blocks: resp.content.map(b => ({ type: b.type, ...(b.type === 'text' ? { length: (b as Anthropic.TextBlock).text.length } : {}) })),
    input_tokens: resp.usage?.input_tokens,
    output_tokens: resp.usage?.output_tokens,
    output_text_length: outputText.length,
    output_preview: outputText.slice(0, 200),
  }, '[takeoff] Agent 1 response');
}

/** Legacy block builder: one document block per PDF, one image block per image.
 *  Used as a whole-batch fallback if Stage 0 doc prep throws unexpectedly. */
function legacyContentBlocks(batchFiles: Express.Multer.File[]): Agent1Block[] {
  const blocks: Agent1Block[] = [];
  for (const f of batchFiles) {
    const b64 = f.buffer.toString('base64');
    const ext = f.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    } else {
      const mt: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' =
        ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      blocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
    }
  }
  return blocks;
}

/** One row of the persisted prep inventory (takeoff_results.prep_inventory) —
 *  Task 2.3: makes a low-fidelity run visible instead of a single silent log
 *  line, and gives a durable record of every page's classification. */
interface PrepInventoryEntry {
  file: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
  cls: string;
  included: boolean;
  textChars: number;
  /** FIX-5 (phase 2 post-review) — false when the classifier never actually
   *  placed this page (discipline defaulted to 'unknown': missing from its
   *  response entirely, or an invalid discipline value). Recorded distinctly
   *  so silent degradation is visible in the inventory rather than reading as
   *  a confident "other/schedule" classification. */
  classified: boolean;
  /** FIX-1 (phase 2 post-review) — set only when this page's file was dropped
   *  entirely (a non-electrical filename with every page classified as a
   *  non-electrical discipline), so a low-fidelity/zero-content run is visible
   *  in the inventory instead of a silent per-page `included: false`. */
  reason?: string;
}

/** FIX-2 (phase 2 post-review) — per-PDF Stage 0 prep result. Classification,
 *  page selection, and text extraction all run ONCE per file here (fixes the
 *  reviewer's F6 finding that extractPdfPageTexts used to run twice per PDF —
 *  once for inventory char counts, once again during block-building).
 *
 *  `pages` is non-null whenever a page count is known — either from a real
 *  title-block classification, or, when that classification failed outright,
 *  synthesized from pdftotext's page count (already extracted for Task 1)
 *  with a uniform filename-based class (today's whole-file classifySheet
 *  guess) — so even a classifier failure still packs by the same token budget
 *  instead of going out as one oversized call. `pages` is null only in the
 *  true last-resort case where no page count could be determined at all
 *  (poppler entirely unavailable, or pdftotext also unavailable/failed after
 *  classification did) — that PDF goes out as a single opaque document block. */
interface PdfPrepResult {
  filename: string;
  buffer: Buffer;
  pageTexts: string[];
  pages: PdfPageSelection[] | null;
  /** What `pages` would be if a drop (FIX-1) gets reverted by the whole-upload
   *  safety net. Equal to `pages` whenever dropFile is false. */
  revivedPages: PdfPageSelection[] | null;
  dropFile: boolean;
  inventory: PrepInventoryEntry[];
  usage: { input_tokens: number; output_tokens: number };
}

const NO_USAGE = { input_tokens: 0, output_tokens: 0 };

/** FIX-2 — classify one PDF's pages by title block, select which are worth
 *  full-fidelity tiling, and extract its page text — all exactly once. Never
 *  throws; a classification failure must never kill the run (plan
 *  requirement), it just degrades to the filename-based whole-file fallback
 *  (still page-split when the page count is known — see PdfPrepResult above).
 *
 *  FIX-1 (phase 2 post-review): when selectPages' all-excluded guard fires
 *  (every page classified as a non-electrical discipline) AND the filename
 *  itself reads as non-electrical, the whole file is dropped (`dropFile`)
 *  instead of riding the guard's include-everything fallback. */
async function prepOnePdf(
  client: Anthropic,
  classifierModel: string,
  buffer: Buffer,
  filename: string
): Promise<PdfPrepResult> {
  let pageTexts: string[] = [];
  if (await isPdftotextAvailable()) {
    try {
      pageTexts = await extractPdfPageTexts(buffer);
    } catch (err) {
      logger.warn({ err, filename }, '[takeoff] pdftotext extraction failed');
    }
  }

  const fallback = (): PdfPrepResult => {
    if (!pageTexts.length) {
      // No page count available at all — true opaque whole-file fallback.
      return { filename, buffer, pageTexts, pages: null, revivedPages: null, dropFile: false, inventory: [], usage: NO_USAGE };
    }
    // Classifier couldn't run, but the page count IS known — synthesize a
    // uniform filename-based page selection (today's whole-file classifySheet
    // guess) so this PDF still packs by the token budget instead of one call.
    const cls = classifySheet(filename);
    const pages: PdfPageSelection[] = pageTexts.map((_, i) => ({ page: i + 1, label: filename, cls }));
    return { filename, buffer, pageTexts, pages, revivedPages: pages, dropFile: false, inventory: [], usage: NO_USAGE };
  };

  if (!(await isPdftoppmAvailable())) return fallback();

  let crops: Awaited<ReturnType<typeof renderTitleBlockCrops>> = [];
  try {
    crops = await renderTitleBlockCrops(buffer);
  } catch (err) {
    logger.warn({ err, filename }, '[takeoff] title-block crop rendering failed — whole-file fallback');
  }
  if (!crops.length) return fallback();

  let classified: Awaited<ReturnType<typeof classifyPages>>;
  try {
    classified = await classifyPages(client, classifierModel, crops, filename);
  } catch (err) {
    // Takeoff accuracy Task 1 — a truncated classifier response fails the run
    // (Decision 9) instead of degrading silently to the whole-file fallback.
    if (isAgentTruncatedError(err)) throw err;
    logger.warn({ err, filename }, '[takeoff] page classification AI call failed — whole-file fallback');
    return fallback();
  }

  const { classifications, usage } = classified;
  const dropFile = shouldDropWholeFile(classifications, filename);
  const { pages: guardPages } = selectPages(classifications);
  const guardPageSet = new Set(guardPages);
  const toSelection = (pageSet: Set<number>): PdfPageSelection[] =>
    classifications
      .filter(c => pageSet.has(c.page))
      .map(c => ({
        page: c.page,
        label: formatSheetLabel(c.sheetNo, c.title, `${filename} p${c.page}`),
        cls: c.cls,
      }));

  const revivedPages = toSelection(guardPageSet);
  const pages = dropFile ? [] : revivedPages;

  const inventory: PrepInventoryEntry[] = classifications.map(c => ({
    file: filename,
    page: c.page,
    sheetNo: c.sheetNo,
    title: c.title,
    discipline: c.discipline,
    cls: c.cls,
    included: !dropFile && guardPageSet.has(c.page),
    textChars: pageTexts[c.page - 1]?.length ?? 0,
    // FIX-5 — 'unknown' discipline means the classifier never actually placed
    // this page (missing from its response, or an invalid value) rather than
    // confidently deciding it belongs to some other discipline.
    classified: c.discipline !== 'unknown',
    ...(dropFile ? { reason: 'all pages excluded by discipline; filename read as non-electrical' } : {}),
  }));

  return { filename, buffer, pageTexts, pages, revivedPages, dropFile, inventory, usage };
}

interface AgentUploadPrepResult {
  /** One Agent 1 call's content blocks per batch — length 1 for an upload
   *  that fits in a single call (the single-pass path stays unchanged). */
  batches: Agent1Block[][];
  inventory: PrepInventoryEntry[];
  classifierUsage: { input_tokens: number; output_tokens: number };
}

/** FIX-2 (phase 2 post-review) — Stage 0 for the WHOLE upload, run once:
 *  classify + select pages + extract text per file (a), build one work unit
 *  per page with an estimated input-token cost (b), and greedily pack those
 *  units — schedule-first across the whole upload, not just within one file —
 *  into batches that each fit under AGENT1_INPUT_BUDGET (c). Replaces the old
 *  per-FILE-count BATCH_SIZE split, which had no relationship to how much
 *  content a call actually carried (a single combined PDF with ~19 selected
 *  pages used to go out as ONE call, well over the context window). */
async function prepareAgent1Upload(
  filesToSend: Express.Multer.File[],
  client: Anthropic,
  classifierModel: string,
  tileOverrides: TileSettingsOverrides
): Promise<AgentUploadPrepResult> {
  const inventory: PrepInventoryEntry[] = [];
  const classifierUsage = { input_tokens: 0, output_tokens: 0 };
  const units: Agent1WorkUnit[] = [];

  const pdfResults: Array<{ prep: PdfPrepResult; dropFile: boolean }> = [];
  const opaqueFallbacks: PdfPrepResult[] = [];

  for (const f of filesToSend) {
    const ext = (f.originalname.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'pdf') {
      units.push({
        kind: 'image', filename: f.originalname, buffer: f.buffer, ext,
        cls: classifySheet(f.originalname), estTokens: TOKENS_PER_TILE + PAGE_TOKEN_OVERHEAD,
      });
      continue;
    }
    const prep = await prepOnePdf(client, classifierModel, f.buffer, f.originalname);
    classifierUsage.input_tokens += prep.usage.input_tokens;
    classifierUsage.output_tokens += prep.usage.output_tokens;
    if (prep.pages === null) opaqueFallbacks.push(prep);
    else pdfResults.push({ prep, dropFile: prep.dropFile });
  }

  // FIX-1's whole-upload safety net: never drop every classified PDF. Only
  // PDFs with a real classification outcome participate — the opaque
  // fallback and known-page-count classifier-failure cases are never dropped
  // in the first place, so they're not part of this decision.
  for (const { prep, dropFile } of reviveIfAllDropped(pdfResults)) {
    const wasRevived = prep.dropFile && !dropFile;
    inventory.push(...prep.inventory.map(entry => (wasRevived ? { ...entry, included: true, reason: undefined } : entry)));
    if (dropFile) continue;
    const pages = wasRevived ? prep.revivedPages! : prep.pages!;
    for (const sel of pages) {
      const text = prep.pageTexts[sel.page - 1] ?? '';
      units.push({
        kind: 'pdf-page', filename: prep.filename, buffer: prep.buffer, page: sel.page,
        label: sel.label, cls: sel.cls, pageText: text,
        estTokens: estimatePageTokens(sel.cls, text.length, tileOverrides),
      });
    }
  }

  for (const prep of opaqueFallbacks) {
    const cls = classifySheet(prep.filename);
    // Page count unknown — never guess low enough to risk under-batching a
    // large document; force it into its own batch (a rare double-fallback
    // path: poppler missing entirely, or pdftotext also unavailable/failed).
    const estTokens = prep.pageTexts.length
      ? prep.pageTexts.length * TOKENS_PER_TILE + Math.ceil(prep.pageTexts.join('').length / 4) + PAGE_TOKEN_OVERHEAD
      : AGENT1_INPUT_BUDGET + 1;
    units.push({ kind: 'document-fallback', filename: prep.filename, buffer: prep.buffer, cls, pageTexts: prep.pageTexts, estTokens });
  }

  const ordered = orderScheduleFirst(units);
  const pageBatches = packPagesByBudget(ordered, AGENT1_INPUT_BUDGET);

  const batches: Agent1Block[][] = [];
  for (const batch of pageBatches) {
    try {
      batches.push(await buildBlocksForBatch(batch, { tileOverrides }));
    } catch (err) {
      const filenames = new Set(batch.map(u => u.filename));
      logger.warn({ err, files: [...filenames] }, '[takeoff] Stage 0 block building failed for a batch — falling back to legacy document blocks for its files');
      const batchFiles = filesToSend.filter(f => filenames.has(f.originalname));
      batches.push(legacyContentBlocks(batchFiles));
    }
  }

  return { batches, inventory, classifierUsage };
}

/** FIX-7 (phase 2 post-review) — merge two Anthropic `usage` objects field by
 *  field (every numeric field summed; the first non-numeric value for any
 *  other field wins), so cache_creation_input_tokens/cache_read_input_tokens
 *  and any other fields survive a merge instead of being reshaped down to
 *  just input_tokens/output_tokens. */
function mergeUsage(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === 'number') {
      merged[k] = (typeof merged[k] === 'number' ? (merged[k] as number) : 0) + v;
    } else if (merged[k] === undefined) {
      merged[k] = v;
    }
  }
  return merged;
}

function compactOutput(text: string, max = 500): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}...`;
}

/** A pipeline input file; `documentId` is set when it was loaded from a bid
 *  document (document_ids), so counted locations can be placed on it. */
type PipelineFile = Express.Multer.File & { documentId?: string };

// ── Background pipeline ───────────────────────────────────────────────────────
// Exported (takeoff accuracy) so integration tests can drive the real pipeline
// with an injected fake Anthropic client — never a real API call from tests.
export async function runPipeline(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig
): Promise<void> {
  let agent1Output = '';
  let agent2Output = '';
  let agent3Output = '';
  // Takeoff accuracy Task 5 — the counting stage needs the page inventory and
  // the PDF bytes Agent 1 was built from.
  let countingInventory: PrepInventoryEntry[] = [];

  const updateStatus = (status: string) =>
    pool.query(`UPDATE takeoff_results SET status=$1 WHERE bid_id=$2`, [status, bidId]);

  // ── Agent 1 ─────────────────────────────────────────────────────────────────
  try {
    // Task 2: the whole-FILE isElectricalSheet filter only applies to non-PDF
    // images now — every PDF passes through here unfiltered, and gets filtered
    // PAGE-BY-PAGE inside prepareAgent1Upload via pageClassifier.ts's title-block
    // classification instead (a combined building set no longer sends 40+
    // non-electrical pages just because the file itself has electrical pages).
    const isPdfFile = (f: Express.Multer.File) => (f.originalname.split('.').pop() || '').toLowerCase() === 'pdf';
    const pdfFiles = files.filter(isPdfFile);
    const nonPdfFiles = files.filter(f => !isPdfFile(f));
    const electricalNonPdf = nonPdfFiles.filter(f => isElectricalSheet(f.originalname));
    const nonPdfToSend = electricalNonPdf.length > 0 ? electricalNonPdf : nonPdfFiles;
    const filesToSend = [...pdfFiles, ...nonPdfToSend];
    const droppedFiles = files.filter(f => !filesToSend.includes(f));
    logger.info({
      bidId,
      sent: filesToSend.map(f => f.originalname),
      dropped: droppedFiles.map(f => f.originalname),
    }, '[takeoff] Agent 1 sheet filter — files sent vs. dropped (PDFs page-filtered separately)');

    // Task 2.3 — a run-level fidelity flag so a low-fidelity run is visible
    // instead of silent (problem 7 in the phase 2 plan).
    const prepFidelity = computePrepFidelity(await isPdftoppmAvailable(), await isPdftotextAvailable());

    // FIX-2 (phase 2 post-review) — classification, page selection, and text
    // extraction all run ONCE for the whole upload, building one work unit per
    // page with an estimated input-token cost, then packing those units
    // (schedule-first across the whole upload) into calls that each stay
    // under AGENT1_INPUT_BUDGET. Replaces the old per-FILE-count BATCH_SIZE
    // split, which had no relationship to how much content a call actually
    // carried. If Stage 0 prep fails outright for the whole upload, fall back
    // to a single legacy document-block call rather than losing the run.
    let uploadPrep: AgentUploadPrepResult;
    try {
      uploadPrep = await prepareAgent1Upload(filesToSend, client, config.modelClassifier, config.tileOverrides);
    } catch (err) {
      if (isAgentTruncatedError(err)) throw err;
      logger.warn({ err, bidId }, '[takeoff] Stage 0 document prep failed for the whole upload — falling back to one legacy document-block call');
      uploadPrep = { batches: [legacyContentBlocks(filesToSend)], inventory: [], classifierUsage: { ...NO_USAGE } };
    }
    const { batches: agent1Batches, inventory: prepInventory, classifierUsage } = uploadPrep;
    countingInventory = prepInventory;
    let agent1JSON: Record<string, unknown> = {};

    if (agent1Batches.length <= 1) {
      // Single pass — everything fit under budget in one call.
      const contentBlocks = agent1Batches[0] ?? [];
      const prep = summarizePrep(contentBlocks);
      contentBlocks.push({
        type: 'text',
        text: 'Analyze all uploaded electrical plans and provide your complete Drawing Analyzer output following your output format exactly. Return JSON only — no prose, no markdown fences.\nIMPORTANT: Even if a sheet contains no electrical equipment, you MUST return a valid JSON object. For non-electrical sheets, include the sheet name in sheet_inventory with a note and leave equipment arrays empty.',
      });

      logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, 'single', prep);
      const resp = await callWithRetry(() =>
        client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokensA1,
          system: [{ type: 'text', text: agent1PromptWithCountingSections(config.promptA1), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contentBlocks }],
        }).finalMessage()
      , { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
      agent1Output = extractText(resp);
      logAgent1Response(bidId, resp, agent1Output, 'single', prep);
      // Task 2.4 — classifier usage is part of drawing analysis, folded into
      // usage_agent1 rather than a new column. FIX-7 — persist the FULL
      // resp.usage shape (cache_creation_input_tokens/cache_read_input_tokens
      // included), not just input/output tokens.
      const mergedUsage = {
        ...resp.usage,
        input_tokens: (resp.usage?.input_tokens ?? 0) + classifierUsage.input_tokens,
        output_tokens: (resp.usage?.output_tokens ?? 0) + classifierUsage.output_tokens,
      };
      await pool.query(
        `UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2, prep_inventory=$3, prep_fidelity=$4 WHERE bid_id=$5`,
        [JSON.stringify(mergedUsage), config.model, JSON.stringify(prepInventory), prepFidelity, bidId]
      ).catch(() => {});
      // Takeoff accuracy Task 1 — after the usage write, so a truncated (but
      // still billed) call's cost is recorded before the run fails.
      assertNotTruncated(resp, 'Agent 1', config.maxTokensA1);

    } else {
      // Batched: N token-budgeted calls (mergeAgent1Batches already merges results).
      const batchResults: Record<string, unknown>[] = [];
      let batchUsage: Record<string, unknown> = { ...NO_USAGE };

      for (let bi = 0; bi < agent1Batches.length; bi++) {
        const contentBlocks = agent1Batches[bi];
        const prep = summarizePrep(contentBlocks);
        contentBlocks.push({
          type: 'text',
          text: `Analyze batch ${bi + 1} of ${agent1Batches.length} electrical plan pages and provide Drawing Analyzer JSON output. Return JSON only — no prose, no markdown fences.\nIMPORTANT: Even if this sheet contains no electrical equipment, you MUST return a valid JSON object with the sheet in sheet_inventory and equipment arrays empty.`,
        });

        logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, `batch ${bi + 1}/${agent1Batches.length}`, prep);
        const bResp = await callWithRetry(() =>
          client.messages.stream({
            model: config.model,
            max_tokens: config.maxTokensA1,
              system: [{ type: 'text', text: agent1PromptWithCountingSections(config.promptA1), cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: contentBlocks }],
          }).finalMessage()
        , { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
        const bText = extractText(bResp);
        logAgent1Response(bidId, bResp, bText, `batch ${bi + 1}/${agent1Batches.length}`, prep);
        // Takeoff accuracy Task 1 — a truncated batch used to fall through to
        // parseAIJSON, fail, and be silently skipped by the merge below: the
        // takeoff just lost every sheet that batch carried.
        assertNotTruncated(bResp, `Agent 1 (batch ${bi + 1} of ${agent1Batches.length})`, config.maxTokensA1);
        if (!bText.trim()) {
          logger.warn({ bidId, batch: `${bi + 1}/${agent1Batches.length}` },
            '[takeoff] Agent 1 batch returned empty output — skipping');
        }
        const parsed = parseAIJSON(bText);
        if (parsed) batchResults.push(parsed);
        // FIX-7 — sum the full usage shape across batches, not just input/output.
        if (bResp.usage) batchUsage = mergeUsage(batchUsage, bResp.usage as unknown as Record<string, unknown>);
      }
      batchUsage = mergeUsage(batchUsage, classifierUsage);
      await pool.query(
        `UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2, prep_inventory=$3, prep_fidelity=$4 WHERE bid_id=$5`,
        [JSON.stringify(batchUsage), config.model, JSON.stringify(prepInventory), prepFidelity, bidId]
      ).catch(() => {});

      // Merge batch results — generic merge over the actual AGENT1_SYSTEM schema
      // (project, service, panels, equipment, quantities, allowances, ecfeciItems,
      // flags, scopeNotes, missingSheets), not a hardcoded legacy key list.
      // See backend/src/ai/mergeAgent1.ts for the merge rules.
      agent1JSON = mergeAgent1Batches(batchResults);
      agent1Output = JSON.stringify(agent1JSON, null, 2);
    }

    // Validate JSON
    const parsedAgent1 = parseAIJSON(agent1Output);
    if (!parsedAgent1) {
      const stopHint = agent1Output.trim().startsWith('```') || agent1Output.trim().startsWith('{')
        ? 'Agent 1 returned JSON that could not be parsed. The response may have been cut off. Try fewer sheets or increase AI Max Tokens in Settings > AI.'
        : 'Agent 1 did not return JSON.';
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [`${stopHint}\n\nRaw preview: ${compactOutput(agent1Output)}`, bidId]
      );
      console.error('[takeoff] Agent 1 JSON parse failed');
      return;
    }
    agent1JSON = parsedAgent1;

    // Task 4.2 — empty-analysis guard: if every batch failed to parse,
    // mergeAgent1Batches still returns a valid-looking {} that would otherwise
    // flow straight into Agents 2-3, billing two more paid calls for nothing.
    if (analysisIsEmpty(agent1JSON)) {
      await pool.query(
        `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [
          'Drawing analysis found no electrical content. Check that the right sheets were uploaded (see the prep inventory) — the run was stopped before Agents 2–3 to avoid billing for an empty takeoff.',
          bidId,
        ]
      );
      logger.warn({ bidId }, '[takeoff] Agent 1 analysis empty — stopped before Agent 2/3');
      return;
    }

    await pool.query(
      `UPDATE takeoff_results SET status='agent1_complete', agent1_output=$1 WHERE bid_id=$2`,
      [agent1Output, bidId]
    );
  } catch (err) {
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 1 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 1 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  // ── Agent 1C: counting stage (takeoff accuracy, Decisions 1-7) ─────────────
  // Every fixture/device/equipment type from the schedules and legend is
  // counted on each electrical plan sheet at 300 DPI; the counts REPLACE
  // Agent 1's own for those types before Agent 2 ever sees them.
  try {
    await updateStatus('counting');
    const pdfs = new Map<string, Buffer>();
    for (const f of files) {
      if ((f.originalname.split('.').pop() || '').toLowerCase() === 'pdf') pdfs.set(f.originalname, f.buffer);
    }
    const stage = await runCountingStage({
      client, model: config.modelCounter, maxTokens: config.maxTokensCounter,
      agent1: parseAIJSON(agent1Output) ?? {}, inventory: countingInventory, pdfs,
    });
    agent1Output = JSON.stringify(stage.agent1, null, 2);
    // Task 6 — counted locations become suggested markers in the Plans view.
    // Non-fatal: a failure here loses the markers, never the counts.
    try {
      const markers = await writeAiCountMarkers(bidId, stage.countResult,
        files.map(f => ({ file: f.originalname, documentId: (f as PipelineFile).documentId, size: f.buffer.length })));
      (stage.countResult as unknown as Record<string, unknown>).markers = markers;
    } catch (err) {
      logger.warn({ err, bidId }, '[takeoff] writing AI count markers failed');
      (stage.countResult as unknown as Record<string, unknown>).markers = { error: 'suggested markers could not be written' };
    }
    // Task 7 — the Needs-review list. A re-run keeps the estimator's earlier
    // resolutions for the same items (their work is never discarded).
    const { rows: prevRows } = await pool.query('SELECT review_items FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const reviewItems = carryOverResolutions(
      buildReviewItems(stage.countResult, []),
      (prevRows[0]?.review_items as ReviewItem[] | null) ?? null,
    );
    await pool.query(
      `UPDATE takeoff_results SET agent1_output=$1, count_result=$2, usage_counter=$3, model_counter=$4,
         review_items=$5, review_status=$6 WHERE bid_id=$7`,
      [agent1Output, JSON.stringify(stage.countResult), JSON.stringify(stage.usage), config.modelCounter,
       JSON.stringify(reviewItems), reviewStatus(reviewItems), bidId]
    );
  } catch (err) {
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Counting stage failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff counting stage failed');
    await pool.query(`UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`, [message, bidId]);
    return;
  }

  // ── Agent 2 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent2_running');
    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA2,
      max_tokens: config.maxTokensA2,
      system: [{ type: 'text', text: config.promptA2 || AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        // Task 4.1 — compact (no 2-space indent) in the request body; storage
        // and the UI keep the pretty agent1Output exactly as today.
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${compactForHandoff(agent1Output)}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    assertNotTruncated(resp, 'Agent 2', config.maxTokensA2);
    agent2Output = extractText(resp);
    const agent2ToStore = extractJSONText(agent2Output) ?? agent2Output;

    await pool.query(
      `UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1, usage_agent2=$2, model_agent2=$3 WHERE bid_id=$4`,
      [agent2ToStore, JSON.stringify(resp.usage), config.modelA2, bidId]
    );
  } catch (err) {
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 2 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 2 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent2_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  // ── Agent 3 ─────────────────────────────────────────────────────────────────
  try {
    await updateStatus('agent3_running');

    // Task 6 — feed Agent 3 the independent pre-bid takeoff (Cowork package,
    // bid_takeoffs kind='prebid') when one exists, so QC can reconcile two
    // independent counts instead of checking Agent 2 against Agent 1's own
    // numbers alone. A missing/unreadable pre-bid row degrades to today's
    // behavior — never let this block the run.
    let prebidCrossCheck: string | null = null;
    try {
      const { rows: prebidRows } = await pool.query(
        `SELECT categories, line_items FROM bid_takeoffs WHERE bid_id=$1 AND kind='prebid'`,
        [bidId]
      );
      prebidCrossCheck = buildPrebidCrossCheck(prebidRows[0] ?? null);
    } catch (err) {
      logger.warn({ err, bidId }, '[takeoff] pre-bid cross-check load failed — continuing without it');
    }

    const resp = await callWithRetry(() => client.messages.create({
      model: config.modelA3,
      max_tokens: config.maxTokensA3,
      system: [{ type: 'text', text: config.promptA3 || AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        // Task 4.1 — compact in the request body (both prior agents' outputs).
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${compactForHandoff(agent1Output)}\n\n---\n\nESTIMATOR OUTPUT:\n\n${compactForHandoff(agent2Output)}${prebidCrossCheck ? `\n\n---\n\n${prebidCrossCheck}` : ''}`,
      }],
    }), { onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
    assertNotTruncated(resp, 'Agent 3', config.maxTokensA3);
    agent3Output = extractText(resp);
    const agent3ToStore = extractJSONText(agent3Output) ?? agent3Output;

    // Final write — all three complete
    await pool.query(`
      UPDATE takeoff_results SET
        status='complete',
        agent3_output=$1,
        raw_response=$2,
        usage_agent3=$3,
        model_agent3=$4
      WHERE bid_id=$5
    `, [agent3ToStore, agent1Output, JSON.stringify(resp.usage), config.modelA3, bidId]);

    // Also persist structured fields from agent1 JSON for backward compatibility
    const a1 = parseAIJSON(agent1Output) ?? {};
    await pool.query(`
      UPDATE takeoff_results SET
        scope=$1, materials=$2
      WHERE bid_id=$3
    `, [
      JSON.stringify(a1.panels ?? []),
      JSON.stringify(a1.quantities ?? []),
      bidId,
    ]);

    // Auto-fill project_type/sq_ft from the takeoff extraction — never overwrite a manually-set value
    const a1Project = (a1.project ?? {}) as Record<string, unknown>;
    const extractedType = String(a1Project.projectType ?? '');
    const extractedSqFt = Number(a1Project.sqFt) || null;
    const validType = PROJECT_TYPES.includes(extractedType) ? extractedType : null;
    if (validType || extractedSqFt) {
      await pool.query(
        `UPDATE bids SET
           project_type = COALESCE(project_type, $1),
           sq_ft = COALESCE(sq_ft, $2)
         WHERE id=$3 AND deleted_at IS NULL`,
        [validType, extractedSqFt, bidId]
      );
    }

    // Fire-and-forget: upload scope extraction JSON to Drive
    (async () => {
      try {
        const { rows: bidRows } = await pool.query(
          'SELECT name, drive_estimates_folder_id FROM bids WHERE id=$1',
          [bidId],
        );
        if (!bidRows.length || !bidRows[0].drive_estimates_folder_id) return;
        const bid = bidRows[0];
        const date = new Date().toISOString().split('T')[0];
        const payload = {
          job: bid.name,
          generated: date,
          drawing_analysis: parseAIJSON(agent1Output) ?? agent1Output,
          scope_and_estimate: agent2Output,
          qc_review: agent3Output,
        };
        await uploadFile(
          `Scope — ${bid.name} — ${date}.json`,
          'application/json',
          Buffer.from(JSON.stringify(payload, null, 2)),
          bid.drive_estimates_folder_id,
        );
      } catch (err) {
        console.error('[drive] Scope JSON upload failed:', err);
      }
    })();
  } catch (err) {
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 3 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 3 failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', agent3_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET hardcoded default system prompts (for display in Settings)
router.get('/prompt-defaults', requireAuth, (_req, res) => {
  res.json({ agent1: AGENT1_SYSTEM, agent2: AGENT2_SYSTEM, agent3: AGENT3_SYSTEM, agent4: AGENT4_SYSTEM });
});

// POST import-bid — non-AI extraction from a bid you built outside the agent pipeline:
// amount + scope of work from the finished proposal (.docx/.pdf), square footage and
// quantity takeoff from its spreadsheet (.xlsx), and the material/labor/equipment/quote
// split plus labor hours from an Accubid "Breakdown" export (.pdf). Label/structure
// parsing only, reliable for APT's own templates.
//
// Every uploaded file is filed in the Documents hub so it shows up on the bid's Files
// tab afterwards. The takeoff and cost breakdown are also parsed and persisted (they
// feed the comparison view); the headline fields come back as a preview and aren't
// written to the bid until the caller PATCHes it with the confirmed values.
router.post('/:bidId/import-bid', requireAuth, documentUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'takeoff', maxCount: 1 },
  { name: 'breakdown', maxCount: 1 },
]), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.file?.[0];
  if (!file) return res.status(400).json({ error: 'file required' });

  // Keep the uploaded file even if parsing later fails — a document that couldn't be
  // read is still the customer's bid, and losing it is worse than a failed import.
  const keep = (f: Express.Multer.File, category: string) =>
    storeDocument({
      file: f, linkedId: bidId, linkedName: bid.name, div: 'elec', category,
      uploadedBy: req.user!.name, replaceExisting: true,
    }).catch(err => { logger.error({ err, bidId, category }, '[import-bid] document store failed'); return null; });

  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  if (ext !== 'docx' && ext !== 'pdf') {
    return res.status(400).json({ error: 'Only .docx and .pdf are supported for bid import' });
  }
  await keep(file, 'proposal');
  const text = ext === 'docx' ? extractDocxText(file.buffer) : await extractPdfText(file.buffer);
  const parsed = parseBidDocText(text);

  let sqFt: number | null = null;
  let takeoffSummary: { categories: unknown[]; itemCount: number } | null = null;
  const takeoffFile = files?.takeoff?.[0];
  if (takeoffFile && (takeoffFile.originalname.split('.').pop() || '').toLowerCase() === 'xlsx') {
    await keep(takeoffFile, 'takeoff');
    const takeoff = parseTakeoffWorkbook(takeoffFile.buffer);
    sqFt = takeoff.sqFt;
    if (takeoff.lineItems.length) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count, source_file, updated_at)
         VALUES ($1,'final',$2::jsonb,$3::jsonb,$4,$5,now())
         ON CONFLICT (bid_id, kind) DO UPDATE SET
           categories=$2::jsonb, line_items=$3::jsonb, item_count=$4, source_file=$5, updated_at=now()`,
        [bidId, JSON.stringify(takeoff.categories), JSON.stringify(takeoff.lineItems),
         takeoff.lineItems.length, takeoffFile.originalname]
      );
      takeoffSummary = { categories: takeoff.categories, itemCount: takeoff.lineItems.length };
    }
  }

  let breakdownSummary: ReturnType<typeof parseAccubidBreakdown> | null = null;
  const breakdownFile = files?.breakdown?.[0];
  if (breakdownFile && (breakdownFile.originalname.split('.').pop() || '').toLowerCase() === 'pdf') {
    await keep(breakdownFile, 'cost_breakdown');
    const b = parseAccubidBreakdown(await extractPdfText(breakdownFile.buffer));
    if (b.sellingPrice || b.laborTotal || b.laborHours) {
      await pool.query(
        `INSERT INTO bid_cost_breakdown (bid_id, material_total, labor_total, equipment_total,
           quotes_total, prime_cost, total_overhead, total_markup, selling_price, labor_hours,
           journeyman_hours, apprentice_hours, avg_labor_rate, avg_crew_size, labor_risk_ratio,
           source_file, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
         ON CONFLICT (bid_id) DO UPDATE SET
           material_total=$2, labor_total=$3, equipment_total=$4, quotes_total=$5,
           prime_cost=$6, total_overhead=$7, total_markup=$8, selling_price=$9,
           labor_hours=$10, journeyman_hours=$11, apprentice_hours=$12, avg_labor_rate=$13,
           avg_crew_size=$14, labor_risk_ratio=$15, source_file=$16, updated_at=now()`,
        [bidId, b.materialTotal, b.laborTotal, b.equipmentTotal, b.quotesTotal, b.primeCost,
         b.totalOverhead, b.totalMarkup, b.sellingPrice, b.laborHours, b.journeymanHours,
         b.apprenticeHours, b.avgLaborRate, b.avgCrewSize, b.laborRiskRatio,
         breakdownFile.originalname]
      );
      breakdownSummary = b;
    }
  }

  res.json({ ...parsed, sqFt, takeoff: takeoffSummary, breakdown: breakdownSummary });
}));

// POST import-prebid — the Cowork pre-bid package: a scope .docx and a quantity .xlsx
// produced right after a bid invite is accepted, before any pricing exists. Stored under
// kind='prebid' so a later finished-bid import cannot overwrite it; the pre-bid set is
// the comparison corpus and is the only takeoff data most jobs will ever have.
router.post('/:bidId/import-prebid', requireAuth, documentUpload.fields([
  { name: 'takeoff', maxCount: 1 },
  { name: 'scope', maxCount: 1 },
]), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const takeoffFile = files?.takeoff?.[0];
  const scopeFile = files?.scope?.[0];
  if (!takeoffFile && !scopeFile) {
    return res.status(400).json({ error: 'takeoff or scope file required' });
  }

  const ext = (f: Express.Multer.File) => (f.originalname.split('.').pop() || '').toLowerCase();
  if (takeoffFile && ext(takeoffFile) !== 'xlsx') {
    return res.status(400).json({ error: 'takeoff must be .xlsx' });
  }
  if (scopeFile && ext(scopeFile) !== 'docx') {
    return res.status(400).json({ error: 'scope must be .docx' });
  }

  // Keep the upload even if parsing fails — an unreadable file is still the estimator's
  // document, and losing it is worse than a failed import.
  const keep = (f: Express.Multer.File, category: string) =>
    storeDocument({
      file: f, linkedId: bidId, linkedName: bid.name, div: 'elec', category,
      uploadedBy: req.user!.name, replaceExisting: true,
    }).catch(err => { logger.error({ err, bidId, category }, '[import-prebid] document store failed'); return null; });

  let takeoffSummary: { categories: unknown[]; itemCount: number; unresolvedCount: number } | null = null;
  let parsedSqFt: number | null = null;
  // Surfaced to the estimator instead of a silent "0 items imported" — the file is
  // still saved to Files either way via keep() above, so nothing is lost.
  const warnings: string[] = [];

  if (takeoffFile) {
    await keep(takeoffFile, 'prebid_takeoff');
    // parseTakeoffWorkbook opens the buffer as a zip (new AdmZip(buf)) with no
    // internal guard, unlike parsePrebidScope's extractDocxParagraphs — a
    // genuinely corrupt/non-xlsx upload throws here instead of yielding zero
    // items. Caught and folded into the same "empty success" path as an
    // unrecognized-but-valid workbook: the file is still filed via keep() above,
    // and an honest warning beats a 500 that makes the estimator re-upload blind.
    let t: ReturnType<typeof parseTakeoffWorkbook>;
    try {
      t = parseTakeoffWorkbook(takeoffFile.buffer);
    } catch (err) {
      logger.error({ err, bidId }, '[import-prebid] takeoff workbook parse threw');
      t = { sqFt: null, price: null, categories: [], lineItems: [], keyFindings: [] };
    }
    parsedSqFt = t.sqFt;
    if (t.lineItems.length) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count, key_findings, source_file, updated_at)
         VALUES ($1,'prebid',$2::jsonb,$3::jsonb,$4,$5::jsonb,$6,now())
         ON CONFLICT (bid_id, kind) DO UPDATE SET
           categories=$2::jsonb, line_items=$3::jsonb, item_count=$4,
           key_findings=$5::jsonb, source_file=$6, updated_at=now()`,
        [bidId, JSON.stringify(t.categories), JSON.stringify(t.lineItems),
         t.lineItems.length, JSON.stringify(t.keyFindings), takeoffFile.originalname]
      );
      takeoffSummary = {
        categories: t.categories,
        itemCount: t.lineItems.length,
        unresolvedCount: t.lineItems.filter(i => i.qty === null).length,
      };
    } else {
      warnings.push('Takeoff workbook did not match the expected format — nothing was imported (the file was still saved to Files).');
    }
  }

  let scopeSummary: { sections: unknown[]; furnishModel: string | null } | null = null;
  let suggestedBrand: string | null = null;

  if (scopeFile) {
    await keep(scopeFile, 'prebid_scope');
    const s = parsePrebidScope(scopeFile.buffer);
    suggestedBrand = s.suggestedBrand;
    // Zero sections AND empty meta means the parser found nothing recognizable —
    // upserting anyway would leave an empty bid_prebid_scope row that lets
    // prebid-analyze burn a paid AI call on nothing.
    if (s.sections.length === 0 && Object.keys(s.meta).length === 0) {
      warnings.push('Scope document did not match the expected format — nothing was imported (the file was still saved to Files).');
    } else {
      await pool.query(
        `INSERT INTO bid_prebid_scope (bid_id, meta, furnish_model, furnish_note,
           general_items, sections, source_file, updated_at)
         VALUES ($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7,now())
         ON CONFLICT (bid_id) DO UPDATE SET
           meta=$2::jsonb, furnish_model=$3, furnish_note=$4, general_items=$5::jsonb,
           sections=$6::jsonb, source_file=$7, updated_at=now()`,
        [bidId, JSON.stringify(s.meta), s.furnishModel, s.furnishNote,
         JSON.stringify(s.generalItems), JSON.stringify(s.sections), scopeFile.originalname]
      );
      scopeSummary = { sections: s.sections, furnishModel: s.furnishModel };
    }
  }

  // Comparable matching ranks on square footage, so a bid without one cannot be compared
  // at all. Fill it from the parsed header when absent — but never overwrite a value a
  // human entered, which may be the leasable area rather than the gross footprint.
  let sqFtApplied = false;
  if (parsedSqFt && (bid.sq_ft === null || bid.sq_ft === undefined)) {
    await pool.query('UPDATE bids SET sq_ft=$2 WHERE id=$1 AND sq_ft IS NULL', [bidId, parsedSqFt]);
    sqFtApplied = true;
  }

  // brand is returned as a suggestion only. It outranks project_type in comp ranking, so
  // a wrong auto-set would silently skew every future comparison on this job.
  res.json({ takeoff: takeoffSummary, scope: scopeSummary, sqFtApplied, suggestedBrand, warnings });
}));

// GET prebid — the stored package for this bid, for the Pre-Bid tab.
router.get('/:bidId/prebid', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const [takeoff, scope] = await Promise.all([
    pool.query(
      `SELECT categories, line_items, item_count, key_findings, source_file
         FROM bid_takeoffs WHERE bid_id=$1 AND kind='prebid'`, [req.params.bidId]),
    pool.query('SELECT * FROM bid_prebid_scope WHERE bid_id=$1', [req.params.bidId]),
  ]);
  res.json({ takeoff: takeoff.rows[0] ?? null, scope: scope.rows[0] ?? null });
}));

// GET comparables-preview — same matching rules as /:bidId/comparables, but for a bid
// that doesn't exist yet (e.g. the "add bid" form previewing likely comps as the
// estimator types in brand/project type/sq ft). No subject bid to authorize against,
// so rows are scoped directly to the caller's own bids (owner/admin see all).
// Registered ahead of the /:bidId/... routes so it isn't shadowed by them.
router.get('/comparables-preview', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const brandRaw = req.query.brand;
  const projectTypeRaw = req.query.project_type;
  const brand = typeof brandRaw === 'string' && brandRaw.trim() ? brandRaw.trim() : null;
  const projectType = typeof projectTypeRaw === 'string' && projectTypeRaw.trim() ? projectTypeRaw.trim() : null;
  const sqFtNum = Number(req.query.sq_ft);
  const sqFt = Number.isFinite(sqFtNum) && sqFtNum > 0 ? sqFtNum : null;

  if (!brand && !projectType) {
    return res.json({ count: 0, won: 0, lost: 0, avgPerSf: null, top: [] });
  }

  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.id, b.name, b.gc, b.stage, b.brand, b.project_type, b.sq_ft, b.amount,
           b.updated_at,
           (bt.bid_id IS NOT NULL) AS has_takeoff,
           (bc.bid_id IS NOT NULL) AS has_breakdown,
           bc.labor_hours
      FROM bids b
      LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = 'final'
      LEFT JOIN bid_cost_breakdown bc ON bc.bid_id = b.id
     WHERE b.deleted_at IS NULL
       AND b.amount IS NOT NULL AND b.amount > 0
       AND ($1::text IS NOT NULL AND b.brand = $1
            OR $2::text IS NOT NULL AND b.project_type = $2)
       AND ($4::uuid IS NULL OR b.salesperson_id = $4::uuid)
     ORDER BY ((($1::text IS NOT NULL) AND b.brand = $1)) DESC,
              CASE WHEN $3::numeric IS NULL OR b.sq_ft IS NULL THEN 1 ELSE 0 END,
              ABS(COALESCE(b.sq_ft, 0) - COALESCE($3::numeric, 0)),
              b.updated_at DESC
     LIMIT 25
  `, [brand, projectType, sqFt, scope]);

  const won = rows.filter(r => r.stage === 'awarded').length;
  const lost = rows.filter(r => r.stage === 'lost').length;
  const perSf = rows
    .map(r => (r.amount != null && r.sq_ft ? Number(r.amount) / Number(r.sq_ft) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const avgPerSf = perSf.length ? perSf.reduce((a, b) => a + b, 0) / perSf.length : null;

  res.json({
    count: rows.length,
    won,
    lost,
    avgPerSf,
    top: rows.slice(0, 3).map(r => ({
      id: r.id, name: r.name, brand: r.brand, project_type: r.project_type,
      sq_ft: r.sq_ft, amount: r.amount, stage: r.stage,
    })),
  });
}));

// GET comparables — past bids worth pricing this one against. Same brand ranks above
// same project type (chain stores are built to near-identical prototypes), then nearest
// square footage. Any bid with an amount qualifies, won or lost: a lost bid is still
// signal about where the number landed. Comp rows are scoped to bids the caller can
// see (restricted reps: their own only) — matches the ownership check already applied
// to the subject bid via loadAccessibleBid, so a rep can't read another rep's amounts
// and cost data through the comps list.
router.get('/:bidId/comparables', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.id, b.name, b.gc, b.stage, b.brand, b.project_type, b.sq_ft, b.amount,
           b.updated_at, b.awarded_at,
           (bt.bid_id IS NOT NULL) AS has_takeoff,
           (bc.bid_id IS NOT NULL) AS has_breakdown,
           bc.labor_hours
      FROM bids b
      LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = 'final'
      LEFT JOIN bid_cost_breakdown bc ON bc.bid_id = b.id
     WHERE b.id <> $1
       AND b.deleted_at IS NULL
       AND b.amount IS NOT NULL AND b.amount > 0
       AND ($2::text IS NOT NULL AND b.brand = $2
            OR $3::text IS NOT NULL AND b.project_type = $3)
       AND ($5::uuid IS NULL OR b.salesperson_id = $5::uuid)
     ORDER BY ((($2::text IS NOT NULL) AND b.brand = $2)) DESC,
              CASE WHEN $4::numeric IS NULL OR b.sq_ft IS NULL THEN 1 ELSE 0 END,
              ABS(COALESCE(b.sq_ft, 0) - COALESCE($4::numeric, 0)),
              b.updated_at DESC
     LIMIT 25
  `, [bid.id, bid.brand, bid.project_type, bid.sq_ft, scope]);

  res.json({
    bid: { id: bid.id, name: bid.name, brand: bid.brand, project_type: bid.project_type,
           sq_ft: bid.sq_ft, amount: bid.amount },
    comparables: rows,
  });
}));

// GET prebid-comparables — comps for a pre-bid comparison. Same ranking as /comparables
// (same brand beats same project type, then nearest square footage), with one deliberate
// difference: the amount > 0 requirement is dropped. Pre-bid corpus jobs have not been
// priced yet, so requiring an amount would filter out exactly the rows this feature runs
// on. Candidates must instead carry a prebid takeoff, which is what there is to compare.
router.get('/:bidId/prebid-comparables', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.id, b.name, b.gc, b.stage, b.brand, b.project_type, b.sq_ft, b.amount,
           b.updated_at, bt.item_count
      FROM bids b
      JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = 'prebid'
     WHERE b.id <> $1
       AND b.deleted_at IS NULL
       AND ($2::text IS NOT NULL AND b.brand = $2
            OR $3::text IS NOT NULL AND b.project_type = $3)
       AND ($5::uuid IS NULL OR b.salesperson_id = $5::uuid)
     ORDER BY ((($2::text IS NOT NULL) AND b.brand = $2)) DESC,
              CASE WHEN $4::numeric IS NULL OR b.sq_ft IS NULL THEN 1 ELSE 0 END,
              ABS(COALESCE(b.sq_ft, 0) - COALESCE($4::numeric, 0)),
              b.updated_at DESC
     LIMIT 25
  `, [bid.id, bid.brand, bid.project_type, bid.sq_ft, scope]);

  const subjectSqFt = bid.sq_ft != null ? Number(bid.sq_ft) : null;
  res.json({
    bid: { id: bid.id, name: bid.name, brand: bid.brand,
           project_type: bid.project_type, sq_ft: bid.sq_ft },
    comparables: rows.map(r => ({
      ...r,
      // How much bigger or smaller this job is than the comp, the headline number.
      sq_ft_delta_pct: subjectSqFt && r.sq_ft
        ? ((subjectSqFt - Number(r.sq_ft)) / Number(r.sq_ft)) * 100
        : null,
    })),
  });
}));

// POST prebid-analyze — compare this pre-bid against one comparable's pre-bid. On demand
// only: it never fires on upload, and result is cached to ai_comparison so re-VIEWING it
// via GET /prebid (a plain SELECT) is free. Re-POSTing here always fires a fresh billed
// call — there is no short-circuit on an existing ai_comparison for the same comparable.
router.post('/:bidId/prebid-analyze', requireAuth, requireAIPermission('run_analysis'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { bidId } = req.params;
    const bid = await loadAccessibleBid(res, req.user!, bidId);
    if (!bid) return;

    const against = String(req.query.against || '').trim();
    if (!against) return res.status(400).json({ error: 'against required' });
    if (!(await loadAccessibleBid(res, req.user!, against))) return;

    const { rows } = await pool.query(
      `SELECT s.bid_id, s.sections, s.furnish_model, b.sq_ft, b.name,
              t.categories
         FROM bid_prebid_scope s
         JOIN bids b ON b.id = s.bid_id
         LEFT JOIN bid_takeoffs t ON t.bid_id = s.bid_id AND t.kind = 'prebid'
        WHERE s.bid_id = ANY($1::uuid[])`,
      [[bidId, against]]
    );
    const subject = rows.find(r => r.bid_id === bidId);
    const comp = rows.find(r => r.bid_id === against);
    if (!subject || !comp) {
      return res.status(404).json({ error: 'both bids need a pre-bid scope' });
    }

    // Gate synchronously, like the sibling AI routes (/analyze, run-agent4): an
    // unconfigured key must fail the kickoff immediately with an actionable 503,
    // not after a spinner via a polled ai_status='error'.
    const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' });

    const config = await loadAIConfig();
    const client = new Anthropic({ apiKey });

    await pool.query(
      `UPDATE bid_prebid_scope
          SET ai_status='running', ai_error=NULL, ai_comparison_against=$2, updated_at=now()
        WHERE bid_id=$1`, [bidId, against]);
    res.json({ status: 'running' });

    // Fire and forget, exactly as run-agent4 does — the client polls GET /prebid.
    // callWithRetry takes a THUNK: it wraps the whole SDK call, it does not take a
    // prompt pair. Mirrors the Agent 2 call site.
    (async () => {
      try {
        const payload = JSON.stringify({
          subject: { name: subject.name, sqFt: subject.sq_ft, furnishModel: subject.furnish_model,
                     sections: subject.sections, categories: subject.categories ?? [] },
          comparable: { name: comp.name, sqFt: comp.sq_ft, furnishModel: comp.furnish_model,
                        sections: comp.sections, categories: comp.categories ?? [] },
        });
        const resp = await callWithRetry(() => client.messages.create({
          model: config.modelA2,
          max_tokens: config.maxTokensA2,
          system: [{ type: 'text', text: PREBID_COMPARE_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Compare these two pre-bid packages.\n\n${payload}` }],
        }), { onRetry: (a, _e, d) => console.warn(`[prebid-analyze] transient error, retry ${a} in ${d}ms`) });

        assertNotTruncated(resp, 'Pre-bid comparison', config.maxTokensA2, 'it uses Agent 2\'s Max Tokens in Settings → AI');
        const parsed = parseAIJSON(extractText(resp));
        if (!parsed) throw new Error('model did not return parseable JSON');
        await pool.query(
          `UPDATE bid_prebid_scope
              SET ai_comparison=$2::jsonb, ai_status='complete', updated_at=now()
            WHERE bid_id=$1`, [bidId, JSON.stringify(parsed)]);
      } catch (err) {
        logger.error({ err, bidId }, '[prebid-analyze] failed');
        await pool.query(
          `UPDATE bid_prebid_scope SET ai_status='error', ai_error=$2, updated_at=now() WHERE bid_id=$1`,
          [bidId, describeAIError(err)]
        );
      }
    })().catch(err => logger.error({ err, bidId }, '[prebid-analyze] Uncaught background error'));
  }));

// GET compare — this bid against selected comparables. Returns per-category takeoff
// quantities and cost-breakdown figures for each job, normalized per 1,000 SF so
// buildings of different sizes line up. The frontend renders the deltas.
router.get('/:bidId/compare', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const against = String(req.query.against || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!against.length) return res.status(400).json({ error: 'against required' });

  const ids = [bid.id, ...against];
  const kind = req.query.kind === 'prebid' ? 'prebid' : 'final';
  // Scope comp rows the same way as /comparables: a restricted rep only pulls bids
  // they own into the comparison, even if they pass another rep's bid id in `against`.
  // The subject bid itself always matches — loadAccessibleBid already verified it's
  // either the caller's own or the caller is unrestricted.
  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.id, b.name, b.gc, b.stage, b.brand, b.project_type, b.sq_ft, b.amount,
           bt.categories, bt.item_count,
           bc.material_total, bc.labor_total, bc.equipment_total, bc.quotes_total,
           bc.selling_price, bc.labor_hours, bc.journeyman_hours, bc.apprentice_hours,
           bc.avg_labor_rate, bc.avg_crew_size, bc.labor_risk_ratio
      FROM bids b
      LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = $3
      LEFT JOIN bid_cost_breakdown bc ON bc.bid_id = b.id
     WHERE b.id = ANY($1::uuid[]) AND b.deleted_at IS NULL
       AND ($2::uuid IS NULL OR b.salesperson_id = $2::uuid)
  `, [ids, scope, kind]);

  // Preserve caller order, subject bid first.
  const byId = new Map(rows.map(r => [r.id, r]));
  const jobs = ids.map(id => byId.get(id)).filter(Boolean);

  // Union of categories across all jobs, so a category present in only one job still
  // shows up as a gap rather than silently vanishing.
  const categoryNames = [...new Set(
    jobs.flatMap(j => (j.categories ?? []).map((c: { name: string }) => c.name))
  )].sort();

  res.json({ subjectId: bid.id, jobs, categoryNames });
}));

// GET takeoff line items for a bid — drill-down behind a category in the compare view.
// Mirrors /compare's kind selection so the detail view never contradicts the grid it
// was opened from: default 'final' preserves every existing caller's behaviour.
router.get('/:bidId/takeoff', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const kind = req.query.kind === 'prebid' ? 'prebid' : 'final';
  const { rows } = await pool.query(
    'SELECT categories, line_items, item_count, source_file FROM bid_takeoffs WHERE bid_id=$1 AND kind=$2',
    [req.params.bidId, kind]
  );
  res.json(rows[0] || null);
}));

// GET all workspaces (for restoring state on app load). Restricted reps only get
// workspaces for bids they own; managers/admins see all.
router.get('/workspaces', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const { rows } = scope
    ? await pool.query(
        `SELECT w.* FROM bid_workspaces w
         JOIN bids b ON b.id = w.bid_id
         WHERE b.salesperson_id = $1 AND b.deleted_at IS NULL`,
        [scope]
      )
    : await pool.query('SELECT * FROM bid_workspaces');
  res.json(rows);
});

// GET workspace — Task 11 ("pricing fields join the workspace autosave").
// The per-bid counterpart to PUT below; PcWorkspace reads overhead_pct/
// profit_pct/estimate_overrides from this to seed a reload, same trigger
// (pristine-only) as the existing bid_estimates hydration.
router.get('/:bidId/workspace', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const { rows } = await pool.query(`SELECT * FROM bid_workspaces WHERE bid_id=$1`, [bidId]);
  res.json(rows[0] || null);
});

// PUT workspace (upsert)
router.put('/:bidId/workspace', requireAuth, async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const {
    step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, confirmed_service,
    // Task 11 — struck from Batch 2: these three already exist on bid_estimates
    // (written only by the deliberate "Save Estimate" action); the continuous
    // workspace autosave now carries them too, so a draft survives even before
    // that action. Does not change what /estimates stores or the estimate math.
    overhead_pct, profit_pct, estimate_overrides,
  } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO bid_workspaces (bid_id, step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, confirmed_service, overhead_pct, profit_pct, estimate_overrides, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     ON CONFLICT (bid_id) DO UPDATE SET
       step=$2, active_tab=$3, notes=$4, scope=$5, rfis=$6, files=$7,
       ai_done=$8, proposal_generated=$9, confirmed_service=$10,
       overhead_pct=$11, profit_pct=$12, estimate_overrides=$13, updated_at=now()
     RETURNING *`,
    [bidId, step||'intake', active_tab||'overview', notes||'',
     JSON.stringify(scope||{}), JSON.stringify(rfis||[]), JSON.stringify(files||[]),
     !!ai_done, !!proposal_generated,
     confirmed_service ? JSON.stringify(confirmed_service) : null,
     overhead_pct === undefined || overhead_pct === null || overhead_pct === '' ? null : Number(overhead_pct),
     profit_pct === undefined || profit_pct === null || profit_pct === '' ? null : Number(profit_pct),
     JSON.stringify(estimate_overrides || {})]
  );
  res.json(rows[0]);
});

// ── Phase 4 Task 5.1: RFI submit becomes real ───────────────────────────────
// Builds an Outlook DRAFT (never sends) to the bid's contact listing every
// currently-open RFI, numbered, with the question text — then marks those
// RFIs submitted:true in the workspace, but ONLY after the draft actually
// succeeds (a failed draft must never silently mark RFIs as sent).
router.post('/:bidId/rfi-draft', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const { rows: wsRows } = await pool.query('SELECT rfis FROM bid_workspaces WHERE bid_id=$1', [bidId]);
  const rfis = (wsRows[0]?.rfis ?? []) as { id: string; question: string; submitted: boolean; answer: string }[];
  const open = rfis.filter(r => !r.submitted && (r.question || '').trim());
  if (!open.length) return res.status(400).json({ error: 'No open RFIs to submit.' });

  const emailMatch = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(bid.contact || '');
  const to = emailMatch ? [emailMatch[0]] : [];
  if (!to.length) {
    return res.status(400).json({ error: 'No contact email on file for this bid — add one before submitting RFIs.' });
  }
  if (!isGraphMailConfigured()) {
    return res.status(503).json({ error: 'Email is not configured (Microsoft Graph).' });
  }

  let draft;
  try {
    draft = await graphCreateDraft({
      to,
      subject: rfiDraftSubject(bid.name),
      html: buildRfiDraftHtml(bid.name, open),
    });
  } catch (err) {
    logger.error({ err, bidId }, '[preconstruction] rfi-draft failed');
    return res.status(502).json({ error: 'Could not create the draft. Check the mail configuration.' });
  }

  const openIds = open.map(r => r.id);
  const openIdSet = new Set(openIds);
  const updatedRfis = rfis.map(r => (openIdSet.has(r.id) ? { ...r, submitted: true } : r));
  await pool.query('UPDATE bid_workspaces SET rfis=$1, updated_at=now() WHERE bid_id=$2', [JSON.stringify(updatedRfis), bidId]);

  // FIX-11 (post-review) — `submittedIds` is the actual list of RFI ids this
  // call marked submitted (blank-question RFIs are excluded from `open`
  // above and so never appear here). The client used to mark EVERY
  // currently-unsubmitted RFI as submitted on any successful response,
  // which drifted from this list the moment a blank-question RFI existed —
  // it would show as submitted client-side while staying unsubmitted
  // server-side. `rfis` (the full updated array) is still included too, as
  // the more authoritative source of truth if a caller wants it.
  res.json({ draftWebLink: draft.webLink, submittedCount: open.length, submittedIds: openIds, rfis: updatedRfis });
}));

// ── Takeoff accuracy Task 7: the Needs-review list ─────────────────────────
router.get('/:bidId/review', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  res.json(await getTakeoffReview(req.params.bidId));
}));

// Resolve one or more items the same way: {itemIds, action:'count'|'markers'|
// 'not_on_job'|'answer', qty?, reason?, answer?}. Every item is validated;
// nothing is saved unless all of them pass.
router.post('/:bidId/review/resolve', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const body = req.body as { itemIds?: unknown; action?: unknown; qty?: unknown; reason?: unknown; answer?: unknown };
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === 'string') : [];
  const action = body.action;
  if (!itemIds.length) return res.status(400).json({ error: 'itemIds required' });
  if (action !== 'count' && action !== 'markers' && action !== 'not_on_job' && action !== 'answer') {
    return res.status(400).json({ error: 'action must be count, markers, not_on_job or answer' });
  }
  const out = await resolveReviewItems(bidId, itemIds, { action, qty: body.qty, reason: body.reason, answer: body.answer }, req.user!.name);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json(out.review);
}));

router.post('/:bidId/review/reopen', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : '';
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  const out = await reopenReviewItem(bidId, itemId);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  res.json(out.review);
}));

// GET results for a bid
router.get('/:bidId/results', requireAuth, requireAIPermission('view_results'), async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const { rows } = await pool.query(
    'SELECT * FROM takeoff_results WHERE bid_id=$1',
    [req.params.bidId]
  );
  res.json(rows[0] || null);
});

// GET historical cost comps from real won jobs data. Scoped like /comparables — a
// restricted rep only pulls comps from their own bids, not the whole company's
// pricing history (owner/admin: ownScopeId returns null, no filter applied).
router.get('/costs', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.name, b.amount, b.sheets, b.gc, b.loc, b.sq_ft, b.project_type,
           EXTRACT(YEAR FROM b.updated_at) as year,
           be.subtotals, be.confidence
    FROM bids b
    LEFT JOIN bid_estimates be ON be.bid_id = b.id
    WHERE b.stage = 'awarded' AND b.amount IS NOT NULL AND b.deleted_at IS NULL
      AND ($1::uuid IS NULL OR b.salesperson_id = $1::uuid)
    ORDER BY b.updated_at DESC
    LIMIT 30
  `, [scope]);
  res.json(rows);
});

// GET bid intelligence stats. Same scoping as /costs — a restricted rep's GC/overall
// win-rate stats are computed over their own bids only, not company-wide.
router.get('/intelligence/:bidId', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const scope = ownScopeId(req.user!);
  const { rows: gcStats } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost,
      COUNT(*) FILTER (WHERE stage IN ('awarded','lost')) as total,
      AVG(amount) FILTER (WHERE stage='awarded') as avg_won_amount
    FROM bids WHERE gc=$1 AND deleted_at IS NULL
      AND ($2::uuid IS NULL OR salesperson_id = $2::uuid)
  `, [bid.gc, scope]);

  const { rows: overall } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE stage='awarded') as won,
      COUNT(*) FILTER (WHERE stage='lost') as lost
    FROM bids WHERE deleted_at IS NULL
      AND ($1::uuid IS NULL OR salesperson_id = $1::uuid)
  `, [scope]);

  const gc = gcStats[0];
  const ov = overall[0];
  const gcWinRate = gc.total > 0 ? Math.round((gc.won / gc.total) * 100) : null;
  const overallWinRate = (Number(ov.won) + Number(ov.lost)) > 0
    ? Math.round((Number(ov.won) / (Number(ov.won) + Number(ov.lost))) * 100) : null;

  res.json({
    gc: bid.gc,
    gcWinRate,
    gcWins: Number(gc.won),
    gcLosses: Number(gc.lost),
    gcAvgWonAmount: gc.avg_won_amount ? Math.round(gc.avg_won_amount) : null,
    overallWinRate,
  });
});

// POST analyze — 3-agent sequential pipeline
router.post('/analyze', requireAuth, requireAIPermission('run_analysis'), upload.array('files', 50), asyncHandler(async (req: AuthRequest, res) => {
  const bidId = req.body.bidId;
  if (!bidId) return res.status(400).json({ error: 'bidId required' });

  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const rawFiles = (req.files as Express.Multer.File[]) ?? [];

  // Expand any zip archives into their constituent PDF/image files
  const files: Express.Multer.File[] = [];
  for (const f of rawFiles) {
    if (f.originalname.toLowerCase().endsWith('.zip')) {
      try {
        const zip = new AdmZip(f.buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const n = entry.name.toLowerCase();
          if (!n.endsWith('.pdf') && !n.endsWith('.jpg') && !n.endsWith('.jpeg') && !n.endsWith('.png')) continue;
          files.push({
            ...f,
            originalname: entry.name,
            buffer: entry.getData(),
            size: entry.header.size,
            mimetype: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          });
        }
      } catch { /* corrupt or unreadable zip — skip */ }
    } else {
      files.push(f);
    }
  }
  // Also pull in any documents already attached to this bid
  const rawDocIds = req.body.document_ids;
  const docIds: string[] = Array.isArray(rawDocIds)
    ? (rawDocIds as string[]).filter(Boolean)
    : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];

  for (const docId of docIds) {
    try {
      const { rows: docRows } = await pool.query(
        'SELECT name, file_type, file_data, storage_url FROM documents WHERE id=$1 AND deleted_at IS NULL',
        [docId]
      );
      const doc = docRows[0];
      if (!doc) continue;

      const fname = doc.name as string;
      const ftype = (doc.file_type as string) || 'application/octet-stream';
      let buf: Buffer | null = null;

      if (doc.file_data) {
        buf = Buffer.from(doc.file_data as string, 'base64');
      } else if (doc.storage_url) {
        const driveMatch = (doc.storage_url as string).match(/\/file\/d\/([^/?#]+)/);
        if (driveMatch) {
          const media = await getFileMedia(driveMatch[1]);
          if (media) {
            buf = await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              media.stream.on('data', (c: Buffer) => chunks.push(c));
              media.stream.on('end', () => resolve(Buffer.concat(chunks)));
              media.stream.on('error', reject);
            });
          }
        } else {
          const resp = await fetch(doc.storage_url as string);
          if (resp.ok) buf = Buffer.from(await resp.arrayBuffer());
        }
      }

      if (!buf) continue;
      files.push({
        documentId: docId,
        fieldname: 'files',
        originalname: fname,
        encoding: '7bit',
        mimetype: ftype,
        buffer: buf,
        size: buf.length,
        stream: undefined,
        destination: '',
        filename: fname,
        path: '',
      } as unknown as Express.Multer.File);
    } catch (err) {
      logger.warn({ err, docId }, '[takeoff] could not load document, skipping');
    }
  }

  if (!files.length) {
    return res.status(400).json({ error: 'Upload at least one plan file, or select files from Project Files, before running AI analysis.' });
  }

  // Prefer the key configured in Settings -> AI; fall back to the env var.
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' });
  }
  const aiConfig = await loadAIConfig();

  // Mark as running
  await pool.query(`
    INSERT INTO takeoff_results (bid_id, status) VALUES ($1, 'running')
    ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now(),
      agent1_output=NULL, agent2_output=NULL, agent3_output=NULL
  `, [bidId]);

  // Log AI usage for rate limiting and audit
  await pool.query(
    `INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_analysis','preconstruction',$1,$2)`,
    [`Plan analysis for ${bid.name || bidId} (${files.length} files) by ${req.user?.name}`, req.user?.id]
  ).catch(() => {}); // non-fatal

  // Count electrical sheets for immediate response
  const electricalCount = files.filter(f => isElectricalSheet(f.originalname)).length || files.length;

  // Respond immediately, run pipeline in background
  res.json({
    status: 'running',
    message: 'Analysis started',
    totalFiles: files.length,
    electricalSheets: electricalCount,
  });

  const client = new Anthropic({ apiKey });
  logger.info({ bidId, model: aiConfig.model, modelA2: aiConfig.modelA2, modelA3: aiConfig.modelA3 }, 'AI takeoff pipeline started');
  runPipeline(bidId, files, client, aiConfig).catch(async err => {
    const message = `Pipeline failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff pipeline failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', raw_response=$1 WHERE bid_id=$2`,
      [message, bidId]
    ).catch(dbErr => logger.error({ err: dbErr, bidId }, 'Could not persist takeoff pipeline failure'));
  });
}));

// POST run-agent4 — kicks off Proposal Formatter in background, returns immediately
// Frontend polls GET /:bidId/results and watches agent4_status for completion.
router.post('/:bidId/run-agent4', requireAuth, requireAIPermission('run_analysis'), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const { price, internalNotes } = req.body as { price?: string; internalNotes?: string };

  if (!price?.trim()) return res.status(400).json({ error: 'price is required' });
  // Validate before any DB write — a "$" or comma in the price must never reach
  // agent4_price NUMERIC(12,2) and crash after the paid Agent 4 call. Parsed here,
  // before agent4_status is stamped 'running', so a bad price never leaves the run
  // half-started.
  const parsedPrice = parseMoney(price);
  if (parsedPrice === null) {
    return res.status(400).json({ error: 'Price must be a positive number (e.g. 425000 or $425,000).' });
  }
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  // Takeoff accuracy Task 7 — zero/unreadable counts and unanswered scope
  // questions block the proposal until the estimator resolves them.
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });

  const { rows: trRows } = await pool.query(
    'SELECT agent1_output, agent2_output, review_items FROM takeoff_results WHERE bid_id=$1',
    [bidId]
  );
  if (!trRows.length || !trRows[0].agent2_output) {
    return res.status(400).json({ error: 'No scope data found. Run the 3-agent analysis first.' });
  }

  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'Anthropic API key not configured.' });

  const config = await loadAIConfig();
  const client = new Anthropic({ apiKey });

  const agent1Output = (trRows[0].agent1_output as string) || '';
  const agent2Output = (trRows[0].agent2_output as string) || '';

  // The estimator's edited Scope of Work (bid_workspaces.scope) and the saved
  // estimate (bid_estimates) are the estimator's actual work — Agent 4 needs both,
  // not just the raw Agent 2 output, so their edits and pricing survive into the
  // proposal. Both are optional; a bid can reach Agent 4 without either.
  const [{ rows: wsRows }, { rows: estRows }] = await Promise.all([
    pool.query('SELECT scope FROM bid_workspaces WHERE bid_id=$1', [bidId]),
    pool.query('SELECT grand_total, overhead_pct, profit_pct, subtotals FROM bid_estimates WHERE bid_id=$1', [bidId]),
  ]);
  const workspaceScope = (wsRows[0]?.scope as Record<string, string> | undefined) ?? null;
  const savedEstimate = estRows[0] ?? null;

  // Mark as running and respond immediately — don't wait for AI
  await pool.query(
    `UPDATE takeoff_results SET agent4_status='running', agent4_error=NULL, agent4_output=NULL WHERE bid_id=$1`,
    [bidId]
  );
  res.json({ status: 'running' });

  // Run AI call in background
  const userMsg = buildAgent4UserMessage({
    price,
    internalNotes,
    agent1Output,
    agent2Output,
    workspaceScope,
    savedEstimate,
    reviewResolutions: reviewResolutionsForAgent4(trRows[0].review_items as ReviewItem[] | null),
  });

  (async () => {
    try {
      const resp = await callWithRetry(() => client.messages.create({
        model: config.modelA4,
        max_tokens: config.maxTokensA4,
          system: [{ type: 'text', text: config.promptA4 || AGENT4_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }), { onRetry: (a, _e, d) => logger.warn(`[agent4] retry ${a} in ${d}ms`) });

      assertNotTruncated(resp, 'Agent 4', config.maxTokensA4);
      const rawText = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
      const parsed = parseAIJSON(rawText);
      if (!parsed) {
        // Takeoff accuracy Task 1 follow-up (a live AutoZone failure that only
        // logged a 300-char preview): log AND report why — stop_reason, output
        // tokens and the TAIL of the raw text (a cut-off reply is visible at
        // the end, never at the start). A max_tokens stop never gets here:
        // assertNotTruncated above already failed it with "raise Max Tokens".
        const outTokens = resp.usage?.output_tokens ?? null;
        const tail = rawText.slice(-300);
        logger.warn({ bidId, stop_reason: resp.stop_reason, output_tokens: outTokens, max_tokens: config.maxTokensA4, text_length: rawText.length, preview: rawText.slice(0, 200), tail }, '[agent4] Could not parse JSON from response');
        await pool.query(
          `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
          [`AI response could not be parsed as valid JSON (stop_reason: ${resp.stop_reason ?? 'unknown'}, ${outTokens ?? '?'} of ${config.maxTokensA4} output tokens, ${rawText.length} characters). Try re-running Agent 4. End of the response: …${tail.replace(/\s+/g, ' ').slice(-200)}`, bidId]
        );
        return;
      }
      // Task 5.4 — light shape check on the new data-only contract (sections[]
      // and takeoff[] present). Not a full validateBidData pass — that now
      // really does run (FIX-7), inside composeCurrentBidData, on the
      // COMPOSED BidData after the bid row is merged in, shared by
      // generate-docx/generate-takeoff-xlsx/generate-prebid-package — this
      // check here is just enough to catch a response that isn't even
      // attempting the new shape before it's persisted and silently produces
      // a blank proposal.
      if (!isAgent4Shape(parsed)) {
        logger.warn({ bidId, preview: rawText.slice(0, 300) }, '[agent4] Response parsed as JSON but is not the expected shape (sections[]/takeoff[] missing)');
        await pool.query(
          `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
          ['AI response was valid JSON but missing the expected sections/takeoff arrays. Try re-running Agent 4.', bidId]
        );
        return;
      }
      await pool.query(
        `UPDATE takeoff_results SET
          agent4_output=$1, agent4_price=$2, agent4_notes=$3,
          agent4_model=$4, usage_agent4=$5,
          agent4_status='complete', agent4_error=NULL
        WHERE bid_id=$6`,
        [JSON.stringify(parsed), parsedPrice, internalNotes?.trim() || null, config.modelA4, JSON.stringify(resp.usage), bidId]
      );
      // The proposal price is the later, more authoritative number — sync it into
      // the pipeline the same way the estimate save already does.
      await pool.query(
        'UPDATE bids SET amount=$1 WHERE id=$2 AND deleted_at IS NULL',
        [parsedPrice, bidId]
      );
      logger.info({ bidId }, '[agent4] Proposal generated successfully');
    } catch (err) {
      logger.error({ err, bidId }, '[agent4] Background run failed');
      const message = err instanceof Error ? err.message : 'Unknown error during proposal generation';
      await pool.query(
        `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2`,
        [message, bidId]
      );
    }
  })().catch(err => logger.error({ err, bidId }, '[agent4] Uncaught background error'));
}));

// ── Task 6: shared BidData composition ──────────────────────────────────────
// generate-docx, generate-takeoff-xlsx and generate-prebid-package all need
// the SAME composed BidData for a bid — one bid_data.json feeds every
// deterministic builder, exactly like the desktop APT_Bid_System. This is
// the one place that loads agent4_output + the bid row, detects the shape
// (Task 5's new data-only contract vs. a pre-Phase-3 legacy row), and
// composes it — no response writing here, so each route decides its own
// status codes for a given failure.
export type ComposeCurrentBidDataResult =
  // Fix round 2 / R2-S4(a) — ambiguousQtyKeys (composeBidData.ts's own
  // "left un-overridden, counts didn't line up" signal) threaded all the
  // way out here so a caller (the proposal-preview route) can surface it
  // to the estimator instead of it only ever reaching server logs. Always
  // present, empty for a legacy-shape row (composeBidData never runs).
  | { ok: true; bidData: BidData; bidName: string; asciiName: string; ambiguousQtyKeys: string[] }
  | { ok: false; status: number; error: string; failures?: { check: string; detail: string }[] };

export interface ComposeCurrentBidDataOptions {
  /** FIX-9 — GET /proposal-preview composes ephemerally (shows the
   *  would-be job number) without writing it back; only the generate
   *  endpoints (a GET writing the DB is otherwise a footgun) persist a
   *  freshly-generated job number. Defaults true — every generate-*
   *  endpoint wants persistence; only the preview route opts out. */
  persist?: boolean;
  /** FIX-7 — validateBidData against the composed data before a caller
   *  renders anything. Only applied to the new-shape (composeBidData) path:
   *  a legacy row was never subject to this gate (see
   *  legacyProposalToBidData's own docstring) and preview opts out entirely
   *  so a broken/incomplete proposal can still be displayed for the
   *  estimator to fix, rather than 422ing the very screen that shows what's
   *  wrong. Defaults true.
   */
  validate?: boolean;
}

// Exported (Phase 4 Task 2.2) so the public proposal page (routes/bids.ts's
// GET /p/:token) can compose the SAME BidData this file's generate-*
// endpoints do, with persist:false — one composition function, not a
// second copy of the legacy-shape/precedence logic living in bids.ts.
export async function composeCurrentBidData(
  bidId: string,
  opts: ComposeCurrentBidDataOptions = {},
): Promise<ComposeCurrentBidDataResult> {
  const persist = opts.persist ?? true;
  const validate = opts.validate ?? true;

  const { rows: trRows } = await pool.query(
    'SELECT agent4_output, agent4_price FROM takeoff_results WHERE bid_id=$1',
    [bidId]
  );
  if (!trRows.length || !trRows[0].agent4_output) {
    return { ok: false, status: 404, error: 'No proposal data found. Run Agent 4 first.' };
  }

  // agent4_price NUMERIC(12,2) is the authoritative, DB-validated price (see
  // run-agent4's parseMoney gate) — format it here rather than trusting whatever
  // string the LLM echoed back into the data blob.
  const rawPrice = trRows[0].agent4_price as string | number | null;
  const priceNum = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
  const formattedPrice = priceNum !== null && Number.isFinite(priceNum)
    ? `$${priceNum.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(priceNum) ? 0 : 2, maximumFractionDigits: 2 })}`
    : undefined;

  const raw = trRows[0].agent4_output as string;
  const parsed = parseAIJSON(raw);
  if (!parsed) return { ok: false, status: 422, error: 'Proposal data could not be parsed. Re-run Agent 4 to regenerate.' };

  const [{ rows: bidRows }, { rows: estRows }] = await Promise.all([
    pool.query(
      'SELECT name, loc, gc, contact, sq_ft, job_number FROM bids WHERE id=$1 AND deleted_at IS NULL',
      [bidId]
    ),
    pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]),
  ]);
  const bid = bidRows[0] as { name?: string; loc?: string; gc?: string; contact?: string; sq_ft?: number | string | null; job_number?: string | null } | undefined;
  const bidName = bid?.name ?? bidId;
  // HTTP headers must be Latin-1. Strip any non-ASCII (em dashes, accents, etc.)
  // from the filename or res.setHeader throws ERR_INVALID_CHAR.
  const asciiName = bidName.replace(/[^\x20-\x7E]/g, '').trim() || 'proposal';
  // Phase 2's saved per-item confidence (bid_estimates.line_items) — the
  // authority composeBidData prefers over whatever Agent 4 itself echoed.
  // Harmless to always pass through: neither GC renderer (docx/xlsx) ever
  // surfaces `conf`, only the pre-bid xlsx does.
  const savedLineItems = (estRows[0]?.line_items ?? []) as SavedConfidenceItem[];

  let bidData: BidData;
  // Fix round 2 / R2-S4(a) — [] for the legacy-shape branch below
  // (composeBidData never runs there, so there's nothing to flag).
  let ambiguousQtyKeys: string[] = [];
  if (isAgent4Shape(parsed)) {
    if (!formattedPrice) {
      return { ok: false, status: 422, error: 'No validated price on file for this proposal. Re-run Agent 4.' };
    }
    const bidRow: ComposeBidRow = {
      name: bid?.name, loc: bid?.loc, gc: bid?.gc, contact: bid?.contact,
      sq_ft: bid?.sq_ft ?? null, job_number: bid?.job_number ?? null,
    };
    const { data, jobNumberGenerated, ambiguousQtyKeys: keys } = composeBidData(bidRow, parsed as Agent4Output, formattedPrice, { savedLineItems });
    ambiguousQtyKeys = keys;
    if (jobNumberGenerated && persist) {
      // Task 6.2 — two bids generated the same day compute the identical
      // JS.MMDDYYYY (jobNumber() is a pure function of today's date only),
      // so the second one used to silently collide with the first. Only a
      // FRESHLY GENERATED number ever passes through resolveUniqueJobNumber
      // — an existing/manually-entered job_number (jobNumberGenerated
      // false) is never touched.
      const { rows: collisions } = await pool.query(
        `SELECT job_number FROM bids
          WHERE deleted_at IS NULL AND id <> $1 AND job_number LIKE $2`,
        [bidId, `${data.job_number}%`]
      );
      const taken = new Set(
        (collisions as { job_number: string }[])
          .map(r => r.job_number)
          .filter(n => n === data.job_number || new RegExp(`^${data.job_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(n))
      );
      data.job_number = resolveUniqueJobNumber(data.job_number, taken);

      // composeBidData is pure and never writes to the DB — persist the
      // freshly-generated (and now collision-free) job number so it's
      // stable on every future regeneration of this bid's documents.
      // FIX-9: skipped when opts.persist is false (the preview route) — a
      // GET must never write.
      await pool.query('UPDATE bids SET job_number=$2 WHERE id=$1 AND deleted_at IS NULL', [bidId, data.job_number]);
    }
    bidData = data;

    // FIX-7 — validateBidData actually runs now (it was dead code: wired
    // into nothing, despite a stale comment below claiming otherwise).
    // New-shape only, per opts.validate above.
    if (validate) {
      const problems = validateBidData(bidData);
      if (problems.length) {
        return {
          ok: false,
          status: 422,
          error: 'This proposal did not pass data validation — fix the composed data before generating documents.',
          failures: problems.map(detail => ({ check: 'data', detail })),
        };
      }
    }
  } else {
    // The bid record is the authoritative source for the project name — the
    // stored data blob's own projectName/gcName are ignored in favor of what
    // the estimator entered. Same precedence pattern either shape.
    const legacyData = legacyProposalWithBidMeta(parsed as unknown as ProposalJSON, {
      projectName: bid?.name,
      projectAddress: bid?.loc,
      gcName: bid?.gc,
      gcContact: bid?.contact,
      totalPrice: formattedPrice,
    });
    // FIX-11 — the new-shape branch above has always required a validated
    // price before returning; this branch didn't, so a legacy row with
    // neither agent4_price nor its own embedded totalPrice sailed through
    // composeCurrentBidData only to blow up as an uncaught 500 later, inside
    // renderBidDocx's own price guard. Same 422 as the new path.
    if (!legacyData.total_price || !String(legacyData.total_price).trim()) {
      return { ok: false, status: 422, error: 'No validated price on file for this proposal. Re-run Agent 4.' };
    }
    bidData = legacyData;
  }

  return { ok: true, bidData, bidName, asciiName, ambiguousQtyKeys };
}

/** Flatten every takeoff item's text fields — the pre-bid scope docx never
 *  renders the takeoff table, so its own placeholder scan can't see this
 *  content; folded into the same verifyBidText pass so a stray "[BRACKET]"
 *  in a takeoff item's description/source still gates the pre-bid package. */
function takeoffAsText(bidData: BidData): string {
  return bidData.takeoff
    .flatMap(cat => [
      cat.name,
      ...cat.items.flatMap(it => [it.item, it.description, it.unit, String(it.qty ?? ''), it.source, it.conf, it.furnish_by].filter(Boolean)),
    ])
    .join('\n');
}

// GET proposal-preview — the composed BidData, for the Proposal tab preview
// (Task 7). Thin: reuses composeCurrentBidData, no render/verify/file step —
// the frontend renders sections/exclusions/terms/alternates directly from
// this instead of re-implementing the legacy-vs-new-shape/precedence logic
// client-side. FIX-9: a GET must never write — persist:false so a freshly-
// generated job number is only ever shown here (the ephemeral would-be
// value), never stamped onto the bid row; that persistence happens on first
// use of one of the generate-* endpoints below. FIX-7: validate:false — the
// preview's whole point is to show the estimator what's there (including
// something incomplete) so they can fix it, not to 422 the one screen that
// would show them what's wrong.
router.get('/:bidId/proposal-preview', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;

  const loaded = await composeCurrentBidData(bidId, { persist: false, validate: false });
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error });
  // Fix round 2 / R2-S4(a) — ambiguousQtyKeys riding alongside the BidData
  // fields (rather than a separate round trip) is what lets the frontend
  // show it as a real pre-send warning instead of it only ever reaching
  // server logs (see composeBidData.ts's own comment on this).
  res.json({ ...loaded.bidData, ambiguousQtyKeys: loaded.ambiguousQtyKeys });
}));

// GET generate-docx — build and return the .docx proposal file
router.get('/:bidId/generate-docx', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });

  const loaded = await composeCurrentBidData(bidId);
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error, ...(loaded.failures ? { failures: loaded.failures } : {}) });
  const { bidData, bidName, asciiName } = loaded;

  let buf: Buffer;
  try {
    buf = await renderBidDocx(bidData);
  } catch (err) {
    logger.error({ err, bidId }, '[generate-docx] renderBidDocx threw');
    return res.status(500).json({ error: `Document build failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  // Task 6 — hard verify gate: on failure, file nothing and never send the
  // docx. Mirrors verify.sh v4's "exits non-zero — do not deliver a file
  // that failed it."
  const verifyResult = await verifyBidDocx(buf, { kind: 'gc' });
  if (!verifyResult.pass) {
    return res.status(422).json({
      error: 'This proposal did not pass the bid-standard verification gate.',
      failures: verifyResult.failures,
    });
  }

  // FIX-10 — name generated bid docs per the standard's own deliverables
  // table (APT_Bid_[ProjectSlug]_[LocationSlug].docx), falling back to the
  // pre-existing "Proposal - <name>.docx" naming when a slug comes out
  // blank. ASCII header-safety strip kept regardless (HTTP headers must be
  // Latin-1; project_slug/location_slug are already alnum-only, but the
  // fallback branch runs through asciiName which needed this strip too).
  const filename = bidDocxFilename(bidData, asciiName).replace(/[<>:"/\\|?*\r\n]/g, '-');
  const dateStr = new Date().toISOString().split('T')[0];
  const storageFilename = filename.replace(/\.docx$/i, ` - ${dateStr}.docx`);

  // File everything: the docx (version history — every generate-docx call is
  // a new row, replaceExisting intentionally omitted, same as before), the
  // composed bid_data.json (so the desktop APT_Bid_System and the CRM stay
  // interchangeable — either can read the other's bid_data.json), and the
  // PDF when soffice produced one. storeDocument (div:'elec') also uploads
  // to Drive via the same uploadFile helper, so this covers both "file it"
  // and "put it in Drive." Storage failure must never block the download —
  // losing the download is worse than a missed filing (same trade-off as
  // import-prebid's keep()).
  try {
    await storeDocument({
      file: {
        buffer: buf,
        originalname: storageFilename,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buf.length,
      } as Express.Multer.File,
      linkedId: bidId,
      linkedName: bidName,
      div: 'elec',
      category: 'proposal',
      displayName: storageFilename,
      uploadedBy: req.user!.name,
      // FIX-3 (post-review) — this row is only ever filed after
      // verifyBidDocx(kind:'gc') passed, above. gate_passed marks it as the
      // only kind of 'proposal' row draft-proposal will ever attach.
      gatePassed: true,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-docx] storeDocument (proposal) failed');
  }

  try {
    const bidDataJson = Buffer.from(JSON.stringify(bidData, null, 2));
    const bidDataFilename = `${asciiName}_bid_data.json`;
    await storeDocument({
      file: {
        buffer: bidDataJson,
        originalname: bidDataFilename,
        mimetype: 'application/json',
        size: bidDataJson.length,
      } as Express.Multer.File,
      linkedId: bidId,
      linkedName: bidName,
      div: 'elec',
      category: 'bid_data',
      displayName: bidDataFilename,
      uploadedBy: req.user!.name,
      // FIX-3 (post-review) — the public proposal page (routes/bids.ts's
      // GET /p/:token) renders directly from the most recent gate_passed
      // bid_data.json instead of composing/verifying live; this is the row
      // it reads.
      gatePassed: true,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-docx] storeDocument (bid_data) failed');
  }

  if (verifyResult.pdf) {
    try {
      const pdfFilename = `Proposal - ${asciiName} - ${dateStr}.pdf`;
      await storeDocument({
        file: {
          buffer: verifyResult.pdf,
          originalname: pdfFilename,
          mimetype: 'application/pdf',
          size: verifyResult.pdf.length,
        } as Express.Multer.File,
        linkedId: bidId,
        linkedName: bidName,
        div: 'elec',
        category: 'proposal',
        displayName: pdfFilename,
        uploadedBy: req.user!.name,
        gatePassed: true,
      });
    } catch (err) {
      logger.error({ err, bidId }, '[generate-docx] storeDocument (pdf) failed');
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
}));

// GET generate-takeoff-xlsx — GC-mode quantity takeoff from the same
// composed BidData used by generate-docx, so the two documents can never
// drift apart (Task 3's takeoffXlsx.ts).
router.get('/:bidId/generate-takeoff-xlsx', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });

  const loaded = await composeCurrentBidData(bidId);
  if (!loaded.ok) return res.status(loaded.status).json({ error: loaded.error, ...(loaded.failures ? { failures: loaded.failures } : {}) });
  const { bidData, bidName } = loaded;

  let xlsx: Awaited<ReturnType<typeof renderTakeoffXlsx>>;
  try {
    xlsx = await renderTakeoffXlsx(bidData, { prebid: false });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-takeoff-xlsx] renderTakeoffXlsx threw');
    return res.status(500).json({ error: `Takeoff build failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  // FIX-4 — this GC-facing xlsx shipped with no verification gate at all
  // (the docx path has always had verifyBidDocx(kind:'gc')). Same pure text
  // core (Task 4), same failure shape, applied to the takeoff's own text
  // content — failure blocks both filing and streaming.
  const verifyResult = verifyBidText(takeoffAsText(bidData), 'gc');
  if (!verifyResult.pass) {
    return res.status(422).json({
      error: 'This takeoff did not pass the bid-standard verification gate.',
      failures: verifyResult.failures,
    });
  }

  try {
    await storeDocument({
      file: {
        buffer: xlsx.buffer,
        originalname: xlsx.filename,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: xlsx.buffer.length,
      } as Express.Multer.File,
      linkedId: bidId,
      linkedName: bidName,
      div: 'elec',
      category: 'takeoff',
      displayName: xlsx.filename,
      uploadedBy: req.user!.name,
      gatePassed: true,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-takeoff-xlsx] storeDocument failed');
  }

  const asciiFilename = xlsx.filename.replace(/[^\x20-\x7E]/g, '').trim() || 'takeoff.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"`);
  res.setHeader('Content-Length', xlsx.buffer.length);
  res.send(xlsx.buffer);
}));

// POST generate-prebid-package — ports build_prebid.js + build_takeoff.py
// --prebid: the internal scope docx (PRE-BID PACKAGE — INTERNAL USE banner,
// To Chris/From Jake header, no price/signature/closing) and the confidence-
// coded pre-bid xlsx, from the SAME composed BidData. Filed under the
// existing prebid_scope / prebid_takeoff categories — FIX-3: each generation
// files NEW dated rows (same version-history convention generate-docx has
// always used), not replaceExisting. import-prebid uploads human-uploaded
// pre-bid documents under these SAME two categories; replaceExisting here
// used to hard-DELETE those on every regeneration (storeDocument's
// replaceExisting is a `DELETE FROM documents WHERE linked_id=$1 AND
// category=$2`, with no distinction between who uploaded what). Verified
// with kind:'internal' (placeholders still gate; banned-language/SF relax,
// and the ECFECI occurrence count now still applies per FIX-6 — pre-bid
// scope legitimately carries estimator language and square footage per
// PROJECT_INSTRUCTIONS §14, but must keep the ECFECI language).
router.post('/:bidId/generate-prebid-package', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bidId } = req.params;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  // FIX-7 — validate:false here: validateBidData's rules (scope exactly 6,
  // terms exactly 10, Section C exactly 3, etc.) are the GC-facing standard's
  // non-negotiables, not requirements on this internal/rougher pre-bid
  // deliverable — this route already has its own, more specific and
  // friendlier "no scope data" check just below.
  const loaded = await composeCurrentBidData(bidId, { validate: false });
  if (!loaded.ok) {
    return res.status(400).json({
      error: `Cannot generate a pre-bid package: ${loaded.error}`,
      ...(loaded.failures ? { failures: loaded.failures } : {}),
    });
  }
  const { bidData, bidName } = loaded;

  if (!bidData.sections.length) {
    return res.status(400).json({ error: 'No scope data to build a pre-bid package from. Run Agent 4 first.' });
  }

  let scopeDocx: Buffer;
  try {
    scopeDocx = await renderPrebidScopeDocx(bidData);
  } catch (err) {
    logger.error({ err, bidId }, '[generate-prebid-package] renderPrebidScopeDocx threw');
    return res.status(500).json({ error: `Pre-bid scope build failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  let xlsx: Awaited<ReturnType<typeof renderTakeoffXlsx>>;
  try {
    xlsx = await renderTakeoffXlsx(bidData, { prebid: true });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-prebid-package] renderTakeoffXlsx threw');
    return res.status(500).json({ error: `Pre-bid takeoff build failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  // Verify the scope docx's own text PLUS every takeoff item's text fields
  // (the scope docx never renders the takeoff table, so its own extracted
  // text can't see them) in one pass — verifyBidText is the pure core
  // (Task 4), reused directly here rather than verifyBidDocx (which is
  // docx/PDF-specific and can't read an xlsx).
  const combinedText = `${extractDocxText(scopeDocx)}\n${takeoffAsText(bidData)}`;
  const verifyResult = verifyBidText(combinedText, 'internal');
  if (!verifyResult.pass) {
    return res.status(422).json({
      error: 'The pre-bid package did not pass verification.',
      failures: verifyResult.failures,
    });
  }

  // FIX-3 — dated storage filenames, same version-history convention
  // generate-docx already uses (originalname/displayName stay the plain
  // build-standard name; the date suffix is only on what's actually stored,
  // so a bid can accumulate a history of pre-bid packages across revisions).
  const dateStr = new Date().toISOString().split('T')[0];
  const scopeFilename = prebidScopeFilename(bidData);
  const scopeStorageFilename = scopeFilename.replace(/\.docx$/i, ` - ${dateStr}.docx`);
  let scopeDoc: { id: string } | null = null;
  try {
    scopeDoc = await storeDocument({
      file: {
        buffer: scopeDocx,
        originalname: scopeStorageFilename,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: scopeDocx.length,
      } as Express.Multer.File,
      linkedId: bidId,
      linkedName: bidName,
      div: 'elec',
      category: 'prebid_scope',
      displayName: scopeStorageFilename,
      uploadedBy: req.user!.name,
      gatePassed: true,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-prebid-package] storeDocument (scope) failed');
  }

  const takeoffStorageFilename = xlsx.filename.replace(/\.xlsx$/i, ` - ${dateStr}.xlsx`);
  let takeoffDoc: { id: string } | null = null;
  try {
    takeoffDoc = await storeDocument({
      file: {
        buffer: xlsx.buffer,
        originalname: takeoffStorageFilename,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: xlsx.buffer.length,
      } as Express.Multer.File,
      linkedId: bidId,
      linkedName: bidName,
      div: 'elec',
      category: 'prebid_takeoff',
      displayName: takeoffStorageFilename,
      uploadedBy: req.user!.name,
      gatePassed: true,
    });
  } catch (err) {
    logger.error({ err, bidId }, '[generate-prebid-package] storeDocument (takeoff) failed');
  }

  if (!scopeDoc && !takeoffDoc) {
    return res.status(500).json({ error: 'Pre-bid package built but could not be filed. Try again.' });
  }

  res.json({ scopeDocumentId: scopeDoc?.id ?? null, takeoffDocumentId: takeoffDoc?.id ?? null });
}));

export default router;
