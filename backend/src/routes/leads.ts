import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth, AuthRequest, ownScopeId } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

async function loadOwnedLead(req: AuthRequest, res: import('express').Response) {
  const { rows } = await pool.query(
    'SELECT * FROM leads WHERE id=$1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rows.length) { res.status(404).json({ error: 'Not found' }); return null; }
  const scope = ownScopeId(req.user!);
  if (scope && rows[0].salesperson_id !== scope) {
    res.status(403).json({ error: 'You do not have access to this lead' });
    return null;
  }
  return rows[0];
}

// Webhook URL map: key = 'stage:contact_method' or 'stage:any'
const WEBHOOK_URLS: Record<string, string | undefined> = {
  'new:email':          process.env.ZAPIER_WEBHOOK_EMAIL_NEW_LEAD,
  'new:phone':          process.env.ZAPIER_WEBHOOK_PHONE_NEW_LEAD,
  'quoted:any':         process.env.ZAPIER_WEBHOOK_QUOTED,
  'site-scheduled:any': process.env.ZAPIER_WEBHOOK_SITE_SCHEDULED,
};

async function triggerWebhook(
  lead: Record<string, unknown>,
  stage: string,
  contactMethod: string,
): Promise<{ result: 'ok' | 'fail' | 'no_url'; error?: string }> {
  const specificKey = `${stage}:${contactMethod}`;
  const anyKey = `${stage}:any`;
  const url = WEBHOOK_URLS[specificKey] ?? WEBHOOK_URLS[anyKey];
  if (!url) return { result: 'no_url' };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id:        lead.id,
        name:           lead.name,
        email:          lead.email,
        phone:          lead.phone,
        address:        lead.address,
        source:         lead.source,
        contact_method: lead.contact_method,
        interest_level: lead.interest_level,
        stage,
        notes:          lead.notes,
        quoted_range:   lead.quoted_range,
        follow_up_date: lead.follow_up_date,
      }),
    });
    if (resp.ok) return { result: 'ok' };
    return { result: 'fail', error: `HTTP ${resp.status}` };
  } catch (err: unknown) {
    return { result: 'fail', error: String(err) };
  }
}

async function fireAndLogWebhook(
  lead: Record<string, unknown>,
  stage: string,
  contactMethod: string,
) {
  const { result, error } = await triggerWebhook(lead, stage, contactMethod);
  if (result === 'no_url') return;
  const kind  = result === 'ok' ? 'webhook_ok' : 'webhook_fail';
  const text  = result === 'ok'
    ? `Automation triggered for stage "${stage}"`
    : `Automation failed for stage "${stage}": ${error}`;
  await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
    [lead.id, kind, text]
  ).catch(e => logger.error({ err: e }, 'lead_activity insert failed'));
}

// GET /api/leads
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const params: unknown[] = [];
  const where = ['deleted_at IS NULL'];
  if (scope) { params.push(scope); where.push(`salesperson_id = $${params.length}`); }
  const sql = `SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

// POST /api/leads
router.post('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const {
    name, email, phone, address,
    source = 'phone',
    contact_method = 'phone',
    interest_level = 'unknown',
    notes,
    follow_up_date,
    salesperson_id,
    salesperson_name,
  } = req.body;

  if (!name?.trim()) { res.status(400).json({ error: 'Name is required' }); return; }

  const { rows } = await pool.query(
    `INSERT INTO leads
       (name, email, phone, address, source, contact_method, interest_level, notes,
        follow_up_date, salesperson_id, salesperson_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      name.trim(), email || null, phone || null, address || null,
      source, contact_method, interest_level,
      notes || null,
      follow_up_date || null,
      salesperson_id || null,
      salesperson_name || null,
    ]
  );
  const lead = rows[0];

  // Fire-and-forget webhook (does NOT await)
  fireAndLogWebhook(lead, lead.stage, lead.contact_method).catch(() => {});

  res.status(201).json(lead);
}));

// GET /api/leads/:id  (includes activity log)
router.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  const { rows: activity } = await pool.query(
    'SELECT * FROM lead_activity WHERE lead_id=$1 ORDER BY created_at DESC',
    [lead.id]
  );
  res.json({ ...lead, activity });
}));

// PATCH /api/leads/:id
router.patch('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  const allowed = [
    'name', 'email', 'phone', 'address', 'source', 'contact_method',
    'interest_level', 'stage', 'notes', 'site_notes', 'quoted_range',
    'follow_up_date', 'salesperson_id', 'salesperson_name',
  ];
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];

  for (const key of allowed) {
    if (key in req.body) {
      params.push(req.body[key] ?? null);
      sets.push(`${key} = $${params.length}`);
    }
  }

  params.push(lead.id);
  const { rows } = await pool.query(
    `UPDATE leads SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  const updated = rows[0];

  // Log stage change and fire webhook if stage changed
  if (req.body.stage && req.body.stage !== lead.stage) {
    await pool.query(
      'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
      [lead.id, 'stage_change', `Stage changed from "${lead.stage}" to "${req.body.stage}"`]
    ).catch(() => {});

    fireAndLogWebhook(updated, updated.stage, updated.contact_method).catch(() => {});
  }

  res.json(updated);
}));

// DELETE /api/leads/:id (soft delete)
router.delete('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;
  await pool.query('UPDATE leads SET deleted_at = now() WHERE id=$1', [lead.id]);
  res.json({ ok: true });
}));

// POST /api/leads/:id/trigger-automation  (manually fire webhook for current stage)
router.post('/:id/trigger-automation', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  await fireAndLogWebhook(lead, lead.stage, lead.contact_method);
  res.json({ ok: true });
}));

// POST /api/leads/:id/log-call
router.post('/:id/log-call', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  const { text } = req.body;
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  const { rows } = await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3) RETURNING *',
    [lead.id, 'call', text.trim()]
  );
  res.status(201).json(rows[0]);
}));

// POST /api/leads/:id/create-gen  (create a linked generator proposal)
router.post('/:id/create-gen', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  // Insert minimal generator proposal record
  const { rows: genRows } = await pool.query(
    `INSERT INTO generator_proposals
       (customer, salesperson_id, salesperson_name, stage)
     VALUES ($1,$2,$3,'building')
     RETURNING *`,
    [lead.name, lead.salesperson_id, lead.salesperson_name]
  );
  const gen = genRows[0];

  // Link the gen back to the lead
  await pool.query(
    'UPDATE leads SET linked_gen_id=$1, updated_at=now() WHERE id=$2',
    [gen.id, lead.id]
  );

  await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
    [lead.id, 'note', `Generator proposal created (ID: ${gen.id})`]
  ).catch(() => {});

  res.status(201).json(gen);
}));

export default router;
