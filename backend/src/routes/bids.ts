import { Router } from 'express';
import { Resend } from 'resend';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { writeAudit } from '../utils/audit';
import { ensureProject, setProjectDeleted } from '../utils/project';
import { commissionRate, commissionAmount } from '../utils/commission';
import { getSetting } from '../db/getSetting';
import { parseDueDays, withDueDays, formatDue } from '../utils/dueDate';
import { escapeHtml } from '../utils/escapeHtml';
import { logger } from '../utils/logger';
import { upsertCustomer } from './customers';
import {
  createJobFolder,
  createSubfolders,
  moveJobToStage,
  jobFolderName,
  BID_SUBFOLDER_NAMES,
  AWARD_SUBFOLDER_NAMES,
  ESTIMATING_ACTIVE_BIDS_ROOT,
  ESTIMATING_SUBMITTED_BIDS_ROOT,
  ACTIVE_PROJECTS_ROOT,
  COMPLETED_PROJECTS_ROOT,
} from '../services/googleDrive';

const router = Router();

async function sendBidNotification(bid: Record<string, unknown>, addedBy: { name: string }) {
  const [enabled, emailsJson, apiKey, fromAddress, fromName, frontendUrl] = await Promise.all([
    getSetting('bid_notify_enabled'),
    getSetting('bid_notify_emails'),
    getSetting('email_resend_api_key'),
    getSetting('email_from_address'),
    getSetting('email_from_name'),
    getSetting('frontend_url'),
  ]);
  if (enabled === 'false' || !apiKey) return;
  let emails: string[] = [];
  try { emails = JSON.parse(emailsJson || '[]'); } catch { return; }
  if (!emails.length) return;

  const dueStr = bid.due ? String(bid.due) : 'TBD';
  const amt = bid.amount ? '$' + Number(bid.amount).toLocaleString() : '—';
  const base = (frontendUrl || 'https://electrical-program.onrender.com').replace(/\/$/, '');

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
    to: emails,
    subject: `New Bid — ${bid.name}`,
    html: `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 16px">New Bid Added</h2>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5;width:130px">Job</td><td style="padding:8px 12px">${escapeHtml(bid.name)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">General Contractor</td><td style="padding:8px 12px">${escapeHtml(bid.gc)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Location</td><td style="padding:8px 12px">${escapeHtml(bid.loc)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Due Date</td><td style="padding:8px 12px">${escapeHtml(dueStr)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Est. Value</td><td style="padding:8px 12px">${escapeHtml(amt)}</td></tr>
        <tr><td style="padding:8px 12px;font-weight:700;background:#f5f5f5">Added By</td><td style="padding:8px 12px">${escapeHtml(addedBy.name)}</td></tr>
      </table>
      <p style="margin:20px 0 0"><a href="${base}" style="background:#4D8DF7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open Pipeline →</a></p>
    </div>`,
    text: `New Bid: ${bid.name}\nGC: ${bid.gc}\nLocation: ${bid.loc}\nDue: ${dueStr}\nEst. Value: ${amt}\nAdded by: ${addedBy.name}\n\n${base}`,
  });
}

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

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name, gc, loc, amount, due, notes } = req.body;
  if (!name?.trim() || !gc?.trim()) return res.status(400).json({ error: 'Name and GC required' });
  const user = req.user!;
  const customerId = await upsertCustomer(gc, 'gc');
  const { rows } = await pool.query(
    `INSERT INTO bids (name, gc, loc, amount, due, notes, salesperson_id, salesperson_name, customer_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [name.trim(), gc.trim(), (loc||'').trim()||'—', amount ? Number(amount) : null, formatDue(due), notes?.trim() || null, user.id, user.name, customerId]
  );
  sendBidNotification(rows[0], user).catch(() => {});

  // Await Drive folder setup before responding so that folder IDs are written to
  // the DB by the time the client receives the new bid. This prevents a race where
  // an immediately-uploaded file finds null folder IDs and skips Drive routing.
  // Drive failure must not block bid creation — we catch and continue.
  const newBid = rows[0];
  try {
    logger.info({ bidId: newBid.id, bidName: newBid.name }, '[drive] starting bid folder setup');
    const jobFolderId = await createJobFolder(jobFolderName(newBid.name, newBid.loc), newBid.gc, ESTIMATING_ACTIVE_BIDS_ROOT);
    logger.info({ bidId: newBid.id, jobFolderId }, '[drive] createJobFolder result');
    if (jobFolderId) {
      const subs = await createSubfolders(jobFolderId, BID_SUBFOLDER_NAMES);
      logger.info({ bidId: newBid.id, subs }, '[drive] createSubfolders result');
      await pool.query(
        `UPDATE bids SET drive_job_folder_id=$1, drive_plans_folder_id=$2, drive_estimates_folder_id=$3 WHERE id=$4`,
        [jobFolderId, subs['Plans'] || null, subs['Bid Proposals'] || null, newBid.id],
      );
      newBid.drive_job_folder_id = jobFolderId;
      newBid.drive_plans_folder_id = subs['Plans'] || null;
      newBid.drive_estimates_folder_id = subs['Bid Proposals'] || null;
      logger.info({ bidId: newBid.id, drive_job_folder_id: jobFolderId, drive_plans_folder_id: newBid.drive_plans_folder_id }, '[drive] bid folder setup complete');
    } else {
      logger.warn({ bidId: newBid.id }, '[drive] createJobFolder returned null — Drive may not be configured or ESTIMATING_ACTIVE_BIDS_ROOT is inaccessible');
    }
  } catch (err) {
    logger.error({ err, bidId: newBid.id }, '[drive] bid folder setup failed');
  }

  res.json(withDueDays(newBid));
});

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  const valid = ['due', 'submitted', 'awarded', 'lost'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  if (!(await loadOwnedBid(req, res))) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current bid
    const { rows: cur } = await client.query('SELECT * FROM bids WHERE id=$1', [req.params.id]);
    if (!cur.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const bid = cur[0];

    // Update stage; stamp lifecycle timestamps the first time each is reached.
    const { rows } = await client.query(
      `UPDATE bids SET stage=$1, loss_reason=$3, competitor=$4, updated_at=now(),
         submitted_at = CASE WHEN $1 IN ('submitted','awarded') THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
         awarded_at   = CASE WHEN $1 = 'awarded' THEN COALESCE(awarded_at, now()) ELSE awarded_at END
       WHERE id=$2 RETURNING *`,
      [stage, req.params.id, stage === 'lost' ? (req.body.loss_reason || null) : null, stage === 'lost' ? (req.body.competitor || null) : null]
    );

    // If transitioning TO awarded (not already awarded), create won-job record
    let wonJob = null;
    if (stage === 'awarded' && bid.stage !== 'awarded') {
      const rate = await commissionRate();
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id,
                                commission_rate, commission_amount, commission_status, commission_earned_at)
         VALUES ($1,$2,$3,'Electrical',$4,$5,$6,$7,'earned',now())
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [bid.salesperson_name, bid.name, bid.id, bid.amount, bid.salesperson_id || null,
         rate, commissionAmount(bid.amount, rate)]
      );
      wonJob = wj[0] || null;

      // Awarded work becomes a first-class project (shares the bid id).
      await ensureProject(client, {
        id: bid.id, sourceType: 'elec', customerId: bid.customer_id,
        name: bid.name, contractValue: bid.amount,
      });

      await client.query(
        `INSERT INTO activity (kind, div, text)
         VALUES ('awarded','elec',$1)`,
        [`${bid.name} awarded — ${bid.salesperson_name}`]
      );
    } else if (stage !== bid.stage) {
      const labels: Record<string, string> = { due:'Bids Due', submitted:'Submitted', lost:'Lost' };
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ($1,'elec',$2)`,
        [stage === 'lost' ? 'lost' : 'new', `${bid.name} moved to ${labels[stage] || stage}`]
      );
    }

    await client.query('COMMIT');

    // Fire-and-forget: move Drive folder to the correct stage location
    if (bid.drive_job_folder_id && stage !== bid.stage) {
      const stageRoots: Record<string, string> = {
        due:       ESTIMATING_ACTIVE_BIDS_ROOT,
        submitted: ESTIMATING_SUBMITTED_BIDS_ROOT,
        awarded:   ACTIVE_PROJECTS_ROOT,
        // lost: no move — folder stays in Submitted Bids
      };
      const destRoot = stageRoots[stage];
      if (destRoot) {
        moveJobToStage(bid.drive_job_folder_id, bid.gc, destRoot)
          .catch(err => console.error('[drive] moveJobToStage on stage change failed:', err));
      }
    }

    if (stage === 'awarded' && bid.stage !== 'awarded') {
      await writeAudit(req, {
        action: 'award', entityType: 'bid', entityId: bid.id,
        summary: `Awarded bid "${bid.name}" (${bid.gc}) — $${Number(bid.amount || 0).toLocaleString()}`,
        before: { stage: bid.stage }, after: { stage: 'awarded', value: bid.amount },
      });
      // Awarded = job is starting, not finished — folder stays in Active Projects.
      // Folder moves to Completed Projects only when the job is closed out.
      //
      // Now that the job is a real project, add the remaining project subfolders
      // (Plans + Bid Proposals already exist from the bid stage). Skip if already
      // created (guard against re-award).
      if (bid.drive_job_folder_id && !bid.drive_submittals_folder_id) {
        (async () => {
          try {
            const subfolders = await createSubfolders(bid.drive_job_folder_id, AWARD_SUBFOLDER_NAMES);
            await pool.query(
              `UPDATE bids SET
                 drive_photos_folder_id=$1, drive_contracts_folder_id=$2,
                 drive_submittals_folder_id=$3, drive_rfis_folder_id=$4,
                 drive_change_orders_folder_id=$5
               WHERE id=$6`,
              [
                subfolders['Photos'] || null,
                subfolders['Contract & Invoices'] || null,
                subfolders['Submittals'] || null,
                subfolders['RFIs'] || null,
                subfolders['Change Orders'] || null,
                bid.id,
              ],
            );
          } catch (err) {
            console.error('[drive] Awarded subfolder creation failed:', err);
          }
        })();
      }
    }
    res.json({ bid: withDueDays(rows[0]), wonJob });
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
  if (!(await loadOwnedBid(req, res))) return;
  const { name, gc, loc, amount, due, sheets, contact } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name    !== undefined) { fields.push(`name=$${i++}`);    vals.push(name.trim()); }
  if (gc      !== undefined) { fields.push(`gc=$${i++}`);      vals.push(gc.trim()); }
  if (loc     !== undefined) { fields.push(`loc=$${i++}`);     vals.push(loc.trim() || '—'); }
  if (amount  !== undefined) { fields.push(`amount=$${i++}`);  vals.push(amount === '' || amount === null ? null : Number(amount)); }
  if (due     !== undefined) { fields.push(`due=$${i++}`);     vals.push(formatDue(due)); }
  if (sheets  !== undefined) { fields.push(`sheets=$${i++}`);  vals.push(Number(sheets) || null); }
  if (contact !== undefined) { fields.push(`contact=$${i++}`); vals.push(contact.trim()); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at=now()`);
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE bids SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
    vals
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(withDueDays(rows[0]));
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

export default router;
