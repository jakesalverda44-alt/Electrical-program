import { Router } from 'express';
import { takeoffGate, budgetPendingGate, evidenceGate } from '../estimating/takeoffReview';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, canRestore, AuthRequest, ownScopeId } from '../middleware/auth';
import { writeAudit } from '../utils/audit';
import { setProjectDeleted } from '../utils/project';
import { parseDueDays, withDueDays, formatDue } from '../utils/dueDate';
import { logger } from '../utils/logger';
import { sendBidNotification } from '../email/bidNotification';
import { loadBidDocumentsAsAttachments, fetchDocBytes, attachmentFileName, DocRow } from '../email/bidAttachments';
import { graphCreateDraft, isGraphMailConfigured, GraphAttachment } from '../email/graphMailer';
import {
  defaultSubmittalSubject, defaultSubmittalBodyText, buildBidSubmittalHtml,
  defaultPrebidChrisSubject, buildPrebidChrisBodyHtml,
} from '../email/bidSubmittalEmail';
import { getSetting } from '../db/getSetting';
import { resolveCustomer } from './customers';
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
  getFileMedia,
  getFileParents,
  COMPLETED_PROJECTS_ROOT,
} from '../services/googleDrive';
import { VALID_BID_STAGES, transitionBidStage, applyBidStagePostCommit } from '../services/bidStage';

const router = Router();

// Task 6 (audit data #7) — every other column on `bids` is read from the list by
// something in the frontend (grepped against the `Bid` interface in
// frontend/src/types/index.ts and every consumer under frontend/src/features):
// `notes` isn't in the `Bid` type at all (AddBidModal only ever writes it, on
// create) and `signature_data` is neither in the type nor referenced anywhere,
// and — unlike generator_proposals' form_data/totals_data/checklist_data/
// survey_markup, which this batch deliberately leaves alone — is confirmed
// unused: 0 of 35 local bids have ever had it set (nothing in routes/bids.ts
// writes it; the public e-sign flow that would have was removed 2026-09-03
// per the comment on the Bid type's proposal_token/signer_name fields).
// `notes` itself is real, populated data (21/35 rows) — just never rendered
// from this list — so it's dropped from the response, not the column.
const BIDS_LIST_COLUMNS = `
  id, name, loc, gc, due, due_days, amount, sheets, contact, stage,
  salesperson_id, salesperson_name, created_at, updated_at, elec_project_phase,
  loss_reason, competitor, customer_id, submitted_at, awarded_at, deleted_at,
  org_id, drive_gc_folder_id, drive_job_folder_id, drive_plans_folder_id,
  drive_estimates_folder_id, drive_photos_folder_id, drive_contracts_folder_id,
  drive_submittals_folder_id, drive_rfis_folder_id, drive_change_orders_folder_id,
  closed_at, project_type, sq_ft, source_email_link, team_notified_at,
  team_notified_to, brand, job_number, proposal_token, proposal_sent_at,
  proposal_sent_to, proposal_viewed_at, proposal_signed_at, signer_name,
  signed_document_id`;

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const params: unknown[] = [];
  const where: string[] = ['deleted_at IS NULL', 'closed_at IS NULL'];
  if (scope) { params.push(scope); where.push(`salesperson_id = $${params.length}`); }
  let sql = `SELECT ${BIDS_LIST_COLUMNS} FROM bids WHERE ${where.join(' AND ')}`;
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

// ── Post-merge rework (2026-09-03) — draft the GC submittal in Outlook ──────
// Jake corrected the product design after reviewing Phase 4: GCs never
// e-sign a web page — they execute via contract/PO. So this NEVER sends
// (graphSendMail is never called here — draft-proposal uses graphCreateDraft
// exclusively) and the public /p/:token proposal page + e-sign surface is
// gone entirely (see docs/superpowers/plans/2026-09-03-phase4-report.md's
// rework section). Jake reviews the Outlook draft and sends it himself.
//
// Still NEVER re-renders the proposal: it attaches exactly the bytes of the
// most recent FILED, gate-passed PDF when one exists (falling back to the
// .docx when soffice didn't produce a PDF at generate-docx time), so what
// the GC receives is provably what got reviewed and downloaded.
const PROPOSAL_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PROPOSAL_PDF_MIME = 'application/pdf';
const TAKEOFF_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// FIX-3 (post-review) — gate_passed = true always, everywhere this is
// called. "Most recent filed" was never actually gated on having passed
// verifyBid's gate — a document filed under the same category by something
// other than a generate-* route (import-bid, a manual upload, POST
// /documents) could otherwise be picked up here and, via draft-proposal,
// end up attached to a GC's draft as though it were the reviewed proposal.
// gate_passed is set ONLY by the Phase 3 generate-docx/generate-takeoff-
// xlsx/generate-prebid-package routes, and only on the rows they file after
// their own verify gate passes (see utils/storeDocument.ts) — so this query
// can only ever return something that's actually been through that gate.
async function loadMostRecentBidDoc(bidId: string, category: string, mimetype: string): Promise<(DocRow & { compose_inputs_hash?: string | null }) | null> {
  // Takeoff accuracy fix round 1 / B5 — when the bid has an analysis run id,
  // only a document filed from THAT run qualifies: after a re-analysis the
  // previous run's proposal / takeoff / pre-bid package can never be
  // attached. A bid from before run ids (run_id NULL) keeps the old rule.
  const { rows: tr } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id = $1', [bidId]);
  const runId = (tr[0]?.run_id as string | null) ?? null;
  const { rows } = await pool.query<DocRow & { compose_inputs_hash?: string | null }>(
    `SELECT id, name, display_name, category, file_type, file_size, file_data, storage_url, compose_inputs_hash
       FROM documents
      WHERE linked_id = $1 AND category = $2 AND file_type = $3 AND deleted_at IS NULL AND gate_passed = true
        AND superseded_at IS NULL
        AND ($4::uuid IS NULL OR takeoff_run_id = $4::uuid)
      ORDER BY created_at DESC LIMIT 1`,
    [bidId, category, mimetype, runId]
  );
  return rows[0] ?? null;
}

/** Fix round 2 / R2-B1 — a filed document may be sent only if the inputs it
 *  was made from (counts, resolutions, answers, price, scope list, account
 *  rule snapshot, the Agent 4 output / draft) are still the current ones.
 *  null = OK to send; otherwise the refusal message. A bid from before run
 *  ids keeps the old behaviour. */
async function staleFileMessage(bidId: string, docs: Array<{ compose_inputs_hash?: string | null } | null>, source: 'final' | 'draft'): Promise<string | null> {
  if (!(await currentRunId(bidId))) return null;
  const { composeCurrentBidData } = await import('./preconstruction');
  const loaded = await composeCurrentBidData(bidId, { persist: false, validate: false, source });
  const stale = 'Regenerate — inputs changed since this file was made.';
  if (!loaded.ok) return `${stale} (${loaded.error})`;
  for (const d of docs) {
    if (d && d.compose_inputs_hash !== loaded.inputsHash) {
      return `${stale} The counts, review answers, price, scope list or proposal text changed after it was generated — ${source === 'draft' ? 'generate the pre-bid package again' : 'download the proposal again (it re-files the PDF)'}, then send.`;
    }
  }
  return null;
}

async function currentRunId(bidId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT run_id FROM takeoff_results WHERE bid_id = $1', [bidId]);
  return (rows[0]?.run_id as string | null) ?? null;
}

// `body: {to, cc?, subject, bodyText, includeTakeoff?, markSubmitted?}` —
// creates an Outlook DRAFT (Drafts folder, never sent) with the proposal
// attached, prefilled subject/body Jake can edit before drafting. Same
// 409-if-no-gate-passed-doc precondition the old send-proposal had.
//
// markSubmitted (default true, mirrors the modal's checkbox default) —
// when true, stamps proposal_sent_at/proposal_sent_to and advances a `due`
// bid to `submitted` through the shared bidStage path, exactly as the old
// send did (the columns/stage semantics mean "Jake told the GC," which is
// still true once he's about to send the draft — see the modal's own
// explanation copy). When false, this is a draft-only dry run: no stamps,
// no stage change, no Drive folder move.
router.post('/:id/draft-proposal', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  // Takeoff accuracy Task 7 — a takeoff with open review items (zero or
  // unreadable counts, unanswered scope questions) can't be sent.
  const gate = await takeoffGate(bid.id);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });
  // Fix round 2 / B5 — a budget-pending vendor quote blocks the GC send too
  // (a "budget number" going out the door as though it were firm is exactly
  // the mistake this closes). Never applied to email-prebid-chris below —
  // that internal package carries no pricing at all.
  const budgetGate = await budgetPendingGate(bid.id);
  if (budgetGate) return res.status(409).json({ error: budgetGate.error });
  // Evidence round 4.1 — every GC-facing quantity needs evidence (or, for a
  // manual/hand-typed line, a reason). Never applied to email-prebid-chris.
  const evGate = await evidenceGate(bid.id);
  if (evGate) return res.status(409).json({ error: evGate.error, reviewItems: evGate.openItems });

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
  const markSubmitted = req.body?.markSubmitted !== false;

  // Never re-render at draft time — prefer the PDF (a GC can always open a
  // PDF; not everyone has Word), falling back to the docx when no PDF was
  // produced (soffice/LibreOffice unavailable at generate-docx time). 409
  // if neither a gate-passed PDF nor docx exists yet.
  // Fix round 1 / B5 — a bid analyzed with run ids attaches ONLY the PDF
  // filed by generate-docx from the CURRENT run (it passed verifyBid), never
  // an older run's file and never the .docx.
  const runId = await currentRunId(bid.id);
  let proposalDoc = await loadMostRecentBidDoc(bid.id, 'proposal', PROPOSAL_PDF_MIME);
  let attachedFormat: 'pdf' | 'docx' = 'pdf';
  if (!proposalDoc && runId) {
    return res.status(409).json({ error: 'No proposal PDF from the current analysis is on file. Generate the proposal again (Download .docx) — the PDF is produced and filed with it; LibreOffice must be installed on the server for the PDF.' });
  }
  if (!proposalDoc) {
    proposalDoc = await loadMostRecentBidDoc(bid.id, 'proposal', PROPOSAL_DOCX_MIME);
    attachedFormat = 'docx';
  }
  if (!proposalDoc) {
    return res.status(409).json({ error: 'No filed proposal on file yet. Generate/download the proposal .docx first.' });
  }
  // R2-B1 — never a file whose inputs changed since it was made.
  const takeoffForSend = includeTakeoff ? await loadMostRecentBidDoc(bid.id, 'takeoff', TAKEOFF_XLSX_MIME) : null;
  const staleProposal = await staleFileMessage(bid.id, [proposalDoc, takeoffForSend], 'final');
  if (staleProposal) return res.status(409).json({ error: staleProposal });
  const proposalBytes = await fetchDocBytes(proposalDoc);
  if (!proposalBytes) {
    return res.status(409).json({ error: 'The filed proposal document could not be loaded. Try re-downloading it first.' });
  }

  const attachments: GraphAttachment[] = [{
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: attachmentFileName(proposalDoc.display_name, proposalDoc.name, proposalDoc.file_type),
    contentType: proposalDoc.file_type || (attachedFormat === 'pdf' ? PROPOSAL_PDF_MIME : PROPOSAL_DOCX_MIME),
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
    return res.status(503).json({ error: 'Email is not configured (Microsoft Graph). Set it up under Integrations first.' });
  }

  // No public link — GCs execute via contract/PO, not a web e-sign page.
  const html = buildBidSubmittalHtml({ bodyText });

  let draft;
  try {
    // FIX-5 (post-review, still true here) — buildBidSubmittalHtml already
    // appends the template's own "Thanks, Jake Salverda / ... /
    // 352-801-8997" sign-off (bidSubmittalEmail.ts's JAKE_SIGNATURE_LINES).
    // Without appendSignature:false, graphCreateDraft tacks the branded
    // HTML signature on again after it — two sign-offs in one draft.
    draft = await graphCreateDraft({ to, cc: cc.length ? cc : undefined, subject, html, attachments, appendSignature: false });
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[bids] draft-proposal failed');
    return res.status(502).json({ error: 'Could not create the draft. Check the mail configuration.' });
  }

  if (!markSubmitted) {
    // Draft-only: no stamps, no stage change — just log that a draft exists.
    await pool.query(
      `INSERT INTO proposal_activity (bid_id, kind, direction, text, created_by)
       VALUES ($1,'draft_created','out',$2,$3)`,
      [bid.id, `Proposal draft created for ${to.join(', ')}`, req.user!.name]
    );
    return res.json({ webLink: draft.webLink, attached: attachedFormat, bid: withDueDays(bid), wonJob: null, stageAdvanced: false });
  }

  // markSubmitted — stamp sent, log the timeline, and — if the bid is still
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
       VALUES ($1,'draft_created','out',$2,$3)`,
      [bid.id, `Proposal draft created for ${to.join(', ')}`, req.user!.name]
    );
    await client.query(
      `INSERT INTO activity (kind, div, text) VALUES ('draft_created','elec',$1)`,
      [`${bid.name} proposal draft created for ${to[0]}${to.length > 1 ? ` +${to.length - 1}` : ''}`]
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
      applyBidStagePostCommit(bid, 'submitted', (err, phase) => logger.error({ err, phase, bidId: bid.id }, '[bids] draft-proposal stage-advance Drive step failed'));
    }
    res.json({ webLink: draft.webLink, attached: attachedFormat, bid: withDueDays(updatedBid), wonJob, stageAdvanced: updatedBid.stage === 'submitted' && bid.stage === 'due' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, bidId: bid.id }, '[bids] draft-proposal post-draft stamp failed (draft already created)');
    res.status(500).json({ error: 'Draft created, but the bid record could not be updated. Refresh to check its status.' });
  } finally {
    client.release();
  }
});

// ── Phase 4 Task 1.5: the internal Chris pre-bid-package email ──────────────
// A DRAFT, not a send — Jake reviews/sends from Outlook, same as notify-team.
// FIX-11 (post-review) — the recipient used to be hardcoded in the frontend
// (PcWorkspace.tsx). DEFAULT_PREBID_CHRIS_EMAIL is only the last-resort
// fallback now — the real default lives in the `prebid_chris_email`
// app_setting (Settings screen), configurable without a code change.
const DEFAULT_PREBID_CHRIS_EMAIL = 'chrise@accuratepowerandtechnology.com';

router.post('/:id/email-prebid-chris', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;
  // Fix round 1 / B5 — the pre-bid package is gated by the review too.
  const gate = await takeoffGate(bid.id);
  if (gate) return res.status(409).json({ error: gate.error, reviewItems: gate.openItems });

  let to = Array.isArray(req.body?.to)
    ? (req.body.to as unknown[]).map(e => String(e).trim()).filter(Boolean)
    : [];
  if (!to.length) {
    const configured = (await getSetting('prebid_chris_email'))?.trim();
    if (configured) to = [configured];
  }
  if (!to.length) to = [DEFAULT_PREBID_CHRIS_EMAIL];

  const scopeDoc = await loadMostRecentBidDoc(bid.id, 'prebid_scope', PROPOSAL_DOCX_MIME);
  const takeoffDoc = await loadMostRecentBidDoc(bid.id, 'prebid_takeoff', TAKEOFF_XLSX_MIME);
  if (!scopeDoc && !takeoffDoc) {
    return res.status(409).json({ error: 'No pre-bid package from the current analysis is on file. Generate it first.' });
  }
  const stalePackage = await staleFileMessage(bid.id, [scopeDoc, takeoffDoc], 'draft');
  if (stalePackage) return res.status(409).json({ error: stalePackage });

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
    // FIX-5 (post-review) — buildPrebidChrisBodyHtml already ends with its
    // own "Jake" sign-off; appendSignature:false stops the branded HTML
    // signature from being appended a second time.
    draft = await graphCreateDraft({ to, subject, html, attachments, appendSignature: false });
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

// Stream one photo's bytes from this bid's Drive Photos folder. Job-site photos
// are listed straight out of Drive and never get a `documents` row, so the
// generic /documents/drive-file/:fileId proxy correctly fails closed on them
// (post-review fix for B2) — this owned-record route authorizes by folder
// membership instead: the file's parent must be this bid's own Photos folder.
router.get('/:id/photos/:fileId', requireAuth, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;
  if (!bid.drive_photos_folder_id) return res.status(404).json({ error: 'File not available' });
  const parents = await getFileParents(req.params.fileId);
  if (!parents || !parents.includes(bid.drive_photos_folder_id)) {
    return res.status(403).json({ error: 'You do not have access to this file' });
  }
  const media = await getFileMedia(req.params.fileId);
  if (!media) return res.status(404).json({ error: 'File not available' });
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  media.stream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  media.stream.pipe(res);
});

// Soft delete — moves the bid (and its won-job revenue record) to the Trash.
// Recoverable via /restore; permanently removed by /purge or the retention job.
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const bid = await loadOwnedBid(req, res);
  if (!bid) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE bids SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [req.params.id, req.user!.id]);
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

// Restore a trashed bid (and its won-job record). Task 2 (audit ux #5) —
// admin, or the user who deleted it, within RESTORE_WINDOW_MS — so a delete's
// toast "Undo" works for the person who just clicked it, not only an admin.
router.post('/:id/restore', requireAuth, async (req: AuthRequest, res) => {
  const { rows: existing } = await pool.query(
    'SELECT deleted_by, deleted_at FROM bids WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id]
  );
  if (!existing.length) return res.status(404).json({ error: 'Not found in Trash' });
  if (!canRestore(req.user!, existing[0])) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  const { rows } = await pool.query('UPDATE bids SET deleted_at=NULL, deleted_by=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *', [req.params.id]);
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

export default router;
