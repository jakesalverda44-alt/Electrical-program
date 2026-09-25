// Bid Overview: Plans Upload + Job Profile — the routes behind the Overview
// panel. The work itself lives in services/jobProfileRun.ts (job profile fix
// round, review 1755e62).
//
//   POST /api/preconstruction/:bidId/job-profile/run   { document_ids?, force? }
//        -> reads the bid's CURRENT plan documents (optionally narrowed to
//           document_ids — every id must be this bid's own). 202 {status:
//           'waiting'} while the sheet check for those files is still running
//           (the profile runs when it completes); 200 with the profile once
//           it has run.
//   GET  /api/preconstruction/:bidId/job-profile
//        -> status, profile, suggestions, systems, the live sheet summary and
//           the bid (the panel polls this while the status is waiting/running).
//   PUT  /api/preconstruction/:bidId/job-profile/suggestions/:field
//        { action: 'accept' | 'ignore' }
//        -> accept applies the plans' stored value (never the client's copy)
//           and logs it with the card's previous value; ignore dismisses the
//           chip until the plans' value changes.
//   DELETE /api/preconstruction/:bidId/plan-files/:docId
//        -> plans-panel fix round, Task 1: soft-deletes one of this bid's
//           plan documents (the existing documents Trash path — restorable
//           from Settings -> Trash, or by the same user within the usual
//           restore window), then refreshes the job profile for the files
//           that remain. Never a hard delete, and never admin-only — the
//           same roles that can upload plans (or the AI view_results
//           permission) may remove one.
//   POST /api/preconstruction/:bidId/plan-files/:docId/restore
//        -> fix round (review eb39943, S4): Undo for the above — restores
//           the document and refreshes, so the sheet summary is never left
//           stale after an Undo.
//   POST /api/preconstruction/:bidId/plan-files/replace  (multipart: files)
//        -> fix round (review eb39943, S1/S2): "Replace plan set" as ONE
//           server-side, all-or-nothing operation. Every new file is stored
//           first; if any fails, the ones that DID upload are trashed again
//           and the old set is untouched — the response names the file that
//           failed. Only once every new file is stored are the bid's
//           PREVIOUS plan files trashed, and the job profile refreshes
//           exactly ONCE (never once per removed file).
//   POST /api/preconstruction/:bidId/plan-files/replace/undo
//        { removedIds, uploadedIds }
//        -> fix round S2: Undo for a replace, as ONE action — restores the
//           old files AND trashes the replacement files, then one refresh.
//
// Permissions (Decision 8): NOT run_analysis — bid-edit access
// (loadAccessibleBid) plus the ai_enabled master kill switch.
import { Router, Response } from 'express';
import { requireAuth, AuthRequest, hasAIPermission } from '../middleware/auth';
import { loadAccessibleBid } from '../utils/ownership';
import { asyncHandler } from '../utils/asyncHandler';
import { getSetting } from '../db/getSetting';
import { pool } from '../db/pool';
import { writeAudit } from '../utils/audit';
import type { AuditActor } from '../utils/audit';
import { withDueDays } from '../utils/dueDate';
import { requestJobProfile, loadJobProfile, JobProfileError, refreshAfterPlanFilesChanged } from '../services/jobProfileRun';
import type { StoredSuggestion } from '../estimating/jobProfileCardRules';
import { applySelection, loadSheetCheck, type RevisionDecision, type RevisionProposal } from '../services/sheetCheck';
import { canRestore } from '../middleware/auth';
import { documentUpload } from '../utils/upload';
import { storeDocument } from '../utils/storeDocument';
import { logger } from '../utils/logger';

const router = Router();

// N1 (review eb39943) — a malformed id used to reach `WHERE id=$1` on a uuid
// column and surface as a raw 500 (Postgres' cast error). Every plan-files
// route below validates the shape first and 404s instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles that edit bid cards (and upload their plans). */
const BID_EDIT_ROLES: ReadonlySet<string> = new Set([
  'owner', 'administrator', 'manager', 'estimator', 'sales_manager', 'salesperson', 'salesperson_legacy', 'project_manager',
]);

/** Same gate as reading the plans (Decision 8 / R2-S2): never admin-only. */
async function canEditPlans(user: NonNullable<AuthRequest['user']>): Promise<boolean> {
  return BID_EDIT_ROLES.has(user.role) || (await hasAIPermission(user, 'view_results'));
}

function actorFrom(req: AuthRequest): AuditActor {
  return { id: req.user?.id ?? null, name: req.user?.name ?? req.user?.email ?? null };
}

router.get('/:bidId/job-profile', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;
  res.json(await loadJobProfile(req.params.bidId));
}));

router.post('/:bidId/job-profile/run', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  const aiEnabled = await getSetting('ai_enabled');
  if (aiEnabled === 'false') return res.status(503).json({ error: 'AI features are currently disabled by an administrator.' });
  // Round 2 (R2-S2) — reading the plans makes a paid model call: a role that
  // edits bids (the people who upload plans, sales included) or one with the
  // AI view_results permission. read_only / technician / accounting cannot.
  if (!BID_EDIT_ROLES.has(req.user!.role) && !(await hasAIPermission(req.user!, 'view_results'))) {
    return res.status(403).json({ error: 'Reading the plans is not available for your role.' });
  }

  const raw = req.body?.document_ids;
  const docIds: string[] | null = Array.isArray(raw)
    ? (raw as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim())
    : (typeof raw === 'string' && raw.trim()) ? [raw.trim()] : null;
  try {
    const force = req.body?.force === true || req.body?.force === 'true';
    const outcome = await requestJobProfile(bidId, docIds?.length ? docIds : null, { id: req.user?.id ?? null, name: req.user?.name ?? req.user?.email ?? null }, { force });
    const payload = await loadJobProfile(bidId);
    res.status(outcome.status === 'waiting' ? 202 : 200).json({ ...payload, status: payload.status ?? outcome.status });
  } catch (err) {
    if (err instanceof JobProfileError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

// SQL safety: `field` reaches an UPDATE ... SET ${field}=$2 below — it MUST
// be checked against this exact allowlist first. This is also the
// enforcement point for "gc is never touched": gc is not in this list.
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
  let audit: { action: string; summary: string; before: unknown; after: unknown } | null = null;
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
      // Every suggestible field — name included — is a plain column on bids
      // (the allowlist above is what keeps this safe; gc is not in it). N2 —
      // the audit entry carries the card's previous value.
      const col = field === 'plan_date' ? `to_char(plan_date, 'YYYY-MM-DD') AS plan_date` : field;
      const { rows: prev } = await tx.query(`SELECT ${col} FROM bids WHERE id=$1 FOR UPDATE`, [bidId]);
      await tx.query(`UPDATE bids SET ${field}=$2, updated_at=now() WHERE id=$1`, [bidId, s.value]);
      audit = {
        action: 'update', before: prev[0]?.[field] ?? null, after: s.value,
        summary: `${field} accepted suggestion from plans${s.sheet ? ` (sheet ${s.sheet})` : ''}: "${s.value}"`,
      };
      suggestions[field] = { ...s, status: 'accepted', at, by };
    } else {
      audit = { action: 'ai_override', before: s.value, after: null, summary: `${field} suggestion from plans dismissed: "${s.value}"` };
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
  if (audit) await writeAudit(req, { entityType: 'bid', entityId: bidId, ...audit });

  const { rows: updatedBid } = await pool.query(`SELECT * FROM bids WHERE id=$1`, [bidId]);
  res.json({ bid: withDueDays(updatedBid[0]) });
}));

// Round 3 R3-B1 — the estimator's answer to "Rev 2 appears to replace Rev 1":
// Replace (the older file's matching sheets leave the analysis) or Keep both.
// Stored per file pair on the bid's sheet check and audited.
router.put('/:bidId/plan-revisions', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  if (!BID_EDIT_ROLES.has(req.user!.role) && !(await hasAIPermission(req.user!, 'view_results'))) {
    return res.status(403).json({ error: 'Answering plan revisions is not available for your role.' });
  }
  const id = String(req.body?.id ?? '');
  const decision = String(req.body?.decision ?? '');
  if (decision !== 'replace' && decision !== 'keep_both') return res.status(400).json({ error: 'decision must be "replace" or "keep_both".' });
  const by = req.user?.name || req.user?.email || 'estimator';
  const at = new Date().toISOString();
  const tx = await pool.connect();
  let proposal: RevisionProposal | undefined;
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query('SELECT result, overrides, revision_decisions FROM bid_sheet_check WHERE bid_id=$1 FOR UPDATE', [bidId]);
    const row = rows[0];
    proposal = (row?.result?.revisionProposals as RevisionProposal[] | undefined)?.find(p => p.id === id);
    if (!row?.result || !proposal) { await tx.query('ROLLBACK'); return res.status(404).json({ error: 'No such plan revision proposal.' }); }
    const decisions: Record<string, RevisionDecision> = { ...(row.revision_decisions ?? {}), [id]: { decision, by, at } };
    const sel = applySelection(row.result.pages, row.overrides ?? {}, decisions);
    await tx.query('UPDATE bid_sheet_check SET revision_decisions=$2, result=$3, updated_at=now() WHERE bid_id=$1',
      [bidId, JSON.stringify(decisions), JSON.stringify({ ...row.result, pages: sel.pages, refs: sel.refs, revisionProposals: sel.revisionProposals, duplicateSheets: sel.duplicateSheets })]);
    await tx.query('COMMIT');
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
  await writeAudit(req, {
    action: 'update', entityType: 'bid', entityId: bidId,
    summary: decision === 'replace'
      ? `Plan revision: ${proposal!.newerFile} replaces ${proposal!.olderFile} for analysis (${proposal!.matchingSheets.length} matching sheets)`
      : `Plan revision: kept both ${proposal!.olderFile} and ${proposal!.newerFile} in the analysis`,
    before: null, after: { id, decision },
  });
  const sc = await loadSheetCheck(bidId);
  res.json({ revisionProposals: sc?.result?.revisionProposals ?? [], duplicateSheets: sc?.result?.duplicateSheets ?? [] });
}));

// Plans-panel fix round, Task 1 — remove ("x") / "Replace plan set" both
// soft-delete through this route. Same role gate as reading the plans
// (BID_EDIT_ROLES or the AI view_results permission) — never admin-only, so
// the roles that upload plans can also take one down. Soft delete only: it
// is the exact same Trash a document ever goes to (restorable via the
// existing POST /documents/:id/restore, same as any other document's Undo).
router.delete('/:bidId/plan-files/:docId', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  if (!UUID_RE.test(req.params.docId)) return res.status(404).json({ error: 'Plan file not found on this bid.' });
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  if (!(await canEditPlans(req.user!))) {
    return res.status(403).json({ error: 'Removing plan files is not available for your role.' });
  }
  const { rows } = await pool.query(
    `UPDATE documents SET deleted_at=now(), deleted_by=$3
      WHERE id=$1 AND linked_id=$2::text AND category='plans' AND deleted_at IS NULL
      RETURNING id, name, display_name`,
    [req.params.docId, bidId, req.user!.id]);
  if (!rows.length) return res.status(404).json({ error: 'Plan file not found on this bid.' });
  await writeAudit(req, {
    action: 'delete', entityType: 'document', entityId: rows[0].id,
    summary: `Removed plan file "${rows[0].display_name || rows[0].name}" from bid Overview (Trash)`,
  });
  // Refresh the job profile for what remains — never the takeoff's own
  // results, and never claims Estimating's own selection-specific sheet
  // check (see refreshAfterPlanFilesChanged, review S3).
  await refreshAfterPlanFilesChanged(bidId, actorFrom(req));
  res.json({ ok: true, id: rows[0].id, ...(await loadJobProfile(bidId)) });
}));

// Review S4 — Undo for the DELETE above must refresh too, or the sheet
// summary is left describing a smaller set than the bid now has.
router.post('/:bidId/plan-files/:docId/restore', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  if (!UUID_RE.test(req.params.docId)) return res.status(404).json({ error: 'Plan file not found in Trash.' });
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  const { rows: existing } = await pool.query(
    `SELECT deleted_by, deleted_at FROM documents WHERE id=$1 AND linked_id=$2::text AND category='plans' AND deleted_at IS NOT NULL`,
    [req.params.docId, bidId]);
  if (!existing.length) return res.status(404).json({ error: 'Plan file not found in Trash.' });
  if (!canRestore(req.user!, existing[0])) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const { rows } = await pool.query(
    `UPDATE documents SET deleted_at=NULL, deleted_by=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id, name, display_name`,
    [req.params.docId]);
  if (!rows.length) return res.status(404).json({ error: 'Plan file not found in Trash.' });
  await writeAudit(req, {
    action: 'restore', entityType: 'document', entityId: rows[0].id,
    summary: `Restored plan file "${rows[0].display_name || rows[0].name}"`,
  });
  await refreshAfterPlanFilesChanged(bidId, actorFrom(req));
  res.json({ ok: true, id: rows[0].id, ...(await loadJobProfile(bidId)) });
}));

interface ReplacedDoc { id: string; name: string }

// Review S1/S2 — "Replace plan set" as ONE server-side, all-or-nothing
// operation: every new file is stored first; a failure trashes whatever DID
// upload and leaves the old set untouched; only once every new file is
// stored are the old files trashed; the job profile refreshes exactly ONCE.
router.post('/:bidId/plan-files/replace', requireAuth, documentUpload.array('files', 50), asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  if (!(await canEditPlans(req.user!))) {
    return res.status(403).json({ error: 'Replacing the plan set is not available for your role.' });
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'No files were uploaded.' });

  const { rows: oldDocs } = await pool.query<{ id: string; name: string; display_name: string | null }>(
    `SELECT id, name, display_name FROM documents WHERE linked_id=$1::text AND category='plans' AND deleted_at IS NULL`,
    [bidId]);

  const uploaded: ReplacedDoc[] = [];
  let failedFile: string | null = null;
  try {
    for (const f of files) {
      failedFile = f.originalname;
      // skipDedupe — the old files are still on the bid while these upload;
      // identical bytes to one of them is exactly what "replace" expects,
      // not a duplicate to collapse.
      const doc = await storeDocument({
        file: f, linkedId: bidId, linkedName: bid.name, div: 'elec', category: 'plans',
        displayName: f.originalname, uploadedBy: req.user!.name, skipDedupe: true,
      });
      uploaded.push({ id: doc.id, name: doc.display_name || doc.name });
    }
  } catch (err) {
    logger.error({ err, bidId, failedFile }, '[jobProfile] replace: an upload failed — rolling back');
    if (uploaded.length) {
      await pool.query(`UPDATE documents SET deleted_at=now(), deleted_by=$2 WHERE id = ANY($1::uuid[])`, [uploaded.map(u => u.id), req.user!.id])
        .catch(rollbackErr => logger.error({ err: rollbackErr, bidId }, '[jobProfile] replace: rollback of the partial upload also failed'));
    }
    // 400, not 5xx — the frontend's generic error handling folds every 5xx
    // into "Server error" and drops the specific message; this one names the
    // file that failed and must reach the panel as written.
    return res.status(400).json({ error: `Could not upload "${failedFile}" — the plan set was not changed.` });
  }

  // Only now: the files that were current before this replace move to Trash.
  const removed: ReplacedDoc[] = [];
  const failedRemovals: string[] = [];
  for (const d of oldDocs) {
    const { rowCount } = await pool.query(`UPDATE documents SET deleted_at=now(), deleted_by=$2 WHERE id=$1 AND deleted_at IS NULL`, [d.id, req.user!.id]);
    if (rowCount) removed.push({ id: d.id, name: d.display_name || d.name });
    else failedRemovals.push(d.display_name || d.name); // surfaced below, never silently dropped
  }
  await writeAudit(req, {
    action: 'update', entityType: 'bid', entityId: bidId,
    summary: `Replaced the plan set: ${uploaded.map(u => u.name).join(', ')} — ${removed.length} previous file${removed.length === 1 ? '' : 's'} moved to Trash`
      + (failedRemovals.length ? `; could not remove: ${failedRemovals.join(', ')}` : ''),
  });
  // ONE refresh for the whole replace (review S1) — never claims
  // Estimating's own selection-specific check (review S3).
  await refreshAfterPlanFilesChanged(bidId, actorFrom(req));
  res.json({ ok: true, uploaded, removed, failedRemovals, ...(await loadJobProfile(bidId)) });
}));

// Review S2 — Undo for a replace is one action: restore the old files AND
// trash the replacement files, then one refresh.
router.post('/:bidId/plan-files/replace/undo', requireAuth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const bidId = req.params.bidId;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;
  const removedIds = Array.isArray(req.body?.removedIds) ? (req.body.removedIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  const uploadedIds = Array.isArray(req.body?.uploadedIds) ? (req.body.uploadedIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];
  if (!removedIds.length && !uploadedIds.length) return res.status(400).json({ error: 'Nothing to undo.' });

  if (removedIds.length) {
    const { rows: existing } = await pool.query(
      `SELECT id, deleted_by, deleted_at FROM documents WHERE id = ANY($1::uuid[]) AND linked_id=$2::text AND category='plans' AND deleted_at IS NOT NULL`,
      [removedIds, bidId]);
    const restorable = existing.filter(r => canRestore(req.user!, r));
    if (restorable.length) {
      await pool.query(`UPDATE documents SET deleted_at=NULL, deleted_by=NULL WHERE id = ANY($1::uuid[])`, [restorable.map(r => r.id)]);
    }
  }
  if (uploadedIds.length) {
    await pool.query(
      `UPDATE documents SET deleted_at=now(), deleted_by=$3 WHERE id = ANY($1::uuid[]) AND linked_id=$2::text AND category='plans' AND deleted_at IS NULL`,
      [uploadedIds, bidId, req.user!.id]);
  }
  await writeAudit(req, {
    action: 'update', entityType: 'bid', entityId: bidId,
    summary: `Undid a plan set replace: restored ${removedIds.length} file${removedIds.length === 1 ? '' : 's'}, removed ${uploadedIds.length} replacement file${uploadedIds.length === 1 ? '' : 's'}`,
  });
  // ONE refresh for the whole undo (review S2/S4).
  await refreshAfterPlanFilesChanged(bidId, actorFrom(req));
  res.json({ ok: true, ...(await loadJobProfile(bidId)) });
}));

export default router;
