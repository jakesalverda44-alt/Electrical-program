// Next round A1–A3 — the sheet check: the page inventory as a first-class,
// per-bid record, built when files are added/changed in the Documents step
// (and reused by /analyze), with references followed and missing ones listed.
//
//   inventory  — every page of every PDF: sheet no, title, discipline, class
//                (the existing Haiku title-block classifier), text layer.
//                Cached by content hash in sheet_page_cache, so an unchanged
//                file is never classified twice (not by a re-check, not by
//                the analysis).
//   references — ai/sheetRefs.ts on each electrical page's text (regex);
//                Haiku on notes sentences the regex can't read; Sonnet
//                vision on a scanned (no text layer) sheet's notes region.
//   selection  — analysis pages (electrical disciplines, as before), plus
//                reference pages (referenced + present, or always useful),
//                minus / plus the estimator's overrides (with reasons).
//   missing    — referenced but not in the upload: Upload, or Skip with a
//                reason (skips become proposal clarifications).
//
// Pure halves (applySelection, missingRefs, skippedClarifications, planFor)
// are exported and unit-tested; the I/O halves never throw for one file —
// a file the classifier can't read is listed as unclassified and the
// analysis falls back to its old whole-file path for it.
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import {
  classifyPages, renderTitleBlockCrops, shouldDropWholeFile, formatSheetLabel,
  SELECT_DISCIPLINES, type PageClassification, type Discipline,
} from '../ai/pageClassifier';
import { isPdftoppmAvailable, type SheetClass } from '../ai/documentPrep';
import { extractPdfPageTexts, isPdftotextAvailable } from '../ai/pdfText';
import {
  extractRegexRefs, resolveRefs, alwaysUsefulPages, parseAiRefs, normalizeSheetId, learnSheetPattern, pagesForDiscipline,
  type SheetRef, type ResolvedRef, type RefInventoryPage, type NoteSentence,
} from '../ai/sheetRefs';
import { callWithRetry } from '../ai/retry';
import { runSignalOf, isCancellationError } from '../ai/runControl';
import { assertNotTruncated, isAgentTruncatedError } from '../ai/stopReason';
import { SHEET_REFS_TEXT_SYSTEM, SHEET_REFS_VISION_SYSTEM, PAGE_CLASSIFIER_SYSTEM } from '../ai/prompts';
import { sanitizeForPrompt } from '../ai/sanitizeForPrompt';

const execFileP = promisify(execFile);

export type PageRole = 'analysis' | 'reference' | 'excluded';

/** A page has a usable text layer from this many extracted characters. */
export const TEXT_LAYER_MIN_CHARS = 50;
/** At most this many "always useful" extra pages (equipment schedules, RCP,
 *  life safety) go as reference pages. Explicitly referenced sheets and
 *  photometric / site pages are never capped (fix round S4); a broad
 *  discipline reference gives at most 3 pages. */
export const MAX_REFERENCE_PAGES = 12;

export interface PageOverride {
  decision: 'include' | 'exclude'; reason: string; by: string; at: string;
  /** N7 — the page it was made on, so it follows the sheet into a revised
   *  file (a new content hash) instead of lapsing silently. */
  sheetNo?: string; title?: string;
}
export interface RefSkip {
  reason: string; by: string; at: string; auto?: boolean;
  /** S7 — the sheet check (input_key) the skip was made against; a skip
   *  from another set of inputs is not honored. */
  inputKey?: string | null;
}

export interface CheckedPage {
  /** `${sha256}#${page}` — stable across re-uploads and renames. */
  key: string;
  file: string;
  documentId?: string;
  /** Round 2 R2-S3 — the file's upload time (newest wins a shared sheet). */
  uploadedAt?: string | null;
  /** Round 2 R2-S3 — the newer file that carries this sheet. */
  replacedBy?: string;
  sha: string;
  page: number;
  sheetNo: string;
  title: string;
  discipline: string;
  cls: SheetClass;
  textChars: number;
  hasTextLayer: boolean;
  /** False when the classifier never placed the page ('unknown'). */
  classified: boolean;
  /** References found on this page (regex + cached AI). */
  refs: SheetRef[];
  // ── selection (applySelection) ──
  role: PageRole;
  reason: string;
  /** "E-7 note 3" — where a reference page was referenced from. */
  referencedBy?: string[];
  override?: PageOverride;
}

export interface SheetCheckResult {
  version: 1;
  pages: CheckedPage[];
  refs: ResolvedRef[];
  /** PDFs the classifier could not read (the analysis falls back for them). */
  unclassifiedFiles: string[];
  /** Images go to the analysis as before; listed for completeness. */
  otherFiles: string[];
  checkedAt: string;
}

export interface MissingRef extends ResolvedRef { skip?: RefSkip }

// ── Pure: selection ─────────────────────────────────────────────────────────

function label(p: Pick<CheckedPage, 'sheetNo' | 'title' | 'file' | 'page'>): string {
  return formatSheetLabel(p.sheetNo, p.title, `${p.file} p${p.page}`);
}

function shortLabel(p: Pick<CheckedPage, 'sheetNo' | 'file' | 'page'>): string {
  return p.sheetNo.trim() || `${p.file} p${p.page}`;
}

/** Pages whose notes are read for references: the electrical-discipline
 *  pages the analysis reads anyway, plus any page the estimator forced in. */
function isRefSource(p: CheckedPage): boolean {
  if (p.override?.decision === 'exclude') return false;
  if (p.override?.decision === 'include') return true;
  return SELECT_DISCIPLINES.has(p.discipline as Discipline) && p.discipline !== 'unknown';
}

/** Pure: every page's role and reason, and the resolved references.
 *  Rules, in order:
 *   1. electrical-discipline pages are analysed (as before); a file whose
 *      every page is another discipline AND whose name reads non-electrical
 *      is left out whole — unless that would leave nothing to analyse;
 *   2. a page an analysed page references (and that is in the upload) is
 *      sent as a reference page, and so is an always-useful page
 *      (equipment schedules, photometric / site lighting, RCP, life safety);
 *   3. the estimator's overrides win (include = analyse it; exclude = leave
 *      it out), each with its reason. */
export function applySelection(
  pagesIn: CheckedPage[],
  overrides: Record<string, PageOverride>,
): { pages: CheckedPage[]; refs: ResolvedRef[] } {
  const pages = pagesIn.map(p => ({ ...p, override: overrideFor(p, overrides), referencedBy: undefined as string[] | undefined, replacedBy: undefined as string | undefined }));
  // 1. the classifier's own selection, file by file (FIX-1 drop rule).
  const byFile = new Map<string, CheckedPage[]>(); // N5 — by content hash
  for (const p of pages) {
    if (!byFile.has(p.sha)) byFile.set(p.sha, []);
    byFile.get(p.sha)!.push(p);
  }
  const dropped = new Set<string>();
  for (const [sha, ps] of byFile) {
    const inv: PageClassification[] = ps.map(p => ({ page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline as Discipline, cls: p.cls as PageClassification['cls'] }));
    if (shouldDropWholeFile(inv, ps[0].file)) dropped.add(sha);
  }
  if (dropped.size && dropped.size === byFile.size) dropped.clear(); // never drop everything
  for (const p of pages) {
    const disciplineIn = SELECT_DISCIPLINES.has(p.discipline as Discipline);
    const allOtherInFile = !(byFile.get(p.sha) ?? []).some(q => SELECT_DISCIPLINES.has(q.discipline as Discipline));
    if (dropped.has(p.sha)) { p.role = 'excluded'; p.reason = 'every page of this file is another discipline'; continue; }
    if (disciplineIn) { p.role = 'analysis'; p.reason = p.discipline === 'unknown' ? 'the classifier could not place this page — included to be safe' : `${p.discipline} sheet`; continue; }
    if (allOtherInFile) { p.role = 'analysis'; p.reason = 'no electrical pages were identified in this file — included to be safe'; continue; }
    p.role = 'excluded';
    p.reason = `${p.discipline || 'other'} sheet`;
  }
  // Round 2 R2-S3 — one sheet, two files (Rev 1 and Rev 2 of a set): only
  // the current copy is analysed — the higher revision in the file name,
  // else the newer upload. With no evidence either way both stay.
  markReplacedSheets(pages);
  // Overrides that decide what is analysed come before references (a
  // forced-in page's notes are read; a forced-out page's are not).
  for (const p of pages) {
    if (p.override?.decision === 'include') { p.role = 'analysis'; p.reason = `included by ${p.override.by}: ${p.override.reason}`; }
  }
  // 2. references.
  const inventory: RefInventoryPage[] = pages.map(p => ({ key: p.key, file: p.file, page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline }));
  const sources = pages.filter(p => (p.role === 'analysis' || p.override?.decision === 'include') && isRefSource(p));
  const refs = resolveRefs(sources.flatMap(p => p.refs), inventory, learnSheetPattern(pages.map(p => p.sheetNo)));
  const byKey = new Map(pages.map(p => [p.key, p]));
  // Fix round S4 — what was explicitly referenced (a sheet id, or a
  // discipline the notes point at) and every photometric / site-lighting
  // page ALWAYS gets in; only the "always useful" extras share the cap.
  let extraPages = 0;
  const isPhotometric = (p: CheckedPage) => pagesForDiscipline('photometric', [{ key: p.key, file: p.file, page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline }]).length > 0;
  const makeReference = (p: CheckedPage, why: string, opts: { from?: string; capped?: boolean } = {}) => {
    if (p.override || p.replacedBy) return; // R2-S3 — a replaced copy is never sent
    if (opts.from) p.referencedBy = [...new Set([...(p.referencedBy ?? []), opts.from])];
    if (p.role !== 'excluded') return;
    if (opts.capped && !isPhotometric(p)) {
      if (extraPages >= MAX_REFERENCE_PAGES) { p.reason = `${p.reason} (limit of ${MAX_REFERENCE_PAGES} always-useful pages reached)`; return; }
      extraPages++;
    }
    p.role = 'reference';
    p.reason = why;
  };
  // Explicit sheet ids first, then discipline references (each broad
  // discipline gives at most 3 pages — pagesForDiscipline).
  const ordered = [...refs.filter(r => r.kind === 'sheet'), ...refs.filter(r => r.kind === 'discipline')];
  for (const r of ordered) {
    if (r.status === 'missing') continue;
    for (const k of r.pages) {
      const p = byKey.get(k);
      if (!p) continue;
      for (const by of r.referencedBy) {
        const fromLbl = `${shortLabel(byKey.get(by.fromKey) ?? { sheetNo: by.fromLabel, file: '', page: 0 })}${by.note ? ` ${by.note}` : ''}`;
        makeReference(p, `referenced by ${fromLbl}`, { from: fromLbl });
      }
    }
  }
  for (const u of alwaysUsefulPages(inventory)) {
    const p = byKey.get(u.key);
    if (p && p.role === 'excluded') makeReference(p, `always useful: ${u.why}`, { capped: true });
  }
  // 3. exclusions win last.
  for (const p of pages) {
    if (p.override?.decision === 'exclude') { p.role = 'excluded'; p.reason = `left out by ${p.override.by}: ${p.override.reason}`; }
  }
  return { pages, refs };
}

/** Round 2 R2-S3 — "Elec REV 2.pdf" -> 2. */
function fileRevision(name: string): number | null {
  const m = /\bREV(?:ISION)?\.?\s*[-_#]?\s*(\d{1,3})\b/i.exec(name) ?? /(?:^|[\s_-])R(\d{1,2})(?:[\s_.-]|$)/i.exec(name);
  return m ? Number(m[1]) : null;
}

/** Round 2 R2-S3 — pages whose sheet number a NEWER file also carries are
 *  excluded, with the file that replaced them. Mutates `pages`. */
export function markReplacedSheets(pages: CheckedPage[]): void {
  const newer = (a: CheckedPage, b: CheckedPage): boolean | null => {
    const ra = fileRevision(a.file); const rb = fileRevision(b.file);
    if (ra != null && rb != null && ra !== rb) return ra > rb;
    const ta = a.uploadedAt ? Date.parse(a.uploadedAt) : NaN; const tb = b.uploadedAt ? Date.parse(b.uploadedAt) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
    return null; // no evidence
  };
  const bySheet = new Map<string, CheckedPage[]>();
  for (const p of pages) {
    const id = normalizeSheetId(p.sheetNo ?? '');
    if (!id) continue;
    if (!bySheet.has(id)) bySheet.set(id, []);
    bySheet.get(id)!.push(p);
  }
  for (const group of bySheet.values()) {
    const shas = new Set(group.map(p => p.sha));
    if (shas.size < 2) continue;
    for (const p of group) {
      const winner = group.find(q => q.sha !== p.sha && newer(q, p) === true);
      if (!winner) continue;
      p.role = 'excluded';
      p.reason = `replaced by ${winner.file} (newer copy of ${p.sheetNo})`;
      p.replacedBy = winner.file;
    }
  }
}

/** Pure: missing references with the estimator's skip decisions. */
/** S7 — a skip counts only for the inputs it was made against. */
function skipApplies(skip: RefSkip | undefined, inputKey: string | null | undefined): skip is RefSkip {
  return !!skip && (!skip.inputKey || !inputKey || skip.inputKey === inputKey);
}

export function missingRefs(result: SheetCheckResult | null, skips: Record<string, RefSkip>, inputKey?: string | null): MissingRef[] {
  return (result?.refs ?? []).filter(r => r.status === 'missing')
    .map(r => ({ ...r, ...(skipApplies(skips[r.id], inputKey) ? { skip: skips[r.id] } : {}) }));
}

/** Pure: proposal clarifications for skipped references (one line each). A
 *  reference that is no longer missing (the sheet was added later) prints
 *  nothing. */
export function skippedClarifications(result: SheetCheckResult | null, skips: Record<string, RefSkip>, inputKey?: string | null): string[] {
  return missingRefs(result, skips, inputKey).filter(m => m.skip).map(m => `${m.notProvidedText}.`);
}

/** N7 — the override for a page: by its key, else (a revised file) the one
 *  made on the same sheet number and title, when exactly one matches. */
export function overrideFor(p: Pick<CheckedPage, 'key' | 'sheetNo' | 'title'>, overrides: Record<string, PageOverride>): PageOverride | undefined {
  if (overrides[p.key]) return overrides[p.key];
  const no = normalizeSheetId(p.sheetNo);
  if (!no) return undefined;
  const hits = Object.values(overrides).filter(o => o.sheetNo && normalizeSheetId(o.sheetNo) === no
    && (o.title ?? '').trim().toUpperCase() === p.title.trim().toUpperCase());
  return hits.length === 1 ? hits[0] : undefined;
}

/** What the analysis does with one PDF, from the sheet check. */
export interface FileSheetPlan {
  file: string;
  sha: string;
  classifications: PageClassification[];
  pageTexts: string[];
  roles: Map<number, { role: PageRole; reason: string; referencedBy?: string[] }>;
}

/** Pure: the per-file plans the analysis uses (files the check classified). */
export function plansFor(result: SheetCheckResult, pageTexts: Map<string, string[]>): Map<string, FileSheetPlan> {
  const plans = new Map<string, FileSheetPlan>();
  for (const p of result.pages) {
    let plan = plans.get(p.sha);
    if (!plan) {
      plan = { file: p.file, sha: p.sha, classifications: [], pageTexts: pageTexts.get(p.sha) ?? [], roles: new Map() };
      plans.set(p.sha, plan);
    }
    plan.classifications.push({ page: p.page, sheetNo: p.sheetNo, title: p.title, discipline: p.discipline as Discipline, cls: p.cls as PageClassification['cls'] });
    plan.roles.set(p.page, { role: p.role, reason: p.reason, ...(p.referencedBy ? { referencedBy: p.referencedBy } : {}) });
  }
  return plans;
}

// ── I/O: build the inventory ────────────────────────────────────────────────

export interface CheckInputFile {
  originalname: string; buffer: Buffer; documentId?: string;
  /** Round 2 R2-S3 — when the file was filed (a raw upload: now). */
  uploadedAt?: string | null;
}

export interface BuildOptions {
  client: Anthropic | null;
  classifierModel: string;
  visionModel: string;
  /** Run the AI reference readers (Haiku / vision). The analysis passes
   *  false — it uses what the Documents-step check already cached. */
  aiRefs: boolean;
}

export interface BuiltInventory {
  pages: CheckedPage[];
  pageTexts: Map<string, string[]>;
  unclassifiedFiles: string[];
  otherFiles: string[];
  usage: { input_tokens: number; output_tokens: number };
}

export function sha256(b: Buffer): string {
  return crypto.createHash('sha256').update(b).digest('hex');
}

interface CacheRow {
  page: number; sheet_no: string; title: string; discipline: string; cls: string;
  text_chars: number; has_text_layer: boolean; ai_refs: SheetRef[] | null;
}

/** Fix round S6 — the cache key: classifier model + a hash of its prompt.
 *  A page the classifier never placed ('unknown', filled in) is NOT cached,
 *  so the next check classifies that file again instead of keeping the miss
 *  forever. */
export function classifierCacheKey(model: string): string {
  return `${model}|${crypto.createHash('sha256').update(PAGE_CLASSIFIER_SYSTEM).digest('hex').slice(0, 12)}`;
}

async function readCache(sha: string, key: string): Promise<CacheRow[]> {
  const { rows } = await pool.query(
    'SELECT page, sheet_no, title, discipline, cls, text_chars, has_text_layer, ai_refs FROM sheet_page_cache WHERE content_sha256=$1 AND cache_key=$2 ORDER BY page',
    [sha, key]);
  return rows as CacheRow[];
}

async function writeCache(sha: string, key: string, c: PageClassification, textChars: number, model: string): Promise<void> {
  await pool.query(
    `INSERT INTO sheet_page_cache (content_sha256, page, cache_key, sheet_no, title, discipline, cls, text_chars, has_text_layer, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (content_sha256, page, cache_key) DO UPDATE SET sheet_no=EXCLUDED.sheet_no, title=EXCLUDED.title,
       discipline=EXCLUDED.discipline, cls=EXCLUDED.cls, text_chars=EXCLUDED.text_chars,
       has_text_layer=EXCLUDED.has_text_layer, model=EXCLUDED.model, ai_refs=NULL`,
    [sha, c.page, key, c.sheetNo, c.title, c.discipline, c.cls, textChars, textChars >= TEXT_LAYER_MIN_CHARS, model]);
}

async function writeAiRefs(sha: string, key: string, page: number, refs: SheetRef[]): Promise<void> {
  await pool.query('UPDATE sheet_page_cache SET ai_refs=$4 WHERE content_sha256=$1 AND cache_key=$2 AND page=$3', [sha, key, page, JSON.stringify(refs)]);
}

/** "Re-classify pages": forget the cached classification of these files. */
export async function forgetClassifications(shas: string[]): Promise<void> {
  if (shas.length) await pool.query('DELETE FROM sheet_page_cache WHERE content_sha256 = ANY($1)', [shas]);
}

/** Classify every PDF (cache first), extract its text, read its references.
 *  Never throws for one file, except a truncated classifier reply or a stop
 *  (the caller's run policy). */
export async function buildInventory(files: CheckInputFile[], opts: BuildOptions): Promise<BuiltInventory> {
  const pages: CheckedPage[] = [];
  const pageTexts = new Map<string, string[]>();
  const unclassifiedFiles: string[] = [];
  const otherFiles: string[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const canText = await isPdftotextAvailable();
  const canRender = await isPdftoppmAvailable();

  for (const f of files) {
    if ((f.originalname.split('.').pop() ?? '').toLowerCase() !== 'pdf') { otherFiles.push(f.originalname); continue; }
    const sha = sha256(f.buffer);
    let texts: string[] = [];
    if (canText) {
      try { texts = await extractPdfPageTexts(f.buffer); } catch (err) { logger.warn({ err, file: f.originalname }, '[sheetCheck] pdftotext failed'); }
    }
    // N5 — keyed by content, never by file name (a set and an addendum can
    // both be called "Electrical.pdf").
    pageTexts.set(sha, texts);
    const key = classifierCacheKey(opts.classifierModel);
    let cached = await readCache(sha, key);
    if (!cached.length || (texts.length && cached.length !== texts.length)) {
      cached = [];
      if (!opts.client || !canRender) { unclassifiedFiles.push(f.originalname); continue; }
      try {
        const crops = await renderTitleBlockCrops(f.buffer);
        if (!crops.length) { unclassifiedFiles.push(f.originalname); continue; }
        const res = await classifyPages(opts.client, opts.classifierModel, crops, f.originalname);
        usage.input_tokens += res.usage.input_tokens;
        usage.output_tokens += res.usage.output_tokens;
        for (const c of res.classifications) {
          const textChars = texts[c.page - 1]?.length ?? 0;
          if (c.discipline !== 'unknown') await writeCache(sha, key, c, textChars, opts.classifierModel);
          cached.push({ page: c.page, sheet_no: c.sheetNo, title: c.title, discipline: c.discipline, cls: c.cls, text_chars: textChars, has_text_layer: textChars >= TEXT_LAYER_MIN_CHARS, ai_refs: null });
        }
      } catch (err) {
        if (isAgentTruncatedError(err) || isCancellationError(err)) throw err;
        logger.warn({ err, file: f.originalname }, '[sheetCheck] classification failed — the analysis falls back to the whole file');
        unclassifiedFiles.push(f.originalname);
        continue;
      }
    }
    for (const r of cached) {
      pages.push({
        key: `${sha}#${r.page}`, file: f.originalname, ...(f.documentId ? { documentId: f.documentId } : {}),
        ...(f.uploadedAt ? { uploadedAt: f.uploadedAt } : {}), sha, page: r.page,
        sheetNo: r.sheet_no, title: r.title, discipline: r.discipline, cls: r.cls as SheetClass,
        textChars: r.text_chars, hasTextLayer: r.has_text_layer, classified: r.discipline !== 'unknown',
        refs: [...(r.ai_refs ?? [])], role: 'excluded', reason: '',
      });
    }
  }

  // Regex references on every page with text (cheap; kept per page so an
  // override that forces a page in can use its notes without a re-check).
  // B1 — the set's own sheet-number shape and ids: a referenced id that is
  // not in the upload is reported only when it looks like one of them.
  const pattern = learnSheetPattern(pages.map(p => p.sheetNo));
  const inventoryKeys = new Set(pages.map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));
  const prefixes = { pattern, inventoryKeys };
  const unresolved: Array<{ page: CheckedPage; s: NoteSentence }> = [];
  for (const p of pages) {
    const text = pageTexts.get(p.sha)?.[p.page - 1] ?? '';
    if (!text) continue;
    const { refs, unresolved: u } = extractRegexRefs(text, { key: p.key, label: label(p), sheetNo: p.sheetNo }, prefixes);
    p.refs.push(...refs.filter(r => !p.refs.some(x => x.kind === r.kind && x.key === r.key)));
    if (SELECT_DISCIPLINES.has(p.discipline as Discipline) && p.discipline !== 'cover' && p.discipline !== 'unknown') {
      for (const s of u) unresolved.push({ page: p, s });
    }
  }

  if (opts.aiRefs && opts.client) {
    // Haiku on notes sentences the regex couldn't resolve (pages not yet read).
    const todo = unresolved.filter(u => !u.page.refs.some(r => r.source === 'haiku'));
    const alreadyRead = new Set(pages.filter(p => p.refs.some(r => r.source === 'haiku')).map(p => p.key));
    const fresh = todo.filter(u => !alreadyRead.has(u.page.key));
    if (fresh.length) {
      try {
        // N6 — every sentence is read (40 per call), before any page is
        // marked as read.
        const found: SheetRef[] = [];
        for (let i = 0; i < fresh.length; i += 40) found.push(...await readVagueRefs(opts.client, opts.classifierModel, fresh.slice(i, i + 40), usage));
        for (const p of new Set(fresh.map(u => u.page))) {
          const mine = found.filter(r => r.fromKey === p.key);
          p.refs.push(...mine);
          // Cache even an empty answer (marker ref never resolves) so the
          // same sentences are not re-asked on every check.
          await writeAiRefs(p.sha, classifierCacheKey(opts.classifierModel), p.page, [...p.refs.filter(r => r.source !== 'regex'), ...(mine.length ? [] : [HAIKU_READ_MARKER(p)])]);
        }
      } catch (err) {
        if (isAgentTruncatedError(err) || isCancellationError(err)) throw err;
        logger.warn({ err }, '[sheetCheck] Haiku reference reading failed — regex references only');
      }
    }
    // Sonnet vision on scanned electrical sheets' notes region.
    if (canRender) {
      for (const p of pages) {
        if (p.hasTextLayer || p.discipline !== 'electrical' || p.refs.some(r => r.source === 'vision')) continue;
        const f = files.find(x => x.originalname === p.file);
        if (!f) continue;
        try {
          const found = await readScannedNotesRefs(opts.client, opts.visionModel, f.buffer, p, usage);
          p.refs.push(...found);
          await writeAiRefs(p.sha, classifierCacheKey(opts.classifierModel), p.page, [...p.refs.filter(r => r.source !== 'regex'), ...(found.length ? [] : [VISION_READ_MARKER(p)])]);
        } catch (err) {
          if (isAgentTruncatedError(err) || isCancellationError(err)) throw err;
          logger.warn({ err, page: label(p) }, '[sheetCheck] vision reference reading failed for a scanned sheet');
        }
      }
    }
  }
  // Markers only record "already read"; they never resolve to a page.
  for (const p of pages) p.refs = p.refs.filter(r => r.key !== READ_MARKER_KEY);
  return { pages, pageTexts, unclassifiedFiles, otherFiles, usage };
}

const READ_MARKER_KEY = '__read__';
const HAIKU_READ_MARKER = (p: CheckedPage): SheetRef => ({ kind: 'sheet', key: READ_MARKER_KEY, label: '', context: '', fromKey: p.key, fromLabel: '', source: 'haiku' });
const VISION_READ_MARKER = (p: CheckedPage): SheetRef => ({ kind: 'sheet', key: READ_MARKER_KEY, label: '', context: '', fromKey: p.key, fromLabel: '', source: 'vision' });

/** Haiku: numbered notes sentences in, references out. */
export async function readVagueRefs(
  client: Anthropic, model: string, items: Array<{ page: CheckedPage; s: NoteSentence }>, usage: { input_tokens: number; output_tokens: number },
): Promise<SheetRef[]> {
  const list = items.map((u, i) => `${i + 1}. [${sanitizeForPrompt(label(u.page))}] ${sanitizeForPrompt(u.s.text).slice(0, 300)}`).join('\n');
  const maxTokens = 2000;
  const resp = await callWithRetry(() => client.messages.stream({
    model, max_tokens: maxTokens, temperature: 0,
    system: [{ type: 'text', text: SHEET_REFS_TEXT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Notes sentences from electrical drawing sheets:\n${list}\n\nReturn the JSON array only.` }],
  }).finalMessage(), { signal: runSignalOf(client) });
  assertNotTruncated(resp, 'Sheet reference reader', maxTokens);
  usage.input_tokens += resp.usage?.input_tokens ?? 0;
  usage.output_tokens += resp.usage?.output_tokens ?? 0;
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
  const out: SheetRef[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let arr: unknown;
  try { arr = JSON.parse((fenced?.[1] ?? text).trim().replace(/^[^[]*/, '')); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  for (const el of arr) {
    const i = Number((el as { i?: unknown })?.i);
    const item = items[i - 1];
    if (!item) continue;
    out.push(...parseAiRefs(JSON.stringify([el]), { key: item.page.key, label: label(item.page) }, 'haiku', item.s.text)
      .map(r => ({ ...r, ...(item.s.note ? { note: item.s.note } : {}) })));
  }
  return out;
}

/** Pure: the general-notes region of a sheet — the strip left of the title
 *  block, where notes sit on nearly every E-sheet format (right 45% of the
 *  page minus the title-block 10%). */
export function notesRegionRect(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = Math.floor(width * 0.45);
  const right = Math.floor(width * 0.9);
  return { left, top: 0, width: Math.max(1, right - left), height: Math.max(1, height) };
}

/** Sonnet vision on the notes region of one scanned page. */
export async function readScannedNotesRefs(
  client: Anthropic, model: string, pdf: Buffer, p: CheckedPage, usage: { input_tokens: number; output_tokens: number },
): Promise<SheetRef[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-notes-'));
  let jpeg: Buffer;
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdf);
    await execFileP('pdftoppm', ['-gray', '-png', '-r', '150', '-f', String(p.page), '-l', String(p.page), pdfPath, path.join(tmp, 'pg')]);
    const file = (await fs.readdir(tmp)).find(f => f.endsWith('.png'));
    if (!file) return [];
    const meta = await sharp(path.join(tmp, file)).metadata();
    if (!meta.width || !meta.height) return [];
    jpeg = await sharp(path.join(tmp, file)).extract(notesRegionRect(meta.width, meta.height))
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  const maxTokens = 2000;
  const resp = await callWithRetry(() => client.messages.stream({
    model, max_tokens: maxTokens,
    system: [{ type: 'text', text: SHEET_REFS_VISION_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Notes region of sheet ${sanitizeForPrompt(label(p))} (scanned, no text layer):` },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
      { type: 'text', text: 'Return the JSON array only.' },
    ] }],
  }).finalMessage(), { signal: runSignalOf(client) });
  assertNotTruncated(resp, 'Sheet reference reader (vision)', maxTokens);
  usage.input_tokens += resp.usage?.input_tokens ?? 0;
  usage.output_tokens += resp.usage?.output_tokens ?? 0;
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n');
  return parseAiRefs(text, { key: p.key, label: label(p) }, 'vision');
}

// ── DB: the bid's check ─────────────────────────────────────────────────────

export interface SheetCheckRow {
  status: 'idle' | 'running' | 'complete' | 'error';
  run_token: string | null;
  input_key: string | null;
  result: SheetCheckResult | null;
  overrides: Record<string, PageOverride>;
  skips: Record<string, RefSkip>;
  error: string | null;
  finished_at: string | null;
}

export async function loadSheetCheck(bidId: string): Promise<SheetCheckRow | null> {
  const { rows } = await pool.query(
    'SELECT status, run_token, input_key, result, overrides, skips, error, finished_at FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
  return (rows[0] as SheetCheckRow | undefined) ?? null;
}

/** The inputs' identity: sorted content hashes. A check is current for an
 *  analysis only when this matches. */
export function inputKeyOf(files: CheckInputFile[]): string {
  return files.map(f => sha256(f.buffer)).sort().join(',');
}

/** Start a check: claim the row with a fresh token (a newer check
 *  supersedes one still running). */
export async function claimSheetCheck(bidId: string, inputKey: string): Promise<string> {
  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO bid_sheet_check (bid_id, status, run_token, input_key, started_at, updated_at, error)
     VALUES ($1, 'running', $2, $3, now(), now(), NULL)
     ON CONFLICT (bid_id) DO UPDATE SET status='running', run_token=$2, input_key=$3, started_at=now(), updated_at=now(), error=NULL`,
    [bidId, token, inputKey]);
  return token;
}

/** Run the check and store it (only if still the current token). */
export async function runSheetCheck(bidId: string, token: string, files: CheckInputFile[], opts: BuildOptions): Promise<void> {
  try {
    const built = await buildInventory(files, opts);
    const row = await loadSheetCheck(bidId);
    const { pages, refs } = applySelection(built.pages, row?.overrides ?? {});
    const result: SheetCheckResult = {
      version: 1, pages, refs, unclassifiedFiles: built.unclassifiedFiles, otherFiles: built.otherFiles, checkedAt: new Date().toISOString(),
    };
    await pool.query(
      `UPDATE bid_sheet_check SET status='complete', result=$2, usage=$3, finished_at=now(), updated_at=now()
        WHERE bid_id=$1 AND run_token=$4`,
      [bidId, JSON.stringify(result), JSON.stringify(built.usage), token]);
  } catch (err) {
    logger.error({ err, bidId }, '[sheetCheck] check failed');
    await pool.query(
      `UPDATE bid_sheet_check SET status='error', error=$2, finished_at=now(), updated_at=now() WHERE bid_id=$1 AND run_token=$3`,
      [bidId, err instanceof Error ? err.message.slice(0, 500) : String(err), token]).catch(() => {});
  }
}

/** Re-apply the selection after an override / skip change (no AI, no I/O
 *  beyond the row). */
export async function reselect(bidId: string): Promise<SheetCheckRow | null> {
  const row = await loadSheetCheck(bidId);
  if (!row?.result) return row;
  const { pages, refs } = applySelection(row.result.pages, row.overrides ?? {});
  const result: SheetCheckResult = { ...row.result, pages, refs };
  await pool.query('UPDATE bid_sheet_check SET result=$2, updated_at=now() WHERE bid_id=$1', [bidId, JSON.stringify(result)]);
  return { ...row, result };
}

/** For /analyze: the plans to use, built from the cache (never a new AI
 *  reference call) with the bid's overrides applied. Files the cache
 *  doesn't know are classified now (and cached) — the analysis never runs
 *  on a stale selection. Returns the result for the run's record. */
export interface SupplementPlanOptions {
  /** The run's earlier pages (the bid's sheet check, else its prep
   *  inventory): the new files are planned AGAINST them, so a lone M-1 is
   *  resolved as the reference an earlier E-sheet points at. */
  contextPages: CheckedPage[];
  /** New pages identical to a page already in the run (per-page content
   *  hash): never analysed again. */
  skipPageKeys: string[];
}

export async function planSheetsForRun(
  bidId: string, files: CheckInputFile[], client: Anthropic, classifierModel: string,
  supplement?: SupplementPlanOptions,
): Promise<{ plans: Map<string, FileSheetPlan>; result: SheetCheckResult; usage: { input_tokens: number; output_tokens: number } }> {
  const built = await buildInventory(files, { client, classifierModel, visionModel: '', aiRefs: false });
  const row = await loadSheetCheck(bidId);
  let pages: CheckedPage[];
  let refs: ResolvedRef[];
  if (!supplement) {
    ({ pages, refs } = applySelection(built.pages, row?.overrides ?? {}));
  } else {
    // Fix round S3 — only genuinely new pages, planned against the run.
    const newKeys = new Set(built.pages.map(p => p.key));
    const skip = new Set(supplement.skipPageKeys);
    const context = supplement.contextPages.filter(p => !newKeys.has(p.key));
    const sel = applySelection([...context, ...built.pages], row?.overrides ?? {});
    refs = sel.refs;
    pages = sel.pages.filter(p => newKeys.has(p.key)).map(p => {
      if (skip.has(p.key)) return { ...p, role: 'excluded' as const, reason: 'already in this analysis (same page content)' };
      // A sheet the estimator added on purpose that no note points at and
      // no discipline rule selects: context for the run, never counted in full.
      // (Also the whole-file "included to be safe" rule: a lone mechanical
      // file is context here, not a set to analyse in full.)
      const otherDiscipline = !SELECT_DISCIPLINES.has(p.discipline as Discipline);
      if (!p.override && (p.role === 'excluded' || (p.role === 'analysis' && otherDiscipline))) {
        return { ...p, role: 'reference' as const, reason: p.referencedBy?.length ? p.reason : 'added to the analysis as a referenced sheet' };
      }
      return p;
    });
  }
  const result: SheetCheckResult = { version: 1, pages, refs, unclassifiedFiles: built.unclassifiedFiles, otherFiles: built.otherFiles, checkedAt: new Date().toISOString() };
  return { plans: plansFor(result, built.pageTexts), result, usage: built.usage };
}

/** Fix round S3 — a page's content identity for the supplement pass: its
 *  text layer (normalized), or null for a scanned page. */
export function pageContentHash(text: string | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length >= TEXT_LAYER_MIN_CHARS ? crypto.createHash('sha256').update(t).digest('hex') : null;
}

/** Fix round S7 — after a successful supplement pass: references that the
 *  added pages now satisfy are present, and their skips (and so their "not
 *  provided" clarifications) are removed. */
export async function resolveRefsAfterSupplement(bidId: string, added: RefInventoryPage[]): Promise<string[]> {
  const tx = await pool.connect();
  const resolved: string[] = [];
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query('SELECT result, skips FROM bid_sheet_check WHERE bid_id=$1 FOR UPDATE', [bidId]);
    const result = rows[0]?.result as SheetCheckResult | null;
    if (!result) { await tx.query('ROLLBACK'); return resolved; }
    const skips: Record<string, RefSkip> = { ...(rows[0].skips ?? {}) };
    const keys = new Map(added.map(p => [normalizeSheetId(p.sheetNo), p.key]));
    const refs = result.refs.map(r => {
      if (r.status !== 'missing') return r;
      const pages = r.kind === 'sheet'
        ? (keys.has(r.key) ? [keys.get(r.key)!] : [])
        : pagesForDiscipline(r.key as Parameters<typeof pagesForDiscipline>[0], added).map(p => p.key);
      if (!pages.length) return r;
      resolved.push(r.id);
      delete skips[r.id];
      return { ...r, status: 'present' as const, pages };
    });
    await tx.query('UPDATE bid_sheet_check SET result=$2, skips=$3, updated_at=now() WHERE bid_id=$1',
      [bidId, JSON.stringify({ ...result, refs }), JSON.stringify(skips)]);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
  return resolved;
}
