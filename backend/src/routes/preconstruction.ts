import { Router, Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth, requireAIPermission, hasAIPermission, AuthRequest, ownScopeId } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { getSetting } from '../db/getSetting';
import Anthropic from '@anthropic-ai/sdk';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { AGENT1_SYSTEM, agent1PromptWithCountingSections, AGENT2_SYSTEM, AGENT3_SYSTEM, AGENT4_SYSTEM, PREBID_COMPARE_SYSTEM } from '../ai/prompts';
import { buildProposalDocx, ProposalJSON, renderBidDocx, legacyProposalWithBidMeta, bidDocxFilename, headerLines, introLine, priceLine, takeoffDescription } from '../utils/proposalDocx';
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
import { runBatchesInOrder, AGENT1_CONCURRENCY } from '../ai/agent1Batching';
import { buildAgent4UserMessage, isAgent4Shape, Agent4Output } from '../ai/agent4Message';
import { parseMoney } from '../utils/money';
import { compactForHandoff } from '../ai/compactPayload';
import { analysisIsEmpty } from '../ai/emptyAnalysis';
import { buildPrebidCrossCheck } from '../ai/agent3CrossCheck';
import { runCountingStage, runSupplementCounting, type CountResult } from '../ai/countingStage';
import { dbEvidenceCache } from '../services/evidenceCache';
import { normalizeSheetId } from '../ai/sheetRefs';
import { emptyHygiene, applyGcHygiene, filterMissingSheets, downgradeNotFound, collectSqFt, zeroQuantityProblems, irrelevantSpecSentences, type HygieneReport } from '../ai/outputHygiene';
import { writeAiCountMarkers, writeGapFillMarkers, revertAiMarkerWrite, type MarkerScope } from '../estimating/aiMarkers';
import { buildReviewItems, referencedSheetItems, carryOverResolutions, reviewStatus, reviewResolutionsForAgent4, isRealReason, type ReviewItem } from '../ai/reviewItems';
import { takeoffGate, budgetPendingGate, evidenceGate, getTakeoffReview, resolveReviewItems, reopenReviewItem } from '../estimating/takeoffReview';
import { logLabeledEvents } from '../estimating/labeledEvents';
import { deriveExpectedFromConfirmedCounts } from '../estimating/finishedBidEval';
import { buildAccountTermsSnapshot, scopeQuestionsFor, effectiveAccountTerms } from '../bidstd/accountRulesDb';
import { renderAccountTermsBlock, verifyOptionsFor, type AccountTermsSnapshot } from '../bidstd/accountRules';
import { renderScopeListBlock, excludedScopeProblems, nonElectricalFindings, nearDuplicateLines, normalizeLineKey, overrideFor } from '../bidstd/scopeList';
import { getBidScopeList } from '../bidstd/scopeListDb';
import { ComposeBidRow, SavedConfidenceItem } from '../bidstd/composeBidData';
import { composeProposal } from '../bidstd/composeProposal';
import { getAlternates, getQuotes } from '../estimating/accubidBidData';
import { resolveUniqueJobNumber } from '../bidstd/boilerplate';
import { renderTakeoffXlsx } from '../bidstd/takeoffXlsx';
import { renderPrebidScopeDocx, prebidScopeFilename } from '../bidstd/prebidScopeDocx';
import { verifyBidDocx, verifyBidText, type VerifyOptions } from '../bidstd/verifyBid';
import { BidData } from '../bidstd/bidData';
import { graphCreateDraft, isGraphMailConfigured } from '../email/graphMailer';
import { rfiDraftSubject, buildRfiDraftHtml } from '../email/rfiDraftEmail';
import { resetForRerun, type RerunResetSummary } from '../services/rerunReset';
import { planSheetsForRun, loadSheetCheck, skippedClarifications, buildInventory, pageContentHash, resolveRefsAfterSupplement, type FileSheetPlan, type SupplementPlanOptions, type CheckedPage } from '../services/sheetCheck';
import { registerRun, abortableClient, abortRuns, isCancellationError, RunCancelledError, runSignalOf } from '../ai/runControl';

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
  /** Next round A2 — Sonnet vision reads a scanned sheet's notes region for
   *  references (setting ai_sheet_refs_vision_model). */
  modelRefVision: string;
  /** Evidence round — the narrow readers (viewports, typicals, schedule
   *  rows): setting ai_takeoff_evidence_model / ai_max_tokens_evidence. */
  modelEvidence: string;
  maxTokensEvidence: number;
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
const DEFAULT_MAX_TOKENS_A2 = 32000; // Agent 2 hit 16,000 on the AutoZone set; streaming makes this safe
const DEFAULT_MAX_TOKENS_A3 = 16000;
const DEFAULT_MAX_TOKENS_A4 = 8000;
/** Takeoff accuracy Decision 1 — Opus 5.5 counts symbols. Its thinking cannot
 *  be disabled and thinking tokens count against max_tokens, so the budget is
 *  sized for thinking plus ~200-400 compact marks per sheet (see counter.ts). */
export const DEFAULT_COUNTER_MODEL = 'claude-opus-5-5';
export const DEFAULT_MAX_TOKENS_COUNTER = 32000;
/** Evidence round — the readers read one sheet overview / one crop / one
 *  table per call. Opus 5.5 by default: its high-resolution image limit
 *  (3.75 MP) sees a 36x24 sheet overview at ~64 px/in and a panel schedule
 *  crop at ~180 px/in; the standard tier (Sonnet 4.6, 1.2 MP) gets ~37 and
 *  ~105 px/in — small print. Changeable in Settings -> AI. */
export const DEFAULT_EVIDENCE_MODEL = 'claude-opus-5-5';
export const DEFAULT_MAX_TOKENS_EVIDENCE = 16000;
const DEFAULT_TEMPERATURE = 0.3;

function parseNumberSetting(value: string, fallback: number, min: number, max: number): number {
  // Evidence round (found by its settings test): an emptied field is stored
  // as '' and Number('') is 0, which clamped to the MINIMUM (1,024 tokens —
  // a truncated run) instead of meaning "use the default".
  if (!String(value ?? '').trim()) return fallback;
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
    modelCounterSetting, maxCounterSetting, modelRefVisionSetting,
    modelEvidenceSetting, maxEvidenceSetting,
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
    getSetting('ai_sheet_refs_vision_model'),
    getSetting('ai_takeoff_evidence_model'),
    getSetting('ai_max_tokens_evidence'),
  ]);
  const defaultModel = (process.env.ANTHROPIC_MODEL || process.env.AI_MODEL || DEFAULT_AI_MODEL).trim();
  return {
    model:   (modelSetting   || defaultModel),
    modelA2: (modelA2Setting || 'claude-haiku-4-5-20251001'),
    modelA3: (modelA3Setting || 'claude-haiku-4-5-20251001'),
    modelA4: (modelA4Setting || 'claude-sonnet-4-6'),
    modelClassifier: (modelClassifierSetting || 'claude-haiku-4-5-20251001'),
    modelCounter: ((modelCounterSetting || '').trim() || DEFAULT_COUNTER_MODEL),
    modelRefVision: ((modelRefVisionSetting || '').trim() || 'claude-sonnet-4-6'),
    modelEvidence: ((modelEvidenceSetting || '').trim() || DEFAULT_EVIDENCE_MODEL),
    maxTokensEvidence: parseNumberSetting(maxEvidenceSetting || '', DEFAULT_MAX_TOKENS_EVIDENCE, 1024, 64000),
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
  if ((err as { name?: string })?.name === 'AgentRefusedError') return (err as Error).message;
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
  /** Next round A1/A3 — how the sheet check placed this page: analysed,
   *  sent as a reference page (context only, not counted — except a
   *  photometric / site sheet for site fixture types), or left out. */
  role?: 'analysis' | 'reference' | 'excluded';
  /** "E-7 note 3" — where a reference page was referenced from. */
  referencedBy?: string[];
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
  filename: string,
  plan?: FileSheetPlan,
): Promise<PdfPrepResult> {
  // Next round A1 — the sheet check already classified this file (cached by
  // content hash) and decided every page's role: no second classifier call.
  if (plan && plan.classifications.length) {
    const pageTexts = plan.pageTexts;
    const selection: PdfPageSelection[] = [];
    const inventory: PrepInventoryEntry[] = plan.classifications.map(c => {
      const r = plan.roles.get(c.page) ?? { role: 'excluded' as const, reason: 'not placed by the sheet check' };
      if (r.role !== 'excluded') {
        selection.push({ page: c.page, label: formatSheetLabel(c.sheetNo, c.title, `${filename} p${c.page}`), cls: r.role === 'reference' ? 'reference' : c.cls });
      }
      return {
        file: filename, page: c.page, sheetNo: c.sheetNo, title: c.title, discipline: c.discipline, cls: c.cls,
        included: r.role !== 'excluded', textChars: pageTexts[c.page - 1]?.length ?? 0, classified: c.discipline !== 'unknown',
        role: r.role, reason: r.reason, ...(r.referencedBy?.length ? { referencedBy: r.referencedBy } : {}),
      };
    });
    const dropFile = selection.length === 0;
    return { filename, buffer, pageTexts, pages: selection, revivedPages: selection, dropFile, inventory, usage: NO_USAGE };
  }
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
  tileOverrides: TileSettingsOverrides,
  plans: Map<string, FileSheetPlan> = new Map(),
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
    const prep = await prepOnePdf(client, classifierModel, f.buffer, f.originalname, plans.get(crypto.createHash('sha256').update(f.buffer).digest('hex')));
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

// ── Takeoff accuracy Task 12: the pre-bid draft ───────────────────────────
// After the analysis (and once the Needs-review list is clear) Agent 4 runs
// in DRAFT mode — the same output contract, the same account-terms /
// scope-list / review blocks, no price — and the result is stored as
// draft_output. Choice: re-using Agent 4 with an explicit mode (rather than a
// separate composer prompt) keeps ONE contract for sections + takeoff, so the
// pre-bid package and the GC proposal render the same composed data through
// the same enforcement and verification; the price was never part of Agent
// 4's output (code applies it), so "no price" is just a different request
// header plus no saved-estimate figures.

/** Fix round 1 / S12 — every input that shapes the scope, read in ONE
 *  repeatable-read snapshot: the draft prompt is built from exactly this, and
 *  its hash is taken from exactly this (a scope edit that lands mid-call can
 *  no longer be folded into a hash it wasn't in). */
export interface ScopeSnapshot {
  runId: string | null;
  agent1Output: string;
  agent2Output: string;
  reviewItems: ReviewItem[] | null;
  accountTerms: AccountTermsSnapshot | null;
  workspaceScope: Record<string, string> | null;
  scopeList: Awaited<ReturnType<typeof getBidScopeList>>;
}

export async function loadScopeSnapshot(bidId: string): Promise<ScopeSnapshot | null> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: tr } = await c.query('SELECT run_id, agent1_output, agent2_output, review_items, account_terms FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const { rows: ws } = await c.query('SELECT scope FROM bid_workspaces WHERE bid_id=$1', [bidId]);
    const scopeList = await getBidScopeList(bidId, c);
    await c.query('COMMIT');
    if (!tr.length) return null;
    return {
      runId: (tr[0].run_id as string | null) ?? null,
      agent1Output: (tr[0].agent1_output as string) || '',
      agent2Output: (tr[0].agent2_output as string) || '',
      reviewItems: (tr[0].review_items as ReviewItem[] | null) ?? null,
      accountTerms: (tr[0].account_terms as AccountTermsSnapshot | null) ?? null,
      workspaceScope: (ws[0]?.scope as Record<string, string> | undefined) ?? null,
      scopeList,
    };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export function hashScopeSnapshot(snap: ScopeSnapshot | null): string {
  const resolutions = (snap?.reviewItems ?? []).map(i => [i.id, i.resolution?.action ?? null, i.resolution?.qty ?? null, i.resolution?.answer ?? null, i.resolution?.reason ?? null]);
  const payload = JSON.stringify([
    snap?.runId ?? null, snap?.agent2Output ?? '', snap?.accountTerms ?? null, resolutions,
    (snap?.scopeList.items ?? []).map(i => [i.kind, i.text]), (snap?.scopeList.overrides ?? []).map(o => [o.lineKey, o.reason]),
    snap?.workspaceScope ?? {},
  ]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** sha256 of every input that shapes the scope: equal at proposal time means
 *  the draft can be reused with just the price inserted. */
export async function scopeInputsHash(bidId: string): Promise<string> {
  return hashScopeSnapshot(await loadScopeSnapshot(bidId));
}

/** Fix round 1 / B5 — begin a new analysis run for a bid (see /analyze).
 *  Returns the new run id. */
export async function startAnalysisRun(bidId: string): Promise<string> {
  return (await beginAnalysisRun(bidId)).runId;
}

/** Re-run reset — mints the run id AND resets everything the previous run
 *  produced (services/rerunReset.ts) in ONE transaction: a re-run is either
 *  fully reset or not started. The takeoff_results row is locked first, so
 *  two re-runs of the same bid serialize. */
export async function beginAnalysisRun(bidId: string): Promise<{ runId: string; reset: RerunResetSummary }> {
  const runId = crypto.randomUUID();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: prev } = await c.query(
      'SELECT run_id, agent2_output, agent4_price, review_items FROM takeoff_results WHERE bid_id=$1 FOR UPDATE', [bidId]
    );
    await c.query(`
      INSERT INTO takeoff_results (bid_id, status, run_id, review_status, reset_run_id) VALUES ($1, 'running', $2, 'pending', $2)
      ON CONFLICT (bid_id) DO UPDATE SET status='running', created_at=now(), run_id=$2,
        agent1_output=NULL, agent2_output=NULL, agent3_output=NULL, count_result=NULL,
        agent4_output=NULL, agent4_price=NULL, agent4_status=NULL, agent4_error=NULL, agent4_run_id=NULL, agent4_source=NULL,
        draft_output=NULL, draft_status=NULL, draft_error=NULL, draft_inputs_hash=NULL, draft_run_id=NULL,
        review_status='pending',
        -- Re-run reset — the review (items AND the estimator's answers to
        -- them), the account-term snapshot, output hygiene and the last
        -- error go too: nothing from the previous run carries over.
        review_items=NULL, account_terms=NULL, hygiene=NULL, raw_response=NULL,
        progress=NULL, cancelled_at=NULL, cancelled_by=NULL,
        reset_run_id=$2
    `, [bidId, runId]);
    const reset = await resetForRerun(c, bidId, runId, {
      runId: (prev[0]?.run_id as string | null) ?? null,
      agent2Output: (prev[0]?.agent2_output as string | null) ?? null,
      agent4Price: prev[0]?.agent4_price ?? null,
      reviewItems: prev[0]?.review_items ?? null,
    });
    const { rfis: _rfis, scope: _scope, ...summary } = reset;
    await c.query('UPDATE takeoff_results SET reset_summary=$2 WHERE bid_id=$1', [bidId, JSON.stringify(summary)]);
    await c.query('COMMIT');
    return { runId, reset };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Compose the pre-bid draft. Never throws: failures land in draft_status /
 *  draft_error. Refuses (records why) while the takeoff still needs review. */
export async function runDraftComposition(bidId: string, client: Anthropic, config: AIConfig, opts: { claimed?: boolean } = {}): Promise<void> {
  let claimedHere = false;
  // N-R2-1 — every write below is bound to the run this draft belongs to; a
  // superseded draft can't mark the new run's draft as error or release its claim.
  const { rows: runRows } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const draftRun = (runRows[0]?.run_id as string | null) ?? null;
  // Stop analysis — the draft can be stopped on its own (draft_status
  // 'cancelled'); its model call carries this job's abort signal.
  const handle = registerRun(bidId, 'draft', draftRun);
  client = abortableClient(client, handle.signal);
  try {
    const gate = await takeoffGate(bidId);
    if (gate) {
      if (opts.claimed) await pool.query(`UPDATE takeoff_results SET draft_status=NULL WHERE bid_id=$1 AND draft_status='running' AND run_id IS NOT DISTINCT FROM $2`, [bidId, draftRun]);
      await pool.query(`UPDATE takeoff_results SET draft_error=$2 WHERE bid_id=$1`, [bidId, 'Waiting on the takeoff review.']);
      return;
    }
    // S13 — one draft in flight per bid: claim the running state atomically.
    if (!opts.claimed) {
      const claim = await pool.query(
        `UPDATE takeoff_results SET draft_status='running', draft_error=NULL
          WHERE bid_id=$1 AND agent2_output IS NOT NULL AND draft_status IS DISTINCT FROM 'running' RETURNING 1`, [bidId]);
      if (!claim.rowCount) return;
      claimedHere = true;
    }
    const snap = await loadScopeSnapshot(bidId);
    if (!snap?.agent2Output) {
      await pool.query(`UPDATE takeoff_results SET draft_status=NULL WHERE bid_id=$1 AND draft_status='running' AND run_id IS NOT DISTINCT FROM $2`, [bidId, draftRun]);
      return;
    }
    const inputsHash = hashScopeSnapshot(snap);
    const userMsg = buildAgent4UserMessage({
      mode: 'draft',
      price: '',
      agent1Output: snap.agent1Output,
      agent2Output: snap.agent2Output,
      workspaceScope: snap.workspaceScope,
      savedEstimate: null,
      reviewResolutions: reviewResolutionsForAgent4(snap.reviewItems),
      accountTerms: await accountTermsBlockFor(bidId, snap.accountTerms, snap.reviewItems, snap.agent1Output),
      scopeList: renderScopeListBlock(snap.scopeList.items),
    });
    const { rows: live } = await pool.query('SELECT draft_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (handle.signal.aborted || live[0]?.draft_status === 'cancelled') throw new RunCancelledError();
    const resp = await callWithRetry(() => client.messages.stream({
      model: config.modelA4,
      max_tokens: config.maxTokensA4,
      system: [{ type: 'text', text: config.promptA4 || AGENT4_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }).finalMessage(), { signal: runSignalOf(client), onRetry: (a, _e, d) => logger.warn(`[draft] retry ${a} in ${d}ms`) });
    assertNotTruncated(resp, 'Agent 4 (pre-bid draft)', config.maxTokensA4);
    const parsed = parseAIJSON(extractText(resp));
    if (!parsed || !isAgent4Shape(parsed)) {
      throw new Error(`The pre-bid draft could not be parsed (stop_reason: ${resp.stop_reason ?? 'unknown'}). Compose it again.`);
    }
    // B5 — written only if no new analysis started meanwhile.
    const w = await pool.query(
      `UPDATE takeoff_results SET draft_output=$2, draft_status='complete', draft_error=NULL, draft_model=$3,
         usage_draft=$4, draft_inputs_hash=$5, draft_at=now(), draft_run_id=run_id
        WHERE bid_id=$1 AND run_id IS NOT DISTINCT FROM $6 AND draft_status IS DISTINCT FROM 'cancelled'`,
      [bidId, JSON.stringify(parsed), config.modelA4, JSON.stringify(resp.usage), inputsHash, snap.runId]
    );
    if (!w.rowCount) logger.warn({ bidId }, '[draft] the draft was stopped or a new analysis started while it was composing — result discarded');
  } catch (err) {
    if (isCancellationError(err) || handle.signal.aborted) {
      logger.info({ bidId }, '[draft] pre-bid draft stopped — nothing written');
    } else {
      logger.error({ err, bidId }, '[draft] pre-bid draft composition failed');
      await pool.query(`UPDATE takeoff_results SET draft_status='error', draft_error=$2 WHERE bid_id=$1 AND run_id IS NOT DISTINCT FROM $3 AND draft_status IS DISTINCT FROM 'cancelled'`,
        [bidId, isAgentTruncatedError(err) ? (err as Error).message : describeAIError(err), draftRun]).catch(() => {});
    }
  } finally {
    handle.release();
    if (claimedHere || opts.claimed) {
      await pool.query(`UPDATE takeoff_results SET draft_status=NULL WHERE bid_id=$1 AND draft_status='running' AND run_id IS NOT DISTINCT FROM $2`, [bidId, draftRun]).catch(() => {});
    }
  }
}

/** S13 — starts a draft only when none is in flight for the bid (claimed
 *  atomically), logs who started it. false = not started. */
async function startDraftInBackground(bidId: string, startedBy?: { id: string; name: string }): Promise<boolean> {
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return false;
  let client: Anthropic;
  try { client = new Anthropic({ apiKey }); } catch (err) { logger.warn({ err, bidId }, '[draft] client could not be created'); return false; }
  const claim = await pool.query(
    `UPDATE takeoff_results SET draft_status='running', draft_error=NULL
      WHERE bid_id=$1 AND agent2_output IS NOT NULL AND draft_status IS DISTINCT FROM 'running' RETURNING 1`, [bidId]);
  if (!claim.rowCount) return false;
  if (startedBy) {
    await pool.query(`INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_draft','preconstruction',$1,$2)`,
      [`Pre-bid draft composition started by ${startedBy.name}`, startedBy.id]).catch(() => {});
  }
  const config = await loadAIConfig();
  void runDraftComposition(bidId, client, config, { claimed: true });
  return true;
}

/** Takeoff accuracy Task 8 — the account terms for a bid: the snapshot taken
 *  at analysis time, or (a run from before account rules existed) one built
 *  now from the current rules and the stored drawing analysis, never
 *  persisted from here. */
async function accountTermsFor(bidId: string, stored: AccountTermsSnapshot | null, agent1Output: string): Promise<AccountTermsSnapshot | null> {
  if (stored) return stored;
  const agent1 = parseAIJSON(agent1Output || '') ?? {};
  const { rows } = await pool.query('SELECT name, brand, project_type FROM bids WHERE id=$1', [bidId]);
  if (!rows.length) return null;
  return buildAccountTermsSnapshot(rows[0], agent1);
}

async function accountTermsBlockFor(bidId: string, stored: AccountTermsSnapshot | null, reviewItems: ReviewItem[] | null, agent1Output: string): Promise<string | null> {
  const snap = await accountTermsFor(bidId, stored, agent1Output);
  return renderAccountTermsBlock(snap, effectiveAccountTerms(snap, reviewItems));
}

// ── Background pipeline ───────────────────────────────────────────────────────
// Exported (takeoff accuracy) so integration tests can drive the real pipeline
// with an injected fake Anthropic client — never a real API call from tests.
/** Next round A4 — a supplement pass: the run's earlier state, into which
 *  the new pages are analysed and counted (same run id). */
export interface SupplementContext {
  priorAgent1: Record<string, unknown>;
  priorCount: CountResult | null;
  priorInventory: PrepInventoryEntry[];
  priorUsage: Record<string, unknown>;
  /** The run's earlier input files, for counting NEW types on old sheets. */
  oldFiles: Express.Multer.File[];
  /** Fix round S3 — plan the new pages against the run (and skip pages
   *  already in it). */
  plan?: SupplementPlanOptions;
}

export async function runPipeline(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig,
  opts: { supplement?: SupplementContext } = {},
): Promise<void> {
  // Stop analysis — every model call of this run carries the run's abort
  // signal (POST /:bidId/stop-analysis aborts it).
  // Fix round S3 — registered under its run id: a stop / re-run aborts this
  // run only, never a later one.
  const { rows: runRow } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const handle = registerRun(bidId, 'analysis', (runRow[0]?.run_id as string | null) ?? null);
  try {
    await runPipelineStages(bidId, files, abortableClient(client, handle.signal), config, handle.signal, client, opts.supplement);
  } finally {
    handle.release();
  }
}

async function runPipelineStages(
  bidId: string,
  files: Express.Multer.File[],
  client: Anthropic,
  config: AIConfig,
  signal: AbortSignal,
  /** Fix round S3 — the unwrapped client, for the end-of-run draft: the
   *  draft is its own job (own stop), so stopping an analysis that has
   *  just finished can never kill it. */
  draftClient: Anthropic,
  supplement?: SupplementContext,
): Promise<void> {
  const newFileNames = new Set(files.map(f => f.originalname));
  // A4 — in a supplement pass the stored inventory / usage keep the run's
  // earlier pages and cost; the new pages are added.
  const storedInventory = (inv: PrepInventoryEntry[]) => supplement
    ? [...supplement.priorInventory.filter(p => !newFileNames.has(p.file)), ...inv] : inv;
  const storedUsage = (u: Record<string, unknown>) => supplement ? mergeUsage(supplement.priorUsage, u) : u;
  let agent1Output = '';
  let agent2Output = '';
  let agent3Output = '';
  // Takeoff accuracy Task 5 — the counting stage needs the page inventory and
  // the PDF bytes Agent 1 was built from.
  let countingInventory: PrepInventoryEntry[] = [];
  // Task 8 — set by the counting stage, read by Agent 2's message.
  let accountTerms: AccountTermsSnapshot | null = null;
  let reviewItemsNow: ReviewItem[] = [];
  // Task 9 — what the deterministic clean-up changed (takeoff_results.hygiene).
  const hygiene: HygieneReport = emptyHygiene();
  let agent1BatchResults: Record<string, unknown>[] = [];
  const { rows: bidGcRows } = await pool.query('SELECT gc FROM bids WHERE id=$1', [bidId]);
  const bidGc = String(bidGcRows[0]?.gc ?? '');

  // Fix round 2 / S-R2-1 — every write of this run is guarded by its run id:
  // once a newer /analyze starts, nothing this run does can change status,
  // outputs or the review (not even an error write). The run then stops.
  const { rows: runRows } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const runId = (runRows[0]?.run_id as string | null) ?? null;
  let superseded = false;
  // Stop analysis — a cancelled run (status 'cancelled', same run id) is
  // treated exactly like a superseded one: nothing it does writes anymore.
  const guarded = async (sql: string, params: unknown[]) => {
    const r = await pool.query(
      `${sql.trimEnd()} AND run_id IS NOT DISTINCT FROM $${params.length + 1} AND status IS DISTINCT FROM 'cancelled'`,
      [...params, runId]
    );
    if (!r.rowCount) {
      if (!superseded) logger.warn({ bidId, runId }, '[takeoff] this run was stopped or a newer analysis run started — this run stops writing');
      superseded = true;
    }
    return r;
  };
  const updateStatus = (status: string) =>
    guarded(`UPDATE takeoff_results SET status=$1 WHERE bid_id=$2`, [status, bidId]);
  /** Stop analysis — true once the run was stopped (or superseded). Checked
   *  between steps: between Agent 1 batches, before counting, Agents 2 / 3
   *  and the draft. The in-memory signal answers at once; the database
   *  covers a stop sent to another server process. */
  const checkpoint = async (): Promise<boolean> => {
    if (superseded) return true;
    if (signal.aborted) { superseded = true; return true; }
    const { rows } = await pool.query('SELECT run_id, status FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if ((rows[0]?.run_id ?? null) !== runId || rows[0]?.status === 'cancelled') { superseded = true; return true; }
    return false;
  };
  /** Stop analysis — a model call or checkpoint ended because the run was
   *  stopped: log it quietly and write nothing. */
  const stoppedBy = (err: unknown): boolean => {
    if (!isCancellationError(err) && !signal.aborted) return false;
    superseded = true;
    logger.info({ bidId, runId }, '[takeoff] analysis stopped — no further calls, nothing written');
    return true;
  };
  /** Live progress for the UI (takeoff_results.progress). Best effort. */
  // Fix round N8 — progress writes are chained, so they land in the order
  // they were made ("3 of 13" never overwritten by a late "2 of 13").
  let progressChain: Promise<unknown> = Promise.resolve();
  const setProgress = (stage: string, label: string, step: number | null = null, of: number | null = null) => {
    const value = JSON.stringify({ stage, label, step, of, at: new Date().toISOString() });
    progressChain = progressChain.then(() => guarded('UPDATE takeoff_results SET progress=$1 WHERE bid_id=$2', [value, bidId]).catch(() => {}));
    return progressChain;
  };

  // ── Agent 1 ─────────────────────────────────────────────────────────────────
  try {
    if (await checkpoint()) throw new RunCancelledError();
    await setProgress('prep', 'Reading the plan set — sorting pages');
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
    // Next round A1 — the sheet check's page inventory and selection (cached
    // by content hash: an unchanged file is not classified again), with the
    // estimator's overrides and the reference pages it found.
    let plans = new Map<string, FileSheetPlan>();
    let planUsage = { ...NO_USAGE };
    try {
      const planned = await planSheetsForRun(bidId, filesToSend, client, config.modelClassifier, supplement?.plan);
      plans = planned.plans;
      planUsage = planned.usage;
    } catch (err) {
      if (isAgentTruncatedError(err) || isCancellationError(err) || signal.aborted) throw err;
      logger.warn({ err, bidId }, '[takeoff] sheet check plan failed — pages are classified per file as before');
    }
    let uploadPrep: AgentUploadPrepResult;
    try {
      uploadPrep = await prepareAgent1Upload(filesToSend, client, config.modelClassifier, config.tileOverrides, plans);
      uploadPrep.classifierUsage.input_tokens += planUsage.input_tokens;
      uploadPrep.classifierUsage.output_tokens += planUsage.output_tokens;
    } catch (err) {
      if (isAgentTruncatedError(err) || isCancellationError(err) || signal.aborted) throw err;
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

      if (await checkpoint()) throw new RunCancelledError();
      await setProgress('agent1', 'Agent 1: reading the drawings (1 call)', 1, 1);
      logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, 'single', prep);
      const resp = await callWithRetry(() =>
        client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokensA1,
          system: [{ type: 'text', text: agent1PromptWithCountingSections(config.promptA1), cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: contentBlocks }],
        }).finalMessage()
      , { signal: runSignalOf(client), onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 transient error, retry ${a} in ${d}ms`) });
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
      await guarded(`UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2, prep_inventory=$3, prep_fidelity=$4 WHERE bid_id=$5`,
        [JSON.stringify(storedUsage(mergedUsage as unknown as Record<string, unknown>)), config.model, JSON.stringify(storedInventory(prepInventory)), prepFidelity, bidId]
      ).catch(() => {});
      // Takeoff accuracy Task 1 — after the usage write, so a truncated (but
      // still billed) call's cost is recorded before the run fails.
      assertNotTruncated(resp, 'Agent 1', config.maxTokensA1);

    } else {
      // Batched: N token-budgeted calls (mergeAgent1Batches already merges results).
      // Next round A5 — up to AGENT1_CONCURRENCY batches at once; results
      // are merged in batch order, exactly as the sequential loop did.
      let batchUsage: Record<string, unknown> = { ...NO_USAGE };
      const total = agent1Batches.length;
      await setProgress('agent1', `Agent 1: ${total} batches, ${Math.min(AGENT1_CONCURRENCY, total)} at a time`, 0, total);
      const parsedByBatch = await runBatchesInOrder(total, async (bi, batchSignal) => {
        const contentBlocks = agent1Batches[bi];
        const prep = summarizePrep(contentBlocks);
        contentBlocks.push({
          type: 'text',
          text: `Analyze batch ${bi + 1} of ${total} electrical plan pages and provide Drawing Analyzer JSON output. Return JSON only — no prose, no markdown fences.\nIMPORTANT: Even if this sheet contains no electrical equipment, you MUST return a valid JSON object with the sheet in sheet_inventory and equipment arrays empty.`,
        });

        logAgent1Request(bidId, contentBlocks, config.model, config.maxTokensA1, `batch ${bi + 1}/${total}`, prep);
        const runSig = runSignalOf(client);
        const bResp = await callWithRetry(() =>
          client.messages.stream({
            model: config.model,
            max_tokens: config.maxTokensA1,
            system: [{ type: 'text', text: agent1PromptWithCountingSections(config.promptA1), cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: contentBlocks }],
          }, { signal: batchSignal }).finalMessage()
        , { signal: runSig ? AbortSignal.any([runSig, batchSignal]) : batchSignal, onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 1 batch transient error, retry ${a} in ${d}ms`) });
        const bText = extractText(bResp);
        logAgent1Response(bidId, bResp, bText, `batch ${bi + 1}/${total}`, prep);
        // FIX-7 — sum the full usage shape across batches (a truncated
        // batch was still billed).
        if (bResp.usage) batchUsage = mergeUsage(batchUsage, bResp.usage as unknown as Record<string, unknown>);
        // Takeoff accuracy Task 1 — a truncated batch used to fall through to
        // parseAIJSON, fail, and be silently skipped by the merge below: the
        // takeoff just lost every sheet that batch carried.
        assertNotTruncated(bResp, `Agent 1 (batch ${bi + 1} of ${total})`, config.maxTokensA1);
        if (!bText.trim()) {
          logger.warn({ bidId, batch: `${bi + 1}/${total}` },
            '[takeoff] Agent 1 batch returned empty output — skipping');
        }
        return parseAIJSON(bText);
      }, {
        // Stop analysis — no further batch starts once the run is stopped.
        shouldStop: () => checkpoint(),
        onSettled: (done, of, running) => {
          void setProgress('agent1', `Agent 1: ${done} of ${of} batches done${running ? ` (${running} running)` : ''}`, done, of);
        },
      }).catch(async (err) => {
        // Fix round N8 — batches that ran were billed: record their usage
        // even when the run fails.
        await guarded(`UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2 WHERE bid_id=$3`,
          [JSON.stringify(storedUsage(mergeUsage(batchUsage, classifierUsage))), config.model, bidId]).catch(() => {});
        throw err;
      });
      const batchResults = parsedByBatch.filter((p): p is Record<string, unknown> => !!p);
      batchUsage = mergeUsage(batchUsage, classifierUsage);
      await guarded(`UPDATE takeoff_results SET usage_agent1=$1, model_agent1=$2, prep_inventory=$3, prep_fidelity=$4 WHERE bid_id=$5`,
        [JSON.stringify(storedUsage(batchUsage)), config.model, JSON.stringify(storedInventory(prepInventory)), prepFidelity, bidId]
      ).catch(() => {});

      // Merge batch results — generic merge over the actual AGENT1_SYSTEM schema
      // (project, service, panels, equipment, quantities, allowances, ecfeciItems,
      // flags, scopeNotes, missingSheets), not a hardcoded legacy key list.
      // See backend/src/ai/mergeAgent1.ts for the merge rules.
      agent1BatchResults = batchResults;
      agent1JSON = mergeAgent1Batches(batchResults);
      agent1Output = JSON.stringify(agent1JSON, null, 2);
    }

    // Validate JSON
    const parsedAgent1 = parseAIJSON(agent1Output);
    if (!parsedAgent1) {
      const stopHint = agent1Output.trim().startsWith('```') || agent1Output.trim().startsWith('{')
        ? 'Agent 1 returned JSON that could not be parsed. The response may have been cut off. Try fewer sheets or increase AI Max Tokens in Settings > AI.'
        : 'Agent 1 did not return JSON.';
      await guarded(`UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [`${stopHint}\n\nRaw preview: ${compactOutput(agent1Output)}`, bidId]
      );
      console.error('[takeoff] Agent 1 JSON parse failed');
      return;
    }
    agent1JSON = parsedAgent1;
    // A4 — the supplement's pages are merged into the run's analysis.
    if (supplement) agent1JSON = mergeAgent1Batches([supplement.priorAgent1, parsedAgent1]);

    // Task 4.2 — empty-analysis guard: if every batch failed to parse,
    // mergeAgent1Batches still returns a valid-looking {} that would otherwise
    // flow straight into Agents 2-3, billing two more paid calls for nothing.
    if (analysisIsEmpty(agent1JSON)) {
      await guarded(`UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
        [
          'Drawing analysis found no electrical content. Check that the right sheets were uploaded (see the prep inventory) — the run was stopped before Agents 2–3 to avoid billing for an empty takeoff.',
          bidId,
        ]
      );
      logger.warn({ bidId }, '[takeoff] Agent 1 analysis empty — stopped before Agent 2/3');
      return;
    }

    // Task 9 — output hygiene on the drawing analysis, before anything reads it.
    collectSqFt(agent1BatchResults.length ? agent1BatchResults : [agent1JSON], hygiene);
    let cleaned = applyGcHygiene(agent1JSON, bidGc, hygiene);
    const loadedSheetNos = [
      ...countingInventory.map(p => p.sheetNo),
      ...(supplement?.priorInventory ?? []).map(p => p.sheetNo),
      ...(Array.isArray((cleaned.project as Record<string, unknown> | undefined)?.sheets) ? ((cleaned.project as Record<string, unknown>).sheets as unknown[]).map(String) : []),
    ];
    cleaned = filterMissingSheets(cleaned, loadedSheetNos, hygiene);
    cleaned = downgradeNotFound(cleaned, hygiene);
    agent1JSON = cleaned;
    agent1Output = JSON.stringify(agent1JSON, null, 2);

    await guarded(`UPDATE takeoff_results SET status='agent1_complete', agent1_output=$1, hygiene=$2 WHERE bid_id=$3`,
      [agent1Output, JSON.stringify(hygiene), bidId]
    );
  } catch (err) {
    if (stoppedBy(err)) return;
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 1 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 1 failed');
    await guarded(`UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  if (superseded) return;
  // ── Agent 1C: counting stage (takeoff accuracy, Decisions 1-7) ─────────────
  // Every fixture/device/equipment type from the schedules and legend is
  // counted on each electrical plan sheet at 300 DPI; the counts REPLACE
  // Agent 1's own for those types before Agent 2 ever sees them.
  try {
    if (await checkpoint()) throw new RunCancelledError();
    await updateStatus('counting');
    await setProgress('counting', 'Counting: preparing sheets');
    const pdfs = new Map<string, Buffer>();
    for (const f of files) {
      if ((f.originalname.split('.').pop() || '').toLowerCase() === 'pdf') pdfs.set(f.originalname, f.buffer);
    }
    // Fix round 1 / B2 — fixture types the estimator entered (when an earlier
    // run found no schedule/legend) are counted like schedule rows.
    const agent1ForCounting = parseAIJSON(agent1Output) ?? {};
    const { rows: manualRows } = await pool.query('SELECT manual_count_targets FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const manual = (manualRows[0]?.manual_count_targets as Array<Record<string, unknown>> | null) ?? [];
    if (manual.length) {
      const have = new Set(((agent1ForCounting.fixtureSchedule as Array<{ type?: string }> | undefined) ?? []).map(f => String(f.type ?? '').toUpperCase()));
      agent1ForCounting.fixtureSchedule = [
        ...((agent1ForCounting.fixtureSchedule as unknown[] | undefined) ?? []),
        ...manual.filter(m => !have.has(String(m.type ?? '').toUpperCase())).map(m => ({ ...m, sourceSheet: 'Entered by the estimator' })),
      ];
    }
    const countingInput = {
      client, model: config.modelCounter, maxTokens: config.maxTokensCounter,
      agent1: agent1ForCounting, inventory: countingInventory, pdfs,
      // Evidence round Parts 1-3 — viewports, typicals, schedule rows.
      evidence: { model: config.modelEvidence, maxTokens: config.maxTokensEvidence, cache: dbEvidenceCache },
      // Fix round S2 — also once a newer run took over (the progress write
      // below sets `superseded`): a superseded run launches no more sheets.
      shouldStop: () => signal.aborted || superseded,
      onProgress: (done: number, total: number, phase?: 'retry') => {
        if (total) void setProgress('counting', `${phase === 'retry' ? 'Re-counting dense sheet' : 'Counting sheet'} ${Math.min(done + 1, total)} of ${total}`, Math.min(done + 1, total), total);
      },
    };
    // A4 — a supplement pass counts only what the new pages can change.
    if (supplement) for (const f of supplement.oldFiles) if (!pdfs.has(f.originalname) && (f.originalname.split('.').pop() || '').toLowerCase() === 'pdf') pdfs.set(f.originalname, f.buffer);
    const stage = supplement?.priorCount
      ? await runSupplementCounting({ ...countingInput, prior: supplement.priorCount, priorInventory: supplement.priorInventory, newFiles: newFileNames })
      : await runCountingStage(countingInput);
    agent1Output = JSON.stringify(stage.agent1, null, 2);
    if (superseded) return;
    // Task 6 — counted locations become suggested markers in the Plans view.
    // Non-fatal: a failure here loses the markers, never the counts.
    try {
      if (await checkpoint()) throw new RunCancelledError();
      // Fix round B2 — a supplement pass rewrites markers only for what it
      // re-counted (the new sheets; on an earlier sheet only the new types),
      // resolving documents for the run's earlier files too, and records
      // exactly what it changed so a failed pass can put them back.
      const markerFiles = [...(supplement?.oldFiles ?? []), ...files];
      let scope: MarkerScope | undefined;
      if (supplement) {
        const priorKeys = new Set((supplement.priorCount?.targets ?? []).map(t => t.key));
        const newTypes = stage.countResult.targets.map(t => t.key).filter(k => !priorKeys.has(k));
        scope = stage.countResult.sheets.flatMap((sh): MarkerScope => newFileNames.has(sh.file)
          ? [{ sheetKey: sh.key, typeKeys: null }]
          : newTypes.length ? [{ sheetKey: sh.key, typeKeys: newTypes }] : []);
      }
      const markers = await writeAiCountMarkers(bidId, stage.countResult,
        markerFiles.map(f => ({ file: f.originalname, documentId: (f as PipelineFile).documentId, size: f.buffer.length })), runId, scope);
      const { replacedIds, writtenIds, ...markerSummary } = markers;
      if (supplement) {
        await guarded(`UPDATE takeoff_results SET supplement = COALESCE(supplement, '{}'::jsonb) || jsonb_build_object('markers', $1::jsonb) WHERE bid_id=$2`,
          [JSON.stringify({ replacedIds: replacedIds ?? [], writtenIds: writtenIds ?? [] }), bidId]).catch(() => {});
      }
      (stage.countResult as unknown as Record<string, unknown>).markers = markerSummary;
      // Fix round (B2) — gap-fill's suggested marks, same source files, same
      // "never a count until confirmed" rule. Non-fatal, like the counter's
      // own write above: a failure here loses the suggestions, never a count.
      const gfSuggested = stage.countResult.evidence?.gapFill?.suggested ?? [];
      if (gfSuggested.length) {
        try {
          await writeGapFillMarkers(bidId, stage.countResult, gfSuggested,
            markerFiles.map(f => ({ file: f.originalname, documentId: (f as PipelineFile).documentId, size: f.buffer.length })), runId);
        } catch (err) {
          logger.warn({ err, bidId }, '[takeoff] writing gap-fill suggested markers failed');
        }
      }
    } catch (err) {
      logger.warn({ err, bidId }, '[takeoff] writing AI count markers failed');
      (stage.countResult as unknown as Record<string, unknown>).markers = { error: 'suggested markers could not be written' };
    }
    // Task 8 — the account rule for this bid, resolved against the drawings'
    // explicit furnish/install statements; open terms become scope questions.
    const { rows: bidRows } = await pool.query('SELECT name, brand, project_type FROM bids WHERE id=$1', [bidId]);
    accountTerms = await buildAccountTermsSnapshot(bidRows[0] ?? {}, stage.agent1);
    // Task 7 — the Needs-review list. A re-run keeps the estimator's earlier
    // resolutions for the same items (their work is never discarded).
    // N5 — the carry-over reads and writes review_items in ONE transaction
    // under a row lock, so a resolve that commits meanwhile is never lost.
    // A4 — sheets Agent 1 says are referenced that the sheet check missed.
    const sheetRow = await loadSheetCheck(bidId).catch(() => null);
    const inventoryKeys = new Set([...countingInventory, ...(supplement?.priorInventory ?? [])]
      .map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));
    const checkRefKeys = new Set((sheetRow?.result?.refs ?? []).filter(r => r.kind === 'sheet').map(r => r.key));
    const freshItems = [
      ...buildReviewItems(stage.countResult, scopeQuestionsFor(accountTerms)),
      ...referencedSheetItems((stage.agent1 as Record<string, unknown>).missingSheets, { loadedSheetKeys: inventoryKeys, checkRefKeys }, normalizeSheetId),
    ];
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { rows: prevRows } = await tx.query('SELECT review_items FROM takeoff_results WHERE bid_id=$1 FOR UPDATE', [bidId]);
      reviewItemsNow = carryOverResolutions(freshItems, (prevRows[0]?.review_items as ReviewItem[] | null) ?? null);
      const w = await tx.query(
        `UPDATE takeoff_results SET agent1_output=$1, count_result=$2, usage_counter=$3, model_counter=$4,
           review_items=$5, review_status=$6, account_terms=$7 WHERE bid_id=$8 AND run_id IS NOT DISTINCT FROM $9
           AND status IS DISTINCT FROM 'cancelled'`,
        [agent1Output, JSON.stringify(stage.countResult), JSON.stringify(stage.usage), config.modelCounter,
         JSON.stringify(reviewItemsNow), reviewStatus(reviewItemsNow), JSON.stringify(accountTerms), bidId, runId]
      );
      if (!w.rowCount) superseded = true;
      await tx.query('COMMIT');
    } catch (err) {
      await tx.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      tx.release();
    }
    // Evidence round 5.1 — one labeled event per gap-fill SUGGESTION (B2:
    // never an accepted count — only the estimator's own later confirmation,
    // logged separately at that point, ever is): a crop reference (sheet +
    // position, never image bytes), the type, confidence and note.
    // Fire-and-forget, after the transaction, never delays the response.
    if (!superseded) {
      const suggested = stage.countResult.evidence?.gapFill?.suggested ?? [];
      const gapFillEvents = suggested.map(g => ({
        bidId, runId, kind: 'gapfill_suggested' as const, typeKey: g.typeKey, sheetKey: g.sheetKey,
        client: bidRows[0]?.brand ?? null, projectType: bidRows[0]?.project_type ?? null,
        cropRef: { sheetKey: g.sheetKey },
        detail: { x: g.x, y: g.y, confidence: g.confidence, note: g.note.slice(0, 500) },
      }));
      if (gapFillEvents.length) void logLabeledEvents(gapFillEvents);
    }
  } catch (err) {
    if (stoppedBy(err)) return;
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Counting stage failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff counting stage failed');
    await guarded(`UPDATE takeoff_results SET status='error', agent1_output=$1 WHERE bid_id=$2`, [message, bidId]);
    return;
  }

  if (superseded) return;
  // ── Agent 2 ─────────────────────────────────────────────────────────────────
  try {
    if (await checkpoint()) throw new RunCancelledError();
    await updateStatus('agent2_running');
    await setProgress('agent2', 'Agent 2 of 3: building scope & estimate', 1, 1);
    // Task 11 — the estimator's scope list, binding for Agent 2.
    const agent2ScopeBlock = renderScopeListBlock((await getBidScopeList(bidId)).items);
    const resp = await callWithRetry(() => client.messages.stream({
      model: config.modelA2,
      max_tokens: config.maxTokensA2,
      system: [{ type: 'text', text: config.promptA2 || AGENT2_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        // Task 4.1 — compact (no 2-space indent) in the request body; storage
        // and the UI keep the pretty agent1Output exactly as today.
        content: `Use the following Drawing Analyzer JSON as the authoritative source for all quantities and project data. Generate your complete Estimator output following your output format exactly.\n\n${renderAccountTermsBlock(accountTerms, effectiveAccountTerms(accountTerms, reviewItemsNow)) ?? ''}\n\n${agent2ScopeBlock ?? ''}\n\nDRAWING ANALYZER JSON:\n\n${compactForHandoff(agent1Output)}`,
      }],
    }).finalMessage(), { signal: runSignalOf(client), onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 2 transient error, retry ${a} in ${d}ms`) });
    assertNotTruncated(resp, 'Agent 2', config.maxTokensA2);
    agent2Output = extractText(resp);
    // Task 9 — the same hygiene on Agent 2's JSON: the bid's GC, no
    // not-found value left VERIFIED.
    const agent2Parsed = parseAIJSON(agent2Output);
    if (agent2Parsed) {
      const a2Report = emptyHygiene();
      agent2Output = JSON.stringify(downgradeNotFound(applyGcHygiene(agent2Parsed, bidGc, a2Report), a2Report));
      if (a2Report.downgraded.length) {
        hygiene.downgraded.push(...a2Report.downgraded.map(d => ({ ...d, path: `agent2.${d.path}` })));
        hygiene.flags.push(...a2Report.downgraded.map(d => `Agent 2 ${d.path}: "${d.value}" can't be ${d.from} — downgraded to ${d.to}.`));
        await guarded('UPDATE takeoff_results SET hygiene=$1 WHERE bid_id=$2', [JSON.stringify(hygiene), bidId]);
      }
    }
    const agent2ToStore = extractJSONText(agent2Output) ?? agent2Output;

    await guarded(`UPDATE takeoff_results SET status='agent2_complete', agent2_output=$1, usage_agent2=$2, model_agent2=$3 WHERE bid_id=$4`,
      [agent2ToStore, JSON.stringify(resp.usage), config.modelA2, bidId]
    );
  } catch (err) {
    if (stoppedBy(err)) return;
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 2 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 2 failed');
    await guarded(`UPDATE takeoff_results SET status='error', agent2_output=$1 WHERE bid_id=$2`,
      [message, bidId]
    );
    return;
  }

  if (superseded) return;
  // ── Agent 3 ─────────────────────────────────────────────────────────────────
  try {
    if (await checkpoint()) throw new RunCancelledError();
    await updateStatus('agent3_running');
    await setProgress('agent3', 'Agent 3 of 3: QA review & risk assessment', 1, 1);

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

    const resp = await callWithRetry(() => client.messages.stream({
      model: config.modelA3,
      max_tokens: config.maxTokensA3,
      system: [{ type: 'text', text: config.promptA3 || AGENT3_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        // Task 4.1 — compact in the request body (both prior agents' outputs).
        content: `Review the following outputs and generate your complete Chief Estimator QC review following your output format exactly.\n\nDRAWING ANALYZER JSON:\n\n${compactForHandoff(agent1Output)}\n\n---\n\nESTIMATOR OUTPUT:\n\n${compactForHandoff(agent2Output)}${prebidCrossCheck ? `\n\n---\n\n${prebidCrossCheck}` : ''}`,
      }],
    }).finalMessage(), { signal: runSignalOf(client), onRetry: (a, _e, d) => console.warn(`[takeoff] Agent 3 transient error, retry ${a} in ${d}ms`) });
    assertNotTruncated(resp, 'Agent 3', config.maxTokensA3);
    agent3Output = extractText(resp);
    const agent3ToStore = extractJSONText(agent3Output) ?? agent3Output;

    // Final write — all three complete
    await guarded(`
      UPDATE takeoff_results SET
        status='complete',
        agent3_output=$1,
        raw_response=$2,
        usage_agent3=$3,
        model_agent3=$4
      WHERE bid_id=$5
    `, [agent3ToStore, agent1Output, JSON.stringify(resp.usage), config.modelA3, bidId]);

    // Takeoff accuracy Task 12 — the pre-bid draft, right after the analysis,
    // when nothing is waiting on the estimator (otherwise it's composed the
    // moment the Needs-review list clears).
    if (await checkpoint()) return;
    // The run is complete: the draft is its own job from here on (own
    // abort handle, own stop), and the writes below belong to a finished
    // run — only a NEWER run (never a late stop) skips them.
    await runDraftComposition(bidId, draftClient, config);
    const { rows: stillCurrent } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if ((stillCurrent[0]?.run_id ?? null) !== runId) return;

    // Also persist structured fields from agent1 JSON for backward compatibility
    const a1 = parseAIJSON(agent1Output) ?? {};
    await guarded(`
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
    // Task 9 — two different SF values on the drawings: never auto-fill.
    const extractedSqFt = hygiene.sqFt?.conflict ? null : (Number(a1Project.sqFt) || null);
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
    if (stoppedBy(err)) return;
    const message = isAgentTruncatedError(err) ? (err as Error).message : `Agent 3 failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff Agent 3 failed');
    await guarded(`UPDATE takeoff_results SET status='error', agent3_output=$1 WHERE bid_id=$2`,
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
        const resp = await callWithRetry(() => client.messages.stream({
          model: config.modelA2,
          max_tokens: config.maxTokensA2,
          system: [{ type: 'text', text: PREBID_COMPARE_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Compare these two pre-bid packages.\n\n${payload}` }],
        }).finalMessage(), { onRetry: (a, _e, d) => console.warn(`[prebid-analyze] transient error, retry ${a} in ${d}ms`) });

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
    // Fix round S4 — which scope sections the AI wrote / need re-check.
    // Absent (an older client) keeps what is stored.
    scope_meta,
  } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO bid_workspaces (bid_id, step, active_tab, notes, scope, rfis, files, ai_done, proposal_generated, confirmed_service, overhead_pct, profit_pct, estimate_overrides, scope_meta, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::jsonb, '{}'::jsonb),now())
     ON CONFLICT (bid_id) DO UPDATE SET
       step=$2, active_tab=$3, notes=$4, scope=$5, rfis=$6, files=$7,
       ai_done=$8, proposal_generated=$9, confirmed_service=$10,
       overhead_pct=$11, profit_pct=$12, estimate_overrides=$13,
       scope_meta=COALESCE($14::jsonb, bid_workspaces.scope_meta), updated_at=now()
     RETURNING *`,
    [bidId, step||'intake', active_tab||'overview', notes||'',
     JSON.stringify(scope||{}), JSON.stringify(rfis||[]), JSON.stringify(files||[]),
     !!ai_done, !!proposal_generated,
     confirmed_service ? JSON.stringify(confirmed_service) : null,
     overhead_pct === undefined || overhead_pct === null || overhead_pct === '' ? null : Number(overhead_pct),
     profit_pct === undefined || profit_pct === null || profit_pct === '' ? null : Number(profit_pct),
     JSON.stringify(estimate_overrides || {}),
     scope_meta && typeof scope_meta === 'object' ? JSON.stringify(scope_meta) : null]
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
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const review = await getTakeoffReview(bidId);
  // Fix round 1 / S5 — a bid analysed before the accuracy checks (no counting
  // stage ever ran: review_status NULL) is NOT blocked — its existing flow
  // keeps working — but the Takeoff step says so, and shows the questions its
  // account rule would ask (built now from the stored analysis; nothing is
  // written).
  if (review.status === null) {
    const { rows } = await pool.query('SELECT agent1_output, account_terms FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (rows[0]?.agent1_output) {
      const snap = await accountTermsFor(bidId, rows[0].account_terms as AccountTermsSnapshot | null, rows[0].agent1_output as string).catch(() => null);
      return res.json({
        ...review,
        legacy: {
          message: 'Analyzed before accuracy checks — re-run analysis to enable counting and account rules.',
          accountRule: snap ? `${snap.ruleName} (${snap.matchedBy})` : null,
          questions: (snap?.questions ?? []).map(q => ({ label: q.label, question: q.question, notes: q.notes })),
        },
      });
    }
  }
  // S8 — the matched account rule (and its warning) shown in the Takeoff step.
  const { rows: tr } = await pool.query('SELECT account_terms FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const snap = (tr[0]?.account_terms as AccountTermsSnapshot | null) ?? null;
  res.json({ ...review, ...(snap ? { accountRule: { name: snap.ruleName, matchedBy: snap.matchedBy, ...(snap.warning ? { warning: snap.warning } : {}) } } : {}) });
}));

// Resolve one or more items the same way: {itemIds, action:'count'|'markers'|
// 'not_on_job'|'answer', qty?, reason?, answer?}. Every item is validated;
// nothing is saved unless all of them pass.
router.post('/:bidId/review/resolve', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const body = req.body as { itemIds?: unknown; action?: unknown; qty?: unknown; reason?: unknown; answer?: unknown; answerIndex?: unknown; useSuggested?: unknown };
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === 'string') : [];
  const action = body.action;
  if (!itemIds.length) return res.status(400).json({ error: 'itemIds required' });
  if (action !== 'count' && action !== 'markers' && action !== 'not_on_job' && action !== 'answer' && action !== 'confirm') {
    return res.status(400).json({ error: 'action must be count, markers, not_on_job, answer or confirm' });
  }
  const out = await resolveReviewItems(bidId, itemIds, { action, qty: body.qty, reason: body.reason, answer: body.answer, answerIndex: body.answerIndex, useSuggested: body.useSuggested }, req.user!.name);
  if (!out.ok) return res.status(out.status).json({ error: out.error });
  // Task 12 — the last open item just cleared: compose the pre-bid draft.
  let draftStarted = false;
  // S13 — only for a user who may run paid analysis, and never a second
  // draft while one is in flight (startDraftInBackground claims atomically).
  if (out.review.status === 'clear' && await hasAIPermission(req.user!, 'run_analysis')) {
    const { rows } = await pool.query('SELECT draft_status, draft_inputs_hash FROM takeoff_results WHERE bid_id=$1', [bidId]);
    const upToDate = rows[0]?.draft_status === 'complete' && rows[0]?.draft_inputs_hash === await scopeInputsHash(bidId);
    if (!upToDate) draftStarted = await startDraftInBackground(bidId, { id: req.user!.id, name: req.user!.name });
  }
  res.json({ ...out.review, draftStarted });
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

// Evidence round 5.2 — "Finished bid": attach an answer key and store it as
// an eval case (scripts/evalTakeoff.ts's shape). Two sources:
//   * the bid's own CONFIRMED counts (default — always available once the
//     analysis has run; never an unresolved AI guess, see
//     deriveExpectedFromConfirmedCounts);
//   * a Chris BOM/breakdown import reference, when the estimator names one
//     (bomImportDocumentId) — recorded as the input the case is FROM, not
//     re-derived here (that parse already exists on the accubid import path).
router.post('/:bidId/finish-bid', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const { rows: trRows } = await pool.query('SELECT count_result, review_items, run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const countResult = trRows[0]?.count_result as CountResult | null;
  if (!countResult) return res.status(400).json({ error: 'No takeoff analysis on this bid yet — run the analysis first.' });
  const reviewItems = (trRows[0]?.review_items as ReviewItem[] | null) ?? [];
  const runId = (trRows[0]?.run_id as string | null) ?? null;
  const { rows: bidRows } = await pool.query('SELECT brand, project_type FROM bids WHERE id=$1', [bidId]);
  const bomImportDocumentId = typeof req.body?.bomImportDocumentId === 'string' ? req.body.bomImportDocumentId : null;

  const expected = deriveExpectedFromConfirmedCounts(countResult, reviewItems);
  if (!expected.length) {
    return res.status(400).json({ error: 'No confirmed counts to build an eval case from yet — resolve the takeoff review first.' });
  }
  const loaded = await composeCurrentBidData(bidId, { validate: false, persist: false }).catch(() => null);
  const inputsHash = loaded && loaded.ok ? loaded.inputsHash : null;
  const { rows } = await pool.query(
    `INSERT INTO takeoff_eval_cases (bid_id, run_id, client, project_type, source, expected, inputs_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [
      bidId, runId, bidRows[0]?.brand ?? null, bidRows[0]?.project_type ?? null,
      bomImportDocumentId ? 'bom_import' : 'confirmed_counts', JSON.stringify(expected),
      JSON.stringify({ runId, inputsHash, ...(bomImportDocumentId ? { bomImportDocumentId } : {}) }), req.user!.name,
    ]
  );
  res.json({ id: rows[0].id, createdAt: rows[0].created_at, itemCount: expected.length, expected });
}));

// Fix round 1 / B2 — the estimator enters the fixture types (when the
// analysis found no schedule or legend); the next analysis run counts them.
// body: {types: [{type, description, location?: interior|exterior_building|site, wattage?}]}
router.put('/:bidId/count-types', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const raw = Array.isArray(req.body?.types) ? req.body.types as unknown[] : null;
  if (!raw) return res.status(400).json({ error: 'types must be an array' });
  const types: Array<Record<string, unknown>> = [];
  for (const t of raw) {
    const r = (t ?? {}) as Record<string, unknown>;
    const type = String(r.type ?? '').trim().slice(0, 20);
    const description = String(r.description ?? '').trim().slice(0, 200);
    const location = ['interior', 'exterior_building', 'site'].includes(String(r.location)) ? String(r.location) : 'interior';
    const wattage = Number(r.wattage);
    if (!type || !description) return res.status(400).json({ error: 'Each type needs a tag (e.g. "A") and a description.' });
    types.push({ type, description, location, ...(Number.isFinite(wattage) && wattage > 0 ? { wattage } : {}) });
  }
  const { rowCount } = await pool.query('UPDATE takeoff_results SET manual_count_targets=$2 WHERE bid_id=$1', [bidId, JSON.stringify(types)]);
  if (!rowCount) return res.status(404).json({ error: 'Run the AI analysis first.' });
  res.json({ types, note: 'Saved. Re-run the analysis — these types are counted on the plan sheets like schedule rows.' });
}));

// Task 12 — compose (or re-compose) the pre-bid draft on demand.
router.post('/:bidId/compose-draft', requireAuth, requireAIPermission('run_analysis'), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });
  const { rows } = await pool.query('SELECT agent2_output, draft_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
  if (!rows[0]?.agent2_output) return res.status(400).json({ error: 'Run the AI analysis first.' });
  if (rows[0].draft_status === 'running') return res.json({ status: 'running' });
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI.' });
  await startDraftInBackground(bidId, { id: req.user!.id, name: req.user!.name });
  res.json({ status: 'running' });
}));

// ── Takeoff accuracy Task 11: the estimator's scope list ────────────────────
router.get('/:bidId/scope-items', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  res.json(await getBidScopeList(req.params.bidId));
}));

router.post('/:bidId/scope-items', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const kind = req.body?.kind;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (kind !== 'include' && kind !== 'exclude') return res.status(400).json({ error: 'kind must be include or exclude' });
  if (text.length < 2 || text.length > 300) return res.status(400).json({ error: 'Describe the item (2-300 characters).' });
  await pool.query('INSERT INTO bid_scope_items (bid_id, kind, text, created_by) VALUES ($1,$2,$3,$4)', [bidId, kind, text, req.user!.name]);
  res.json(await getBidScopeList(bidId));
}));

// Keep a line the non-electrical gate flagged: {category, line, reason}.
router.post('/:bidId/non-electrical-overrides', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const category = typeof req.body?.category === 'string' ? req.body.category : '';
  const line = typeof req.body?.line === 'string' ? req.body.line.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  // S-R2-5 — bound to this exact line AND this flag.
  const flag = typeof req.body?.flag === 'string' ? req.body.flag : 'non_electrical';
  if (!/^(non_electrical|excluded_scope|spec|gc_scope|(count_line|dup_keep|dup_remove):[A-Z0-9 .:-]{1,40})$/.test(flag)) return res.status(400).json({ error: 'unknown flag' });
  if (!category || !line) return res.status(400).json({ error: 'category and line required' });
  // Fix round 1 — one override mechanism for every "keep this" decision: a
  // non-electrical line (S9), a line on the Not-included list (N7), or an
  // other-region spec sentence (S10, category 'spec'). A real reason (N6).
  if (!isRealReason(reason)) return res.status(400).json({ error: 'Say why this belongs on this job (at least 10 characters).' });
  await pool.query(
    `INSERT INTO bid_scope_items (bid_id, kind, text, line_key, reason, created_by, flag_code) VALUES ($1,'override_non_electrical',$2,$3,$4,$5,$6)`,
    [bidId, line, normalizeLineKey(category, line), reason, req.user!.name, flag]
  );
  res.json(await getBidScopeList(bidId));
}));

router.delete('/:bidId/scope-items/:itemId', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { bidId, itemId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM bid_scope_items WHERE id=$1 AND bid_id=$2', [itemId, bidId]);
  res.json(await getBidScopeList(bidId));
}));

// GET results for a bid
router.get('/:bidId/results', requireAuth, requireAIPermission('view_results'), async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const { rows } = await pool.query(
    'SELECT * FROM takeoff_results WHERE bid_id=$1',
    [req.params.bidId]
  );
  if (!rows[0]) return res.json(null);
  // Fix round 1 / S12 — tell the UI when the pre-bid draft no longer matches
  // its scope inputs (or came from an earlier analysis run) so it offers
  // "Compose again"; generate-prebid-package refuses a stale draft.
  const r = rows[0];
  const draftStale = r.draft_status === 'complete' && !!r.draft_output
    && ((r.run_id && r.draft_run_id !== r.run_id) || (r.draft_inputs_hash && r.draft_inputs_hash !== await scopeInputsHash(req.params.bidId)));
  res.json({ ...r, draft_stale: !!draftStale });
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
/** One analysis input left out, and why (logged with every run). */
export interface AnalysisInputExclusion {
  name: string;
  documentId?: string;
  reason: 'crm_generated' | 'duplicate';
  detail: string;
}

/** The bid's files that go to the analysis for one /analyze call.
 *
 *  Live AutoZone re-run (2026-09-23): Agent 1 was sent the previous run's
 *  "Proposal - AutoZone - 2026-09-23.pdf" as a drawing, and the plan set and
 *  spec book twice each (once uploaded in this session, once selected from
 *  Project Files) — 28 Opus batches of ~88k input tokens instead of ~14.
 *
 *  - A document the CRM generated (documents.generated — never inferred
 *    from its category) is never an input. An upload
 *    whose bytes (sha256, else name + size) match one of this bid's
 *    generated documents is dropped too.
 *  - A document id selected twice is sent once; two inputs with the same
 *    bytes (sha256) are sent once, the document-backed copy winning (its id
 *    places the counting stage's markers on the Plans view).
 *  Every exclusion is logged with its reason. */
export async function gatherAnalysisInputs(
  bidId: string, rawUploads: Express.Multer.File[], docIds: string[],
): Promise<{ files: Express.Multer.File[]; excluded: AnalysisInputExclusion[] }> {
  const excluded: AnalysisInputExclusion[] = [];

  // Expand any zip archives into their constituent PDF/image files
  const uploads: Express.Multer.File[] = [];
  for (const f of rawUploads) {
    if (f.originalname.toLowerCase().endsWith('.zip')) {
      try {
        const zip = new AdmZip(f.buffer);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const n = entry.name.toLowerCase();
          if (!n.endsWith('.pdf') && !n.endsWith('.jpg') && !n.endsWith('.jpeg') && !n.endsWith('.png')) continue;
          uploads.push({
            ...f,
            originalname: entry.name,
            buffer: entry.getData(),
            size: entry.header.size,
            mimetype: n.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          });
        }
      } catch { /* corrupt or unreadable zip — skip */ }
    } else {
      uploads.push(f);
    }
  }

  const fromDocs: Express.Multer.File[] = [];
  const seenDocIds = new Set<string>();
  for (const docId of docIds) {
    if (seenDocIds.has(docId)) {
      excluded.push({ name: docId, documentId: docId, reason: 'duplicate', detail: 'the same document was selected twice' });
      continue;
    }
    seenDocIds.add(docId);
    try {
      const { rows: docRows } = await pool.query(
        'SELECT name, file_type, file_data, storage_url, category, generated FROM documents WHERE id=$1 AND deleted_at IS NULL',
        [docId]
      );
      const doc = docRows[0];
      if (!doc) continue;

      const fname = doc.name as string;
      // Fix round S1 — by the generated flag only: a person can file a real
      // drawing under Proposal / Takeoff / Pre-Bid, and it must still go.
      if (doc.generated) {
        excluded.push({ name: fname, documentId: docId, reason: 'crm_generated', detail: `a CRM-generated ${doc.category} document, not a drawing` });
        continue;
      }
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
      fromDocs.push({
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

  // An upload that IS one of this bid's generated documents (e.g. a
  // downloaded proposal PDF dropped back in) is not a drawing either.
  const { rows: generatedDocs } = await pool.query(
    `SELECT name, display_name, file_size, content_sha256 FROM documents
      WHERE linked_id = $1::text AND deleted_at IS NULL AND generated = true`,
    [bidId]
  );
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const keptUploads: Express.Multer.File[] = [];
  for (const f of uploads) {
    const h = sha(f.buffer);
    const match = generatedDocs.find(g => g.content_sha256
      ? g.content_sha256 === h
      : Number(g.file_size) === f.buffer.length && [g.name, g.display_name].includes(f.originalname));
    if (match) {
      excluded.push({ name: f.originalname, reason: 'crm_generated', detail: `matches the CRM-generated document "${match.display_name || match.name}"` });
      continue;
    }
    keptUploads.push(f);
  }

  // Same bytes twice (the upload from this session AND its Project Files
  // copy, or one file filed twice): send it once.
  const files: Express.Multer.File[] = [];
  const byHash = new Map<string, string>();
  for (const f of [...fromDocs, ...keptUploads]) {
    const h = sha(f.buffer);
    const first = byHash.get(h);
    if (first !== undefined) {
      excluded.push({
        name: f.originalname, documentId: (f as PipelineFile).documentId, reason: 'duplicate',
        detail: `same content as "${first}"`,
      });
      continue;
    }
    byHash.set(h, f.originalname);
    files.push(f);
  }
  // Fix round N5 — two different files with one name (a set and its
  // addendum, both "Electrical.pdf") get distinct names, so nothing
  // downstream that keys by name (page texts, tiles, the counter's PDFs,
  // the inventory) can mix them.
  const used = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!used.has(f.originalname)) { used.add(f.originalname); continue; }
    const dot = f.originalname.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [f.originalname.slice(0, dot), f.originalname.slice(dot)] : [f.originalname, ''];
    let n = 2;
    while (used.has(`${stem} (${n})${ext}`)) n++;
    const name = `${stem} (${n})${ext}`;
    used.add(name);
    files[i] = Object.assign(Object.create(Object.getPrototypeOf(f)), f, { originalname: name });
  }

  logger.info({
    bidId,
    sent: files.map(f => f.originalname),
    excluded,
  }, '[takeoff] analysis inputs — CRM-generated documents and duplicates excluded');
  return { files, excluded };
}

/** Re-run defaults — the document ids behind an analysis' input files. A
 *  file that came from a document keeps its id; an upload maps to this bid's
 *  non-generated document with the same bytes (the Files panel files every
 *  upload), else it is left out. Order-preserving, no duplicates. */
export async function inputDocumentIds(bidId: string, files: Express.Multer.File[]): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id, content_sha256 FROM documents
      WHERE linked_id = $1::text AND deleted_at IS NULL AND generated = false AND content_sha256 IS NOT NULL
      ORDER BY created_at DESC`,
    [bidId]
  );
  const byHash = new Map<string, string>();
  for (const r of rows) if (!byHash.has(r.content_sha256 as string)) byHash.set(r.content_sha256 as string, r.id as string);
  const ids: string[] = [];
  for (const f of files) {
    const id = (f as PipelineFile).documentId
      ?? byHash.get(crypto.createHash('sha256').update(f.buffer).digest('hex'));
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

router.post('/analyze', requireAuth, requireAIPermission('run_analysis'), upload.array('files', 50), asyncHandler(async (req: AuthRequest, res) => {
  const bidId = req.body.bidId;
  if (!bidId) return res.status(400).json({ error: 'bidId required' });

  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const rawFiles = (req.files as Express.Multer.File[]) ?? [];
  // Also pull in any documents already attached to this bid
  const rawDocIds = req.body.document_ids;
  const docIds: string[] = Array.isArray(rawDocIds)
    ? (rawDocIds as string[]).filter(Boolean)
    : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];
  // Re-run reset follow-up — never the CRM's own outputs, never a file twice.
  const { files, excluded: excludedInputs } = await gatherAnalysisInputs(bidId, rawFiles, docIds);

  if (!files.length) {
    const why = excludedInputs.some(e => e.reason === 'crm_generated')
      ? ' CRM-generated proposals, takeoffs and pre-bid packages are never analysis inputs.' : '';
    return res.status(400).json({ error: `Upload at least one plan file, or select files from Project Files, before running AI analysis.${why}` });
  }

  // Prefer the key configured in Settings -> AI; fall back to the env var.
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' });
  }
  const aiConfig = await loadAIConfig();

  // Mark as running
  // Fix round S2 — the previous run's in-flight AI work (analysis, counter,
  // draft, Agent 4) is aborted FIRST, through the same mechanism as Stop, so
  // it stops billing. Its writes are refused anyway (run-id guards).
  abortRuns(bidId, ['analysis', 'draft', 'agent4'], undefined, 'Superseded by a new analysis run');

  // A new run (fix round 1 / B5 + the re-run reset): everything the previous
  // run produced is cleared in the same transaction that mints the run id —
  // including the review items AND the estimator's answers to them (Jake: a
  // clean slate; nothing carries over) — and the review is 'pending' (every
  // GC document and send blocked) until the counting stage writes this
  // run's review. The estimator's own work is kept (services/rerunReset.ts).
  let started: Awaited<ReturnType<typeof beginAnalysisRun>>;
  try {
    started = await beginAnalysisRun(bidId);
  } catch (err) {
    // The old run was aborted above; don't leave it looking alive.
    await pool.query(
      `UPDATE takeoff_results SET status='cancelled', raw_response='Stopped: a new analysis could not start' WHERE bid_id=$1 AND status = ANY($2::text[])`,
      [bidId, ANALYSIS_RUNNING_STATUSES]
    ).catch(() => {});
    throw err;
  }
  const { runId: analysisRunId, reset } = started;
  // Re-run defaults to the last run's inputs: remember which documents this
  // run read (an upload counts as its filed copy, matched by content hash).
  await pool.query('UPDATE takeoff_results SET input_document_ids=$2 WHERE bid_id=$1 AND run_id=$3',
    [bidId, await inputDocumentIds(bidId, files), analysisRunId]).catch(err => logger.warn({ err, bidId }, '[takeoff] could not record input documents'));

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
    runId: analysisRunId,
    excludedInputs,
    // Re-run reset — what was cleared / kept, and the workspace RFIs after
    // it (the client installs these so its autosave can't restore the
    // cleared ones).
    reset,
  });

  const client = new Anthropic({ apiKey });
  logger.info({ bidId, model: aiConfig.model, modelA2: aiConfig.modelA2, modelA3: aiConfig.modelA3 }, 'AI takeoff pipeline started');
  runPipeline(bidId, files, client, aiConfig).catch(async err => {
    const message = `Pipeline failed: ${describeAIError(err)}`;
    logger.error({ err, bidId }, 'Takeoff pipeline failed');
    await pool.query(
      `UPDATE takeoff_results SET status='error', raw_response=$1 WHERE bid_id=$2 AND run_id = $3 AND status IS DISTINCT FROM 'cancelled'`,
      [message, bidId, analysisRunId]
    ).catch(dbErr => logger.error({ err: dbErr, bidId }, 'Could not persist takeoff pipeline failure'));
  });
}));

/** Stop analysis — the statuses of an analysis that is still running. */
export const ANALYSIS_RUNNING_STATUSES = ['running', 'agent1_complete', 'counting', 'agent2_running', 'agent2_complete', 'agent3_running'];

// POST stop-analysis — stops whatever AI job is running for the bid: the
// analysis pipeline, an Agent 4 proposal run and/or a pre-bid draft. The run
// keeps its run id and is marked 'cancelled' ("Stopped by <user>"); the
// in-flight model calls are aborted (billing stops at tokens already
// produced) and the run-id / status guards mean nothing it does afterwards is
// written. `what`: 'analysis' | 'agent4' | 'draft' | 'all' (default).
router.post('/:bidId/stop-analysis', requireAuth, requireAIPermission('run_analysis'), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const what = String(req.body?.what ?? 'all');
  if (!['analysis', 'agent4', 'draft', 'all'].includes(what)) return res.status(400).json({ error: 'what must be analysis, agent4, draft or all' });
  const message = `Stopped by ${req.user?.name ?? 'the estimator'}`;
  const want = (k: string) => what === 'all' || what === k;

  // Fix round S3 — phase- and run-specific: only a job that is actually
  // running is cancelled, and only THAT run's in-flight calls are aborted.
  // A stop that arrives after the job finished is a no-op ("already
  // finished"): it never kills the draft that follows a finished analysis,
  // nor the finished run's scope / auto-fill / Drive writes.
  const stopped = { analysis: false, agent4: false, draft: false };
  let aborted = 0;
  if (want('analysis')) {
    const r = await pool.query(
      `UPDATE takeoff_results SET status='cancelled', raw_response=$2, cancelled_at=now(), cancelled_by=$3, progress=NULL
        WHERE bid_id=$1 AND status = ANY($4::text[]) RETURNING run_id`,
      [bidId, message, req.user?.name ?? null, ANALYSIS_RUNNING_STATUSES]
    );
    if (r.rowCount) { stopped.analysis = true; aborted += abortRuns(bidId, ['analysis'], r.rows[0].run_id ?? null, message); }
  }
  if (want('agent4')) {
    const r = await pool.query(
      `UPDATE takeoff_results SET agent4_status='cancelled', agent4_error=$2 WHERE bid_id=$1 AND agent4_status='running' RETURNING run_id`, [bidId, message]
    );
    if (r.rowCount) { stopped.agent4 = true; aborted += abortRuns(bidId, ['agent4'], r.rows[0].run_id ?? null, message); }
  }
  if (want('draft')) {
    const r = await pool.query(
      `UPDATE takeoff_results SET draft_status='cancelled', draft_error=$2 WHERE bid_id=$1 AND draft_status='running' RETURNING run_id`, [bidId, message]
    );
    if (r.rowCount) { stopped.draft = true; aborted += abortRuns(bidId, ['draft'], r.rows[0].run_id ?? null, message); }
  }
  if (stopped.analysis || stopped.agent4 || stopped.draft) {
    await pool.query(
      `INSERT INTO activity (kind, div, text, user_id) VALUES ('ai_analysis','preconstruction',$1,$2)`,
      [`AI run stopped (${Object.entries(stopped).filter(([, v]) => v).map(([k]) => k).join(', ')}) by ${req.user?.name}`, req.user?.id]
    ).catch(() => {});
  }
  logger.info({ bidId, stopped, aborted, by: req.user?.name }, '[takeoff] stop-analysis');
  if (!stopped.analysis && !stopped.agent4 && !stopped.draft) {
    const label = what === 'analysis' ? 'The analysis has' : what === 'agent4' ? 'The proposal run has' : what === 'draft' ? 'The pre-bid draft has' : 'Everything has';
    return res.status(409).json({ error: `${label} already finished — nothing to stop.`, alreadyFinished: true, stopped, aborted });
  }
  res.json({ stopped, aborted, message });
}));

// POST run-agent4 — kicks off Proposal Formatter in background, returns immediately
// Frontend polls GET /:bidId/results and watches agent4_status for completion.
// Next round A4 — the supplement pass. A sheet the drawings reference turned
// up after the run (a "Referenced sheet X not in analysis" review item, or
// one skipped in the sheet check): upload it here and it is analysed by
// Agent 1 on just its pages, merged into THIS run (same run id), counted
// only for what it can change, and Agents 2-3 run again. The GC documents
// stay blocked meanwhile (review 'pending'); the run's Agent 4 / draft
// output stop being current. If the pass fails, the run is put back exactly
// as it was and the failure is recorded (takeoff_results.supplement).
router.post('/:bidId/supplement', requireAuth, requireAIPermission('run_analysis'), upload.array('files', 50), asyncHandler(async (req: AuthRequest, res) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  const rawDocIds = req.body.document_ids;
  const docIds: string[] = Array.isArray(rawDocIds) ? (rawDocIds as string[]).filter(Boolean)
    : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];
  const { files: incoming } = await gatherAnalysisInputs(bidId, (req.files as Express.Multer.File[]) ?? [], docIds);
  if (!incoming.length) return res.status(400).json({ error: 'Upload the referenced sheet (PDF) to add it to this analysis.' });
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI.' });
  const config = await loadAIConfig();
  const client = new Anthropic({ apiKey });

  // Fix round S5 — every rejection happens BEFORE the claim: a rejected
  // upload never touches the run (nor its Agent 4 proposal / draft).
  const { rows: pre } = await pool.query('SELECT run_id, status, input_document_ids, prep_inventory FROM takeoff_results WHERE bid_id=$1', [bidId]);
  if (!pre[0]?.run_id || pre[0].status !== 'complete') {
    return res.status(409).json({ error: 'A sheet can be added once the analysis has finished (and while no other run is going).' });
  }
  const oldIds = (pre[0].input_document_ids as string[] | null) ?? [];
  const { files: oldFiles } = oldIds.length ? await gatherAnalysisInputs(bidId, [], oldIds) : { files: [] as Express.Multer.File[] };
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const oldHashes = new Set(oldFiles.map(f => sha(f.buffer)));
  const newFiles = incoming.filter(f => !oldHashes.has(sha(f.buffer)));
  if (!newFiles.length) return res.status(400).json({ error: 'Those files are already part of this analysis.' });

  // Fix round S3 — page by page: a page identical to one already in the run
  // is skipped; a page whose sheet number is already in the run but whose
  // content differs is a REVISION, which needs a full re-run (a supplement
  // would count the old and the new sheet both).
  const priorInventory = (pre[0].prep_inventory as PrepInventoryEntry[] | null) ?? [];
  const oldPageHashes = new Set<string>();
  for (const f of oldFiles) {
    if ((f.originalname.split('.').pop() || '').toLowerCase() !== 'pdf') continue;
    try { for (const t of await extractPdfPageTexts(f.buffer)) { const h = pageContentHash(t); if (h) oldPageHashes.add(h); } } catch { /* no text layer */ }
  }
  let built: Awaited<ReturnType<typeof buildInventory>>;
  try {
    built = await buildInventory(newFiles.map(f => ({ originalname: f.originalname, buffer: f.buffer })), { client, classifierModel: config.modelClassifier, visionModel: '', aiRefs: false });
  } catch (err) {
    return res.status(502).json({ error: `The added sheets could not be read: ${describeAIError(err)}` });
  }
  const priorNos = new Set(priorInventory.map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));
  const skipPageKeys: string[] = [];
  const revised: string[] = [];
  for (const p of built.pages) {
    const h = pageContentHash(built.pageTexts.get(p.sha)?.[p.page - 1]);
    if (h && oldPageHashes.has(h)) { skipPageKeys.push(p.key); continue; }
    const no = normalizeSheetId(p.sheetNo);
    if (no && priorNos.has(no)) revised.push(p.sheetNo);
  }
  if (revised.length) {
    return res.status(409).json({
      error: `This upload has new versions of sheets already in the analysis (${[...new Set(revised)].slice(0, 8).join(', ')}). A revised set needs a full re-run of the analysis, not a supplement — adding them would count the old and the new sheets both.`,
      fullRerun: true, revisedSheets: [...new Set(revised)],
    });
  }
  if (built.pages.length && skipPageKeys.length === built.pages.length && !built.unclassifiedFiles.length) {
    return res.status(400).json({ error: 'Every page of those files is already part of this analysis.' });
  }
  const checkRow = await loadSheetCheck(bidId);
  const contextPages: CheckedPage[] = checkRow?.result?.pages?.length
    ? checkRow.result.pages
    : priorInventory.map(p => ({
      key: `${p.file}#${p.page}`, file: p.file, sha: `prior:${p.file}`, page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline,
      cls: p.cls as CheckedPage['cls'], textChars: p.textChars, hasTextLayer: p.textChars >= 50, classified: p.classified, refs: [], role: 'excluded' as const, reason: '',
    }));

  // Claim: only a finished run takes a supplement (one at a time).
  const tx = await pool.connect();
  let snap: Record<string, unknown>;
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query(
      `SELECT run_id, status, agent1_output, count_result, prep_inventory, review_items, review_status,
              usage_agent1, usage_agent2, usage_agent3, usage_counter, model_agent1, model_agent2, model_agent3, model_counter,
              input_document_ids, agent2_output, agent3_output, hygiene, account_terms, agent4_run_id, draft_run_id
         FROM takeoff_results WHERE bid_id=$1 FOR UPDATE`, [bidId]);
    const tr = rows[0];
    if (!tr?.run_id || tr.status !== 'complete' || tr.run_id !== pre[0].run_id) {
      await tx.query('ROLLBACK');
      return res.status(409).json({ error: 'A sheet can be added once the analysis has finished (and while no other run is going).' });
    }
    snap = tr;
    await tx.query(
      `UPDATE takeoff_results SET status='running', review_status='pending', agent4_run_id=NULL, draft_run_id=NULL,
         progress=$2, supplement=$3 WHERE bid_id=$1`,
      [bidId, JSON.stringify({ stage: 'prep', label: 'Adding the referenced sheet to the analysis', step: null, of: null, at: new Date().toISOString() }),
       JSON.stringify({ status: 'running', files: newFiles.map(f => f.originalname), by: req.user?.name ?? null, at: new Date().toISOString() })]);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }

  // Fix round S5 / B2 — exactly as it was: outputs, usage, models, the
  // Agent 4 / draft run ids, and the Plans-view markers this pass changed.
  const restore = async (message: string) => {
    const { rows: cur } = await pool.query('SELECT run_id, supplement FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (cur[0]?.run_id !== snap.run_id) return; // a newer run took over: nothing to restore
    await revertAiMarkerWrite(bidId, (cur[0]?.supplement as { markers?: { replacedIds?: string[]; writtenIds?: string[] } } | null)?.markers).catch(err => logger.warn({ err, bidId }, '[takeoff] supplement: markers not reverted'));
    const j = (v: unknown) => JSON.stringify(v ?? null);
    await pool.query(
      `UPDATE takeoff_results SET status='complete', agent1_output=$2, count_result=$3, prep_inventory=$4, review_items=$5,
         review_status=$6, usage_agent1=$7, agent2_output=$8, agent3_output=$9, hygiene=$10, account_terms=$11,
         supplement=$12, progress=NULL, usage_agent2=$14, usage_agent3=$15, usage_counter=$16,
         model_agent1=$17, model_agent2=$18, model_agent3=$19, model_counter=$20, agent4_run_id=$21, draft_run_id=$22
       WHERE bid_id=$1 AND run_id=$13`,
      [bidId, snap.agent1_output, j(snap.count_result), j(snap.prep_inventory), j(snap.review_items), snap.review_status, j(snap.usage_agent1),
       snap.agent2_output, snap.agent3_output, j(snap.hygiene), j(snap.account_terms),
       JSON.stringify({ status: 'error', error: message, files: newFiles.map(f => f.originalname), at: new Date().toISOString() }), snap.run_id,
       j(snap.usage_agent2), j(snap.usage_agent3), j(snap.usage_counter),
       snap.model_agent1, snap.model_agent2, snap.model_agent3, snap.model_counter, snap.agent4_run_id, snap.draft_run_id]);
  };
  res.json({ status: 'running', supplement: true, files: newFiles.map(f => f.originalname), skippedPages: skipPageKeys.length });

  const supplement: SupplementContext = {
    priorAgent1: parseAIJSON(String(snap.agent1_output ?? '')) ?? {},
    priorCount: (snap.count_result as CountResult | null) ?? null,
    priorInventory: (snap.prep_inventory as PrepInventoryEntry[] | null) ?? [],
    priorUsage: (snap.usage_agent1 as Record<string, unknown> | null) ?? {},
    oldFiles,
    plan: { contextPages, skipPageKeys },
  };
  const runId = snap.run_id as string;
  runPipeline(bidId, newFiles, client, config, { supplement }).then(async () => {
    const { rows } = await pool.query('SELECT status, run_id, agent1_output, raw_response, prep_inventory FROM takeoff_results WHERE bid_id=$1', [bidId]);
    if (rows[0]?.run_id !== runId) return;
    if (rows[0]?.status === 'cancelled') { await restore('Stopped — the run is as it was before the sheet was added.'); return; }
    if (rows[0]?.status === 'error') {
      await restore(`The added sheet could not be analysed: ${String(rows[0].agent1_output ?? rows[0].raw_response ?? '').slice(0, 300)}`);
      return;
    }
    // The run now reads the new documents too (a re-run pre-ticks them).
    const ids = [...new Set([...oldIds, ...(await inputDocumentIds(bidId, newFiles))])];
    await pool.query(`UPDATE takeoff_results SET input_document_ids=$2, supplement=$3 WHERE bid_id=$1 AND run_id=$4`,
      [bidId, ids, JSON.stringify({ status: 'complete', files: newFiles.map(f => f.originalname), by: req.user?.name ?? null, at: new Date().toISOString() }), runId]);
    // Fix round S7 — references the added sheets satisfy are present now;
    // their "not provided" skips go.
    const newNames = new Set(newFiles.map(f => f.originalname));
    const added = ((rows[0]?.prep_inventory as PrepInventoryEntry[] | null) ?? []).filter(p => newNames.has(p.file))
      .map(p => ({ key: `${p.file}#${p.page}`, file: p.file, page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline }));
    await resolveRefsAfterSupplement(bidId, added).catch(err => logger.warn({ err, bidId }, '[takeoff] supplement: sheet-check references not updated'));
  }).catch(async err => {
    logger.error({ err, bidId }, '[takeoff] supplement pass failed');
    await restore(`The added sheet could not be analysed: ${describeAIError(err)}`).catch(() => {});
  });
}));

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
  // Fix round 2 / B5 — a budget-pending vendor quote blocks the paid Agent 4
  // proposal-price run too (it would otherwise price the GC proposal off a
  // number CES/the vendor hasn't confirmed).
  const budgetGate = await budgetPendingGate(bidId);
  if (budgetGate) return res.status(409).json({ error: budgetGate.error });
  // Evidence round 4.1 — every GC-facing quantity needs evidence (or, for a
  // manual/hand-typed line, a reason). Never applied to the pre-bid package.
  const evGate = await evidenceGate(bidId);
  if (evGate) return res.status(409).json({ error: evGate.error, reviewItems: evGate.openItems });

  const { rows: trRows } = await pool.query(
    'SELECT agent1_output, agent2_output, review_items, account_terms, run_id FROM takeoff_results WHERE bid_id=$1',
    [bidId]
  );
  if (!trRows.length || !trRows[0].agent2_output) {
    return res.status(400).json({ error: 'No scope data found. Run the 3-agent analysis first.' });
  }
  // B5 — Agent 4's output belongs to this run; it is written only if no new
  // analysis started meanwhile.
  const runId = (trRows[0].run_id as string | null) ?? null;

  // Takeoff accuracy Task 12 — the proposal reuses the pre-bid draft when the
  // scope inputs haven't changed since it was composed and there are no new
  // notes: the price goes in, no model call. Otherwise Agent 4 re-composes.
  const { rows: draftRows } = await pool.query('SELECT draft_output, draft_status, draft_inputs_hash, draft_model, draft_run_id FROM takeoff_results WHERE bid_id=$1', [bidId]);
  const draft = draftRows[0];
  if (draft?.draft_status === 'complete' && draft.draft_output && !internalNotes?.trim()
      && (draft.draft_run_id ?? null) === runId
      && draft.draft_inputs_hash === await scopeInputsHash(bidId)) {
    await pool.query(
      `UPDATE takeoff_results SET agent4_output=$2, agent4_price=$3, agent4_notes=NULL, agent4_model=$4, usage_agent4=NULL,
         agent4_status='complete', agent4_error=NULL, agent4_source='draft', agent4_run_id=run_id
        WHERE bid_id=$1 AND run_id IS NOT DISTINCT FROM $5`,
      [bidId, draft.draft_output, parsedPrice, draft.draft_model, runId]
    );
    await pool.query('UPDATE bids SET amount=$1 WHERE id=$2 AND deleted_at IS NULL', [parsedPrice, bidId]);
    return res.json({ status: 'complete', reusedDraft: true });
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

  // Stop analysis — Agent 4 can be stopped (agent4_status 'cancelled'); its
  // call carries this job's abort signal and no write lands after a stop.
  // Fix round N4 — registered BEFORE 'running' is visible, so a stop that
  // lands right after the response always reaches the call.
  const agent4Handle = registerRun(bidId, 'agent4', runId);
  const a4Client = abortableClient(client, agent4Handle.signal);
  let userMsg: string;
  try {
  // Mark as running and respond immediately — don't wait for AI
  await pool.query(
    `UPDATE takeoff_results SET agent4_status='running', agent4_error=NULL, agent4_output=NULL WHERE bid_id=$1 AND run_id IS NOT DISTINCT FROM $2`,
    [bidId, runId]
  );
  res.json({ status: 'running' });

  // Run AI call in background
  userMsg = buildAgent4UserMessage({
    price,
    internalNotes,
    agent1Output,
    agent2Output,
    workspaceScope,
    savedEstimate,
    reviewResolutions: reviewResolutionsForAgent4(trRows[0].review_items as ReviewItem[] | null),
    accountTerms: await accountTermsBlockFor(bidId, trRows[0].account_terms as AccountTermsSnapshot | null, trRows[0].review_items as ReviewItem[] | null, agent1Output),
    scopeList: renderScopeListBlock((await getBidScopeList(bidId)).items),
  });
  } catch (err) {
    agent4Handle.release();
    throw err;
  }

  (async () => {
    try {
      // Fix round N4 — a stop that landed while the message was being built.
      const { rows: live } = await pool.query('SELECT agent4_status FROM takeoff_results WHERE bid_id=$1', [bidId]);
      if (agent4Handle.signal.aborted || live[0]?.agent4_status === 'cancelled') throw new RunCancelledError();
      const resp = await callWithRetry(() => a4Client.messages.stream({
        model: config.modelA4,
        max_tokens: config.maxTokensA4,
          system: [{ type: 'text', text: config.promptA4 || AGENT4_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }).finalMessage(), { signal: runSignalOf(a4Client), onRetry: (a, _e, d) => logger.warn(`[agent4] retry ${a} in ${d}ms`) });

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
          `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2 AND run_id IS NOT DISTINCT FROM $3 AND agent4_status IS DISTINCT FROM 'cancelled'`,
          [`AI response could not be parsed as valid JSON (stop_reason: ${resp.stop_reason ?? 'unknown'}, ${outTokens ?? '?'} of ${config.maxTokensA4} output tokens, ${rawText.length} characters). Try re-running Agent 4. End of the response: …${tail.replace(/\s+/g, ' ').slice(-200)}`, bidId, runId]
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
          `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2 AND run_id IS NOT DISTINCT FROM $3 AND agent4_status IS DISTINCT FROM 'cancelled'`,
          ['AI response was valid JSON but missing the expected sections/takeoff arrays. Try re-running Agent 4.', bidId, runId]
        );
        return;
      }
      const written = await pool.query(
        `UPDATE takeoff_results SET
          agent4_output=$1, agent4_price=$2, agent4_notes=$3,
          agent4_model=$4, usage_agent4=$5,
          agent4_status='complete', agent4_error=NULL, agent4_source='model', agent4_run_id=run_id
        WHERE bid_id=$6 AND run_id IS NOT DISTINCT FROM $7 AND agent4_status IS DISTINCT FROM 'cancelled'`,
        [JSON.stringify(parsed), parsedPrice, internalNotes?.trim() || null, config.modelA4, JSON.stringify(resp.usage), bidId, runId]
      );
      // The proposal price is the later, more authoritative number — sync it into
      // the pipeline the same way the estimate save already does. Re-run
      // reset — only when this run is still current: an Agent 4 from a run
      // that a re-run superseded must not write the price the reset cleared.
      if (written.rowCount) {
        await pool.query(
          'UPDATE bids SET amount=$1 WHERE id=$2 AND deleted_at IS NULL',
          [parsedPrice, bidId]
        );
      }
      logger.info({ bidId }, '[agent4] Proposal generated successfully');
    } catch (err) {
      if (isCancellationError(err) || agent4Handle.signal.aborted) {
        logger.info({ bidId }, '[agent4] stopped — nothing written');
        return;
      }
      logger.error({ err, bidId }, '[agent4] Background run failed');
      const message = err instanceof Error ? err.message : 'Unknown error during proposal generation';
      await pool.query(
        `UPDATE takeoff_results SET agent4_status='error', agent4_error=$1 WHERE bid_id=$2 AND run_id IS NOT DISTINCT FROM $3 AND agent4_status IS DISTINCT FROM 'cancelled'`,
        [message, bidId, runId]
      );
    } finally {
      agent4Handle.release();
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
  | { ok: true; bidData: BidData; bidName: string; asciiName: string; ambiguousQtyKeys: string[];
      /** Takeoff accuracy Task 8 — every deterministic change the account
       *  terms made to Agent 4's output (shown in the preview). */
      accountCorrections: string[];
      /** verifyBid options from the account terms (forbidden phrases, ECFECI
       *  checks sized to what APT furnishes). */
      verifyOptions: VerifyOptions;
      /** Takeoff accuracy Task 9 — GC-facing problems to show before
       *  generating: zero-quantity lines, other-region spec text. */
      hygieneWarnings: string[];
      /** Fix round 1 / B5 — the analysis run this was composed from (NULL for
       *  a bid from before run ids); filed documents carry it. */
      runId: string | null;
      /** Fix round 2 / R2-B1 — sha256 of every input this was composed from;
       *  each filed document carries it, and a send refuses a file whose
       *  inputs have changed since. */
      inputsHash: string }
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
  /** Takeoff accuracy Task 12 — 'draft' composes from the pre-bid draft
   *  (no price; the pre-bid package), falling back to agent4_output for a bid
   *  that predates drafts. Default 'final' (the GC proposal). */
  source?: 'final' | 'draft';
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
    `SELECT agent4_output, agent4_price, agent1_output, account_terms, review_items, draft_output, draft_status, count_result,
            run_id, agent4_run_id, draft_run_id, draft_inputs_hash FROM takeoff_results WHERE bid_id=$1`,
    [bidId]
  );
  // Fix round 1 / B5 — only output composed from the CURRENT analysis run is
  // ever used (a bid from before run ids — run_id NULL — is unaffected).
  const runId = (trRows[0]?.run_id as string | null) ?? null;
  const agent4Current = !!trRows[0]?.agent4_output && (!runId || trRows[0].agent4_run_id === runId);
  const draftCurrent = !!trRows[0]?.draft_output && trRows[0]?.draft_status === 'complete' && (!runId || trRows[0].draft_run_id === runId);
  const useDraft = opts.source === 'draft' && draftCurrent;
  if (useDraft && trRows[0].draft_inputs_hash && trRows[0].draft_inputs_hash !== await scopeInputsHash(bidId)) {
    // S12 — a stale draft is never used.
    return { ok: false, status: 409, error: 'The pre-bid draft is out of date — the scope inputs changed after it was composed. Compose it again.' };
  }
  const draftMissing = opts.source === 'draft' && !useDraft && !(agent4Current && !runId);
  if (!trRows.length || draftMissing || (!agent4Current && !useDraft)) {
    return {
      ok: false, status: 404,
      error: opts.source === 'draft'
        ? 'The pre-bid draft is not ready yet — it is composed right after the analysis once the takeoff review is clear.'
        : 'No proposal data found for the current analysis. Run Agent 4 first.',
    };
  }
  // Takeoff accuracy Task 8 — the job's account terms (+ the estimator's
  // scope answers), enforced on Agent 4's output below.
  const accountSnap = await accountTermsFor(bidId, trRows[0].account_terms as AccountTermsSnapshot | null, (trRows[0].agent1_output as string) || '');
  const accountResolved = effectiveAccountTerms(accountSnap, trRows[0].review_items as ReviewItem[] | null);
  const scopeList = await getBidScopeList(bidId);
  const verifyOptions: VerifyOptions = accountSnap ? verifyOptionsFor(accountSnap, accountResolved) : {};
  let accountCorrections: string[] = [];
  // Next round A3 — referenced sheets skipped in the sheet check.
  const sheetRow = await loadSheetCheck(bidId);
  const clarifications = sheetRow ? skippedClarifications(sheetRow.result, sheetRow.skips ?? {}, sheetRow.input_key) : [];
  // Next round B3 — the Labor & Pricing screen's Alternates (add/deduct,
  // including a system-computed one like the 7-Eleven Graybar-package
  // deduct), printed as separate proposal lines.
  const estimatorAlternates = (await getAlternates(bidId).catch(() => [])).map(a => ({ kind: a.kind, description: a.description, amount: a.amount }));

  // agent4_price NUMERIC(12,2) is the authoritative, DB-validated price (see
  // run-agent4's parseMoney gate) — format it here rather than trusting whatever
  // string the LLM echoed back into the data blob.
  // A pre-bid draft has no price — ever.
  const rawPrice = useDraft ? null : (trRows[0].agent4_price as string | number | null);
  const priceNum = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
  const formattedPrice = priceNum !== null && Number.isFinite(priceNum)
    ? `$${priceNum.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(priceNum) ? 0 : 2, maximumFractionDigits: 2 })}`
    : undefined;

  const raw = (useDraft ? trRows[0].draft_output : trRows[0].agent4_output) as string;
  const parsed = parseAIJSON(raw);
  if (!parsed) return { ok: false, status: 422, error: 'Proposal data could not be parsed. Re-run Agent 4 to regenerate.' };

  const [{ rows: bidRows }, { rows: estRows }] = await Promise.all([
    pool.query(
      'SELECT name, loc, gc, contact, sq_ft, job_number, brand FROM bids WHERE id=$1 AND deleted_at IS NULL',
      [bidId]
    ),
    pool.query('SELECT line_items FROM bid_estimates WHERE bid_id=$1', [bidId]),
  ]);
  const bid = bidRows[0] as { name?: string; loc?: string; gc?: string; contact?: string; sq_ft?: number | string | null; job_number?: string | null; brand?: string | null } | undefined;
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
    if (!formattedPrice && !useDraft) {
      return { ok: false, status: 422, error: 'No validated price on file for this proposal. Re-run Agent 4.' };
    }
    const bidRow: ComposeBidRow = {
      name: bid?.name, loc: bid?.loc, gc: bid?.gc, contact: bid?.contact,
      sq_ft: bid?.sq_ft ?? null, job_number: bid?.job_number ?? null, brand: bid?.brand ?? null,
    };
    // Fix round 1 — the one pure composition path (bidstd/composeProposal.ts):
    // account terms, scope-list exclusions, composeBidData, CKT rows out,
    // counted quantities enforced (B1), and the checks that block GC documents.
    const composed = composeProposal({
      agent4: parsed as Agent4Output, bidRow, price: formattedPrice ?? '', savedLineItems,
      accountSnap, accountResolved, scopeItems: scopeList.items, overrides: scopeList.overrides,
      countResult: trRows[0].count_result as CountResult | null, reviewItems: trRows[0].review_items as ReviewItem[] | null,
      clarifications, estimatorAlternates,
    });
    const { data, jobNumberGenerated } = composed;
    ambiguousQtyKeys = composed.ambiguousQtyKeys;
    accountCorrections = composed.corrections;
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
    if (validate && (composed.dataProblems.length || composed.lineFailures.length)) {
      return {
        ok: false,
        status: 422,
        error: composed.dataProblems.length
          ? 'This proposal did not pass data validation — fix the composed data before generating documents.'
          : 'This proposal has lines that can\'t go to the GC — fix or override them before generating.',
        failures: [...composed.lineFailures, ...composed.dataProblems.map(detail => ({ check: 'data', detail }))],
      };
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

  verifyOptions.projectAddress = bid?.loc ?? '';
  // S8 / S3 — shown before generating: the account rule warning, and the
  // counting stage's non-blocking flags stay in the Takeoff step.
  const countWarnings = accountSnap?.warning ? [accountSnap.warning] : [];
  const gcText = [
    ...bidData.sections.flatMap(s => s.bullets.map(b => (typeof b === 'string' ? b : `${b.b} ${b.t}`))),
    ...bidData.exclusions.map(b => (typeof b === 'string' ? b : `${b.b} ${b.t}`)),
  ].join('\n');
  const spec = irrelevantSpecSentences(gcText, bid?.loc ?? '');
  const specKept = (sentence: string) => overrideFor(normalizeLineKey('spec', sentence), scopeList.overrides, 'spec') !== null;
  const hygieneWarnings = [
    ...zeroQuantityProblems(bidData),
    ...excludedScopeProblems(bidData, scopeList.items, scopeList.overrides),
    ...nonElectricalFindings(bidData, scopeList.overrides).map(f => f.overridden
      ? `Kept by the estimator: ${f.category} "${f.line}" (${f.reason}) — ${f.overridden}`
      : `${f.category}: "${f.line}" (${f.unit}) looks like ${f.reason} — ${f.block ? 'not electrical scope (blocks the GC documents until kept with a reason)' : 'check it is electrical scope (keep it with a reason to clear this)'}`),
    ...nearDuplicateLines(bidData).map(d => `Possible duplicate lines in ${d.category}: ${d.lines.map(l => `"${l}"`).join(' / ')}`),
    // S10 — other-region / store-type spec text: a warning with an override.
    ...spec.block.filter(x => specKept(x)).map(x => `Kept by the estimator: "${x}"`),
    ...spec.warn.filter(x => !specKept(x)).map(x => `Owner-spec text for another store type — check it applies to this project: "${x}"`),
    ...countWarnings,
  ];
  // R2-B1 — the inputs the document was made from: the analysis run, which
  // Agent 4 output / draft, the price, the counts and every estimator
  // resolution and answer, the account-rule snapshot, the scope list and
  // overrides, and the bid fields printed on the page.
  const inputsHash = composeInputsHash({
    runId, source: useDraft ? 'draft' : 'final', composed: raw, price: rawPrice,
    countResult: trRows[0].count_result, reviewItems: trRows[0].review_items, accountTerms: accountSnap,
    scopeList, bid: bid ?? null, clarifications, estimatorAlternates,
  });
  return { ok: true, bidData, bidName, asciiName, ambiguousQtyKeys, accountCorrections, verifyOptions, hygieneWarnings, runId, inputsHash };
}

/** Fix round 2 / R2-B1 — the compose-inputs hash (see composeCurrentBidData). */
export function composeInputsHash(x: {
  runId: string | null; source: 'draft' | 'final'; composed: string; price: unknown; countResult: unknown; reviewItems: unknown;
  accountTerms: unknown; scopeList: { items: unknown[]; overrides: unknown[] }; bid: Record<string, unknown> | null;
  /** Next round A3 — only hashed when present, so documents filed before
   *  the sheet check existed keep their hash. */
  clarifications?: string[];
  /** Next round B3 — only hashed when present, same reason. */
  estimatorAlternates?: Array<{ kind: string; description: string; amount: number }>;
}): string {
  const sha = (v: unknown) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v ?? null)).digest('hex');
  const resolutions = ((x.reviewItems ?? []) as ReviewItem[]).map(i => [i.id, i.resolution ? [i.resolution.action, i.resolution.qty ?? null, i.resolution.answer ?? null, i.resolution.furnishBy ?? null, i.resolution.installBy ?? null] : null]);
  return sha([
    x.runId, x.source, sha(x.composed ?? ''), x.price == null ? null : Number(x.price), sha(x.countResult ?? null), resolutions,
    sha(x.accountTerms ?? null), sha(x.scopeList.items), sha(x.scopeList.overrides),
    x.bid ? [x.bid.name, x.bid.loc, x.bid.gc, x.bid.contact, x.bid.job_number, x.bid.brand, x.bid.sq_ft ?? null] : null,
    ...(x.clarifications?.length ? [x.clarifications] : []),
    ...(x.estimatorAlternates?.length ? [x.estimatorAlternates] : []),
  ]);
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
  // Takeoff accuracy Task 13 — `paper` carries the exact strings the .docx
  // prints (header lines, intro, price in words, takeoff descriptions) so the
  // white-paper preview never re-implements them client-side.
  const bd = loaded.bidData;
  const paper = {
    headerLines: headerLines(bd),
    introLine: introLine(bd),
    priceLine: bd.total_price ? priceLine(bd.total_price) : null,
    takeoffDescriptions: bd.takeoff.map(c => c.items.map(it => takeoffDescription(it.item, it.description))),
  };
  res.json({ ...bd, ambiguousQtyKeys: loaded.ambiguousQtyKeys, accountCorrections: loaded.accountCorrections, hygieneWarnings: loaded.hygieneWarnings, paper });
}));

// GET generate-docx — build and return the .docx proposal file
router.get('/:bidId/generate-docx', requireAuth, requireAIPermission('view_results'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { bidId } = req.params;
  if (!(await loadAccessibleBid(res, req.user!, bidId))) return;
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });
  // Fix round 2 / B5 — a budget-pending vendor quote blocks the GC-facing
  // proposal docx/PDF (soffice-converted from this same buffer below).
  const budgetGate = await budgetPendingGate(bidId);
  if (budgetGate) return res.status(409).json({ error: budgetGate.error });
  // Evidence round 4.1 — every GC-facing quantity needs evidence (or, for a
  // manual/hand-typed line, a reason). Never applied to the pre-bid package.
  const evGate = await evidenceGate(bidId);
  if (evGate) return res.status(409).json({ error: evGate.error, reviewItems: evGate.openItems });

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
  const verifyResult = await verifyBidDocx(buf, { kind: 'gc', ...loaded.verifyOptions });
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
      takeoffRunId: loaded.runId,
      composeInputsHash: loaded.inputsHash,
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
      takeoffRunId: loaded.runId,
      composeInputsHash: loaded.inputsHash,
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
        takeoffRunId: loaded.runId,
        composeInputsHash: loaded.inputsHash,
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
  // Fix round 2 / B5 — a budget-pending vendor quote blocks the GC takeoff xlsx too.
  const budgetGate = await budgetPendingGate(bidId);
  if (budgetGate) return res.status(409).json({ error: budgetGate.error });
  // Evidence round 4.1 — every GC-facing quantity needs evidence (or, for a
  // manual/hand-typed line, a reason). Never applied to the pre-bid package.
  const evGate = await evidenceGate(bidId);
  if (evGate) return res.status(409).json({ error: evGate.error, reviewItems: evGate.openItems });

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
  const verifyResult = verifyBidText(takeoffAsText(bidData), 'gc', loaded.verifyOptions);
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
      takeoffRunId: loaded.runId,
      composeInputsHash: loaded.inputsHash,
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
  // Fix round 1 / B5 — the pre-bid package is gated by the review too.
  const gate = await takeoffGate(bidId);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });

  // FIX-7 — validate:false here: validateBidData's rules (scope exactly 6,
  // terms exactly 10, Section C exactly 3, etc.) are the GC-facing standard's
  // non-negotiables, not requirements on this internal/rougher pre-bid
  // deliverable — this route already has its own, more specific and
  // friendlier "no scope data" check just below.
  // Takeoff accuracy Task 12 — the pre-bid package builds from the pre-bid
  // draft (no price), available right after the analysis; a bid from before
  // drafts falls back to its Agent 4 output.
  const loaded = await composeCurrentBidData(bidId, { validate: false, source: 'draft' });
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

  // Review round 2 / N-R2-5 — the pre-bid package carries no price (it's
  // composed from the pre-bid draft, before Agent 4 ever runs), so a
  // budget-pending vendor quote can't silently ship a wrong number the way
  // it could on a GC document (B5's own gate covers those). But Chris still
  // needs to know a quote is outstanding when he's pricing off this
  // package — flagged in "INTERNAL NOTES & DISCREPANCIES", the one section
  // that exists only on this internal document, never the GC-facing bid.
  const budgetPendingQuotes = (await getQuotes(bidId).catch(() => [])).filter(q => q.status === 'budget_pending');
  if (budgetPendingQuotes.length) {
    bidData.prebid = {
      ...bidData.prebid,
      flags: [
        ...(bidData.prebid?.flags ?? []),
        ...budgetPendingQuotes.map(q => `BUDGET — pending vendor quote: ${q.description}.`),
      ],
    };
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
  const verifyResult = verifyBidText(combinedText, 'internal', { ecfeci: loaded.verifyOptions.ecfeci });
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
      takeoffRunId: loaded.runId,
      composeInputsHash: loaded.inputsHash,
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
      takeoffRunId: loaded.runId,
      composeInputsHash: loaded.inputsHash,
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
