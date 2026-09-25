// Job profile fix round (review 1755e62) — the run, end to end:
//
//   request  — the bid's CURRENT plan documents only (category plans, not
//              generated, not superseded, this bid's own — S3/S7). If the
//              sheet check for exactly these files has not finished, the
//              profile WAITS (status 'waiting') and runs when it completes
//              (S4); if there is no current check, one is started.
//   run      — the sheet check's inventory picks the pages; one structured
//              model call reads them; the code validators decide what may
//              fill (ai/jobProfile.ts).
//   apply    — in ONE transaction, with the bid row and the profile row
//              locked: cleared fills become rejections (S2), each fill is a
//              conditional UPDATE that only writes an still-empty field (S1),
//              suggestions merge with the person's earlier decisions, and the
//              newest run (run_token) is the only one that may write.
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getSetting } from '../db/getSetting';
import { writeAuditAs, type AuditActor } from '../utils/audit';
import { withDueDays } from '../utils/dueDate';
import { gatherAnalysisInputs, loadAIConfig } from '../routes/preconstruction';
import { claimSheetCheck, runSheetCheck, loadSheetCheck, inputKeyOf, sha256, buildInventory, type SheetCheckRow } from './sheetCheck';
import { extractPdfPageTexts } from '../ai/pdfText';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { titleBlockCropRect } from '../ai/pageClassifier';
import { listAccountRules } from '../bidstd/accountRulesDb';
import {
  selectProfilePages, prepareProfileInput, assembleJobProfile, callJobProfileModel, jobProfileCostCents, undetermined,
  DEFAULT_JOB_PROFILE_MODEL, type InventoryPage, type JobProfile, type PromptPage, type SelectedPage,
} from '../ai/jobProfile';
import { mergeBrands } from '../ai/jobProfileValidators';
import { friendlyAnthropicError, sanitizeStoredError } from '../ai/friendlyError';
import {
  computeCardUpdates, reconcileFills, mergeSuggestions,
  type CurrentBidFields, type FillRecord, type StoredSuggestion,
} from '../estimating/jobProfileCardRules';

const execFileP = promisify(execFile);

export class JobProfileError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const BID_PROFILE_COLUMNS = [
  'project_type', 'brand', 'store_number', 'prototype', 'loc', 'sq_ft',
  'plan_date', 'owner_name', 'architect', 'engineer', 'build_type',
] as const;

/** A plan document the profile may read. */
export interface PlanDoc { id: string; name: string; created_at: string }

const PLAN_FILE_RE = /\.(pdf|jpe?g|png|zip)$/i;

/** The bid's current plan documents, newest first. `requested` narrows it;
 *  a requested id that is not one of this bid's documents is a 404 (S3). */
export async function eligiblePlanDocs(bidId: string, requested: string[] | null): Promise<PlanDoc[]> {
  const { rows } = await pool.query(
    `SELECT id, name, display_name, category, generated, superseded_at, created_at
       FROM documents WHERE linked_id = $1::text AND deleted_at IS NULL
      ORDER BY created_at DESC, id`, [bidId]);
  if (requested?.length) {
    const own = new Set(rows.map(r => String(r.id)));
    const foreign = requested.filter(id => !own.has(id));
    if (foreign.length) throw new JobProfileError(404, 'A selected document does not belong to this bid.');
  }
  const want = requested?.length ? new Set(requested) : null;
  return rows
    .filter(r => !r.generated && !r.superseded_at && r.category === 'plans' && PLAN_FILE_RE.test(String(r.name ?? '')))
    .filter(r => !want || want.has(String(r.id)))
    .map(r => ({ id: String(r.id), name: String(r.display_name || r.name), created_at: new Date(r.created_at).toISOString() }));
}

export interface RunOutcome { status: 'waiting' | 'complete' | 'undetermined' | 'error'; error?: string }

async function anthropicClient(): Promise<Anthropic | null> {
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  return apiKey ? new Anthropic({ apiKey }) : null;
}

/** Round 2 (R2-B2) — a sheet check or a profile left "running" / "waiting"
 *  this long (a restart mid-run, a crash) is stale: it is re-run, never
 *  waited on forever. */
export const STALE_MS = 10 * 60 * 1000;
/** R2-S2 — the shortest gap between two model calls for one bid (a forced
 *  re-read clicked twice). Env override for tests. */
export function minModelIntervalMs(): number {
  const v = Number(process.env.JOB_PROFILE_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 10_000;
}
/** Round 3 R3-S3 — at most one forced re-read per bid per 2 minutes (it
 *  restarts the sheet check). Env override for tests. */
export function forceIntervalMs(): number {
  const v = Number(process.env.JOB_PROFILE_FORCE_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 2 * 60 * 1000;
}

function isStale(at: unknown): boolean {
  const t = at ? new Date(String(at)).getTime() : 0;
  return !t || Date.now() - t > STALE_MS;
}

async function sheetCheckUpdatedAt(bidId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT updated_at FROM bid_sheet_check WHERE bid_id=$1', [bidId]);
  return rows[0]?.updated_at ?? null;
}

export interface RequestOptions {
  /** "Read the plans again": a fresh sheet check (when the shared one is the
   *  profile's) and a fresh model call. */
  force?: boolean;
}

function baseModel(m: unknown): string {
  return String(m ?? '').replace(/ \(vision\)$/, '');
}

/** Start (or queue) a profile run for the bid's current plans. */
export async function requestJobProfile(bidId: string, requested: string[] | null, actor: AuditActor, opts: RequestOptions = {}): Promise<RunOutcome> {
  const docs = await eligiblePlanDocs(bidId, requested);
  if (!docs.length) throw new JobProfileError(400, 'No plan files on this bid to read — upload the plans first.');
  const docIds = docs.map(d => d.id);
  const docKey = docIds.slice().sort().join('|');
  const { files } = await gatherAnalysisInputs(bidId, [], docIds);
  if (!files.length) throw new JobProfileError(400, 'The plan files could not be read.');
  const inputKey = inputKeyOf(files);
  const model = ((await getSetting('ai_job_profile_model')) || '').trim() || DEFAULT_JOB_PROFILE_MODEL;

  const { rows: prev } = await pool.query(
    'SELECT status, input_key, content_key, model, updated_at, model_called_at, forced_at FROM bid_job_profile WHERE bid_id=$1', [bidId]);
  const row = prev[0];
  if (!opts.force && row) {
    // R2-S2 — the same plan set and model: never a second model call. A run
    // already in flight for it is followed; a finished one is re-applied to
    // the card (cheap — the stored reply, no model call).
    const same = row.input_key === docKey && row.content_key === inputKey && baseModel(row.model) === model;
    if ((row.status === 'waiting' || row.status === 'running') && !isStale(row.updated_at) && row.content_key === inputKey) return { status: 'waiting' };
    if (same && (row.status === 'complete' || row.status === 'undetermined')) return reapplyStoredProfile(bidId, actor);
  }
  if (opts.force && row?.model_called_at && Date.now() - new Date(row.model_called_at).getTime() < minModelIntervalMs()) {
    throw new JobProfileError(429, 'The plans were just read — wait a few seconds before reading them again.');
  }
  if (opts.force && row?.forced_at && Date.now() - new Date(row.forced_at).getTime() < forceIntervalMs()) {
    throw new JobProfileError(429, 'The plans were re-read less than 2 minutes ago — wait a moment before forcing another re-read.');
  }
  if (opts.force) {
    await pool.query('UPDATE bid_job_profile SET forced_at=now() WHERE bid_id=$1', [bidId]);
    await writeAuditAs(actor, { action: 'ai_override', entityType: 'bid', entityId: bidId, summary: 'Plans re-read from Overview (forced: fresh sheet check and model call)' });
  }

  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO bid_job_profile (bid_id, status, run_token, pending_doc_ids, requested_by, content_key, updated_at)
     VALUES ($1, 'waiting', $2, $3, $4, $5, now())
     ON CONFLICT (bid_id) DO UPDATE SET status='waiting', run_token=$2, pending_doc_ids=$3, requested_by=$4, content_key=$5, error=NULL, updated_at=now()`,
    [bidId, token, docIds, JSON.stringify(actor), inputKey]);
  if (opts.force) await pool.query('UPDATE bid_job_profile SET forced_at=now() WHERE bid_id=$1', [bidId]);

  const sc = await loadSheetCheck(bidId);
  const scStale = sc?.status === 'running' && isStale(await sheetCheckUpdatedAt(bidId));
  const ours = !!sc && sc.input_key === inputKey;
  if (ours && sc!.status === 'running' && !scStale && !opts.force) return { status: 'waiting' };
  if (ours && (sc!.status === 'complete' || sc!.status === 'error') && !opts.force) return runJobProfileNow(bidId, token);
  if (sc && !ours && !scStale) {
    // R2-S6 — the bid's sheet check belongs to the Documents step's own
    // selection: never overwrite it. Read the full plan set from the shared
    // content-hash classification cache instead (no row is claimed).
    void runJobProfileNow(bidId, token).catch(err => logger.warn({ err, bidId }, '[jobProfile] run failed'));
    return { status: 'waiting' };
  }
  // No check yet, ours is stale, or a forced re-read of ours: start the
  // bid's sheet check for the full plan set; the profile runs when it ends.
  const client = await anthropicClient();
  const config = await loadAIConfig();
  // Round 3 R3-S3 — a forced re-read keeps the page-classification cache
  // (keyed by content: changed files are classified anyway).
  const checkToken = await claimSheetCheck(bidId, inputKey);
  void runSheetCheck(bidId, checkToken, files.map(f => ({ originalname: f.originalname, buffer: f.buffer, documentId: (f as { documentId?: string }).documentId, uploadedAt: (f as { uploadedAt?: string | null }).uploadedAt ?? null })), {
    client, classifierModel: config.modelClassifier, visionModel: config.modelRefVision, aiRefs: true,
  }).then(() => resumeAfterSheetCheck(bidId)).catch(err => logger.warn({ err, bidId }, '[jobProfile] resume after sheet check failed'));
  return { status: 'waiting' };
}

/** Called whenever a sheet check finishes (this module's own, or the
 *  Documents step's — including its per-sheet Upload, review S9). A waiting
 *  profile runs now; a finished profile re-runs when the plans changed. */
export async function resumeAfterSheetCheck(bidId: string): Promise<void> {
  const { rows } = await pool.query('SELECT status, run_token, input_key, requested_by FROM bid_job_profile WHERE bid_id=$1', [bidId]);
  const row = rows[0];
  if (!row) return;
  const sc = await loadSheetCheck(bidId);
  // A newer check is still running: its own completion resumes us.
  if (sc?.status === 'running' && !isStale(await sheetCheckUpdatedAt(bidId))) return;
  if (row.status === 'waiting' && row.run_token) {
    // Whatever check just finished, the run reads the full plan set — from
    // this check when it is for exactly those files, else from the shared
    // classification cache (R2-S6: never claiming the Documents step's row).
    // runJobProfileNow's claim lets exactly one caller through (R2-S1).
    await runJobProfileNow(bidId, row.run_token);
    return;
  }
  if (row.status === 'running') return;
  const docs = await eligiblePlanDocs(bidId, null);
  const key = docs.map(d => d.id).sort().join('|');
  if (!docs.length || key === row.input_key) return;
  const actor = (row.requested_by as AuditActor | null) ?? { id: null, name: 'Job profile (plans changed)' };
  await requestJobProfile(bidId, null, actor).catch(err => logger.warn({ err, bidId }, '[jobProfile] re-run after plans changed failed'));
}

/** Plans-panel fix round, Task 1 (review eb39943, S3/S4 fix) — after a plan
 *  file is removed, replaced, or restored, the job profile (and, when it's
 *  safe, the shared sheet check) refreshes for the bid's remaining current
 *  plan set.
 *
 *  The review's B1-round version called `claimSheetCheck` unconditionally,
 *  which overwrites `bid_sheet_check` even when it belongs to Estimating's
 *  own, different ticked selection (S3). Simply delegating to
 *  `requestJobProfile`'s own R2-S6 rule instead avoids that, but
 *  UNDER-fixes S4: R2-S6's `ours` check compares against the row's CURRENT
 *  content-hash key, and a remove/restore always changes that key relative
 *  to whatever the row already says — so it would never reclaim the row
 *  again after the FIRST plan-file change, even in the common case where
 *  nothing but this bid's own Overview panel has ever touched it.
 *
 *  So this checks a sharper signal: was the shared row's content key
 *  exactly what OUR OWN last successful profile run left it as
 *  (`bid_job_profile.content_key`)? If so, nothing else (no Estimating
 *  selection, no other process) has touched it since, and it is safe to
 *  claim/update for the new set. If the row exists and its key matches
 *  neither the new set NOR our own last-known key, something else owns it
 *  now and it is left completely untouched (S3) — the job profile still
 *  reads the new set fine, from the shared content-hash classification
 *  cache, via `requestJobProfile`'s existing fallback.
 *
 *  This never touches the takeoff's own results (ai_results / run
 *  history) — only bid_sheet_check and bid_job_profile — so it can never
 *  reset a takeoff already run. */
export async function refreshAfterPlanFilesChanged(bidId: string, actor: AuditActor): Promise<void> {
  const docs = await eligiblePlanDocs(bidId, null);
  if (docs.length) {
    const { files } = await gatherAnalysisInputs(bidId, [], docs.map(d => d.id));
    if (files.length) {
      const newInputKey = inputKeyOf(files);
      const [{ rows: jp }, sc] = await Promise.all([
        pool.query('SELECT content_key FROM bid_job_profile WHERE bid_id=$1', [bidId]),
        loadSheetCheck(bidId),
      ]);
      const lastOwnedKey: string | null = jp[0]?.content_key ?? null;
      const safeToClaim = !sc || sc.input_key === newInputKey || (lastOwnedKey !== null && sc.input_key === lastOwnedKey);
      if (safeToClaim) {
        const client = await anthropicClient();
        const config = await loadAIConfig();
        const token = await claimSheetCheck(bidId, newInputKey);
        await runSheetCheck(bidId, token, files.map(f => ({ originalname: f.originalname, buffer: f.buffer, documentId: (f as { documentId?: string }).documentId, uploadedAt: (f as { uploadedAt?: string | null }).uploadedAt ?? null })), {
          client, classifierModel: config.modelClassifier, visionModel: config.modelRefVision, aiRefs: true,
        });
      }
    }
  }
  try {
    await requestJobProfile(bidId, null, actor);
  } catch (err) {
    if (err instanceof JobProfileError && err.status === 400) {
      // No plan files left on the bid at all — nothing to check. Never
      // touch bid_sheet_check here either: it may belong to Estimating's
      // own, unrelated selection (review S3). Only the job profile's own
      // bookkeeping is reset so the panel's "Detected from plans" /
      // suggestions sections (gated client-side on there being plan files)
      // don't hold onto a run tied to a plan set that no longer exists.
      await pool.query(`UPDATE bid_job_profile SET status='idle', updated_at=now() WHERE bid_id=$1`, [bidId]).catch(() => {});
      return;
    }
    throw err;
  }
}

/** R2-S2 — the same plan set and model: the stored profile is applied again
 *  (a cleared fill is recorded as a rejection, a new card value becomes a
 *  suggestion) without a model call. */
async function reapplyStoredProfile(bidId: string, actor: AuditActor): Promise<RunOutcome> {
  const { rows } = await pool.query(
    `SELECT status, profile, systems, rejected, pages_used, undetermined_reason, input_key, model, usage, cost_cents, run_token
       FROM bid_job_profile WHERE bid_id=$1`, [bidId]);
  const r = rows[0];
  const profile: JobProfile = {
    status: r.status, fields: r.profile ?? {}, systems: r.systems ?? {}, rejected: r.rejected ?? [], pagesUsed: r.pages_used ?? [],
    usedVision: /\(vision\)$/.test(String(r.model ?? '')), ...(r.undetermined_reason ? { undeterminedReason: r.undetermined_reason } : {}),
  };
  await applyProfile(bidId, r.run_token, profile, {
    docIds: String(r.input_key ?? '').split('|').filter(Boolean), model: baseModel(r.model), usage: r.usage ?? { input_tokens: 0, output_tokens: 0 },
    costCents: Number(r.cost_cents ?? 0), actor, reused: true,
  });
  return { status: profile.status };
}

// ── The run ─────────────────────────────────────────────────────────────────

/** A no-text selected page's image: the right 25% title-block strip of an
 *  electrical sheet, the whole (downsized) sheet for a cover. */
export async function renderProfileCrop(pdf: Buffer, page: number, why: SelectedPage['why']): Promise<Buffer | null> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-jobprofile-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdf);
    await execFileP('pdftoppm', ['-png', '-r', why === 'electrical' ? '150' : '100', '-f', String(page), '-l', String(page), pdfPath, path.join(tmp, 'pg')]);
    const file = (await fs.readdir(tmp)).find(f => f.endsWith('.png'));
    if (!file) return null;
    const img = sharp(path.join(tmp, file));
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    const cropped = why === 'electrical' ? img.extract(titleBlockCropRect(meta.width, meta.height)) : img;
    return await cropped.resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export const MAX_VISION_CROPS = 4;

export async function runJobProfileNow(bidId: string, token: string): Promise<RunOutcome> {
  const { rows: claimed } = await pool.query(
    `UPDATE bid_job_profile SET status='running', updated_at=now() WHERE bid_id=$1 AND run_token=$2 AND status='waiting'
     RETURNING pending_doc_ids, requested_by, content_key`, [bidId, token]);
  // R2-S1 — only a run still WAITING under this token proceeds: two resumes
  // (or a resume racing the synchronous run) make exactly one model call.
  if (!claimed.length) return { status: 'waiting' };
  const actor: AuditActor = (claimed[0].requested_by as AuditActor | null) ?? { id: null, name: 'Job profile' };
  try {
    const docs = await eligiblePlanDocs(bidId, (claimed[0].pending_doc_ids as string[] | null) ?? null).catch(() => [] as PlanDoc[]);
    const docIds = docs.map(d => d.id);
    const { files } = docIds.length ? await gatherAnalysisInputs(bidId, [], docIds) : { files: [] as Express.Multer.File[] };
    const uploadedAt = new Map(docs.map(d => [d.id, d.created_at]));

    // Page text per file (the production text path), keyed by content.
    const texts = new Map<string, string[]>();
    const buffers = new Map<string, Buffer>();
    for (const f of files) {
      if (f.mimetype !== 'application/pdf' && !/\.pdf$/i.test(f.originalname)) continue;
      const sha = sha256(f.buffer);
      buffers.set(sha, f.buffer);
      try { texts.set(sha, await extractPdfPageTexts(f.buffer)); } catch (err) {
        logger.warn({ err, file: f.originalname }, '[jobProfile] pdftotext failed — the page counts as having no text');
        texts.set(sha, []);
      }
    }

    // The sheet check's inventory, when it was made for exactly these files;
    // else the shared content-hash classification cache (R2-S6 — the bid's
    // check row belongs to whichever selection ran it and is never claimed
    // here); else each file's pages unplaced.
    const sc: SheetCheckRow | null = await loadSheetCheck(bidId);
    const current = !!files.length && sc?.status === 'complete' && sc.input_key === inputKeyOf(files) && !!sc.result;
    const client = await anthropicClient();
    const toInventory = (ps: Array<{ documentId?: string; file: string; sha: string; page: number; sheetNo: string; title: string; discipline: string; textChars?: number }>): InventoryPage[] =>
      ps.filter(p => buffers.has(p.sha)).map(p => ({
        documentId: p.documentId, file: p.file, sha: p.sha, page: p.page, sheetNo: p.sheetNo, title: p.title,
        discipline: p.discipline, uploadedAt: p.documentId ? uploadedAt.get(p.documentId) ?? null : null, textChars: p.textChars,
      }));
    let inventory: InventoryPage[] = current ? toInventory(sc!.result!.pages) : [];
    if (!inventory.length && files.length) {
      try {
        const config = await loadAIConfig();
        const built = await buildInventory(files.map(f => ({ originalname: f.originalname, buffer: f.buffer, documentId: (f as { documentId?: string }).documentId, uploadedAt: (f as { uploadedAt?: string | null }).uploadedAt ?? null })),
          { client, classifierModel: config.modelClassifier, visionModel: '', aiRefs: false });
        inventory = toInventory(built.pages);
      } catch (err) { logger.warn({ err, bidId }, '[jobProfile] classification cache read failed — unplaced pages'); }
    }
    if (!inventory.length) {
      for (const f of files) {
        const sha = sha256(f.buffer);
        if (!buffers.has(sha)) continue;
        const n = Math.max(1, texts.get(sha)?.length ?? 1);
        const docId = (f as { documentId?: string }).documentId;
        for (let i = 1; i <= n; i++) inventory.push({ documentId: docId, file: f.originalname, sha, page: i, sheetNo: '', title: '', discipline: 'unknown', uploadedAt: docId ? uploadedAt.get(docId) ?? null : null });
      }
    }
    const textOf = (p: InventoryPage) => texts.get(p.sha)?.[p.page - 1] ?? '';
    const selected = selectProfilePages(inventory, textOf);
    const prepared = prepareProfileInput(selected, textOf);

    const model = ((await getSetting('ai_job_profile_model')) || '').trim() || DEFAULT_JOB_PROFILE_MODEL;
    const promptPages: PromptPage[] = [...prepared.promptPages];
    let usedVision = false;
    if (prepared.needsImage.length && client && await isPdftoppmAvailable()) {
      for (const p of prepared.needsImage.slice(0, MAX_VISION_CROPS)) {
        const buf = buffers.get(p.sha);
        if (!buf) continue;
        try {
          const image = await renderProfileCrop(buf, p.page, p.why);
          if (image) { promptPages.push({ sheet: prepared.pagesUsed.find(u => u.page === p.page && u.file === p.file)?.sheet ?? p.sheetNo, why: p.why, text: '', image }); usedVision = true; }
        } catch (err) { logger.warn({ err, page: p.page }, '[jobProfile] could not render a crop'); }
      }
    }

    let profile: JobProfile;
    let usage = { input_tokens: 0, output_tokens: 0 };
    if (!selected.length) {
      profile = undetermined('No cover or electrical sheet was found in the plans.');
    } else if (!promptPages.length) {
      profile = undetermined('The plans have no text layer and the sheet images could not be read.', prepared.pagesUsed);
    } else {
      if (!client) throw new JobProfileError(503, 'No Anthropic API key is set (Settings → AI) — the plans cannot be read.');
      await pool.query('UPDATE bid_job_profile SET model_called_at=now() WHERE bid_id=$1', [bidId]);
      const call = await callJobProfileModel(client, model, promptPages);
      usage = call.usage;
      const brands = mergeBrands(await listAccountRules().catch(() => []));
      profile = assembleJobProfile({ reply: call.reply, sources: prepared.sources, brands, usedVision, pagesUsed: prepared.pagesUsed, noText: prepared.noText });
    }
    const costCents = jobProfileCostCents(usage, model);
    await applyProfile(bidId, token, profile, { docIds, model, usage, costCents, actor, contentKey: files.length ? inputKeyOf(files) : null });
    return { status: profile.status };
  } catch (err) {
    // Task 2 — the raw error (an Anthropic APIError's JSON body included)
    // stays in the server log only; the panel only ever sees the friendly
    // text below.
    logger.error({ err, bidId }, '[jobProfile] run failed');
    const message = err instanceof JobProfileError ? err.message : friendlyAnthropicError(err);
    await pool.query(`UPDATE bid_job_profile SET status='error', error=$3, updated_at=now() WHERE bid_id=$1 AND run_token=$2`, [bidId, token, message.slice(0, 500)]).catch(() => {});
    return { status: 'error', error: message };
  }
}

// ── Apply (one transaction) ─────────────────────────────────────────────────

/** The card's fields, plan_date as ISO text (review B3: node-postgres would
 *  otherwise hand back a JS Date that never equals "2025-09-22"). */
const CURRENT_SELECT = `SELECT name, ${BID_PROFILE_COLUMNS.map(c => c === 'plan_date' ? `to_char(plan_date, 'YYYY-MM-DD') AS plan_date` : c).join(', ')} FROM bids WHERE id=$1`;

export function currentFieldsFromRow(row: Record<string, unknown>): CurrentBidFields {
  const s = (k: string) => (row[k] as string | null | undefined) ?? null;
  return {
    project_type: s('project_type'), brand: s('brand'), store_number: s('store_number'), prototype: s('prototype'),
    loc: s('loc'), sq_ft: row.sq_ft != null ? Number(row.sq_ft) : null, plan_date: s('plan_date'),
    owner_name: s('owner_name'), architect: s('architect'), engineer: s('engineer'), build_type: s('build_type'),
    name: (row.name as string) ?? '',
  };
}

interface ApplyMeta {
  docIds: string[]; model: string; usage: { input_tokens: number; output_tokens: number }; costCents: number; actor: AuditActor;
  /** The plan set's content key (kept as is when absent). */
  contentKey?: string | null;
  /** Re-applying the stored reply (no model call). */
  reused?: boolean;
}

async function applyProfile(bidId: string, token: string, profile: JobProfile, meta: ApplyMeta): Promise<void> {
  const tx = await pool.connect();
  const audits: Array<{ field: string; before: unknown; after: unknown; tag: string }> = [];
  try {
    await tx.query('BEGIN');
    const { rows: pr } = await tx.query('SELECT run_token, suggestions, fills FROM bid_job_profile WHERE bid_id=$1 FOR UPDATE', [bidId]);
    if (!pr.length || pr[0].run_token !== token) { await tx.query('ROLLBACK'); return; } // superseded by a newer run
    await tx.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [bidId]);
    const { rows: br } = await tx.query(CURRENT_SELECT, [bidId]);
    const current = currentFieldsFromRow(br[0] ?? {});
    const fills: Record<string, FillRecord> = reconcileFills((pr[0].fills ?? {}) as Record<string, FillRecord>, current);
    const plan = computeCardUpdates(current, profile, fills);
    const now = new Date().toISOString();
    for (const f of plan.fills) {
      // S1 — only while the field is still empty; never over a person's value.
      const { rowCount } = await tx.query(
        `UPDATE bids SET ${f.field}=$2, updated_at=now()
          WHERE id=$1 AND (${f.field} IS NULL OR btrim(${f.field}::text) IN ('', '—'))`,
        [bidId, f.value]);
      if (!rowCount) continue;
      fills[f.field] = { value: f.value, at: now, sheet: f.sheet, status: 'filled', ...(fills[f.field]?.rejectedValues ? { rejectedValues: fills[f.field].rejectedValues } : {}) };
      audits.push({ field: f.field, before: (current as unknown as Record<string, unknown>)[f.field] ?? null, after: f.value, tag: f.reasonTag });
    }
    const suggestions = mergeSuggestions(plan.suggestions, (pr[0].suggestions ?? {}) as Record<string, StoredSuggestion>, now);
    await tx.query(
      `UPDATE bid_job_profile SET status=$2, input_key=$3, profile=$4, suggestions=$5, systems=$6, fills=$7, pages_used=$8,
              rejected=$9, usage=$10, model=$11, cost_cents=$12, undetermined_reason=$13, error=NULL, pending_doc_ids=NULL,
              content_key=COALESCE($14, content_key), updated_at=now()
        WHERE bid_id=$1`,
      [bidId, profile.status, meta.docIds.slice().sort().join('|'), JSON.stringify(profile.fields), JSON.stringify(suggestions),
        JSON.stringify(profile.systems), JSON.stringify(fills), JSON.stringify(profile.pagesUsed), JSON.stringify(profile.rejected),
        JSON.stringify(meta.usage), profile.usedVision ? `${meta.model} (vision)` : meta.model, meta.costCents, profile.undeterminedReason ?? null,
        meta.contentKey ?? null]);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
  for (const a of audits) {
    await writeAuditAs(meta.actor, {
      action: 'update', entityType: 'bid', entityId: bidId,
      summary: `${a.field} auto-filled from plans (${a.tag}): "${a.after}"`,
      before: a.before, after: a.after,
    });
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

/** Task 3 (plans-panel fix round) — "142 sheets in set · 23 electrical" used
 *  to count every page of every uploaded PDF, including a bound spec book's
 *  pages. Review B1 fix: this is never the classifier's own discipline (a
 *  "spec" discipline was tried and reverted — it took pages out of
 *  analysis). `specBookPage` (ai/specBookPages.ts) is a separate,
 *  deterministic, text-only annotation that this function is the ONLY
 *  reader of: {total, electrical} describe the plan set only; `specPages`
 *  is reported alongside it (0 when there is no spec book in the upload). */
export function sheetSummaryOf(sc: SheetCheckRow | null): { status: string; total: number; electrical: number; missingRefs: number; specPages: number } | null {
  if (!sc) return null;
  if (!sc.result) return sc.status === 'running' ? { status: 'running', total: 0, electrical: 0, missingRefs: 0, specPages: 0 } : null;
  const planPages = sc.result.pages.filter(p => !p.specBookPage);
  return {
    status: sc.status,
    total: planPages.length,
    electrical: planPages.filter(p => p.role === 'analysis').length,
    missingRefs: sc.result.refs.filter(r => r.status === 'missing').length,
    specPages: sc.result.pages.length - planPages.length,
  };
}

/** GET payload: the profile row, the live sheet summary (S4 — from the
 *  check itself, never a stale snapshot) and the bid. */
/** R2-B2 — on boot: a sheet check or a profile still marked running /
 *  waiting belongs to a process that died; mark it so the panel offers a
 *  re-read instead of waiting forever. */
export async function resetStuckJobProfilesOnBoot(opts: { bidId?: string } = {}): Promise<void> {
  // `bidId` scopes it for tests (the shared test DB has other files' checks
  // running in parallel); on boot it is every row.
  const only = opts.bidId ? ' AND bid_id=$1' : '';
  const args = opts.bidId ? [opts.bidId] : [];
  await pool.query(`UPDATE bid_sheet_check SET status='error', error='Interrupted by a server restart — run the check again.', updated_at=now() WHERE status='running'${only}`, args);
  await pool.query(`UPDATE bid_job_profile SET status='error', error='Interrupted by a server restart — read the plans again.', updated_at=now() WHERE status IN ('waiting','running')${only}`, args);
}

/** R2-B2 — a profile waiting / running longer than STALE_MS has lost its
 *  run: it becomes an error the panel can retry from. */
async function expireStaleProfile(bidId: string): Promise<void> {
  await pool.query(
    `UPDATE bid_job_profile SET status='error', error='The plans took too long to read — read them again.', updated_at=now()
      WHERE bid_id=$1 AND status IN ('waiting','running') AND updated_at < now() - ($2::text || ' milliseconds')::interval`,
    [bidId, String(STALE_MS)]);
}

export async function loadJobProfile(bidId: string) {
  await expireStaleProfile(bidId);
  const { rows } = await pool.query(
    `SELECT status, input_key, profile, suggestions, systems, fills, pages_used, rejected, model, cost_cents, usage,
            error, undetermined_reason, updated_at
       FROM bid_job_profile WHERE bid_id=$1`, [bidId]);
  const sc = await loadSheetCheck(bidId);
  const { rows: bid } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
  return {
    ...(rows[0] ?? { status: 'idle', profile: {}, suggestions: {}, systems: null }),
    // N2 (review eb39943) — a row written before the friendly-error mapping
    // existed can still hold raw JSON; sanitize on every read.
    ...(rows[0] ? { error: sanitizeStoredError(rows[0].error) } : {}),
    sheet_summary: sheetSummaryOf(sc),
    // Round 3 R3-B1 — likely plan revisions to answer on Overview.
    revision_proposals: sc?.result?.revisionProposals ?? [],
    duplicate_sheets: sc?.result?.duplicateSheets ?? [],
    bid: bid[0] ? withDueDays(bid[0]) : null,
  };
}
