import { Router } from 'express';
import { Resend } from 'resend';
import multer from 'multer';
import { pool } from '../db/pool';
import { requireAuth, requireAdmin, AuthRequest, ownScopeId } from '../middleware/auth';
import { proposalEmailHtml, proposalEmailText } from '../email/proposalEmail';
import { getSetting } from './settings';
import { upsertCustomer } from './customers';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { writeAudit } from '../utils/audit';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
  const where: string[] = ['deleted_at IS NULL'];
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
  const valid = ['building', 'sent', 'awarded', 'declined'];
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

    const { rows } = await client.query(
      'UPDATE generator_proposals SET stage=$1, updated_at=now() WHERE id=$2 RETURNING *',
      [stage, req.params.id]
    );

    let wonJob = null;
    if (stage === 'awarded' && gen.stage !== 'awarded') {
      const { rows: wj } = await client.query(
        `INSERT INTO won_jobs (salesperson_name, customer, proposal_id, proposal_type, value, salesperson_id)
         VALUES ($1,$2,$3,'Generator',$4,$5)
         ON CONFLICT (proposal_id) DO NOTHING
         RETURNING *`,
        [gen.salesperson_name, gen.customer, gen.id, gen.amount, gen.salesperson_id || null]
      );
      wonJob = wj[0] || null;
      await client.query(
        `INSERT INTO activity (kind, div, text) VALUES ('awarded','gen',$1)`,
        [`${gen.customer} awarded — ${gen.salesperson_name}`]
      );
    } else if (stage !== gen.stage) {
      const labels: Record<string, string> = {
        building: 'Building', sent: 'Proposal Sent', declined: 'Declined',
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
  const { customer, loc, mfr, model, kw, amount, tax, addons, proposal_no, form_data, totals_data } = req.body;
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
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
  fields.push(`updated_at=now()`);
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE generator_proposals SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
    vals
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const gen = rows[0];

  // If amount changed on an awarded gen, keep won_jobs in sync
  let wonJob = null;
  if (amount !== undefined && gen.stage === 'awarded') {
    const { rows: wj } = await pool.query(
      `UPDATE won_jobs SET value=$1 WHERE proposal_id=$2 RETURNING *`,
      [Number(amount), gen.id]
    );
    wonJob = wj[0] || null;
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

// ── Send proposal email ──────────────────────────────────────────────────────
router.post('/:id/send', requireAuth, async (req: AuthRequest, res) => {
  const { to, subject, note, proposalNo, total, deposit } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  if (!(await loadOwnedGen(req, res))) return;

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET sent_at = now(), stage = CASE WHEN stage = 'building' THEN 'sent' ELSE stage END, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const gen = rows[0];

  const [apiKey, fromAddress, fromName, replyTo, frontendUrl] = await Promise.all([
    getSetting('email_resend_api_key'),
    getSetting('email_from_address'),
    getSetting('email_from_name'),
    getSetting('email_reply_to'),
    getSetting('frontend_url'),
  ]);

  const baseUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/p/${gen.proposal_token}`;

  if (!apiKey) {
    console.warn('[email] No API key configured — skipping send, returning link:', link);
    return res.json({ gen, link, skipped: true });
  }

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      replyTo: replyTo || undefined,
      to,
      subject: subject || `Your Generator Proposal — ${proposalNo}`,
      html: proposalEmailHtml({ customerName: gen.customer, proposalNo, total, deposit, link, senderNote: note }),
      text: proposalEmailText({ customerName: gen.customer, proposalNo, total, link }),
    });
  } catch (err) {
    console.error('[email] Resend error:', err);
    return res.status(502).json({ error: 'Email delivery failed' });
  }

  res.json({ gen, link });
});

// ── Public: view proposal by token (no auth) ────────────────────────────────
router.get('/p/:token', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET viewed_at = COALESCE(viewed_at, now())
     WHERE proposal_token = $1 AND deleted_at IS NULL
     RETURNING *`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  res.json(rows[0]);
});

// ── Public: sign proposal by token (no auth) ────────────────────────────────
router.post('/p/:token/sign', async (req, res) => {
  const { signatureData } = req.body;
  if (!signatureData) return res.status(400).json({ error: 'Signature required' });

  const { rows } = await pool.query(
    `UPDATE generator_proposals
     SET signed_at = COALESCE(signed_at, now()),
         signature_data = $1,
         stage = CASE WHEN stage IN ('declined','awarded') THEN stage ELSE 'sent' END,
         updated_at = now()
     WHERE proposal_token = $2 AND deleted_at IS NULL
     RETURNING id, customer, stage, signed_at`,
    [signatureData, req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ ok: true, gen: rows[0] });
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
    await pool.query(
      `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category, file_size, file_type, uploaded_by, file_data)
       VALUES ($1,$2,'gen',$3,$3,'contract',$4,'application/pdf','Customer signature',$5)`,
      [gen.id, gen.customer, name, file.size, file.buffer.toString('base64')]
    );
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
