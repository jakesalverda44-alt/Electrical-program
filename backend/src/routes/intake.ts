import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { writeAudit } from '../utils/audit';
import { upsertCustomer } from './customers';
import { formatDue, withDueDays } from '../utils/dueDate';
import { setupBidDriveFolders } from './bids';
import { ingestTaggedBidEmails } from '../integrations/intakeEmailIngest';
import { downloadAttachments, createReplyDraft } from '../integrations/outlookMail';
import { pushBidDueToCalendar } from '../integrations/outlookCalendar';
import { uploadFile } from '../services/googleDrive';
import { logger } from '../utils/logger';

const router = Router();

// Manual "Refresh" — pull newly "new bid"-tagged Outlook emails into the inbox now.
// (A background poller also runs every ~20 min.) Returns how many new items were imported.
router.post('/refresh', requireAuth, async (_req, res) => {
  try {
    const imported = await ingestTaggedBidEmails();
    res.json({ imported });
  } catch (err) {
    logger.error({ err }, '[intake] manual refresh failed');
    res.status(502).json({ error: 'Could not reach the mailbox. Check Graph configuration.' });
  }
});

// After a bid is created from an email-sourced intake item: copy the email's attachments into
// the bid's Drive "Plans" folder, add the due date to the calendar, and draft a reply to the
// GC. All steps are best-effort and must never fail the accept. Runs after the DB commit.
// `dueDate` is the reviewer's confirmed ISO due date (not a date parsed from the email body).
async function finishEmailSourcedAccept(
  item: Record<string, any>,
  bid: Record<string, any>,
  dueDate: string | null,
): Promise<void> {
  // 1) Download the email's attachments and upload them into the bid's Plans subfolder
  //    (falling back to the job folder), reusing the existing Drive upload helper.
  try {
    const folderId = bid.drive_plans_folder_id || bid.drive_job_folder_id;
    if (!item.graph_message_id) {
      logger.warn({ bidId: bid.id }, '[intake] no graph_message_id — cannot fetch attachments');
    } else if (!folderId) {
      logger.warn({ bidId: bid.id }, '[intake] no Drive folder on bid — skipping attachment upload');
    } else {
      const files = await downloadAttachments(item.graph_message_id);
      let uploaded = 0;
      for (const f of files) {
        const id = await uploadFile(f.name, f.contentType, f.content, folderId);
        if (id) uploaded++;
        else logger.error({ bidId: bid.id, name: f.name }, '[intake] Drive upload returned null (Drive not configured?)');
      }
      logger.info({ bidId: bid.id, folderId, fetched: files.length, uploaded }, '[intake] email attachments → Drive');
    }
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[intake] attachment download/upload failed');
  }

  // 2) Add the bid due date to Outlook from the confirmed due_date field (reminder 2d before).
  await pushBidDueToCalendar(
    { id: bid.id, name: bid.name, gc: bid.gc, loc: bid.loc, source_email_link: bid.source_email_link },
    dueDate,
  ).catch(() => {});

  // 3) Draft (do NOT send) a reply to the email's sender saying we'll be bidding.
  if (item.graph_message_id) {
    const comment = 'Thank you for the invitation — we received the bid documents and we will '
      + 'be submitting a proposal. We will follow up with any questions. Best regards,';
    await createReplyDraft(item.graph_message_id, comment).catch(() => {});
  }
}

// Lightweight unread count for the sidebar badge (all unopened bids). Polled app-wide so the
// badge stays live regardless of which page is open.
router.get('/unread-count', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`SELECT count(*)::int AS unread FROM intake_items WHERE read_at IS NULL`);
  res.json({ unread: rows[0].unread });
});

// Shared inbox of incoming bid invitations. Pending items plus anything
// processed in the last 7 days (so accept/decline stay visible briefly).
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM intake_items
     WHERE status = 'pending' OR updated_at > now() - interval '7 days'
     ORDER BY (status <> 'pending'), created_at DESC`
  );
  res.json(rows);
});

// Manually add an incoming bid to the inbox.
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, contact, amount, sheets, due, notes, source, sq_ft } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const num = (v: unknown) => (v !== undefined && v !== null && v !== '') ? Number(v) : null;
  // Manually-added items are authored by the user, so they start read (not "new to you").
  // Email-imported items are created unread by the ingest path.
  const { rows } = await pool.query(
    `INSERT INTO intake_items (name, gc, loc, contact, amount, sheets, due, notes, source, sq_ft, created_by, created_by_name, read_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING *`,
    [name.trim(), gc?.trim() || null, loc?.trim() || null, contact?.trim() || null,
     num(amount), num(sheets), due || null, notes?.trim() || null, source || 'manual',
     num(sq_ft), req.user!.id, req.user!.name]
  );
  res.json(rows[0]);
});

// Mark an intake item read (called when the reviewer opens it). Idempotent.
router.post('/:id/read', requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `UPDATE intake_items SET read_at = COALESCE(read_at, now()) WHERE id=$1 RETURNING id, read_at`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Accept → create a bid (owned by the accepter) and mark the item accepted.
// Optional body fields override the stored values (the reviewer may edit first).
router.post('/:id/accept', requireAuth, async (req: AuthRequest, res) => {
  const o = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query('SELECT * FROM intake_items WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!cur.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const it = cur[0];
    if (it.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already processed' }); }

    const name = String(o.name ?? it.name ?? '').trim();
    const gc   = String(o.gc ?? it.gc ?? '').trim();
    if (!name || !gc) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Name and GC are required to accept' }); }
    const loc     = o.loc ?? it.loc;
    const contact = o.contact ?? it.contact;
    const amount  = o.amount ?? it.amount;
    const notes   = o.notes ?? it.notes;
    const due     = o.due ?? it.due;
    const sqFt    = o.sq_ft ?? it.sq_ft;
    const user = req.user!;
    const customerId = await upsertCustomer(gc, 'gc');

    const { rows: bidRows } = await client.query(
      `INSERT INTO bids (name, gc, loc, contact, amount, due, notes, salesperson_id, salesperson_name, customer_id, sq_ft, source_email_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, gc, (loc || '').trim() || '—', (typeof contact === 'string' && contact.trim()) ? contact.trim() : null,
       amount != null && amount !== '' ? Number(amount) : null,
       formatDue(due), notes?.trim?.() || notes || null, user.id, user.name, customerId,
       sqFt != null && sqFt !== '' ? Number(sqFt) : null, it.web_link || null]
    );
    const bid = bidRows[0];
    await client.query(
      `UPDATE intake_items SET status='accepted', accepted_bid_id=$1, accepted_at=now(), updated_at=now() WHERE id=$2`,
      [bid.id, req.params.id]
    );
    await client.query('COMMIT');
    await writeAudit(req, { action: 'accept', entityType: 'intake', entityId: req.params.id, summary: `Accepted incoming bid "${name}" (${gc}) into the pipeline` });

    // Create the Drive folder structure (shared with POST /api/bids) before responding so
    // folder ids are persisted, then — for email-sourced items — copy attachments, add the
    // due date to the calendar, and draft a reply. None of this blocks/fails the accept.
    await setupBidDriveFolders(bid);
    if (it.source === 'email') {
      // Pass the reviewer's confirmed ISO due date for the calendar event (the stored bid.due
      // is a display string like "Jun 20" with no year — unsafe to re-parse).
      const dueIso = (due && String(due).trim()) ? String(due).trim() : null;
      await finishEmailSourcedAccept(it, bid, dueIso).catch(err =>
        logger.error({ err, bidId: bid.id }, '[intake] email-sourced post-accept failed'));
    }
    res.json({ bid: withDueDays(bid) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Decline → keep a record with the reason.
router.post('/:id/decline', requireAuth, async (req: AuthRequest, res) => {
  const { reason } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE intake_items SET status='declined', decline_reason=$1, declined_at=now(), updated_at=now()
     WHERE id=$2 AND status='pending' RETURNING *`,
    [reason || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found or already processed' });
  await writeAudit(req, { action: 'decline', entityType: 'intake', entityId: req.params.id, summary: `Declined incoming bid "${rows[0].name}"${reason ? ` — ${reason}` : ''}` });
  res.json(rows[0]);
});

export default router;
