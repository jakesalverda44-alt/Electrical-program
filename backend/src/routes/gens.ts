import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { proposalEmailHtml } from '../email/proposalEmail';
import { graphSendMail, isGraphMailConfigured, TEAM_NOTIFY_TO } from '../email/graphMailer';
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

router.get('/benchmark', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT kw, amount FROM generator_proposals WHERE stage = 'awarded' AND kw > 0 AND amount > 0 AND deleted_at IS NULL`
  );
  const BRACKETS = [
    { label: 'Under 20kW',   min: 0,   max: 20   },
    { label: '20–50kW',      min: 20,  max: 50   },
    { label: '50–100kW',     min: 50,  max: 100  },
    { label: '100–200kW',    min: 100, max: 200  },
    { label: '200–500kW',    min: 200, max: 500  },
    { label: '500kW+',       min: 500, max: Infinity },
  ];
  const result = BRACKETS.map(b => {
    const group = rows.filter(r => Number(r.kw) >= b.min && Number(r.kw) < b.max);
    if (!group.length) return { ...b, count: 0, avgAmount: null, avgPerKw: null };
    const avgAmount = group.reduce((s, r) => s + Number(r.amount), 0) / group.length;
    const avgPerKw  = group.reduce((s, r) => s + Number(r.amount) / Number(r.kw), 0) / group.length;
    return { ...b, count: group.length, avgAmount: Math.round(avgAmount), avgPerKw: Math.round(avgPerKw) };
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
  const { customer, loc, mfr, model, kw, amount, tax, addons, proposal_no, form_data, totals_data } = req.body;
  if (!customer?.trim()) return res.status(400).json({ error: 'Customer required' });
  const user = req.user!;
  const customerId = await upsertCustomer(customer, 'customer');
  const { rows } = await pool.query(
    `INSERT INTO generator_proposals (
       customer, loc, mfr, model, kw, amount, tax, addons,
       proposal_no, form_data, totals_data,
       salesperson_id, salesperson_name, customer_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) RETURNING *`,
    [customer.trim(), (loc || '').trim() || '—', mfr, model, Number(kw) || 0,
     Number(amount) || 0, Number(tax) || 0, Number(addons) || 0,
     proposal_no || null,
     form_data !== undefined ? JSON.stringify(form_data) : null,
     totals_data !== undefined ? JSON.stringify(totals_data) : null,
     user.id, user.name, customerId]
  );
  res.json(rows[0]);
});

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
    if (stage === 'awarded' && gen.stage !== 'awarded') {
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
      wonJob = wj[0] || null;
      await ensureProject(client, {
        id: gen.id, sourceType: 'gen', customerId: gen.customer_id,
        name: gen.customer, contractValue: gen.amount,
      });
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ('awarded','gen',$1)`,
        [`${gen.customer} awarded — ${gen.salesperson_name}`]
      );
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
    }
    res.json({ gen: rows[0], wonJob });
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
  const { customer, loc, mfr, model, kw, amount, tax, addons, proposal_no, form_data, totals_data, date_won } = req.body;
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
  additionalATS: 1000, extraWire: 25,
  padLC_small: 800, padLC_large: 1200, startupLC: 1595,
  lull: 1100, crane: 1800, atsLC_150: 1000, atsLC_200: 1000,
  labor: 3000, permit: 1250, startup: 695,
};

function calcFormTotals(g: Record<string, unknown>) {
  const coolingType = String(g.coolingType || 'air-cooled');
  const brand = String(g.brand || 'Kohler');
  const size = String(g.size || '14KW');
  const genP = GEN_PRICES[coolingType]?.[brand]?.[size] ?? 0;
  const padAmt = g.pad ? (coolingType === 'liquid-cooled'
    ? (parseInt(size) >= 60 ? ADDON_P.padLC_large : ADDON_P.padLC_small)
    : ADDON_P.pad) : 0;
  const smmTotal    = g.smm      ? ADDON_P.smm      : 0;
  const surgeTotal  = g.surgePro ? ADDON_P.surgePro  : 0;
  const batteryAmt  = g.battery  ? ADDON_P.battery   : 0;
  const emPanelAmt  = g.emPanel  ? ADDON_P.emPanel   : 0;
  const gasLineAmt  = (g.jobType === 'swap-out' && g.gasLine) ? ADDON_P.gasLine : 0;
  const extraWireAmt = Number(g.extraWire || 0) * ADDON_P.extraWire;
  const extraATS    = Number(g.additionalATS || 0) * ADDON_P.additionalATS;
  const lcATS       = g.lcATS === '150A' ? ADDON_P.atsLC_150 : g.lcATS === '200A' ? ADDON_P.atsLC_200 : 0;
  const liftAmt     = g.liftType === 'lull' ? ADDON_P.lull : g.liftType === 'crane' ? ADDON_P.crane : 0;
  const removalFee  = g.jobType === 'swap-out' ? (Number(g.removalFee) || 0) : (g.removal ? 500 : 0);
  const laborAmt    = Number(g.labor)   || ADDON_P.labor;
  const permitAmt   = Number(g.permit)  || ADDON_P.permit;
  const startupAmt  = coolingType === 'liquid-cooled' ? ADDON_P.startupLC : (Number(g.startup) || ADDON_P.startup);
  const subtotal    = genP + padAmt + smmTotal + surgeTotal + batteryAmt + emPanelAmt + gasLineAmt + extraWireAmt + extraATS + lcATS + liftAmt + removalFee + laborAmt + permitAmt + startupAmt;
  const discountAmt = g.discountType === '%'
    ? Math.round(subtotal * ((Number(g.discount) || 0) / 100))
    : (Number(g.discount) || 0);
  const taxable     = subtotal - discountAmt;
  const tax         = Math.round(taxable * ((Number(g.taxRate) || 7) / 100));
  const total       = taxable + tax;
  const deposit     = Math.round(total * ((Number(g.depositPct) || 50) / 100));
  return { genP, padAmt, smmTotal, surgeTotal, extraATS, lcATS, liftAmt, removalFee, laborAmt, permitAmt, startupAmt, batteryAmt, emPanelAmt, gasLineAmt, extraWireAmt, subtotal, discountAmt, taxable, tax, total, deposit };
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
  ats         — "100A" | "150A" | "200A" | "400A"  (default: "200A")
  jobType     — "new-install" | "swap-out"  (default: "new-install")
  liftType    — "none" | "lull" | "crane"  (default: "none")
  lcATS       — "none" | "150A" | "200A"  (default: "none")
  discountType— "$" | "%"  (default: "$")

Boolean fields (true/false):
  pad       — concrete pad needed  (default: true)
  smm       — SMM maintenance plan  (default: true)
  surgePro  — surge protector  (default: false)
  battery   — battery maintainer — ALWAYS true when jobType is "new-install"
  emPanel   — EM panel  (default: false)
  gasLine   — gas line disconnect & reconnect — only applies to swap-out jobs  (default: false)
  removal   — remove existing unit  (default: false)
  includeBreakdown — (default: false)

Numeric fields:
  extraWire     — extra wire in feet  (default: 0)
  additionalATS — extra ATS units  (default: 0)
  removalFee    — removal fee in dollars  (default: 500)
  labor         — labor cost  (default: 3000)
  permit        — permit cost  (default: 1250)
  startup       — startup cost  (default: 695)
  discount      — discount amount  (default: 0)
  taxRate       — tax rate percent  (default: 7)
  validDays     — proposal valid days  (default: 30)
  depositPct    — deposit percent  (default: 50)

RULES:
1. If a field is not mentioned in the notes, use the default shown above.
2. battery MUST be true whenever jobType is "new-install", regardless of what the notes say.
3. Choose the closest valid size; if ambiguous pick the next size up.
4. Return the JSON object only — no markdown, no explanation.`;

router.post('/:id/build-from-notes', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { notes } = req.body as { notes?: string };
  if (!notes?.trim()) return res.status(400).json({ error: 'notes required' });

  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'Anthropic API key not configured. Add it in Settings > AI or set ANTHROPIC_API_KEY.' });

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
  if (!parsed) return res.status(422).json({ error: 'AI returned an unrecognizable response. Please try again.' });

  // Normalize fuel: coerce any propane synonym to the stored enum value 'LP'
  if (parsed.fuel && String(parsed.fuel).toLowerCase() !== 'natural gas') {
    parsed.fuel = 'LP';
  }

  // Merge AI output over safe defaults
  const form: Record<string, unknown> = {
    customer: '', attn: '', address: '', city: '', state: 'FL', zip: '', phone: '', email: '',
    brand: 'Kohler', coolingType: 'air-cooled', size: '14KW',
    ats: '200A', fuel: 'Natural Gas', jobType: 'new-install', liftType: 'none', lcATS: 'none',
    pad: true, smm: true, surgePro: false, battery: true, emPanel: false, gasLine: false,
    removal: false, extraWire: 0, additionalATS: 0, removalFee: 500,
    labor: ADDON_P.labor, permit: ADDON_P.permit, startup: ADDON_P.startup,
    discount: 0, discountType: '$', taxRate: 7, validDays: 30, depositPct: 50,
    notes: '', includeBreakdown: false,
    ...parsed,
  };
  // Always enforce battery=true on new-install regardless of AI output
  form.battery = form.jobType === 'swap-out' ? (parsed.battery ?? true) : true;

  const totals = calcFormTotals(form);
  const addons = (form.smm ? 1 : 0) + (form.surgePro ? 1 : 0) + (form.battery ? 1 : 0) + (form.pad ? 1 : 0) + (form.emPanel ? 1 : 0) + (form.gasLine ? 1 : 0);

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

// ── Send proposal email ──────────────────────────────────────────────────────
// Sends through Microsoft Graph (the shared Outlook mailbox, so it lands in Sent
// Items and replies come back to the inbox). The proposal is only marked sent
// AFTER the email actually goes out.
router.post('/:id/send', requireAuth, async (req: AuthRequest, res) => {
  const { to, subject, note, proposalNo, total, deposit } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  const frontendUrl = await getSetting('frontend_url');
  // Never fall back to localhost — a blanked frontend_url must still yield a reachable link
  // (matches bids.ts / auth.ts). Strip any trailing slash so the path joins cleanly.
  const baseUrl = (frontendUrl || process.env.FRONTEND_URL || 'https://electrical-program.onrender.com').replace(/\/$/, '');
  const link = `${baseUrl}/p/${gen.proposal_token}`;

  // Generator spec straight off the proposal: "22kW Generac RG022" etc.
  const spec = [gen.kw ? `${gen.kw}kW` : null, gen.mfr, gen.model].filter(Boolean).join(' ');
  const form = gen.form_data || {};
  const validDays = Number(form.validDays) || 30;
  const finalSubject = subject?.trim()
    || `Your ${spec ? spec + ' ' : ''}Generator Proposal — ${proposalNo || gen.proposal_no || ''}`.trim();
  const html = proposalEmailHtml({
    customerName: gen.customer,
    proposalNo: proposalNo || gen.proposal_no || '',
    spec, total, deposit, validDays, link, senderNote: note,
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
  const { signatureData } = req.body;
  if (!signatureData) return res.status(400).json({ error: 'Signature required' });

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET signed_at = COALESCE(signed_at, now()),
         signature_data = $1,
         stage = CASE WHEN stage IN ('declined','awarded') THEN stage ELSE 'signed' END,
         updated_at = now()
     WHERE proposal_token = $2 AND deleted_at IS NULL
     RETURNING id, customer, stage, signed_at, drive_job_folder_id, salesperson_id, amount, mfr, kw`,
    [signatureData, req.params.token]
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
          linkView: 'gen-proposals',
          linkId: gen.id,
          dedupKey: `propsigned:${gen.id}`,
        });
      }
      // Push the same alert to the salesperson's devices (fire-and-forget).
      const amt = Number(gen.amount || 0);
      sendPushToUsers(targets, {
        title: '🎉 Proposal signed',
        body: `${gen.customer} signed${amt ? ` — $${amt.toLocaleString()}` : ''}`,
        view: 'gen-proposals',
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
        const spec = [gen.kw ? `${gen.kw}kW` : null, gen.mfr].filter(Boolean).join(' ');
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

export default router;
