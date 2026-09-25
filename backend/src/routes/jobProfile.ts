// Bid Overview: Plans Upload + Job Profile (2026-09-24 plan) — the routes
// behind the Overview panel's "detected profile" and its suggestion chips.
//
//   POST /api/preconstruction/:bidId/job-profile/run   { document_ids }
//        -> extracts the profile from the bid's plan documents (text layer
//           first — cheap; see ai/jobProfile.ts), applies every empty-field
//           fill, computes suggestions for conflicts, and stores both.
//   GET  /api/preconstruction/:bidId/job-profile
//        -> the last-stored profile/suggestions/sheet summary.
//   PUT  /api/preconstruction/:bidId/job-profile/suggestions/:field
//        { action: 'accept' | 'ignore' }
//        -> accept applies the plans' value to the bid (never the client's
//           own copy of it) and logs it; ignore just dismisses the chip
//           until the plans' value for that field changes.
//
// Permissions (Decision 8): NOT run_analysis — this is cheap metadata, not a
// paid takeoff run. Bid-edit access (loadAccessibleBid, the same ownership
// check every other bid-scoped route in this file's family uses) plus the
// same "ai_enabled" master kill switch requireAIPermission checks, read
// directly here since there is no lighter AIPermission variant for it.
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { asyncHandler } from '../utils/asyncHandler';
import { getSetting } from '../db/getSetting';
import { pool } from '../db/pool';
import { writeAudit } from '../utils/audit';
import { gatherAnalysisInputs } from './preconstruction';
import { loadSheetCheck } from '../services/sheetCheck';
import { extractPdfPageTexts } from '../ai/pdfText';
import { extractJobProfile, estimateJobProfileCost, type PageText, type JobProfile, type FieldEvidence } from '../ai/jobProfile';
import {
  computeCardUpdates, type CurrentBidFields, type FieldSuggestion,
} from '../estimating/jobProfileCardRules';

const router = Router();

// A short, best-effort sheet-number guess from a page's own text — this
// route doesn't depend on the (heavier, AI-assisted) sheet-check classifier;
// it only needs "is this page's title block probably an electrical/
// mechanical sheet" for jobProfile.ts's date/engineer preference. A short
// standalone line shaped like a sheet id (letters, then digits, optionally
// a decimal) — never a state code (no digits) and never a prototype code
// (starts with a digit, handled by jobProfile.ts's own PROTOTYPE_RE).
const SHEET_NO_GUESS_RE = /^[A-Z]{1,3}-?\d+(?:\.\d+)?[A-Z]?$/;

function guessSheetNo(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const ln = raw.trim();
    if (SHEET_NO_GUESS_RE.test(ln)) return ln;
  }
  return null;
}

async function buildPagesFromDocuments(bidId: string, docIds: string[]): Promise<{ pages: PageText[]; skippedNonPdf: number }> {
  const { files } = await gatherAnalysisInputs(bidId, [], docIds);
  const pages: PageText[] = [];
  let skippedNonPdf = 0;
  for (const f of files) {
    if (f.mimetype !== 'application/pdf') { skippedNonPdf++; continue; }
    let pageTexts: string[];
    try {
      pageTexts = await extractPdfPageTexts(f.buffer);
    } catch {
      continue; // an unreadable PDF just contributes nothing — never fails the whole run
    }
    pageTexts.forEach((text, i) => {
      pages.push({ page: i + 1, file: f.originalname, sheetNo: guessSheetNo(text), text });
    });
  }
  return { pages, skippedNonPdf };
}

const BID_PROFILE_COLUMNS = [
  'project_type', 'brand', 'store_number', 'prototype', 'loc', 'sq_ft',
  'plan_date', 'owner_name', 'architect', 'engineer', 'build_type',
] as const;

function currentFieldsFromBidRow(row: Record<string, unknown>): CurrentBidFields {
  return {
    project_type: (row.project_type as string) ?? null,
    brand: (row.brand as string) ?? null,
    store_number: (row.store_number as string) ?? null,
    prototype: (row.prototype as string) ?? null,
    loc: (row.loc as string) ?? null,
    sq_ft: row.sq_ft != null ? Number(row.sq_ft) : null,
    plan_date: row.plan_date ? String(row.plan_date).slice(0, 10) : null,
    owner_name: (row.owner_name as string) ?? null,
    architect: (row.architect as string) ?? null,
    engineer: (row.engineer as string) ?? null,
    build_type: (row.build_type as string) ?? null,
    name: (row.name as string) ?? '',
  };
}

interface StoredSuggestion { value: unknown; sheet: string | null; quote: string | null; status: 'pending' | 'accepted' | 'ignored'; at: string; by: string | null }

/** Re-run behavior (Decision 6): a suggestion the user already ignored for
 *  the SAME value stays hidden; a changed plan value (or a suggestion this
 *  is the first time seeing) is pending again. Nothing here re-opens a
 *  suggestion the user already accepted — accepting applies the value to
 *  the bid itself, so the next run simply finds the field already agrees
 *  (computeCardUpdates emits neither a fill nor a suggestion for it). */
function mergeSuggestions(
  fresh: FieldSuggestion[], previous: Record<string, StoredSuggestion> | null | undefined,
): Record<string, StoredSuggestion> {
  const out: Record<string, StoredSuggestion> = {};
  for (const s of fresh) {
    const prior = previous?.[s.field];
    const same = prior && JSON.stringify(prior.value) === JSON.stringify(s.suggestedValue);
    out[s.field] = same
      ? prior
      : { value: s.suggestedValue, sheet: s.sheet, quote: s.quote, status: 'pending', at: new Date().toISOString(), by: null };
  }
  return out;
}

function evidenceToJson(fields: JobProfile['fields']): Record<string, FieldEvidence> {
  return fields as Record<string, FieldEvidence>;
}

router.get('/:bidId/job-profile', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;
  const { rows } = await pool.query(
    `SELECT input_key, profile, suggestions, sheet_summary, model, cost_cents, updated_at
       FROM bid_job_profile WHERE bid_id=$1`, [req.params.bidId],
  );
  res.json(rows[0] ?? null);
}));

router.post('/:bidId/job-profile/run', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  // Decision 8 — the master kill switch, not the (heavier, quota-limited)
  // run_analysis permission: this step never calls a model in the
  // text-layer path, and the vision fallback it may one day take is still
  // metadata-cheap, not a takeoff run.
  const aiEnabled = await getSetting('ai_enabled');
  if (aiEnabled === 'false') return res.status(503).json({ error: 'AI features are currently disabled by an administrator.' });

  const rawDocIds = req.body.document_ids;
  const docIds: string[] = Array.isArray(rawDocIds)
    ? (rawDocIds as string[]).filter(Boolean)
    : (typeof rawDocIds === 'string' && rawDocIds.trim()) ? [rawDocIds.trim()] : [];
  if (!docIds.length) return res.status(400).json({ error: 'document_ids required — select at least one plan file.' });

  const { pages } = await buildPagesFromDocuments(bidId, docIds);
  const profile = extractJobProfile(pages);
  const usedVision = profile.usedVision; // always false today — see ai/jobProfile.ts's header note
  const costCents = estimateJobProfileCost(usedVision ? 1 : 0);

  const { rows: bidRows } = await pool.query(
    `SELECT name, gc, ${BID_PROFILE_COLUMNS.join(', ')} FROM bids WHERE id=$1`, [bidId],
  );
  const current = currentFieldsFromBidRow(bidRows[0] ?? {});
  const plan = computeCardUpdates(current, profile);

  const by = req.user?.name || req.user?.email || 'estimator';
  if (plan.fills.length) {
    const setSql = plan.fills.map((f, i) => `${f.field}=$${i + 2}`).join(', ');
    await pool.query(`UPDATE bids SET ${setSql}, updated_at=now() WHERE id=$1`, [bidId, ...plan.fills.map(f => f.value)]);
    for (const f of plan.fills) {
      await writeAudit(req, {
        action: 'update', entityType: 'bid', entityId: bidId,
        summary: `${f.field} auto-filled from plans (${f.reasonTag}): "${f.value}"`,
        before: null, after: f.value,
      });
    }
  }

  const { rows: existingRows } = await pool.query(`SELECT suggestions FROM bid_job_profile WHERE bid_id=$1`, [bidId]);
  const suggestions = mergeSuggestions(plan.suggestions, existingRows[0]?.suggestions ?? null);

  const sheetCheckRow = await loadSheetCheck(bidId);
  const sheetSummary = sheetCheckRow?.result ? {
    total: sheetCheckRow.result.pages.length,
    electrical: sheetCheckRow.result.pages.filter(p => p.role === 'analysis').length,
    missingRefs: sheetCheckRow.result.refs.filter(r => r.status === 'missing').length,
  } : null;

  await pool.query(
    `INSERT INTO bid_job_profile (bid_id, input_key, profile, suggestions, sheet_summary, model, cost_cents, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT (bid_id) DO UPDATE SET input_key=$2, profile=$3, suggestions=$4, sheet_summary=$5, model=$6, cost_cents=$7, updated_at=now()`,
    [bidId, docIds.slice().sort().join('|'), JSON.stringify(evidenceToJson(profile.fields)), JSON.stringify(suggestions),
      sheetSummary ? JSON.stringify(sheetSummary) : null, usedVision ? 'vision-fallback' : 'text-only', costCents],
  );

  const { rows: updatedBid } = await pool.query(`SELECT * FROM bids WHERE id=$1`, [bidId]);
  res.json({
    bid: updatedBid[0], profile: profile.fields, systems: profile.systems, suggestions,
    sheetSummary, fillsApplied: plan.fills.map(f => f.field), costCents, by,
  });
}));

// SQL safety: `field` reaches an UPDATE ... SET ${field}=$2 below — it MUST
// be checked against this exact allowlist before ever touching a query
// string. This is also the enforcement point for "gc is never touched": gc
// is not in this list, so PUT .../suggestions/gc 400s before anything else
// runs, no matter what jobProfileCardRules.ts does or doesn't emit.
const SUGGESTIBLE_FIELDS: ReadonlySet<string> = new Set([
  'project_type', 'brand', 'store_number', 'prototype', 'loc', 'sq_ft',
  'plan_date', 'owner_name', 'architect', 'engineer', 'build_type', 'name',
]);

router.put('/:bidId/job-profile/suggestions/:field', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const field = req.params.field;
  if (!SUGGESTIBLE_FIELDS.has(field)) return res.status(400).json({ error: 'Unknown or unsupported field.' });
  const action = String(req.body?.action ?? '');
  if (action !== 'accept' && action !== 'ignore') return res.status(400).json({ error: 'action must be "accept" or "ignore".' });

  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query(`SELECT suggestions FROM bid_job_profile WHERE bid_id=$1 FOR UPDATE`, [bidId]);
    const suggestions: Record<string, StoredSuggestion> = rows[0]?.suggestions ?? {};
    const s = suggestions[field];
    if (!s || s.status !== 'pending') {
      await tx.query('ROLLBACK');
      return res.status(404).json({ error: 'No pending suggestion for that field.' });
    }
    const by = req.user?.name || req.user?.email || 'estimator';
    const at = new Date().toISOString();

    if (action === 'accept') {
      // name is never a plain column write — every other suggested field
      // maps 1:1 to a bids column (gc is never a suggestion in the first
      // place — jobProfileCardRules.ts never emits one).
      await tx.query(`UPDATE bids SET ${field}=$2, updated_at=now() WHERE id=$1`, [bidId, s.value]);
      await writeAudit(req, {
        action: 'update', entityType: 'bid', entityId: bidId,
        summary: `${field} accepted suggestion from plans${s.sheet ? ` (sheet ${s.sheet})` : ''}: "${s.value}"`,
        before: null, after: s.value,
      });
      suggestions[field] = { ...s, status: 'accepted', at, by };
    } else {
      await writeAudit(req, {
        action: 'ai_override', entityType: 'bid', entityId: bidId,
        summary: `${field} suggestion from plans dismissed: "${s.value}"`,
        before: s.value, after: null,
      });
      suggestions[field] = { ...s, status: 'ignored', at, by };
    }

    await tx.query(`UPDATE bid_job_profile SET suggestions=$2, updated_at=now() WHERE bid_id=$1`, [bidId, JSON.stringify(suggestions)]);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }

  const { rows: updatedBid } = await pool.query(`SELECT * FROM bids WHERE id=$1`, [bidId]);
  res.json({ bid: updatedBid[0] });
}));

export default router;
