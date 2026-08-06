import { Router } from 'express';
import type { PoolClient } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { proposalEmailHtml } from '../email/proposalEmail';
import { graphSendMail, graphCreateDraft, isGraphMailConfigured, TEAM_NOTIFY_TO } from '../email/graphMailer';
import { loadLinkedDocumentsAsAttachments } from '../email/bidAttachments';
import { escapeHtml } from '../utils/escapeHtml';
import { getSetting } from './settings';
import { upsertCustomer } from './customers';
import { asyncHandler } from '../utils/asyncHandler';
import { parseAIJSON } from '../ai/json';
import { logger } from '../utils/logger';
import { writeAudit } from '../utils/audit';
import { ensureProject, setProjectDeleted } from '../utils/project';
import { commissionRate, commissionAmount } from '../utils/commission';
import { createNotification } from '../notifications/engine';
import { ownerAdminIds } from '../notifications/prefs';
import { sendPushToUsers } from '../integrations/webPush';
import { fetchUpcomingEvents, fetchEventDetail } from '../integrations/outlookCalendar';
import { pdfUpload } from '../utils/upload';
import {
  uploadFile,
  createCustomerFolder,
  createSubfolders,
  moveJobToStage,
  listFolderFiles,
  ensureSubfolder,
  GENERATOR_PROPOSALS_FOLDER,
  ACTIVE_GENERATOR_JOBS_ROOT,
  COMPLETED_GENERATOR_JOBS_ROOT,
  GEN_SUBFOLDER_NAMES,
} from '../services/googleDrive';

const router = Router();
const upload = pdfUpload;

// Restricted (rep) users may only act on their own proposals. Returns the row if allowed,
// or sends the appropriate 403/404 and returns null.
async function loadOwnedGen(req: AuthRequest, res: import('express').Response) {
  const { rows } = await pool.query('SELECT * FROM generator_proposals WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return null; }
  const scope = ownScopeId(req.user!);
  if (scope && rows[0].salesperson_id !== scope) {
    res.status(403).json({ error: 'You do not have access to this proposal' });
    return null;
  }
  return rows[0];
}

// Other options in a group (e.g. a good/better/best set offered to one customer)
// lose out once one of them is awarded — reclassify them as "superseded" rather
// than "declined" so they don't count against win rate. This also catches a
// sibling a rep already declined by hand before getting to the winning option's
// paperwork, or one that's being linked into the group after the fact — once a
// group has a winner, none of its other options should read as a loss.
async function supersedeGroupSiblings(client: PoolClient, groupId: string, awardedGen: Record<string, unknown>) {
  const { rows: superseded } = await client.query(
    `UPDATE generator_proposals SET stage='superseded', updated_at=now()
     WHERE group_id=$1 AND id<>$2 AND stage NOT IN ('awarded','superseded')
     RETURNING *`,
    [groupId, awardedGen.id]
  );
  if (superseded.length) {
    await client.query(
      `INSERT INTO activity (kind, div, text) VALUES ('superseded','gen',$1)`,
      [`${superseded.length} other option${superseded.length > 1 ? 's' : ''} for ${awardedGen.customer} superseded by the awarded proposal`]
    );
  }
  return superseded;
}

// Award a generator proposal: book its won_jobs row at the current commission
// rate, ensure the project registry row exists, log an "awarded" activity entry,
// and reclassify any sibling options in its group as superseded. Both award
// entry points — dragging the pipeline card to Awarded (PATCH /:id/stage) and
// countersigning a signed proposal (POST /:id/countersign) — call this same
// helper so an award always means exactly the same four things happened,
// regardless of which door it came through.
async function awardGen(
  client: PoolClient,
  gen: Record<string, any>,
): Promise<{ wonJob: Record<string, unknown> | null; superseded: Record<string, unknown>[] }> {
  const rate = await commissionRate();
  const { rows: wj } = await client.query(
    `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id,
                            commission_rate, commission_amount, commission_status, commission_earned_at)
     VALUES ($1,$2,$3,'Generator',$4,$5,$6,$7,'earned',now())
     ON CONFLICT (proposal_id) DO NOTHING
     RETURNING *`,
    [gen.salesperson_name || 'Unknown', gen.customer, gen.id, gen.amount, gen.salesperson_id || null,
     rate, commissionAmount(gen.amount, rate)]
  );
  const wonJob = wj[0] || null;
  await ensureProject(client, {
    id: gen.id, sourceType: 'gen', customerId: gen.customer_id,
    name: gen.customer, contractValue: gen.amount,
  });
  await client.query(
    `INSERT INTO activity (kind, div, text) VALUES ('awarded','gen',$1)`,
    [`${gen.customer} awarded — ${gen.salesperson_name}`]
  );

  let superseded: Record<string, unknown>[] = [];
  if (gen.group_id) {
    superseded = await supersedeGroupSiblings(client, gen.group_id, gen);
  }
  return { wonJob, superseded };
}

router.get('/benchmark', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT kw, amount FROM generator_proposals WHERE stage = 'awarded' AND kw > 0 AND amount > 0 AND deleted_at IS NULL`
  );
  const byKw = new Map<number, { amount: number }[]>();
  for (const r of rows) {
    const kw = Number(r.kw);
    if (!byKw.has(kw)) byKw.set(kw, []);
    byKw.get(kw)!.push({ amount: Number(r.amount) });
  }
  const result = Array.from(byKw.entries()).map(([kw, group]) => {
    const avgAmount = group.reduce((s, r) => s + r.amount, 0) / group.length;
    const avgPerKw  = avgAmount / kw;
    return { kw, count: group.length, avgAmount: Math.round(avgAmount), avgPerKw: Math.round(avgPerKw) };
  });
  res.json(result);
});

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const params: unknown[] = [];
  const where: string[] = ['deleted_at IS NULL', 'closed_at IS NULL'];
  if (scope) { params.push(scope); where.push(`salesperson_id = $${params.length}`); }
  let sql = `SELECT * FROM generator_proposals WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY created_at DESC';
  // Opt-in pagination: ?limit=N&offset=M. Omitted → return all rows (backward compatible).
  if (req.query.limit !== undefined) {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { customer, loc, mfr, model, kw, amount, tax, addons, proposal_no, form_data, totals_data,
          stage, date_won, commission_paid } = req.body;
  if (!customer?.trim()) return res.status(400).json({ error: 'Customer required' });

  // Historical jobs finished before the CRM existed are logged directly at their final
  // stage rather than dragged through the pipeline, so none of the stage-change side
  // effects (Drive folders, "moved to…" activity, award notifications) fire for work
  // that is already long done. 'signed' stays excluded — it means a real signature.
  const HISTORICAL_STAGES = ['building', 'sent', 'awarded', 'declined'];
  const initialStage = stage && HISTORICAL_STAGES.includes(stage) ? stage : 'building';

  const user = req.user!;
  const customerId = await upsertCustomer(customer, 'customer');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO generator_proposals (
         customer, loc, mfr, model, kw, amount, tax, addons,
         proposal_no, form_data, totals_data,
         salesperson_id, salesperson_name, customer_id, stage
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15) RETURNING *`,
      [customer.trim(), (loc || '').trim() || '—', mfr, model, Number(kw) || 0,
       Number(amount) || 0, Number(tax) || 0, Number(addons) || 0,
       proposal_no || null,
       form_data !== undefined ? JSON.stringify(form_data) : null,
       totals_data !== undefined ? JSON.stringify(totals_data) : null,
       user.id, user.name, customerId, initialStage]
    );
    const gen = rows[0];

    // An awarded job still needs its won_jobs row or it won't appear in revenue
    // reporting — dated when the job was actually won, not today.
    let wonJob = null;
    if (initialStage === 'awarded') {
      const rate = await commissionRate();
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value,
                               salesperson_id, commission_rate, commission_amount,
                               commission_status, commission_earned_at, date_won)
         VALUES ($1,$2,$3,'Generator',$4,$5,$6,$7,$8,
                 COALESCE($9::timestamptz, now()), COALESCE($9::date, CURRENT_DATE))
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [gen.salesperson_name || 'Unknown', gen.customer, gen.id, gen.amount,
         gen.salesperson_id || null, rate, commissionAmount(gen.amount, rate),
         commission_paid ? 'paid' : 'earned', date_won || null]
      );
      wonJob = wj[0] || null;
      await ensureProject(client, {
        id: gen.id, sourceType: 'gen', customerId: gen.customer_id,
        name: gen.customer, contractValue: gen.amount,
      });
    }

    await client.query('COMMIT');
    res.json(wonJob ? { ...gen, wonJob } : gen);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Duplicate an existing proposal into a fresh "building" draft for the same
// customer. This is how a rep offers more than one option to one customer
// (e.g. a good/better/best set, or a Kohler vs Generac alternative): the copy
// keeps the customer, site, and pricing details but gets its own proposal
// number and link, and none of the original's lifecycle state (sent/signed/
// awarded/Drive folders/won-job) carries over.
router.post('/:id/duplicate', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const src = await loadOwnedGen(req, res);
  if (!src) return;

  // Only active proposals can be duplicated — terminal ones (signed/awarded/declined/
  // superseded) are not re-offered from here.
  if (['signed', 'awarded', 'declined', 'superseded'].includes(src.stage)) {
    return res.status(400).json({ error: 'Only active proposals can be duplicated.' });
  }

  // Preserve the original salesperson so ownership stays with the same rep even
  // when an admin makes the copy. proposal_no is left null so the builder mints
  // a new one; proposal_token defaults to a fresh uuid.
  const customerId = src.customer_id || (await upsertCustomer(src.customer, 'customer'));

  // Both copies share a group_id so they're recognized as alternate options for
  // the same opportunity: awarding one auto-closes the other as "superseded"
  // instead of it dragging down win rate as a genuine loss. If the source isn't
  // grouped yet (first duplicate off it), mint a new group and backfill it onto
  // the source too.
  let groupId = src.group_id;
  if (!groupId) {
    groupId = (await pool.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await pool.query('UPDATE generator_proposals SET group_id=$1 WHERE id=$2', [groupId, src.id]);
  }

  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (
       customer, loc, mfr, model, kw, amount, tax, addons,
       form_data, totals_data,
       salesperson_id, salesperson_name, customer_id, group_id, stage
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,'building')
     RETURNING *`,
    [
      src.customer, src.loc, src.mfr, src.model, src.kw, src.amount, src.tax, src.addons,
      src.form_data != null ? JSON.stringify(src.form_data) : null,
      src.totals_data != null ? JSON.stringify(src.totals_data) : null,
      src.salesperson_id || null, src.salesperson_name || null, customerId, groupId,
    ],
  );
  const gen = rows[0];

  await writeAudit(req, {
    action: 'duplicate', entityType: 'gen', entityId: gen.id,
    summary: `Duplicated generator proposal "${src.customer}" into a new draft`,
    after: { source_id: src.id, group_id: groupId },
  });

  res.json(gen);
}));

router.patch('/:id/stage', requireAuth, async (req: AuthRequest, res) => {
  const { stage } = req.body;
  const valid = ['building', 'sent', 'signed', 'awarded', 'declined'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  if (!(await loadOwnedGen(req, res))) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cur } = await client.query(
      'SELECT * FROM generator_proposals WHERE id=$1', [req.params.id]
    );
    if (!cur.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const gen = cur[0];

    // "Signed" is reserved for the customer actually signing (the public sign
    // endpoint sets it). It can't be dragged into manually unless a signature
    // is already on file.
    if (stage === 'signed' && !gen.signed_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Signed is set automatically when the customer signs the proposal. Send it and the card will move on its own.',
      });
    }

    const { rows } = await client.query(
      'UPDATE generator_proposals SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
      [stage, req.params.id]
    );

    let wonJob = null;
    let superseded: Record<string, unknown>[] = [];
    if (stage === 'awarded' && gen.stage !== 'awarded') {
      ({ wonJob, superseded } = await awardGen(client, gen));
    } else if (stage !== gen.stage) {
      const labels: Record<string, string> = {
        building: 'Building', sent: 'Proposal Sent', signed: 'Signed', declined: 'Declined',
      };
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ($1,'gen',$2)`,
        [stage === 'declined' ? 'lost' : stage === 'sent' ? 'sent' : 'new',
         `${gen.customer} moved to ${labels[stage] || stage}`]
      );
    }

    await client.query('COMMIT');
    if (stage === 'awarded' && gen.stage !== 'awarded') {
      await writeAudit(req, {
        action: 'award', entityType: 'gen', entityId: gen.id,
        summary: `Awarded generator proposal "${gen.customer}" — $${Number(gen.amount || 0).toLocaleString()}`,
        before: { stage: gen.stage }, after: { stage: 'awarded', value: gen.amount },
      });
      // Fire-and-forget: create customer folder + subfolders in Active Generator Jobs
      // Skip if signing already created the folder
      if (!gen.drive_job_folder_id) {
        (async () => {
          try {
            const customerFolderId = await createCustomerFolder(gen.customer, ACTIVE_GENERATOR_JOBS_ROOT);
            if (!customerFolderId) return;
            const subs = await createSubfolders(customerFolderId, GEN_SUBFOLDER_NAMES);
            await pool.query(
              `UPDATE generator_proposals SET
                 drive_job_folder_id=$1,
                 drive_engineering_folder_id=$2,
                 drive_permit_folder_id=$3,
                 drive_contract_folder_id=$4,
                 drive_invoices_folder_id=$5
               WHERE id=$6`,
              [
                customerFolderId,
                subs['Engineering'] || null,
                subs['Permit'] || null,
                subs['Contract'] || null,
                subs['Invoices'] || null,
                gen.id,
              ],
            );
          } catch (err) {
            console.error('[drive] Gen folder setup failed:', err);
          }
        })();
      }

      // Kickoff email is drafted explicitly from the Award Kickoff modal
      // (POST /:id/kickoff-email) — not automatically on the transition.
    }
    res.json({ gen: rows[0], wonJob, superseded });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Countersign a signed proposal: stamp APT's own signature/date onto it and, in the
// same transaction, award the deal. Countersigning is a second, independent trigger
// for the same award behavior a pipeline-drag-to-Awarded fires — see awardGen — so a
// single tap here books a won job, earns commission, creates a project, and
// reclassifies every sibling option in the group as superseded. The frontend's
// confirmation dialog is expected to say so before this endpoint is ever called.
router.post('/:id/countersign', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  // A contract the customer has not signed cannot be executed by APT's side of it.
  if (!gen.signed_at) {
    return res.status(409).json({ error: 'This proposal has not been signed by the customer yet.' });
  }

  // The caller's reusable saved signature (Settings > My Signature) is what gets
  // copied onto the proposal below — without one there is nothing to countersign with.
  const { rows: callerRows } = await pool.query('SELECT signature_data FROM users WHERE id=$1', [req.user!.id]);
  const signatureData: string | null = callerRows[0]?.signature_data || null;
  if (!signatureData) {
    return res.status(400).json({ error: 'Save your signature in Settings before countersigning.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-read the row under a lock rather than trusting the copy loadOwnedGen already
    // fetched: a double tap (double submit, a retry on a slow network) can race past
    // the checks above, and only a lock taken inside the transaction guarantees the
    // idempotency check below actually holds — one stamp and one award, never two.
    const { rows: locked } = await client.query(
      'SELECT * FROM generator_proposals WHERE id=$1 FOR UPDATE', [gen.id]
    );
    if (!locked.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    let current = locked[0];

    // Already countersigned: return it unchanged rather than re-stamping or re-awarding.
    if (current.countersigned_at) {
      await client.query('ROLLBACK');
      return res.json({ gen: current, wonJob: null, superseded: [] });
    }

    // awardGen (below) books the won job and superseding but, unlike the stage route,
    // never touches the stage column itself — that update lives here alongside the
    // signature stamp so a countersigned proposal actually reads as Awarded.
    const { rows: stamped } = await client.query(
      `UPDATE generator_proposals
       SET countersigned_at = now(), countersignature_data = $1, countersigned_by = $2,
           stage = 'awarded', updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [signatureData, req.user!.id, current.id]
    );
    current = stamped[0];

    const { wonJob, superseded } = await awardGen(client, current);

    await client.query('COMMIT');

    await writeAudit(req, {
      action: 'countersign', entityType: 'gen', entityId: current.id,
      summary: `Countersigned and awarded generator proposal "${current.customer}" — $${Number(current.amount || 0).toLocaleString()}`,
      before: { countersigned_at: null }, after: { countersigned_at: current.countersigned_at, stage: 'awarded' },
    });

    res.json({ gen: current, wonJob, superseded });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}));

// Retroactively link two already-existing proposals as alternate options for the
// same opportunity — for cases that weren't created via Duplicate (so never got a
// shared group_id) but should have been, e.g. two sizes quoted separately for one
// customer. If the merged group already has an awarded member, the rest are
// immediately superseded — this is the cleanup path for a job where one option
// was awarded before the sibling ever got linked.
router.post('/:id/link-group', requireAuth, async (req: AuthRequest, res) => {
  const { targetId } = req.body;
  if (!targetId || typeof targetId !== 'string') return res.status(400).json({ error: 'targetId required' });
  if (targetId === req.params.id) return res.status(400).json({ error: 'Cannot link a proposal to itself' });
  if (!(await loadOwnedGen(req, res))) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pair } = await client.query(
      `SELECT * FROM generator_proposals WHERE id IN ($1,$2) AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, targetId]
    );
    const a = pair.find(r => r.id === req.params.id);
    const b = pair.find(r => r.id === targetId);
    if (!a || !b) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const scope = ownScopeId(req.user!);
    if (scope && b.salesperson_id !== scope) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You do not have access to that proposal' });
    }
    const sameCustomer = a.customer_id && b.customer_id
      ? a.customer_id === b.customer_id
      : String(a.customer || '').trim().toLowerCase() === String(b.customer || '').trim().toLowerCase();
    if (!sameCustomer) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Can only link proposals for the same customer' });
    }
    if (a.group_id && a.group_id === b.group_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already linked' });
    }

    // Reuse an existing group_id if either side already has one — folding both
    // groups' full membership into it — otherwise mint a new one.
    const groupId = a.group_id || b.group_id
      || (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    const oldGroupIds = [a.group_id, b.group_id].filter((id): id is string => !!id && id !== groupId);
    await client.query(
      `UPDATE generator_proposals SET group_id=$1, updated_at=now()
       WHERE id = ANY($2::uuid[]) OR group_id = ANY($3::uuid[])`,
      [groupId, [a.id, b.id], oldGroupIds]
    );

    await writeAudit(req, {
      action: 'link-group', entityType: 'gen', entityId: a.id,
      summary: `Linked "${a.customer}" proposal as an alternate option alongside another`,
      after: { group_id: groupId, linked_id: b.id },
    });

    const { rows: groupRows } = await client.query('SELECT * FROM generator_proposals WHERE group_id=$1', [groupId]);
    const awarded = groupRows.find(r => r.stage === 'awarded');
    let superseded: Record<string, unknown>[] = [];
    if (awarded) {
      superseded = await supersedeGroupSiblings(client, groupId, awarded);
    }

    await client.query('COMMIT');
    const { rows: finalRows } = await pool.query('SELECT * FROM generator_proposals WHERE group_id=$1', [groupId]);
    res.json({ updated: finalRows, superseded });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Save a proposal PDF snapshot directly to Drive Generator Proposals folder.
router.post('/:id/drive-proposal', requireAuth, upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;
  const driveDate = new Date().toISOString().split('T')[0];
  uploadFile(
    `Proposal — ${gen.customer} — ${driveDate}.pdf`,
    'application/pdf',
    file.buffer,
    GENERATOR_PROPOSALS_FOLDER,
  ).catch(err => console.error('[drive] Proposal PDF upload failed:', err));
  res.json({ ok: true });
}));

// Mark an awarded generator job as closed/complete.
router.post('/:id/close', requireAuth, async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;
  if (gen.stage !== 'awarded') return res.status(400).json({ error: 'Only awarded jobs can be closed' });
  if (gen.closed_at) return res.status(400).json({ error: 'Job is already closed' });

  const { rows } = await pool.query(
    `UPDATE generator_proposals SET closed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [gen.id],
  );
  pool.query(`UPDATE projects SET status = 'complete' WHERE id = $1`, [gen.id]).catch(() => {});

  await writeAudit(req, {
    action: 'close', entityType: 'gen', entityId: gen.id,
    summary: `Closed generator job "${gen.customer}"`,
    before: { closed_at: null }, after: { closed_at: rows[0].closed_at },
  });

  if (gen.drive_job_folder_id) {
    moveJobToStage(gen.drive_job_folder_id, gen.customer, COMPLETED_GENERATOR_JOBS_ROOT)
      .catch(err => console.error('[drive] moveJobToStage on gen close failed:', err));
  }

  res.json(rows[0]);
});

router.patch('/:id/phase', requireAuth, async (req: AuthRequest, res) => {
  const { phase } = req.body;
  const valid = ['deposit', 'engineering', 'permitting', 'scheduling', 'installation', 'inspection', 'startup', 'complete'];
  if (!valid.includes(phase)) return res.status(400).json({ error: 'Invalid phase' });
  if (!(await loadOwnedGen(req, res))) return;
  const { rows } = await pool.query(
    'UPDATE generator_proposals SET gen_install_phase=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [phase, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.patch('/:id', requireAuth, async (req: AuthRequest, res) => {
  if (!(await loadOwnedGen(req, res))) return;
  const { customer, loc, mfr, model, kw, amount, tax, addons, proposal_no, form_data, totals_data, checklist_data, survey_markup, date_won } = req.body;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (customer !== undefined) { fields.push(`customer=$${i++}`); vals.push(customer.trim()); }
  if (loc      !== undefined) { fields.push(`loc=$${i++}`);      vals.push(loc.trim() || '—'); }
  if (mfr      !== undefined) { fields.push(`mfr=$${i++}`);      vals.push(mfr); }
  if (model    !== undefined) { fields.push(`model=$${i++}`);    vals.push(model); }
  if (kw       !== undefined) { fields.push(`kw=$${i++}`);       vals.push(Number(kw)); }
  if (amount   !== undefined) { fields.push(`amount=$${i++}`);   vals.push(Number(amount)); }
  if (tax      !== undefined) { fields.push(`tax=$${i++}`);      vals.push(Number(tax)); }
  if (addons   !== undefined) { fields.push(`addons=$${i++}`);   vals.push(Number(addons)); }
  if (proposal_no !== undefined) { fields.push(`proposal_no=$${i++}`); vals.push(proposal_no || null); }
  if (form_data   !== undefined) { fields.push(`form_data=$${i++}::jsonb`); vals.push(JSON.stringify(form_data)); }
  if (totals_data !== undefined) { fields.push(`totals_data=$${i++}::jsonb`); vals.push(JSON.stringify(totals_data)); }
  if (checklist_data !== undefined) { fields.push(`checklist_data=$${i++}::jsonb`); vals.push(JSON.stringify(checklist_data)); }
  if (survey_markup !== undefined) { fields.push(`survey_markup=$${i++}::jsonb`); vals.push(JSON.stringify(survey_markup)); }
  if (!fields.length && date_won === undefined) return res.status(400).json({ error: 'Nothing to update' });
  let gen = null;
  if (fields.length) {
    fields.push(`updated_at=now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE generator_proposals SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    gen = rows[0];
  } else {
    const { rows } = await pool.query('SELECT * FROM generator_proposals WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    gen = rows[0];
  }

  // Keep won_jobs in sync for awarded gens: amount and/or date_won changed.
  let wonJob = null;
  if (gen.stage === 'awarded' && (amount !== undefined || date_won !== undefined)) {
    const wjFields: string[] = [];
    const wjVals: unknown[] = [];
    let wi = 1;
    if (amount !== undefined) {
      wjFields.push(`value=$${wi++}`, `commission_amount=CASE WHEN commission_status='paid' THEN commission_amount ELSE ROUND($${wi++}*COALESCE(commission_rate,0)/100,2) END`);
      wjVals.push(Number(amount), Number(amount));
    }
    if (date_won !== undefined && date_won) {
      wjFields.push(`date_won=$${wi++}`);
      wjVals.push(date_won);
    }
    if (wjFields.length) {
      wjVals.push(gen.id);
      const { rows: wj } = await pool.query(
        `UPDATE won_jobs SET ${wjFields.join(',')} WHERE proposal_id=$${wi} RETURNING *`,
        wjVals
      );
      wonJob = wj[0] || null;
    }
  }

  res.json({ gen, wonJob });
});

// Soft delete — moves the proposal (and its won-job record) to the Trash.
router.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE generator_proposals SET deleted_at=now() WHERE id=$1', [req.params.id]);
    await client.query('UPDATE won_jobs SET deleted_at=now() WHERE proposal_id=$1', [req.params.id]);
    await setProjectDeleted(client, req.params.id, true);
    await client.query('COMMIT');
    await writeAudit(req, {
      action: 'delete', entityType: 'gen', entityId: gen.id,
      summary: `Moved generator proposal "${gen.customer}" to Trash`, before: gen,
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

// Restore a trashed proposal (and its won-job record).
router.post('/:id/restore', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { rows } = await pool.query('UPDATE generator_proposals SET deleted_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found in Trash' });
  await pool.query('UPDATE won_jobs SET deleted_at=NULL WHERE proposal_id=$1', [req.params.id]);
  await setProjectDeleted(pool, req.params.id, false);
  await writeAudit(req, { action: 'restore', entityType: 'gen', entityId: req.params.id, summary: `Restored generator proposal "${rows[0].customer}"` });
  res.json(rows[0]);
});

// Permanently delete a trashed proposal and dependent records (admin only).
router.delete('/:id/purge', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const { rows: existing } = await pool.query('SELECT id, customer FROM generator_proposals WHERE id=$1 AND deleted_at IS NOT NULL', [req.params.id]);
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
    await client.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    await client.query('DELETE FROM generator_proposals WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    await writeAudit(req, { action: 'purge', entityType: 'gen', entityId: req.params.id, summary: `Permanently deleted generator proposal "${existing[0].customer}"` });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ── AI: build proposal from site visit notes ────────────────────────────────

const GEN_PRICES: Record<string, Record<string, Record<string, number>>> = {
  'air-cooled': {
    Kohler:  { '14KW': 5800, '20KW': 6700, '26KW': 8200 },
    Generac: { '14KW': 5600, '18KW': 6450, '22KW': 7150, '24KW': 7575, '26KW': 8000, '28KW': 9300 },
  },
  'liquid-cooled': {
    Kohler:  { '24KW': 17549, '30KW': 19999, '38KW': 22449, '48KW': 25209, '60KW': 27759, '80KW': 34089, '100KW': 41129 },
    Generac: { '32KW': 19203, '40KW': 21734, '48KW': 22914, '60KW': 25212 },
  },
};

const ADDON_P = {
  smm: 250, surgePro: 395, pad: 485, battery: 185, emPanel: 495, gasLine: 500,
  ats: 1000, extraWire: 25,
  padLC_small: 800, padLC_large: 1200, startupLC: 1595,
  lull: 1100, crane: 1800, extendedWarranty: 1100, silverService: 395,
  labor: 3000, permit: 1250, startup: 695,
  genStandSmall: 2000, genStandBig: 2500,
};

function calcFormTotals(g: Record<string, unknown>) {
  const coolingType = String(g.coolingType || 'air-cooled');
  const brand = String(g.brand || 'Kohler');
  const size = String(g.size || '14KW');
  const genP = GEN_PRICES[coolingType]?.[brand]?.[size] ?? 0;
  // A Gen Stand replaces the concrete pad, so it's charged instead of (never on top of) padAmt.
  const genStandAmt = g.genStand === 'small' ? ADDON_P.genStandSmall
    : g.genStand === 'big' ? ADDON_P.genStandBig : 0;
  const hasGenStand = g.genStand === 'small' || g.genStand === 'big';
  const padAmt = (g.pad && !hasGenStand) ? (coolingType === 'liquid-cooled'
    ? (parseInt(size) >= 60 ? ADDON_P.padLC_large : ADDON_P.padLC_small)
    : ADDON_P.pad) : 0;
  const smmTotal    = Number(g.smmQty || 0) * ADDON_P.smm;
  const surgeTotal  = Number(g.surgeProQty || 0) * ADDON_P.surgePro;
  const batteryAmt  = g.battery  ? ADDON_P.battery   : 0;
  const emPanelAmt  = g.emPanel  ? ADDON_P.emPanel   : 0;
  const gasLineAmt  = (g.jobType === 'swap-out' && g.gasLine) ? ADDON_P.gasLine : 0;
  const extraWireAmt = Number(g.extraWire || 0) * ADDON_P.extraWire;
  // Air-cooled includes 1 ATS standard; liquid-cooled includes none — only qty beyond that is billed.
  const atsIncluded = coolingType === 'air-cooled' ? 1 : 0;
  const atsBillableQty = Math.max(0, Number(g.atsQty || 0) - atsIncluded);
  const atsAmt      = atsBillableQty * ADDON_P.ats;
  const extWarrantyAmt = g.extWarranty === 'paid' ? ADDON_P.extendedWarranty : 0;
  const liftAmt     = g.liftType === 'lull' ? ADDON_P.lull : g.liftType === 'crane' ? ADDON_P.crane : 0;
  const removalFee  = g.jobType === 'swap-out' ? (Number(g.removalFee) || 0) : (g.removal ? 500 : 0);
  const laborAmt    = Number(g.labor)   || ADDON_P.labor;
  const permitAmt   = Number(g.permit)  || ADDON_P.permit;
  const startupAmt  = coolingType === 'liquid-cooled' ? ADDON_P.startupLC : (Number(g.startup) || ADDON_P.startup);
  // Keep in step with calcGenTotals in frontend/src/features/builder/genCalc.ts.
  // Sales tax applies to tangible goods only, matching the proposal's price breakdown:
  // labor, permit, startup, lift, removal and the gas line are services, and extra wire
  // is shown to the customer inside the non-taxable "Labor & Electrical" line.
  const taxableBase    = genP + padAmt + genStandAmt + batteryAmt + atsAmt + smmTotal + surgeTotal + extWarrantyAmt + emPanelAmt;
  const nonTaxableBase = gasLineAmt + extraWireAmt + liftAmt + removalFee + laborAmt + permitAmt + startupAmt;
  const subtotal    = taxableBase + nonTaxableBase;
  const discountAmt = g.discountType === '%'
    ? Math.round(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxedAmount = subtotal > 0
    ? Math.max(0, taxableBase - (discountAmt * taxableBase) / subtotal)
    : 0;
  const netSubtotal = subtotal - discountAmt;
  const tax         = Math.round(taxedAmount * ((Number(g.taxRate) || 7) / 100));
  const total       = netSubtotal + tax;
  const deposit     = Math.round(total * ((Number(g.depositPct) || 50) / 100));
  return { genP, padAmt, genStandAmt, smmTotal, surgeTotal, atsIncluded, atsBillableQty, atsAmt, extWarrantyAmt, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, subtotal, discountAmt, taxableBase, nonTaxableBase, taxedAmount, netSubtotal, tax, total, deposit };
}

const BUILD_FROM_NOTES_SYSTEM = `You are an expert generator installation estimator. Extract a proposal form (GenForm) from field site visit notes.

Return ONLY a valid JSON object. No markdown fences, no explanation, no extra text.

FIELD REFERENCE — include every field in your output:

String fields (use empty string "" if not mentioned):
  customer  — customer or company name
  attn      — contact person name
  address   — street address
  city      — city
  state     — state abbreviation (default: "FL")
  zip       — zip code
  phone     — phone number
  email     — email address
  notes     — any extra install notes to include in the proposal

Enum fields:
  brand       — "Kohler" | "Generac"  (default: "Kohler")
  coolingType — "air-cooled" | "liquid-cooled"  (default: "air-cooled")
  size        — must match brand+coolingType:
                air-cooled Kohler:    "14KW" "20KW" "26KW"
                air-cooled Generac:   "14KW" "18KW" "22KW" "24KW" "26KW" "28KW"
                liquid-cooled Kohler: "24KW" "30KW" "38KW" "48KW" "60KW" "80KW" "100KW"
                liquid-cooled Generac:"32KW" "40KW" "48KW" "60KW"
  fuel        — "Natural Gas" | "LP"  (default: "Natural Gas")
  atsSize     — "100A" | "150A" | "200A" | "400A"  (default: "200A")
  jobType     — "new-install" | "swap-out"  (default: "new-install")
  liftType    — "none" | "lull" | "crane"  (default: "none")
  genStand    — "none" | "small" | "big" — adjustable-height generator stand, if mentioned;
                replaces the concrete pad, don't set pad=true alongside it  (default: "none")
  extWarranty — "none" | "paid" | "promo"  (default: "none") — "paid" is the $1,100 10-year
                extension; "promo" is the free 10-year upgrade — for Kohler it's a time-boxed
                manufacturer promo (use extWarrantyPromoStart/End), for Generac it's an
                APT-included no-charge upgrade with no date range
  silverServicePromo — "none" | "1yr" | "2yr"  (default: "none") — free Silver Service
                preventative-maintenance promo add-on, if mentioned
  discountType— "$" | "%"  (default: "$")

Boolean fields (true/false):
  pad       — concrete pad needed  (default: true)
  battery   — battery maintainer — ALWAYS true when jobType is "new-install"
  emPanel   — EM panel  (default: false)
  gasLine   — gas line disconnect & reconnect — only applies to swap-out jobs  (default: false)
  removal   — remove existing unit  (default: false)
  includeBreakdown — (default: false)

String fields (enum, "" if not mentioned):
  genSide  — "Left" | "Right" | "" — which side of the house the generator sits on
  panelRel — "Same side as panel" | "Opposite side of panel" | "Next to panel" | ""

Numeric fields:
  extraWire — extra wire in feet  (default: 0)
  feedFt    — electrical feed distance in feet, if mentioned  (default: 0)
  panelFt   — distance from the electrical panel in feet, if mentioned  (default: 0)
  smmQty    — SMM maintenance modules  (default: 1)
  surgeProQty — surge protectors  (default: 0)
  atsQty    — total ATS units on the job. Air-cooled generators include 1 standard
              (default: 1); liquid-cooled generators include none (default: 0). Only
              set higher than the included amount if extra units are explicitly mentioned.
  removalFee    — removal fee in dollars  (default: 500)
  labor         — labor cost  (default: 3000)
  permit        — permit cost  (default: 1250)
  startup       — startup cost  (default: 695)
  discount      — discount amount  (default: 0)
  taxRate       — tax rate percent  (default: 7)
  validDays     — proposal valid days  (default: 30)
  depositPct    — deposit percent  (default: 50)

String fields (date, "" if not mentioned):
  extWarrantyPromoStart — promo valid-from date, "YYYY-MM-DD"
  extWarrantyPromoEnd   — promo valid-until date, "YYYY-MM-DD"

RULES:
1. If a field is not mentioned in the notes, use the default shown above.
2. battery MUST be true whenever jobType is "new-install", regardless of what the notes say.
3. Choose the closest valid size; if ambiguous pick the next size up.
4. extWarrantyPromoStart/extWarrantyPromoEnd only apply when extWarranty is "promo" AND brand is "Kohler" — leave "" for Generac.
5. Return the JSON object only — no markdown, no explanation.`;

class BuildFromNotesError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// Shared by /:id/build-from-notes and /from-calendar-event — turns any block of
// free text (site-visit notes, or a calendar appointment's subject/location/body)
// into a GenForm via the same AI extraction and the same safe-defaults/business
// rules, so both entry points behave identically.
async function extractFormFromNotes(notes: string): Promise<Record<string, unknown>> {
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new BuildFromNotesError(503, 'Anthropic API key not configured. Add it in Settings > AI or set ANTHROPIC_API_KEY.');

  const model = ((await getSetting('ai_build_from_notes_model')) || 'claude-haiku-4-5-20251001').trim();
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system: BUILD_FROM_NOTES_SYSTEM,
    messages: [{ role: 'user', content: notes.trim() }],
  });

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const parsed = parseAIJSON(text);
  if (!parsed) throw new BuildFromNotesError(422, 'AI returned an unrecognizable response. Please try again.');

  // Normalize fuel: coerce any propane synonym to the stored enum value 'LP'
  if (parsed.fuel && String(parsed.fuel).toLowerCase() !== 'natural gas') {
    parsed.fuel = 'LP';
  }

  // Merge AI output over safe defaults
  const form: Record<string, unknown> = {
    customer: '', attn: '', address: '', city: '', state: 'FL', zip: '', phone: '', email: '',
    brand: 'Kohler', coolingType: 'air-cooled', size: '14KW',
    atsSize: '200A', atsQty: 1, fuel: 'Natural Gas', jobType: 'new-install', liftType: 'none', genStand: 'none',
    extWarranty: 'none', extWarrantyPromoStart: '', extWarrantyPromoEnd: '',
    pad: true, smmQty: 1, surgeProQty: 0, battery: true, emPanel: false, gasLine: false,
    removal: false, extraWire: 0, removalFee: 500, silverServicePromo: 'none',
    feedFt: 0, genSide: '', panelRel: '', panelFt: 0,
    labor: ADDON_P.labor, permit: ADDON_P.permit, startup: ADDON_P.startup,
    discount: 0, discountType: '$', taxRate: 7, validDays: 30, depositPct: 50,
    notes: '', includeBreakdown: false,
    ...parsed,
  };
  // Always enforce battery=true on new-install regardless of AI output
  form.battery = form.jobType === 'swap-out' ? (parsed.battery ?? true) : true;
  // A Gen Stand replaces the concrete pad — don't let both come back true from the AI.
  if (form.genStand === 'small' || form.genStand === 'big') form.pad = false;
  // The date-boxed promo range only makes sense for Kohler's manufacturer promo; Generac's
  // promo is a standing APT-included upgrade with no expiry.
  if (form.brand !== 'Kohler') { form.extWarrantyPromoStart = ''; form.extWarrantyPromoEnd = ''; }

  return form;
}

router.post('/:id/build-from-notes', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { notes } = req.body as { notes?: string };
  if (!notes?.trim()) return res.status(400).json({ error: 'notes required' });

  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  let form: Record<string, unknown>;
  try {
    form = await extractFormFromNotes(notes);
  } catch (err) {
    if (err instanceof BuildFromNotesError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const totals = calcFormTotals(form);
  const addons = (Number(form.smmQty) > 0 ? 1 : 0) + (Number(form.surgeProQty) > 0 ? 1 : 0) + (form.battery ? 1 : 0) + (form.pad ? 1 : 0) + (form.emPanel ? 1 : 0) + (form.gasLine ? 1 : 0);

  // Stage: set to 'building' only if not already in a more advanced stage
  const advancedStages = ['sent', 'signed', 'awarded'];
  const stageClause = advancedStages.includes(gen.stage) ? '' : `, stage = 'building'`;

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET form_data = $1::jsonb, totals_data = $2::jsonb,
         mfr = $3, model = $4, kw = $5,
         amount = $6, tax = $7, addons = $8,
         updated_at = now()${stageClause}
     WHERE id = $9
     RETURNING *`,
    [
      JSON.stringify(form), JSON.stringify(totals),
      String(form.brand), String(form.size), parseInt(String(form.size)),
      totals.total, totals.tax, addons,
      gen.id,
    ],
  );

  res.json(rows[0]);
}));

// List Outlook calendar events (past week through next 7 days) as candidates for
// "create a proposal from this appointment" — includes recent past visits since a
// rep often builds the proposal a few days after the actual site visit.
router.get('/calendar-events', requireAuth, asyncHandler(async (_req: AuthRequest, res) => {
  res.json(await fetchUpcomingEvents(7, 7));
}));

// Create a brand-new proposal pre-filled from a calendar appointment: pulls the
// event's full body/attendees, runs it through the same extraction as
// build-from-notes, and creates the gen in one step so the rep lands straight in
// the builder to review instead of retyping the customer's name/address/phone.
router.post('/from-calendar-event', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { eventId } = req.body as { eventId?: string };
  if (!eventId?.trim()) return res.status(400).json({ error: 'eventId required' });

  const event = await fetchEventDetail(eventId);
  if (!event) return res.status(404).json({ error: 'Calendar event not found' });

  const notesParts = [
    `Subject: ${event.subject}`,
    event.location ? `Location: ${event.location}` : null,
    event.attendees.length ? `Attendees: ${event.attendees.map(a => a.email ? `${a.name} <${a.email}>` : a.name).join(', ')}` : null,
    event.bodyText ? `\n${event.bodyText}` : null,
  ].filter(Boolean);

  let form: Record<string, unknown>;
  try {
    form = await extractFormFromNotes(notesParts.join('\n'));
  } catch (err) {
    if (err instanceof BuildFromNotesError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const user = req.user!;
  const customerName = String(form.customer || '').trim() || event.subject || 'New Customer';
  const customerId = await upsertCustomer(customerName, 'customer');
  const totals = calcFormTotals(form);
  const addons = (Number(form.smmQty) > 0 ? 1 : 0) + (Number(form.surgeProQty) > 0 ? 1 : 0) + (form.battery ? 1 : 0) + (form.pad ? 1 : 0) + (form.emPanel ? 1 : 0) + (form.gasLine ? 1 : 0);

  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (
       customer, loc, mfr, model, kw, amount, tax, addons,
       form_data, totals_data,
       salesperson_id, salesperson_name, customer_id, stage
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,'building')
     RETURNING *`,
    [
      customerName, (event.location || '').trim() || '—', String(form.brand), String(form.size), parseInt(String(form.size)),
      totals.total, totals.tax, addons,
      JSON.stringify(form), JSON.stringify(totals),
      user.id, user.name, customerId,
    ],
  );
  const gen = rows[0];

  await writeAudit(req, {
    action: 'create-from-calendar', entityType: 'gen', entityId: gen.id,
    summary: `Created generator proposal "${gen.customer}" from calendar event "${event.subject}"`,
    after: { event_id: eventId },
  });

  res.json(gen);
}));

// Short "what was quoted" label for emails, e.g. "22KW Generac". `model` is stored as the
// size string (e.g. "22KW") — kw is a NUMERIC(8,2) column that stringifies as "22.00", so it's
// only used as a fallback when model isn't set, and coerced through Number() to drop the decimals.
function genSpecLabel(gen: { kw?: unknown; mfr?: string | null; model?: string | null }): string {
  const size = gen.model || (gen.kw ? `${Number(gen.kw)}KW` : null);
  return [size, gen.mfr].filter(Boolean).join(' ');
}

// ── Award kickoff email (ported from the standalone "Job Kickoff Tool") ─────
// When a proposal moves to Awarded, an internal draft goes to the ops team with the
// job specifics plus whatever of the signed proposal / sizer report / survey / site
// visit checklist have been uploaded to the job so far.

const DEFAULT_AWARD_RECIPIENTS = [
  'kim@accuratepowerandtechnology.com', 'toni@accuratepowerandtechnology.com',
  'sonny@accuratepowerandtechnology.com', 'brian@accuratepowerandtechnology.com',
  'chrise@accuratepowerandtechnology.com', 'haley@accuratepowerandtechnology.com',
  'alexis@accuratepowerandtechnology.com', 'permits@accuratepowerandtechnology.com',
];

async function getAwardRecipients(): Promise<string[]> {
  try {
    const raw = await getSetting('award_recipients');
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) && list.length ? list.map(String) : DEFAULT_AWARD_RECIPIENTS;
  } catch {
    return DEFAULT_AWARD_RECIPIENTS;
  }
}

const AWARD_DOC_CATEGORIES = ['contract', 'sizer_report', 'survey', 'labeled_survey', 'site_checklist'];
const AWARD_DOC_LABELS: Record<string, string> = {
  contract: 'Signed Proposal',
  sizer_report: 'Sizer Report',
  survey: 'Survey',
  labeled_survey: 'Labeled Survey',
  site_checklist: 'Site Visit Checklist',
};

/** Kickoff-kit categories with no uploaded document yet, as display labels.
 *  'contract' is excluded — drafting is blocked without it, so it can never
 *  be "to follow". */
export function missingKickoffLabels(existingCategories: string[]): string[] {
  return AWARD_DOC_CATEGORIES
    .filter(c => c !== 'contract' && !existingCategories.includes(c))
    .map(c => AWARD_DOC_LABELS[c]);
}

function buildAwardKickoffEmail(gen: Record<string, any>): { subject: string; html: string } {
  const form: Record<string, any> = (gen.form_data && typeof gen.form_data === 'object') ? gen.form_data : {};
  const totals: Record<string, any> = (gen.totals_data && typeof gen.totals_data === 'object') ? gen.totals_data : {};
  const brand = form.brand || gen.mfr || '';
  const city = form.city || '';
  const subject = `New ${brand} Install - ${gen.customer || '[customer]'}${city ? ` - ${city}` : ''}`;

  const equipParts = [form.size ? `${brand} ${form.size} Generator` : genSpecLabel(gen)];
  if (Number(form.atsQty) > 0) {
    equipParts.push(`${form.jobType === 'swap-out' ? 'Existing ' : ''}${form.atsSize || ''} ATS${Number(form.atsQty) > 1 ? ` (${form.atsQty})` : ''}`);
  }
  const equip = equipParts.filter(Boolean).join(' — ');

  const lines: string[] = [`We will be installing a ${equip || '[equipment]'}.`];
  lines.push(Number(form.smmQty) > 0 ? `SMM: Yes (${form.smmQty}).` : 'No SMM or load management.');
  lines.push(form.emPanel ? '1 em-panel.' : 'No em-panel.');
  if (form.fuel) lines.push(`Gas: ${form.fuel === 'LP' ? 'Propane' : 'Natural gas (NG)'}.`);
  if (Number(form.feedFt) > 0) lines.push(`Electrical feed ~${form.feedFt} ft.`);
  const pos: string[] = [];
  if (form.genSide) pos.push(`${String(form.genSide).toLowerCase()} side of house`);
  if (form.panelRel) pos.push(String(form.panelRel).toLowerCase());
  if (Number(form.panelFt) > 0 && form.panelRel !== 'Next to panel') pos.push(`~${form.panelFt} ft from panel`);
  if (pos.length) lines.push(`Generator: ${pos.join(', ')}.`);
  if (form.silverServicePromo === '1yr') lines.push('Included 1 year free Silver Service.');
  if (form.silverServicePromo === '2yr') lines.push('Included 2 years free Silver Service.');
  if (form.notes && String(form.notes).trim()) lines.push(String(form.notes).trim());

  const deposit = Number(totals.deposit) || 0;
  const depLine = deposit ? `Customer made a deposit of $${deposit.toLocaleString()}.` : '';

  const contactRows = [gen.customer, form.phone, form.email, form.address].filter(Boolean).map(String);

  const parts: string[] = [
    `<p>${contactRows.map(r => escapeHtml(r)).join('<br>')}</p>`,
    `<p>${lines.map(l => escapeHtml(l)).join('<br>')}</p>`,
  ];
  if (depLine) parts.push(`<p>${escapeHtml(depLine)}</p>`);

  return { subject, html: parts.join('\n') };
}

interface KickoffResult { drafted: boolean; reason?: 'email_not_configured' | 'no_recipients'; to: string[]; attachedLabels: string[]; skipped: string[]; toFollow: string[]; }

/** Draft (never auto-send) the internal kickoff email, attaching whatever of the signed
 *  proposal / sizer / survey / labeled survey / checklist documents exist for the job.
 *  Called on demand from the Award Kickoff modal (POST /:id/kickoff-email). */
async function draftAwardKickoffEmail(gen: Record<string, any>): Promise<KickoffResult> {
  if (!isGraphMailConfigured()) return { drafted: false, reason: 'email_not_configured', to: [], attachedLabels: [], skipped: [], toFollow: [] };
  const to = await getAwardRecipients();
  if (!to.length) return { drafted: false, reason: 'no_recipients', to: [], attachedLabels: [], skipped: [], toFollow: [] };

  const { subject, html: bodyHtml } = buildAwardKickoffEmail(gen);
  const { attachments, attached, skipped } = await loadLinkedDocumentsAsAttachments(gen.id, {
    categories: AWARD_DOC_CATEGORIES,
  });

  let html = bodyHtml;
  const attachedLabels = attached.map(a => AWARD_DOC_LABELS[a.category || ''] || a.name);
  if (attachedLabels.length) html += `<p>Attached: ${escapeHtml(attachedLabels.join(', '))}.</p>`;
  if (skipped.length) html += `<p>Too large to attach (see the job's Drive folder): ${escapeHtml(skipped.join(', '))}.</p>`;
  if (gen.drive_job_folder_id) html += `<p>All job files: <a href="https://drive.google.com/drive/folders/${gen.drive_job_folder_id}">Google Drive</a></p>`;

  const { rows: existing } = await pool.query(
    `SELECT DISTINCT category FROM documents
      WHERE linked_id = $1 AND deleted_at IS NULL AND category = ANY($2)`,
    [gen.id, AWARD_DOC_CATEGORIES],
  );
  const toFollow = missingKickoffLabels(existing.map(r => r.category));
  if (toFollow.length) html += `<p>To follow: ${escapeHtml(toFollow.join(', '))}.</p>`;

  await graphCreateDraft({ to, subject, html, attachments });
  return { drafted: true, to, attachedLabels, skipped, toFollow };
}

// On-demand: (re)create the kickoff email draft for a job — used by the Award
// Kickoff modal so docs uploaded after award still get bundled.
router.post('/:id/kickoff-email', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  // Signed proposal is the minimum kickoff kit — block drafting without it.
  const { rows: contract } = await pool.query(
    `SELECT 1 FROM documents
      WHERE linked_id = $1 AND category = 'contract' AND deleted_at IS NULL LIMIT 1`,
    [gen.id],
  );
  if (!contract.length) {
    return res.status(400).json({ error: 'Signed proposal required — upload it (or have the customer e-sign) before drafting the kickoff email.' });
  }

  const result = await draftAwardKickoffEmail(gen);
  if (!result.drafted) {
    return res.status(503).json({
      error: result.reason === 'email_not_configured'
        ? 'Email is not configured (Microsoft Graph).'
        : 'No award-email recipients set — add them in Settings → Email Delivery.',
    });
  }
  const { rows: stamped } = await pool.query(
    `UPDATE generator_proposals SET kickoff_email_drafted_at = now(), updated_at = now()
      WHERE id = $1 RETURNING kickoff_email_drafted_at`,
    [gen.id],
  );
  res.json({ ...result, kickoff_email_drafted_at: stamped[0].kickoff_email_drafted_at });
}));

// ── Send proposal email ──────────────────────────────────────────────────────
// Sends through Microsoft Graph (the shared Outlook mailbox, so it lands in Sent
// Items and replies come back to the inbox). The proposal is only marked sent
// AFTER the email actually goes out.
const DEFAULT_PROPOSAL_MESSAGE = 'Thank you for the opportunity to provide you with back-up power at your home.';

router.post('/:id/send', requireAuth, async (req: AuthRequest, res) => {
  const { to, subject, note, proposalNo, total, deposit, includeGasContacts } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  const frontendUrl = await getSetting('frontend_url');
  // Never fall back to localhost — a blanked frontend_url must still yield a reachable link
  // (matches bids.ts / auth.ts). Strip any trailing slash so the path joins cleanly.
  const baseUrl = (frontendUrl || process.env.FRONTEND_URL || 'https://electrical-program.onrender.com').replace(/\/$/, '');
  const link = `${baseUrl}/p/${gen.proposal_token}`;

  // Generator spec straight off the proposal, e.g. "22KW Generac".
  const spec = genSpecLabel(gen);
  const form = gen.form_data || {};
  const validDays = Number(form.validDays) || 30;
  const finalSubject = subject?.trim()
    || `Your ${spec ? spec + ' ' : ''}Generator Proposal — ${proposalNo || gen.proposal_no || ''}`.trim();
  const defaultMessage = (await getSetting('proposal_default_message')) || DEFAULT_PROPOSAL_MESSAGE;
  const gasContacts = includeGasContacts ? ((await getSetting('gas_contacts_text')) || '') : '';
  const html = proposalEmailHtml({
    customerName: gen.customer,
    proposalNo: proposalNo || gen.proposal_no || '',
    spec, total, deposit, validDays, link, senderNote: note,
    defaultMessage, gasContacts,
  });

  if (!isGraphMailConfigured()) {
    return res.status(503).json({
      error: 'Email is not configured (Microsoft Graph). Copy the proposal link and send it yourself.',
      link,
    });
  }
  try {
    await graphSendMail({ to, subject: finalSubject, html });
  } catch (err) {
    logger.error({ err, genId: gen.id }, '[email] Graph proposal send failed');
    return res.status(502).json({ error: 'Email delivery failed (Outlook). Try again or copy the proposal link.', link });
  }

  // Email is out — now stamp sent_at and advance Building -> Sent.
  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET sent_at = now(), stage = CASE WHEN stage = 'building' THEN 'sent' ELSE stage END, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );

  res.json({ gen: rows[0], link });
});

// ── Public: view proposal by token (no auth) ────────────────────────────────
router.get('/p/:token', async (req, res) => {
  // In-app previews pass ?preview=1 — fetch without recording a customer "view".
  const isPreview = !!req.query.preview;
  const sql = isPreview
    ? `SELECT * FROM generator_proposals
       WHERE proposal_token = $1 AND deleted_at IS NULL`
    : `UPDATE generator_proposals
       SET viewed_at = COALESCE(viewed_at, now())
       WHERE proposal_token = $1 AND deleted_at IS NULL
       RETURNING *`;
  const { rows } = await pool.query(sql, [req.params.token]);
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  res.json(rows[0]);
});

// List photos from the gen job's Drive "Photos" subfolder. Lazily creates the folder
// on older jobs that predate the Photos subfolder. Placed after static GET routes so
// the dynamic /:id pattern never shadows them.
router.get('/:id/photos', requireAuth, async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;
  let photosFolderId: string | null = gen.drive_photos_folder_id || null;
  if (!photosFolderId && gen.drive_job_folder_id) {
    photosFolderId = await ensureSubfolder('Photos', gen.drive_job_folder_id);
    if (photosFolderId) {
      await pool.query('UPDATE generator_proposals SET drive_photos_folder_id=$1 WHERE id=$2', [photosFolderId, gen.id]);
    }
  }
  if (!photosFolderId) return res.json([]);
  const files = await listFolderFiles(photosFolderId);
  res.json(files);
});

// ── Public: sign proposal by token (no auth) ────────────────────────────────
router.post('/p/:token/sign', async (req, res) => {
  const { signatureData, initialsData } = req.body;
  if (!signatureData) return res.status(400).json({ error: 'Signature required' });

  // initialsData is optional at the API level even though the UI now requires it —
  // a stale cached client that only knows about signatureData must keep signing
  // successfully. Unlike signature_data (set unconditionally), initials_data falls
  // back to its current value when nothing is posted, so a re-sign that omits it
  // never wipes out initials captured earlier.
  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET signed_at = COALESCE(signed_at, now()),
         signature_data = $1,
         initials_data = COALESCE($3, initials_data),
         stage = CASE WHEN stage IN ('declined','awarded') THEN stage ELSE 'signed' END,
         updated_at = now()
     WHERE proposal_token = $2 AND deleted_at IS NULL
     RETURNING id, customer, stage, signed_at, drive_job_folder_id, salesperson_id, amount, mfr, kw`,
    [signatureData, req.params.token, initialsData || null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  const gen = rows[0];

  // Fire-and-forget: create Active Generator Jobs folder + subfolders on first sign
  if (!gen.drive_job_folder_id) {
    (async () => {
      try {
        const customerFolderId = await createCustomerFolder(gen.customer, ACTIVE_GENERATOR_JOBS_ROOT);
        if (!customerFolderId) return;
        const subs = await createSubfolders(customerFolderId, GEN_SUBFOLDER_NAMES);
        await pool.query(
          `UPDATE generator_proposals SET
             drive_job_folder_id=$1,
             drive_engineering_folder_id=$2,
             drive_permit_folder_id=$3,
             drive_contract_folder_id=$4,
             drive_invoices_folder_id=$5
           WHERE id=$6`,
          [
            customerFolderId,
            subs['Engineering'] || null,
            subs['Permit'] || null,
            subs['Contract'] || null,
            subs['Invoices'] || null,
            gen.id,
          ],
        );
      } catch (err) {
        console.error('[drive] Sign: folder creation failed:', err);
      }
    })();
  }

  res.json({ ok: true, gen });

  // Fire-and-forget: in-app notification to salesperson when proposal is signed.
  (async () => {
    try {
      const raw = await getSetting('notifications_json');
      const notifPrefs = raw ? JSON.parse(raw) : {};
      if (!notifPrefs.proposal_signed) return;
      const targets = gen.salesperson_id ? [gen.salesperson_id] : await ownerAdminIds();
      for (const uid of targets) {
        await createNotification(uid, {
          type: 'proposal_viewed_unsigned',
          title: 'Proposal signed',
          body: `${gen.customer} accepted and signed their proposal`,
          linkView: 'generators/pipeline',
          linkId: gen.id,
          dedupKey: `propsigned:${gen.id}`,
        });
      }
      // Push the same alert to the salesperson's devices (fire-and-forget).
      const amt = Number(gen.amount || 0);
      sendPushToUsers(targets, {
        title: '🎉 Proposal signed',
        body: `${gen.customer} signed${amt ? ` — $${amt.toLocaleString()}` : ''}`,
        view: 'generators/pipeline',
        id: gen.id,
        tag: `propsigned:${gen.id}`,
      }).catch(() => {});
    } catch (err) {
      logger.error({ err }, '[notify] proposal signed notification failed');
    }
  })();

  // Fire-and-forget: email heads-up to the team mailbox so a signature never
  // goes unnoticed. Next step for the user: move the card to Awarded.
  if (isGraphMailConfigured()) {
    (async () => {
      try {
        const spec = genSpecLabel(gen);
        const amt = Number(gen.amount || 0);
        await graphSendMail({
          to: TEAM_NOTIFY_TO,
          subject: `🎉 Proposal signed — ${gen.customer}${amt ? ` ($${amt.toLocaleString()})` : ''}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">
            <p><b>${escapeHtml(gen.customer)}</b> just signed their${spec ? ` ${escapeHtml(spec)}` : ''} generator proposal${amt ? ` for <b>$${amt.toLocaleString()}</b>` : ''}.</p>
            <p>Next step: open the Generator Pipeline and move it to <b>Awarded</b> to kick off the project.</p>
          </div>`,
        });
      } catch (err) {
        logger.error({ err, genId: gen.id }, '[notify] proposal signed email failed');
      }
    })();
  }
});

// ── Public: report that the customer-side PDF archive failed (no auth) ─────────
// The archive PDF is rasterized in the BUYER's browser, where an 8-page render can
// exhaust memory on a phone or lose the tab before the upload lands. That failure used
// to be swallowed client-side, so a job could end up signed with no contract on file
// and nobody knew. This records it in the log so it is discoverable; the rep rebuilds
// the identical PDF from the gen card. Deliberately does nothing but log — it accepts
// unauthenticated input, so it must not write anything a caller could pile up.
router.post('/p/:token/archive-failed', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, customer FROM generator_proposals WHERE proposal_token = $1 AND deleted_at IS NULL',
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });

  const message = String((req.body as { message?: unknown })?.message ?? '').slice(0, 500);
  logger.error(
    { genId: rows[0].id, customer: rows[0].customer, message },
    '[sign] customer-side signed-PDF archive failed — rebuild from the gen card'
  );
  res.json({ ok: true });
}));

// ── Public: auto-save a signed-proposal PDF (no auth) ───────────────────────────
// Token-scoped and tightly bounded: the proposal must be signed, and only one
// signed PDF is ever stored (idempotent), so this public endpoint can't be abused
// to pile up files.
router.post('/p/:token/proposal-pdf', upload.single('file'), asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });

  const { rows } = await pool.query(
    'SELECT id, customer, signed_at FROM generator_proposals WHERE proposal_token = $1 AND deleted_at IS NULL',
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  const gen = rows[0];
  if (!gen.signed_at) return res.status(409).json({ error: 'Proposal is not signed' });

  const { rows: existing } = await pool.query(
    `SELECT 1 FROM documents WHERE linked_id = $1 AND category = 'contract' AND name LIKE 'Signed Proposal%' LIMIT 1`,
    [gen.id]
  );
  if (existing.length) return res.json({ ok: true, skipped: true });

  const name = `Signed Proposal - ${gen.customer}.pdf`;
  logger.info({ genId: gen.id, fileSize: file.size }, 'Signed proposal PDF upload started');
  try {
    // Re-fetch to pick up drive_contract_folder_id set by the sign route
    const { rows: fresh } = await pool.query(
      'SELECT drive_contract_folder_id FROM generator_proposals WHERE id=$1',
      [gen.id]
    );
    const contractFolderId = fresh[0]?.drive_contract_folder_id ?? null;

    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
       VALUES ($1,$2,'gen',$3,$3,'contract',$4,'application/pdf','Customer signature',$5)`,
      [gen.id, gen.customer, name, file.size, file.buffer.toString('base64')]
    );

    // Upload signed contract to Contract subfolder in Active Generator Jobs; fall back to Generator Proposals
    const driveDate = new Date().toISOString().split('T')[0];
    const driveName = `Signed Contract — ${gen.customer} — ${driveDate}.pdf`;
    const driveTarget = contractFolderId ?? GENERATOR_PROPOSALS_FOLDER;
    uploadFile(driveName, 'application/pdf', file.buffer, driveTarget)
      .catch(err => console.error('[drive] Signed contract upload failed:', err));

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, genId: gen.id }, 'Signed proposal PDF upload failed');
    if ((err as { code?: string; column?: string }).code === '42703' && (err as { column?: string }).column === 'file_data') {
      return res.status(500).json({ error: 'Document storage is not ready. Run database migrations and try again.' });
    }
    throw err;
  }
}));

// ── File the fully executed contract, replacing the buyer-signed copy ───────────
// Once APT countersigns, the buyer-signed PDF is superseded: it shows one signature
// where the executed copy shows both. Leaving both on the job meant the kickoff email
// attached two contracts — it pulls every document in the 'contract' category — and
// whoever opened it had to work out which was current.
//
// The supersede happens here rather than the client calling DELETE /documents/:id,
// because that route is admin-only: a non-admin countersigning would silently have
// been left with both. The old row is soft-deleted, so it stays recoverable from
// Settings → Trash rather than being destroyed.
router.post('/:id/executed-contract', requireAuth, upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'file required' });
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;
  if (!gen.countersigned_at) return res.status(409).json({ error: 'Proposal is not countersigned' });

  const name = `Executed Contract - ${gen.customer}.pdf`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Replace rather than accumulate: an earlier executed copy (a rebuild) goes too.
    await client.query(
      `UPDATE documents SET deleted_at = now()
        WHERE linked_id = $1 AND category = 'contract' AND deleted_at IS NULL`,
      [gen.id]
    );

    const { rows } = await client.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
       VALUES ($1,$2,'gen',$3,$3,'contract',$4,'application/pdf',$5,$6)
       RETURNING id, name, display_name, category, file_size, file_type, created_at`,
      [gen.id, gen.customer, name, file.size, req.user!.name, file.buffer.toString('base64')]
    );

    await client.query('COMMIT');

    // Same Drive destination the buyer-signed copy uses, so the job folder holds the
    // executed version alongside its history.
    const driveDate = new Date().toISOString().split('T')[0];
    uploadFile(`Executed Contract — ${gen.customer} — ${driveDate}.pdf`, 'application/pdf', file.buffer,
      gen.drive_contract_folder_id ?? GENERATOR_PROPOSALS_FOLDER)
      .catch(err => logger.error({ err, genId: gen.id }, '[drive] Executed contract upload failed'));

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err, genId: gen.id }, 'Executed contract upload failed');
    throw err;
  } finally {
    client.release();
  }
}));

export default router;
