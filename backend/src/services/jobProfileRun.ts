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
import { claimSheetCheck, runSheetCheck, loadSheetCheck, inputKeyOf, sha256, type SheetCheckRow } from './sheetCheck';
import { extractPdfPageTexts } from '../ai/pdfText';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { titleBlockCropRect } from '../ai/pageClassifier';
import { listAccountRules } from '../bidstd/accountRulesDb';
import {
  selectProfilePages, prepareProfileInput, assembleJobProfile, callJobProfileModel, jobProfileCostCents, undetermined,
  DEFAULT_JOB_PROFILE_MODEL, type InventoryPage, type JobProfile, type PromptPage, type SelectedPage,
} from '../ai/jobProfile';
import { mergeBrands } from '../ai/jobProfileValidators';
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

/** Start (or queue) a profile run for the bid's current plans. */
export async function requestJobProfile(bidId: string, requested: string[] | null, actor: AuditActor): Promise<RunOutcome> {
  const docs = await eligiblePlanDocs(bidId, requested);
  if (!docs.length) throw new JobProfileError(400, 'No plan files on this bid to read — upload the plans first.');
  const docIds = docs.map(d => d.id);
  const { files } = await gatherAnalysisInputs(bidId, [], docIds);
  if (!files.length) throw new JobProfileError(400, 'The plan files could not be read.');
  const inputKey = inputKeyOf(files);

  const token = crypto.randomUUID();
  await pool.query(
    `INSERT INTO bid_job_profile (bid_id, status, run_token, pending_doc_ids, requested_by, updated_at)
     VALUES ($1, 'waiting', $2, $3, $4, now())
     ON CONFLICT (bid_id) DO UPDATE SET status='waiting', run_token=$2, pending_doc_ids=$3, requested_by=$4, error=NULL, updated_at=now()`,
    [bidId, token, docIds, JSON.stringify(actor)]);

  const sc = await loadSheetCheck(bidId);
  const current = sc && sc.input_key === inputKey;
  if (current && sc.status === 'running') return { status: 'waiting' };
  if (current && (sc.status === 'complete' || sc.status === 'error')) return runJobProfileNow(bidId, token);

  // No sheet check for exactly these files yet: start one; the profile runs
  // when it completes (fix round Decision 1 / review S4).
  const client = await anthropicClient();
  const config = await loadAIConfig();
  const checkToken = await claimSheetCheck(bidId, inputKey);
  void runSheetCheck(bidId, checkToken, files.map(f => ({ originalname: f.originalname, buffer: f.buffer, documentId: (f as { documentId?: string }).documentId })), {
    client, classifierModel: config.modelClassifier, visionModel: config.modelRefVision, aiRefs: true,
  }).then(() => resumeAfterSheetCheck(bidId)).catch(err => logger.warn({ err, bidId }, '[jobProfile] resume after sheet check failed'));
  return { status: 'waiting' };
}

/** Called whenever a sheet check finishes (this module's own, or the
 *  Documents step's — including its per-sheet Upload, review S9). A waiting
 *  profile runs now; a finished profile re-runs when the check was made for
 *  the bid's current plan files and those files changed since. */
export async function resumeAfterSheetCheck(bidId: string): Promise<void> {
  const { rows } = await pool.query('SELECT status, run_token, input_key, requested_by FROM bid_job_profile WHERE bid_id=$1', [bidId]);
  const row = rows[0];
  if (!row) return;
  if (row.status === 'waiting' && row.run_token) { await runJobProfileNow(bidId, row.run_token); return; }
  if (row.status === 'running') return;
  const docs = await eligiblePlanDocs(bidId, null);
  const key = docs.map(d => d.id).sort().join('|');
  if (!docs.length || key === row.input_key) return;
  const { files } = await gatherAnalysisInputs(bidId, [], docs.map(d => d.id));
  const sc = await loadSheetCheck(bidId);
  if (!files.length || sc?.status !== 'complete' || sc.input_key !== inputKeyOf(files)) return;
  const actor = (row.requested_by as AuditActor | null) ?? { id: null, name: 'Job profile (plans changed)' };
  await requestJobProfile(bidId, null, actor);
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
    `UPDATE bid_job_profile SET status='running', updated_at=now() WHERE bid_id=$1 AND run_token=$2
     RETURNING pending_doc_ids, requested_by`, [bidId, token]);
  if (!claimed.length) return { status: 'waiting' }; // a newer run owns the row
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

    // The sheet check's inventory, when it was made for exactly these files.
    const sc: SheetCheckRow | null = await loadSheetCheck(bidId);
    const current = !!files.length && sc?.status === 'complete' && sc.input_key === inputKeyOf(files) && !!sc.result;
    let inventory: InventoryPage[] = current
      ? sc!.result!.pages.filter(p => buffers.has(p.sha)).map(p => ({
          documentId: p.documentId, file: p.file, sha: p.sha, page: p.page, sheetNo: p.sheetNo, title: p.title,
          discipline: p.discipline, uploadedAt: p.documentId ? uploadedAt.get(p.documentId) ?? null : null, textChars: p.textChars,
        }))
      : [];
    if (!inventory.length) {
      // No classification (no key, or the check failed): each file's pages
      // unplaced — the selection falls back to each file's first page.
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
    const client = await anthropicClient();
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
      const call = await callJobProfileModel(client, model, promptPages);
      usage = call.usage;
      const brands = mergeBrands(await listAccountRules().catch(() => []));
      profile = assembleJobProfile({ reply: call.reply, sources: prepared.sources, brands, usedVision, pagesUsed: prepared.pagesUsed, noText: prepared.noText });
    }
    const costCents = jobProfileCostCents(usage, model);
    await applyProfile(bidId, token, profile, { docIds, model, usage, costCents, actor });
    return { status: profile.status };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    logger.error({ err, bidId }, '[jobProfile] run failed');
    await pool.query(`UPDATE bid_job_profile SET status='error', error=$3, updated_at=now() WHERE bid_id=$1 AND run_token=$2`, [bidId, token, message]).catch(() => {});
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

interface ApplyMeta { docIds: string[]; model: string; usage: { input_tokens: number; output_tokens: number }; costCents: number; actor: AuditActor }

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
              rejected=$9, usage=$10, model=$11, cost_cents=$12, undetermined_reason=$13, error=NULL, pending_doc_ids=NULL, updated_at=now()
        WHERE bid_id=$1`,
      [bidId, profile.status, meta.docIds.slice().sort().join('|'), JSON.stringify(profile.fields), JSON.stringify(suggestions),
        JSON.stringify(profile.systems), JSON.stringify(fills), JSON.stringify(profile.pagesUsed), JSON.stringify(profile.rejected),
        JSON.stringify(meta.usage), profile.usedVision ? `${meta.model} (vision)` : meta.model, meta.costCents, profile.undeterminedReason ?? null]);
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

export function sheetSummaryOf(sc: SheetCheckRow | null): { status: string; total: number; electrical: number; missingRefs: number } | null {
  if (!sc) return null;
  if (!sc.result) return sc.status === 'running' ? { status: 'running', total: 0, electrical: 0, missingRefs: 0 } : null;
  return {
    status: sc.status,
    total: sc.result.pages.length,
    electrical: sc.result.pages.filter(p => p.role === 'analysis').length,
    missingRefs: sc.result.refs.filter(r => r.status === 'missing').length,
  };
}

/** GET payload: the profile row, the live sheet summary (S4 — from the
 *  check itself, never a stale snapshot) and the bid. */
export async function loadJobProfile(bidId: string) {
  const { rows } = await pool.query(
    `SELECT status, input_key, profile, suggestions, systems, fills, pages_used, rejected, model, cost_cents, usage,
            error, undetermined_reason, updated_at
       FROM bid_job_profile WHERE bid_id=$1`, [bidId]);
  const sc = await loadSheetCheck(bidId);
  const { rows: bid } = await pool.query('SELECT * FROM bids WHERE id=$1', [bidId]);
  return {
    ...(rows[0] ?? { status: 'idle', profile: {}, suggestions: {}, systems: null }),
    sheet_summary: sheetSummaryOf(sc),
    bid: bid[0] ? withDueDays(bid[0]) : null,
  };
}
