import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { writeAudit, writeAuditAs } from '../utils/audit';
import { setProjectDeleted } from '../utils/project';
import { parseDueDays, withDueDays, formatDue } from '../utils/dueDate';
import { logger } from '../utils/logger';
import { asyncHandler } from '../utils/asyncHandler';
import { sendBidNotification } from '../email/bidNotification';
import { loadBidDocumentsAsAttachments, fetchDocBytes, attachmentFileName, DocRow } from '../email/bidAttachments';
import { graphSendMail, graphCreateDraft, isGraphMailConfigured, GraphAttachment, TEAM_NOTIFY_TO } from '../email/graphMailer';
import { escapeHtml } from '../utils/escapeHtml';
import { sendPushToUsers } from '../integrations/webPush';
import {
  defaultSubmittalSubject, defaultSubmittalBodyText, buildBidSubmittalHtml,
  defaultPrebidChrisSubject, buildPrebidChrisBodyHtml,
} from '../email/bidSubmittalEmail';
import { getSetting } from '../db/getSetting';
import { resolveCustomer } from './customers';
import { BidData } from '../bidstd/bidData';
import { renderBidHtml } from '../bidstd/proposalHtml';
import { createNotification } from '../notifications/engine';
import { ownerAdminIds } from '../notifications/prefs';
import {
  createJobFolder,
  createSubfolders,
  moveJobToStage,
  jobFolderName,
  BID_SUBFOLDER_NAMES,
  ESTIMATING_ACTIVE_BIDS_ROOT,
  ESTIMATING_SUBMITTED_BIDS_ROOT,
  ACTIVE_PROJECTS_ROOT,
  listFolderFiles,
  COMPLETED_PROJECTS_ROOT,
} from '../services/googleDrive';
import { VALID_BID_STAGES, transitionBidStage, applyBidStagePostCommit } from '../services/bidStage';

const router = Router();

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const params: unknown[] = [];
  const where: string[] = ['deleted_at IS NULL', 'closed_at IS NULL'];
  if (scope) { params.push(scope); where.push(`salesperson_id = $${params.length}`); }
  let sql = `SELECT * FROM bids WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  // Opt-in pagination: ?limit=N&offset=M. Omitted → return all rows (backward compatible).
  if (req.query.limit !== undefined) {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const { rows } = await pool.query(sql, params);
  res.json(rows.map(withDueDays));
});

// Distinct brand names captured on bids, for autocomplete/filter UIs. Registered above any
// `/:id`-style route so the literal `meta` segment isn't swallowed by an id param matcher.
router.get('/meta/brands', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT brand FROM bids WHERE brand IS NOT NULL AND deleted_at IS NULL ORDER BY brand`
  );
  res.json(rows.map(r => r.brand));
});

// Restricted (rep) users may only act on their own bids. Returns the bid row if allowed,
// or sends the appropriate 403/404 and returns null.
async function loadOwnedBid(req: AuthRequest, res: import('express').Response) {
  const { rows } = await pool.query('SELECT * FROM bids WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return null; }
  const scope = ownScopeId(req.user!);
  if (scope && rows[0].salesperson_id !== scope) {
    res.status(403).json({ error: 'You do not have access to this bid' });
    return null;
  }
  return rows[0];
}

// Create the "Active Bids/GC/Job" Drive folder + standard subfolders for a bid and persist
// the folder ids onto the bid row (mutating `bid` in place). Shared by the POST /bids route
// and the Intake Inbox accept flow so the folder setup lives in exactly one place. Drive
// failure must never block bid creation — errors are logged and swallowed.
export async function setupBidDriveFolders(bid: Record<string, any>): Promise<void> {
  try {
    logger.info({ bidId: bid.id, bidName: bid.name }, '[drive] starting bid folder setup');
    const jobFolderId = await createJobFolder(jobFolderName(bid.name, bid.loc), bid.gc, ESTIMATING_ACTIVE_BIDS_ROOT);
    logger.info({ bidId: bid.id, jobFolderId }, '[drive] createJobFolder result');
    if (jobFolderId) {
      const subs = await createSubfolders(jobFolderId, BID_SUBFOLDER_NAMES);
      logger.info({ bidId: bid.id, subs }, '[drive] createSubfolders result');
      await pool.query(
        `UPDATE bids SET drive_job_folder_id=$1, drive_plans_folder_id=$2, drive_estimates_folder_id=$3 WHERE id=$4`,
        [jobFolderId, subs['Plans'] || null, subs['Bid Proposals'] || null, bid.id],
      );
      bid.drive_job_folder_id = jobFolderId;
      bid.drive_plans_folder_id = subs['Plans'] || null;
      bid.drive_estimates_folder_id = subs['Bid Proposals'] || null;
      logger.info({ bidId: bid.id, drive_job_folder_id: jobFolderId, drive_plans_folder_id: bid.drive_plans_folder_id }, '[drive] bid folder setup complete');
    } else {
      logger.warn({ bidId: bid.id }, '[drive] createJobFolder returned null — Drive may not be configured or ESTIMATING_ACTIVE_BIDS_ROOT is inaccessible');
    }
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[drive] bid folder setup failed');
  }
}

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, amount, due, notes, project_type, sq_ft, suppress_notify, brand } = req.body;
  if (!name?.trim() || !gc?.trim()) return res.status(400).json({ error: 'Name and GC required' });
  const user = req.user!;
  // Snap the freeform GC text to one canonical customer record so duplicate
  // spellings ("bay to bay" vs "Bay to Bay Construction") collapse into a
  // single customer and the board/hub display the same canonical name.
  const resolved = await resolveCustomer(gc, 'gc');
  const customerId = resolved?.id ?? null;
  const gcName = resolved?.canonicalName ?? gc.trim();
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, amount, due, notes, salesperson_id, salesperson_name, customer_id, project_type, sq_ft, brand)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [name.trim(), gcName, (loc||'').trim()||'—', amount ? Number(amount) : null, formatDue(due), notes?.trim() || null, user.id, user.name, customerId, project_type || null, sq_ft ? Number(sq_ft) : null, brand ? String(brand).trim() || null : null]
  );
  if (!suppress_notify) sendBidNotification(rows[0], user).catch(() => {});

  // Await Drive folder setup before responding so that folder IDs are written to
  // the DB by the time the client receives the new bid. This prevents a race where
  // an immediately-uploaded file finds null folder IDs and skips Drive routing.
  const newBid = rows[0];
  await setupBidDriveFolders(newBid);

  res.json(withDueDays(newBid));
});

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  if (!VALID_BID_STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  if (!(await loadOwnedBid(req, res))) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current bid
    const { rows: cur } = await client.query('SELECT * FROM bids WHERE id=$1', [req.params.id]);
    if (!cur.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const bid = cur[0];

    // Phase 4 Task 1.3/3.1 — the shared stage-transition path (see
    // services/bidStage.ts): stage + lifecycle timestamps, won_job/project on
    // award, and the activity feed all happen there so the auto-advance on
    // send and the auto-award on e-sign produce IDENTICAL side effects to
    // this manual pipeline-drag entry point.
    const { bid: updated, wonJob } = await transitionBidStage(client, bid, stage, {
      lossReason: req.body.loss_reason, competitor: req.body.competitor,
    });

    await client.query('COMMIT');

    // Fire-and-forget: move Drive folder to the correct stage location, and
    // (on first award) create the award-only subfolders.
    applyBidStagePostCommit(bid, stage, (err, phase) => console.error(`[drive] ${phase} on stage change failed:`, err));

    if (stage === 'awarded' && bid.stage !== 'awarded') {
      await writeAudit(req, {
        action: 'award', entityType: 'bid', entityId: bid.id,
        summary: `Awarded bid "${bid.name}" (${bid.gc}) — $${Number(bid.amount || 0).toLocaleString()}`,
        before: { stage: bid.stage }, after: { stage: 'awarded', value: bid.amount },
      });
    }
    res.json({ bid: withDueDays(updated), wonJob });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Mark an awarded job as closed/complete. Moves Drive folder to Completed Projects.
router.post('/:id/close', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;
  if (bid.stage !== 'awarded') return res.status(400).json({ error: 'Only awarded jobs can be closed' });
  if (bid.closed_at) return res.status(400).json({ error: 'Job is already closed' });

  const { rows } = await pool.query(
    `UPDATE bids SET closed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [bid.id],
  );
  // Best-effort: mark the linked project complete
  pool.query(`UPDATE projects SET status = 'complete' WHERE id = $1`, [bid.id]).catch(() => {});

  await writeAudit(req, {
    action: 'close', entityType: 'bid', entityId: bid.id,
    summary: `Closed job "${bid.name}" (${bid.gc})`,
    before: { closed_at: null }, after: { closed_at: rows[0].closed_at },
  });

  // Fire-and-forget: move Drive folder to Completed Projects / GC Name
  if (bid.drive_job_folder_id) {
    moveJobToStage(bid.drive_job_folder_id, bid.gc, COMPLETED_PROJECTS_ROOT)
      .catch(err => console.error('[drive] moveJobToStage on close failed:', err));
  }

  res.json(withDueDays(rows[0]));
});

// Create a draft "new bid" email to the team in Outlook (does NOT send — the user reviews
// and sends it from their mailbox). Recipients come from the request (reviewer-edited,
// prefilled from the Settings team list); the bid's uploaded files are attached.
router.post('/:id/notify-team', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  const to = Array.isArray(req.body?.emails)
    ? (req.body.emails as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : [];
  if (!to.length) return res.status(400).json({ error: 'Add at least one recipient.' });

  // Attach the bid's uploaded files (plans, etc.) unless the sender opted out. Files too
  // large to attach fall back to a Google Drive folder link in the email body.
  const attach = req.body?.attachFiles !== false;
  let attachments; let attachedNames: string[] = []; let skipped: string[] = [];
  if (attach) {
    try {
      const loaded = await loadBidDocumentsAsAttachments(bid.id);
      attachments = loaded.attachments;
      attachedNames = loaded.attachedNames;
      skipped = loaded.skipped;
    } catch (err) {
      logger.error({ err, bidId: bid.id }, '[bids] notify-team attachment load failed');
    }
  }
  const driveLink = (skipped.length && bid.drive_job_folder_id)
    ? `https://drive.google.com/drive/folders/${bid.drive_job_folder_id}`
    : null;

  let result;
  try {
    result = await sendBidNotification(bid, { name: req.user!.name }, { to, force: true, draft: true, attachments, attachedNames, driveLink });
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[bids] notify-team draft failed');
    return res.status(502).json({ error: 'Could not create the draft. Check the mail configuration.' });
  }
  if (!result.to.length) {
    return res.status(503).json({ error: 'Email is not configured. Set up Microsoft Graph (GRAPH_* env vars) to create the draft.' });
  }

  await writeAudit(req, {
    action: 'notify_team_draft', entityType: 'bid', entityId: bid.id,
    summary: `Drafted new-bid email for "${bid.name}" to ${result.to.length} recipient${result.to.length === 1 ? '' : 's'}`
      + (attachedNames.length ? ` with ${attachedNames.length} file${attachedNames.length === 1 ? '' : 's'}` : ''),
  });

  // Phase 4 Task 5.4 — the columns exist (074_bids_team_notified.sql) but
  // were never written; the "Sent to team" mark this enables lives on the
  // bid's own detail drawer (distinct from intake's own accept-time stamp
  // on intake_items — see routes/intake.ts's /:id/accept).
  const { rows: stamped } = await pool.query(
    `UPDATE bids SET team_notified_at = now(), team_notified_to = $1, updated_at = now()
      WHERE id = $2 RETURNING team_notified_at, team_notified_to`,
    [result.to, bid.id]
  );

  res.json({ draftWebLink: result.draftWebLink, to: result.to, attachedNames, skipped, ...stamped[0] });
});

// ── Phase 4 Task 1.3: send the filed proposal to the GC ─────────────────────
// Sends via Microsoft Graph (graphSendMail) — the same muted-under-test path
// every other outbound email in this app uses. NEVER re-renders the proposal:
// it attaches exactly the bytes of the most recent FILED, gate-passed .docx
// (the `documents` row generate-docx wrote after verifyBidDocx passed), so
// what the GC receives is provably what got reviewed and downloaded.
const PROPOSAL_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TAKEOFF_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// FIX-3 (post-review) — gate_passed = true always, everywhere this is
// called. "Most recent filed" was never actually gated on having passed
// verifyBid's gate — a document filed under the same category by something
// other than a generate-* route (import-bid, a manual upload, POST
// /documents) could otherwise be picked up here and, via send-proposal,
// emailed to a GC as though it were the reviewed proposal. gate_passed is
// set ONLY by the Phase 3 generate-docx/generate-takeoff-xlsx/generate-
// prebid-package routes, and only on the rows they file after their own
// verify gate passes (see utils/storeDocument.ts) — so this query can only
// ever return something that's actually been through that gate.
async function loadMostRecentBidDoc(bidId: string, category: string, mimetype: string): Promise<DocRow | null> {
  const { rows } = await pool.query<DocRow>(
    `SELECT id, name, display_name, category, file_type, file_size, file_data, storage_url
       FROM documents
      WHERE linked_id = $1 AND category = $2 AND file_type = $3 AND deleted_at IS NULL AND gate_passed = true
      ORDER BY created_at DESC LIMIT 1`,
    [bidId, category, mimetype]
  );
  return rows[0] ?? null;
}

// ── Post-review FIX-1/FIX-2 — the public (no-auth) proposal surface ─────────
// Every /p/:token route below is reachable by anyone who has (or guesses) a
// token, so it gets its own, deliberately narrow contract:
//   - token shape is validated BEFORE it ever reaches a query. proposal_token
//     is a Postgres UUID column; a non-UUID string makes the driver throw
//     22P02 (invalid input syntax), and on bare (non-asyncHandler) express 4
//     handlers that rejection was never forwarded to res — the request just
//     hung. Every one of these routes is wrapped in asyncHandler AND checks
//     the token shape up front so a malformed token 404s immediately.
//   - every failure mode (malformed token / unknown token / nothing to show
//     yet) returns the SAME body, so the response never tells a prober which
//     case it hit.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidToken(token: string): boolean {
  return typeof token === 'string' && UUID_RE.test(token);
}
const PROPOSAL_NOT_FOUND = { error: 'Proposal not found' };

/**
 * The public page's exact field contract (frontend/src/pages/
 * BidProposalPublicPage.tsx's `PublicBid` interface) — id/name/gc/stage/
 * proposal_token/proposal_sent_at/proposal_viewed_at/proposal_signed_at/
 * signer_name, nothing else. The full `bids` row also carries notes,
 * loss_reason, competitor, amount, salesperson_id/customer_id, team_notified
 * fields, Drive folder ids, and signature_data — none of that belongs on an
 * unauthenticated response. signature_data in particular is NEVER returned
 * publicly: proposal_signed_at + signer_name are enough to render the
 * signed state.
 */
function publicBidProjection(bid: Record<string, any>) {
  return {
    id: bid.id,
    name: bid.name,
    gc: bid.gc,
    stage: bid.stage,
    proposal_token: bid.proposal_token,
    proposal_sent_at: bid.proposal_sent_at,
    proposal_viewed_at: bid.proposal_viewed_at,
    proposal_signed_at: bid.proposal_signed_at,
    signer_name: bid.signer_name,
  };
}

router.post('/:id/send-proposal', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  const to = Array.isArray(req.body?.to)
    ? (req.body.to as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : [];
  if (!to.length) return res.status(400).json({ error: 'Add at least one recipient.' });
  const cc = Array.isArray(req.body?.cc)
    ? (req.body.cc as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : [];

  const subject = String(req.body?.subject || '').trim() || defaultSubmittalSubject(bid);
  const bodyText = req.body?.bodyText !== undefined ? String(req.body.bodyText) : defaultSubmittalBodyText(bid);
  const includeTakeoff = !!req.body?.includeTakeoff;

  // Never re-render at send time — 409 if there's no filed docx yet.
  const proposalDoc = await loadMostRecentBidDoc(bid.id, 'proposal', PROPOSAL_DOCX_MIME);
  if (!proposalDoc) {
    return res.status(409).json({ error: 'No filed proposal on file yet. Generate/download the proposal .docx first.' });
  }
  const proposalBytes = await fetchDocBytes(proposalDoc);
  if (!proposalBytes) {
    return res.status(409).json({ error: 'The filed proposal document could not be loaded. Try re-downloading it first.' });
  }

  const attachments: GraphAttachment[] = [{
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: attachmentFileName(proposalDoc.display_name, proposalDoc.name, proposalDoc.file_type),
    contentType: proposalDoc.file_type || PROPOSAL_DOCX_MIME,
    contentBytes: proposalBytes.toString('base64'),
    isInline: false,
    contentId: `bid-proposal-${proposalDoc.id}`,
  }];

  // The takeoff only goes with it when the estimator opts in (per the
  // authority template: "The takeoff goes with it only if the GC asked for it").
  if (includeTakeoff) {
    const takeoffDoc = await loadMostRecentBidDoc(bid.id, 'takeoff', TAKEOFF_XLSX_MIME);
    if (takeoffDoc) {
      const takeoffBytes = await fetchDocBytes(takeoffDoc);
      if (takeoffBytes) {
        attachments.push({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachmentFileName(takeoffDoc.display_name, takeoffDoc.name, takeoffDoc.file_type),
          contentType: takeoffDoc.file_type || TAKEOFF_XLSX_MIME,
          contentBytes: takeoffBytes.toString('base64'),
          isInline: false,
          contentId: `bid-takeoff-${takeoffDoc.id}`,
        });
      }
    }
  }

  if (!isGraphMailConfigured()) {
    return res.status(503).json({ error: 'Email is not configured (Microsoft Graph). Copy the proposal link and send it yourself.' });
  }

  const frontendUrl = await getSetting('frontend_url');
  // Never fall back to localhost — matches gens.ts's /:id/send.
  const baseUrl = (frontendUrl || process.env.FRONTEND_URL || 'https://electrical-program.onrender.com').replace(/\/$/, '');
  const link = `${baseUrl}/bp/${bid.proposal_token}`;
  const html = buildBidSubmittalHtml({ bodyText, proposalLink: link });

  try {
    await graphSendMail({ to, cc: cc.length ? cc : undefined, subject, html, attachments });
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[bids] send-proposal failed');
    return res.status(502).json({ error: 'Email delivery failed (Outlook). Try again or copy the proposal link.', link });
  }

  // Email is out — stamp sent, log the timeline, and — if the bid is still
  // `due` — advance it to `submitted` through the SAME shared stage path the
  // manual PATCH /:id/stage uses (Task 1.3: "extract/reuse, don't duplicate").
  const client = await pool.connect();
  let updatedBid = bid;
  let wonJob = null;
  try {
    await client.query('BEGIN');
    const { rows: sentRows } = await client.query(
      `UPDATE bids SET proposal_sent_at = now(), proposal_sent_to = $1, updated_at = now()
        WHERE id = $2 RETURNING *`,
      [to, bid.id]
    );
    updatedBid = sentRows[0];
    await client.query(
      `INSERT INTO proposal_activity (bid_id, kind, direction, text, created_by)
       VALUES ($1,'sent','out',$2,$3)`,
      [bid.id, `Proposal emailed to ${to.join(', ')}`, req.user!.name]
    );
    await client.query(
      `INSERT INTO activity (kind, div, text) VALUES ('sent','elec',$1)`,
      [`${bid.name} proposal sent to ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`]
    );

    let stageAdvanced = false;
    if (updatedBid.stage === 'due') {
      const { bid: staged, wonJob: staWonJob } = await transitionBidStage(client, updatedBid, 'submitted');
      updatedBid = staged;
      wonJob = staWonJob;
      stageAdvanced = true;
    }
    await client.query('COMMIT');
    if (stageAdvanced) {
      applyBidStagePostCommit(bid, 'submitted', (err, phase) => logger.error({ err, phase, bidId: bid.id }, '[bids] send-proposal stage-advance Drive step failed'));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, bidId: bid.id }, '[bids] send-proposal post-send stamp failed (email already sent)');
    return res.status(500).json({ error: 'Email sent, but the bid record could not be updated. Refresh to check its status.' });
  } finally {
    client.release();
  }

  res.json({ bid: withDueDays(updatedBid), wonJob, link, stageAdvanced: updatedBid.stage === 'submitted' && bid.stage === 'due' });
});

// ── Phase 4 Task 1.5: the internal Chris pre-bid-package email ──────────────
// A DRAFT, not a send — Jake reviews/sends from Outlook, same as notify-team.
router.post('/:id/email-prebid-chris', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  const to = Array.isArray(req.body?.to)
    ? (req.body.to as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : [];
  if (!to.length) return res.status(400).json({ error: 'Add at least one recipient (Chris).' });

  const scopeDoc = await loadMostRecentBidDoc(bid.id, 'prebid_scope', PROPOSAL_DOCX_MIME);
  const takeoffDoc = await loadMostRecentBidDoc(bid.id, 'prebid_takeoff', TAKEOFF_XLSX_MIME);
  if (!scopeDoc && !takeoffDoc) {
    return res.status(409).json({ error: 'No pre-bid package on file yet. Generate it first.' });
  }

  const attachments: GraphAttachment[] = [];
  for (const doc of [scopeDoc, takeoffDoc]) {
    if (!doc) continue;
    const bytes = await fetchDocBytes(doc);
    if (!bytes) continue;
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachmentFileName(doc.display_name, doc.name, doc.file_type),
      contentType: doc.file_type || 'application/octet-stream',
      contentBytes: bytes.toString('base64'),
      isInline: false,
      contentId: `bid-prebid-${doc.id}`,
    });
  }

  if (!isGraphMailConfigured()) {
    return res.status(503).json({ error: 'Email is not configured. Set up Microsoft Graph (GRAPH_* env vars) to create the draft.' });
  }

  const subject = String(req.body?.subject || '').trim() || defaultPrebidChrisSubject(bid);
  const html = buildPrebidChrisBodyHtml({ ...bid, planDate: req.body?.planDate ?? null });

  let draft;
  try {
    draft = await graphCreateDraft({ to, subject, html, attachments });
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[bids] email-prebid-chris draft failed');
    return res.status(502).json({ error: 'Could not create the draft. Check the mail configuration.' });
  }

  await writeAudit(req, {
    action: 'notify_team_draft', entityType: 'bid', entityId: bid.id,
    summary: `Drafted pre-bid package email for "${bid.name}" to ${to.join(', ')}`,
  });
  res.json({ draftWebLink: draft.webLink, to });
});

// Bid qualification score — computed from historical data, no AI key needed
router.get('/:id/qualify', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  // GC win/loss history
  const { rows: gcHistory } = await pool.query(
    `SELECT stage FROM bids WHERE gc=$1 AND id!=$2 AND deleted_at IS NULL`,
    [bid.gc, bid.id]
  );
  const gcWon  = gcHistory.filter(r => r.stage === 'awarded').length;
  const gcLost = gcHistory.filter(r => r.stage === 'lost').length;
  const gcTotal = gcWon + gcLost;
  const gcWinRate = gcTotal > 0 ? gcWon / gcTotal : null;

  // Overall company win rate
  const { rows: allHistory } = await pool.query(
    `SELECT stage FROM bids WHERE stage IN ('awarded','lost') AND id!=$1 AND deleted_at IS NULL`, [bid.id]
  );
  const totalWon  = allHistory.filter(r => r.stage === 'awarded').length;
  const totalLost = allHistory.filter(r => r.stage === 'lost').length;
  const overallRate = (totalWon + totalLost) > 0 ? totalWon / (totalWon + totalLost) : 0.5;

  // Amount score — sweet spot $200K–$2M
  const amt = Number(bid.amount ?? 0);
  let amtScore = 5;
  if (amt >= 200_000 && amt <= 2_000_000) amtScore = 10;
  else if (amt >= 100_000 && amt <= 3_000_000) amtScore = 7;
  else if (amt > 0) amtScore = 4;

  // Due days score — more time = better
  const dueDays = parseDueDays(String(bid.due || ''));
  const timeScore = dueDays >= 21 ? 10 : dueDays >= 10 ? 7 : dueDays >= 5 ? 4 : 2;

  // Composite score (0–10)
  const gcScore = gcWinRate !== null ? Math.round(gcWinRate * 10) : Math.round(overallRate * 10);
  const score = Math.round((gcScore * 0.4 + amtScore * 0.35 + timeScore * 0.25));
  const capped = Math.min(10, Math.max(1, score));

  const reasons: string[] = [];
  if (gcWinRate !== null) reasons.push(`${Math.round(gcWinRate*100)}% win rate with ${bid.gc} (${gcWon}W / ${gcLost}L)`);
  else reasons.push(`No prior history with ${bid.gc}`);
  reasons.push(`Contract value ${amt >= 200_000 && amt <= 2_000_000 ? 'in sweet spot' : 'outside typical range'} ($${Math.round(amt).toLocaleString()})`);
  reasons.push(`${dueDays} days until due — ${dueDays >= 14 ? 'adequate time' : dueDays >= 7 ? 'tight timeline' : 'very tight'}`);
  if (overallRate > 0) reasons.push(`Company overall win rate: ${Math.round(overallRate*100)}%`);

  res.json({ score: capped, reasons, gcWinRate: gcWinRate !== null ? Math.round(gcWinRate*100) : null, gcWon, gcLost, dueDays });
});

router.patch('/:id/phase', requireAuth, async (req: AuthRequest, res) => {
  const { phase } = req.body;
  const valid = ['signed','rough','inspection','trim','final','complete'];
  if (!valid.includes(phase)) return res.status(400).json({ error: 'Invalid phase' });
  if (!(await loadOwnedBid(req, res))) return;
  const { rows } = await pool.query(
    'UPDATE bids SET elec_project_phase=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [phase, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(withDueDays(rows[0]));
});

router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  const existingBid = await loadOwnedBid(req, res);
  if (!existingBid) return;
  const { name, gc, loc, amount, due, sheets, contact, project_type, sq_ft, notes, brand, date_won, job_number } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name         !== undefined) { fields.push(`name=$${i++}`);         vals.push(name.trim()); }
  if (gc           !== undefined) { fields.push(`gc=$${i++}`);           vals.push(gc.trim()); }
  if (loc          !== undefined) { fields.push(`loc=$${i++}`);          vals.push(loc.trim() || '—'); }
  if (amount       !== undefined) { fields.push(`amount=$${i++}`);       vals.push(amount === '' || amount === null ? null : Number(amount)); }
  if (due          !== undefined) { fields.push(`due=$${i++}`);          vals.push(formatDue(due)); }
  if (sheets       !== undefined) { fields.push(`sheets=$${i++}`);       vals.push(Number(sheets) || null); }
  if (contact      !== undefined) { fields.push(`contact=$${i++}`);      vals.push(contact.trim()); }
  if (project_type !== undefined) { fields.push(`project_type=$${i++}`); vals.push(project_type || null); }
  if (sq_ft        !== undefined) { fields.push(`sq_ft=$${i++}`);        vals.push(sq_ft === '' || sq_ft === null ? null : Number(sq_ft)); }
  if (notes        !== undefined) { fields.push(`notes=$${i++}`);        vals.push(notes?.trim() || null); }
  if (brand        !== undefined) { fields.push(`brand=$${i++}`);        vals.push(brand?.trim() || null); }
  // Phase 3 Task 7 — job_number (JS.MMDDYYYY) auto-generates on first
  // proposal/pre-bid generation (composeBidData/jobNumber) but is editable
  // here, same pattern as every other bid field.
  if (job_number   !== undefined) { fields.push(`job_number=$${i++}`);   vals.push(job_number?.trim() || null); }
  if (!fields.length && date_won === undefined) return res.status(400).json({ error: 'Nothing to update' });
  let bid = existingBid;
  if (fields.length) {
    fields.push(`updated_at=now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE bids SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    bid = rows[0];
  }

  // Keep won_jobs in sync for awarded bids: amount and/or date_won changed.
  let wonJob = null;
  if (bid.stage === 'awarded' && (amount !== undefined || (date_won !== undefined && date_won))) {
    const wjFields: string[] = [];
    const wjVals: unknown[] = [];
    let wi = 1;
    if (amount !== undefined) {
      wjFields.push(`value=$${wi++}`);
      wjVals.push(amount === '' || amount === null ? 0 : Number(amount));
    }
    if (date_won !== undefined && date_won) {
      wjFields.push(`date_won=$${wi++}`);
      wjVals.push(date_won);
    }
    if (wjFields.length) {
      wjVals.push(bid.id);
      const { rows: wj } = await pool.query(
        `UPDATE won_jobs SET ${wjFields.join(',')} WHERE proposal_id=$${wi} RETURNING *`,
        wjVals
      );
      wonJob = wj[0] || null;
    }
  }

  res.json({ bid: withDueDays(bid), wonJob });
});

// List files from the Drive Photos folder for this project.
router.get('/:id/photos', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;
  if (!bid.drive_photos_folder_id) return res.json([]);
  const files = await listFolderFiles(bid.drive_photos_folder_id);
  res.json(files);
});

// Soft delete — moves the bid (and its won-job revenue record) to the Trash.
// Recoverable via /restore; permanently removed by /purge or the retention job.
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE bids SET deleted_at=now() WHERE id=$1', [req.params.id]);
    await client.query('UPDATE won_jobs SET deleted_at=now() WHERE proposal_id=$1', [req.params.id]);
    await setProjectDeleted(client, req.params.id, true);
    await client.query('COMMIT');
    await writeAudit(req, {
      action: 'delete', entityType: 'bid', entityId: bid.id,
      summary: `Moved bid "${bid.name}" (${bid.gc}) to Trash`, before: bid,
    });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Restore a trashed bid (and its won-job record).
router.post('/:id/restore', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { rows } = await pool.query('UPDATE bids SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found in Trash' });
  await pool.query('UPDATE won_jobs SET deleted_at=NULL WHERE proposal_id=$1', [req.params.id]);
  await setProjectDeleted(pool, req.params.id, false);
  await writeAudit(req, { action: 'restore', entityType: 'bid', entityId: req.params.id, summary: `Restored bid "${rows[0].name}"` });
  res.json(withDueDays(rows[0]));
});

// Permanently delete a trashed bid and all dependent records (admin only).
router.delete('/:id/purge', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { rows: existing } = await pool.query('SELECT id, name FROM bids WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found in Trash' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM project_change_orders WHERE project_id=$1', [req.params.id]);
    await client.query('DELETE FROM project_field_notes WHERE project_id=$1', [req.params.id]);
    await client.query('DELETE FROM project_rfis WHERE project_id=$1', [req.params.id]);
    await client.query('DELETE FROM project_sections WHERE project_id=$1', [req.params.id]);
    await client.query('DELETE FROM documents WHERE linked_id=$1', [req.params.id]);
    await client.query('DELETE FROM communications WHERE linked_id=$1', [req.params.id]);
    await client.query('DELETE FROM tasks WHERE linked_id=$1', [req.params.id]);
    await client.query('DELETE FROM notifications WHERE link_id=$1', [req.params.id]);
    await client.query('DELETE FROM won_jobs WHERE proposal_id=$1', [req.params.id]);
    await client.query('DELETE FROM bid_workspaces WHERE bid_id=$1', [req.params.id]);
    await client.query('DELETE FROM takeoff_results WHERE bid_id=$1', [req.params.id]);
    await client.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    await client.query('DELETE FROM bids WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    await writeAudit(req, { action: 'purge', entityType: 'bid', entityId: req.params.id, summary: `Permanently deleted bid "${existing[0].name}"` });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── Phase 4 Task 2 / post-review FIX-3: public proposal page (no auth) ──────
// Serves a FILED, GATE-PASSED snapshot — never a live compose. The old
// version here composed the bid's CURRENT BidData on every single view (an
// unauthenticated, unrate-limited route), rendered a full docx from it, and
// ran verifyBidDocx — which execSync-probes for `soffice` on PATH — on every
// request. That's a blocking-call-per-view DoS surface, and worse: on a
// verify failure it fell back to "the most recent bid_data.json filed
// alongside the last generated docx," but that fallback was never actually
// checked for having passed the verify gate itself, so a document filed
// under the same category by something other than generate-docx (an
// import, a manual upload) could theoretically be what a customer — or,
// via send-proposal, a GC — ends up seeing. And because the page composed
// live while the emailed docx was a filed snapshot, the two could silently
// diverge, and a signature would pin to nothing in particular.
//
// The fix: load the most recent GATE-PASSED bid_data.json document
// (loadMostRecentBidDoc, filtered on gate_passed=true — see FIX-3 above)
// and render straight from it. No compose, no docx render, no verify, no
// soffice probe on the view path — the gate already ran once, at filing
// time, in generate-docx. This also pins what the customer sees to
// EXACTLY what was filed/sent, byte-for-byte the same BidData the emailed
// docx came from.
async function loadFiledBidData(bidId: string): Promise<{ bidData: BidData; documentId: string } | null> {
  const filedDoc = await loadMostRecentBidDoc(bidId, 'bid_data', 'application/json');
  if (!filedDoc) return null;
  const bytes = await fetchDocBytes(filedDoc);
  if (!bytes) return null;
  try {
    return { bidData: JSON.parse(bytes.toString('utf8')) as BidData, documentId: filedDoc.id };
  } catch (err) {
    logger.error({ err, bidId }, '[bids] public page: filed bid_data.json could not be parsed');
    return null;
  }
}

// FIX-3(e) — rate limit the public routes (mirrors routes/auth.ts's
// authLimiter). Viewing/downloading a sent proposal is a normal, repeatable
// customer action (a GC may reopen the link several times), so the view/
// download limit is generous; signing is a one-time action per proposal, so
// its limit is tighter.
const publicViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: PROPOSAL_NOT_FOUND,
});
const publicSignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

router.get('/p/:token', publicViewLimiter, asyncHandler(async (req, res) => {
  if (!isValidToken(req.params.token)) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const { rows } = await pool.query(
    'SELECT * FROM bids WHERE proposal_token = $1 AND deleted_at IS NULL',
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const bid = rows[0];

  // FIX-6 (post-review, blocking) — a proposal that was never sent
  // (including a lost bid's old link, which migration 094 backfilled a
  // token onto just like every other bid) has nothing legitimate to show
  // publicly. Same uniform 404 as an unknown/malformed token.
  if (!bid.proposal_sent_at) return res.status(404).json(PROPOSAL_NOT_FOUND);

  const loaded = await loadFiledBidData(bid.id);
  if (!loaded) return res.status(404).json(PROPOSAL_NOT_FOUND);

  // In-app previews pass ?preview=1 — fetch without recording a customer
  // "view" (mirrors gens.ts's /p/:token).
  const isPreview = !!req.query.preview;
  let current = bid;
  if (!isPreview) {
    const wasUnviewed = !bid.proposal_viewed_at;
    const { rows: viewedRows } = await pool.query(
      `UPDATE bids SET proposal_viewed_at = COALESCE(proposal_viewed_at, now())
        WHERE id = $1 RETURNING *`,
      [bid.id]
    );
    current = viewedRows[0];

    if (wasUnviewed) {
      await pool.query(
        `INSERT INTO proposal_activity (bid_id, kind, direction, text) VALUES ($1,'viewed','in',$2)`,
        [bid.id, 'Proposal viewed']
      );

      // Fire-and-forget: notify Jake on first view (opt-in via Settings >
      // Notifications, same "Proposal Viewed" toggle gens' proposal_viewed
      // pref covers — mirrors gens' proposal-signed notification's gating).
      (async () => {
        try {
          const raw = await getSetting('notifications_json');
          const notifPrefs = raw ? JSON.parse(raw) : {};
          if (!notifPrefs.proposal_viewed) return;
          const targets = current.salesperson_id ? [current.salesperson_id] : await ownerAdminIds();
          for (const uid of targets) {
            await createNotification(uid, {
              type: 'bid_proposal_viewed',
              title: 'Proposal viewed',
              body: `${current.name} (${current.gc}) — the proposal link was opened`,
              linkView: 'electrical/bids',
              linkId: current.id,
              dedupKey: `bidviewed:${current.id}`,
            });
          }
        } catch (err) {
          logger.error({ err, bidId: bid.id }, '[notify] bid proposal-viewed notification failed');
        }
      })();
    }
  }

  res.json({
    bid: publicBidProjection(current),
    html: renderBidHtml(loaded.bidData),
  });
}));

// Streams the exact bytes of the most recently FILED, gate-passed proposal
// .docx (never a fresh render) with a content-disposition filename from the
// standard's own naming (APT_Bid_[ProjectSlug]_[LocationSlug].docx).
router.get('/p/:token/download', publicViewLimiter, asyncHandler(async (req, res) => {
  if (!isValidToken(req.params.token)) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const { rows } = await pool.query(
    'SELECT id FROM bids WHERE proposal_token = $1 AND deleted_at IS NULL',
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const bidId = rows[0].id as string;

  const doc = await loadMostRecentBidDoc(bidId, 'proposal', PROPOSAL_DOCX_MIME);
  if (!doc) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const bytes = await fetchDocBytes(doc);
  if (!bytes) return res.status(404).json(PROPOSAL_NOT_FOUND);

  const filename = attachmentFileName(doc.display_name, doc.name, doc.file_type).replace(/[<>:"/\\|?*\r\n]/g, '-');
  res.setHeader('Content-Type', PROPOSAL_DOCX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', bytes.length);
  res.send(bytes);
}));

// ── Phase 4 Task 3: accept & e-sign -> auto-award (no auth) ─────────────────
// Ports gens.ts's POST /p/:token/sign (non-empty signature required,
// idempotent re-sign) and adds an explicit size cap on the data URL — kept
// well under express.json()'s global 100kb body limit so an oversized
// signature gets a clear 400 instead of body-parser's raw 413.
const MAX_SIGNATURE_DATA_URL_LENGTH = 60_000;

router.post('/p/:token/sign', publicSignLimiter, asyncHandler(async (req, res) => {
  if (!isValidToken(req.params.token)) return res.status(404).json(PROPOSAL_NOT_FOUND);
  const { signerName, signatureDataUrl } = req.body || {};
  if (!signatureDataUrl || typeof signatureDataUrl !== 'string') {
    return res.status(400).json({ error: 'Signature required' });
  }
  if (signatureDataUrl.length > MAX_SIGNATURE_DATA_URL_LENGTH) {
    return res.status(400).json({ error: 'Signature image is too large — please sign again with a smaller/simpler signature.' });
  }
  const name = String(signerName || '').trim();
  if (!name) return res.status(400).json({ error: 'Typed name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locked so a double-tap / retry on a slow network can't race past the
    // idempotency check below and sign (or award) twice.
    const { rows: locked } = await client.query(
      `SELECT * FROM bids WHERE proposal_token = $1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.token]
    );
    if (!locked.length) { await client.query('ROLLBACK'); return res.status(404).json(PROPOSAL_NOT_FOUND); }
    const preSign = locked[0];

    // Idempotent — a second sign attempt returns the already-signed state
    // unchanged, never re-stamps or re-awards.
    if (preSign.proposal_signed_at) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, bid: publicBidProjection(preSign), alreadySigned: true, wonJob: null });
    }

    // FIX-6 (post-review, blocking) — a fresh sign, below, always requires a
    // proposal that was actually sent. Migration 094 backfilled
    // proposal_token onto EVERY existing bid, so a lost bid's (or a never-
    // sent bid's) old link is otherwise still a live "sign" endpoint that
    // can flip lost -> awarded, with commission, on a stale link. Same
    // uniform 404 as an unknown/malformed token — a public prober can't
    // tell "never sent" apart from "doesn't exist."
    if (!preSign.proposal_sent_at) {
      await client.query('ROLLBACK');
      return res.status(404).json(PROPOSAL_NOT_FOUND);
    }
    // A sent proposal can still be stale — the estimator marked it lost, or
    // it was already manually awarded through the pipeline. Only a proposal
    // still actually awaiting a decision can be accepted here.
    if (!['due', 'submitted'].includes(preSign.stage)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This proposal is no longer available for acceptance' });
    }

    // FIX-3(d) — pin the signature to the exact bid_data.json document that
    // was on screen (the most recent gate-passed snapshot at sign time —
    // the same one loadFiledBidData would serve to a GET right now), not to
    // "whatever the bid composes to on some future date." Best-effort: if
    // for some reason no gate-passed snapshot exists yet (e.g. the docx
    // filed but the bid_data.json write failed independently), the
    // signature still records — signed_document_id just stays null.
    const filedDoc = await loadMostRecentBidDoc(preSign.id, 'bid_data', 'application/json');

    const { rows: signedRows } = await client.query(
      `UPDATE bids SET proposal_signed_at = now(), signer_name = $1, signature_data = $2,
         signed_document_id = $3, updated_at = now()
        WHERE id = $4 RETURNING *`,
      [name, signatureDataUrl, filedDoc?.id ?? null, preSign.id]
    );
    const signedBid = signedRows[0];

    await client.query(
      `INSERT INTO proposal_activity (bid_id, kind, direction, text) VALUES ($1,'signed','in',$2)`,
      [preSign.id, `Proposal signed by ${name}`]
    );

    // Auto-award through the SAME shared stage-transition path the manual
    // PATCH /:id/stage drag uses (services/bidStage.ts) — won_job, project
    // registration, and the activity-feed entry all fire identically,
    // whether the trigger is a rep's drag or the customer's signature.
    let finalBid = signedBid;
    let wonJob: Record<string, unknown> | null = null;
    if (signedBid.stage !== 'awarded') {
      const result = await transitionBidStage(client, signedBid, 'awarded');
      finalBid = result.bid;
      wonJob = result.wonJob;
    }

    await client.query('COMMIT');

    // Fire-and-forget Drive side effects — same helper the manual award
    // path uses (PATCH /:id/stage), so folder moves/subfolder creation are
    // byte-for-byte the same regardless of which door the award came through.
    if (signedBid.stage !== 'awarded') {
      applyBidStagePostCommit(signedBid, 'awarded', (err, phase) =>
        logger.error({ err, phase, bidId: preSign.id }, '[bids] sign-triggered award Drive step failed'));
    }

    // FIX-8 (post-review) — a public, unauthenticated action has no
    // req.user for the normal writeAudit(req, ...) to attribute this to
    // (gens' public sign route has the same gap and also used to skip
    // auditing entirely). writeAuditAs records it under an explicit
    // system-actor label instead, so an award via e-signature still shows
    // up in the audit trail — same 'award' action PATCH /:id/stage logs for
    // a manual drag. Only fires when this call actually performed the
    // award (never on the "already awarded" branch above).
    if (signedBid.stage !== 'awarded') {
      // Awaited (writeAuditAs never throws — it catches its own errors) so
      // the audit_log row is guaranteed to exist by the time the caller
      // sees the 200 response below.
      await writeAuditAs({ id: null, name: `Customer e-signature (${name})` }, {
        action: 'award', entityType: 'bid', entityId: preSign.id,
        summary: `Awarded bid "${finalBid.name}" (${finalBid.gc}) via e-signature — $${Number(finalBid.amount || 0).toLocaleString()}`,
        before: { stage: signedBid.stage }, after: { stage: 'awarded', value: finalBid.amount },
      });
    }

    res.json({ ok: true, bid: publicBidProjection(finalBid), wonJob });

    // Fire-and-forget: notify Jake — in-app notification + web push + a
    // team-mailbox email heads-up. Mirrors gens.ts's /p/:token/sign exactly.
    (async () => {
      try {
        const raw = await getSetting('notifications_json');
        const notifPrefs = raw ? JSON.parse(raw) : {};
        if (!notifPrefs.proposal_signed) return;
        const targets = finalBid.salesperson_id ? [finalBid.salesperson_id] : await ownerAdminIds();
        for (const uid of targets) {
          await createNotification(uid, {
            type: 'bid_proposal_signed',
            title: 'Proposal signed',
            body: `${finalBid.name} (${finalBid.gc}) accepted and signed their proposal`,
            linkView: 'electrical/bids',
            linkId: finalBid.id,
            dedupKey: `bidsigned:${finalBid.id}`,
          });
        }
        const amt = Number(finalBid.amount || 0);
        sendPushToUsers(targets, {
          title: '🎉 Proposal signed',
          body: `${finalBid.name}${amt ? ` — $${amt.toLocaleString()}` : ''}`,
          view: 'electrical/bids',
          id: finalBid.id,
          tag: `bidsigned:${finalBid.id}`,
        }).catch(() => {});
      } catch (err) {
        logger.error({ err }, '[notify] bid proposal signed notification failed');
      }
    })();

    if (isGraphMailConfigured()) {
      (async () => {
        try {
          const amt = Number(finalBid.amount || 0);
          await graphSendMail({
            to: TEAM_NOTIFY_TO,
            subject: `🎉 Proposal signed — ${finalBid.name}${amt ? ` ($${amt.toLocaleString()})` : ''}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">
              <p><b>${escapeHtml(finalBid.gc)}</b> just signed the electrical proposal for <b>${escapeHtml(finalBid.name)}</b>${amt ? ` — <b>$${amt.toLocaleString()}</b>` : ''}.</p>
              <p>Signed by ${escapeHtml(name)}. The job has been automatically moved to Awarded.</p>
            </div>`,
          });
        } catch (err) {
          logger.error({ err, bidId: preSign.id }, '[notify] bid proposal signed email failed');
        }
      })();
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, '[bids] sign failed');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}));

export default router;
