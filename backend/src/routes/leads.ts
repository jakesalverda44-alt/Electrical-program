import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { requireAuth, requireAuthOrApiKey, AuthRequest, ownScopeId } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validateBody, inputErrorMessage } from '../utils/validate';
import { logger } from '../utils/logger';
import { sendLeadFirstContactEmail, sendNeedsCallNotification } from '../email/leadFirstContact';

const router = Router();

// Enum values mirror the CHECK constraints in 049_create_leads.sql so a bad value
// is rejected with a clear 400 instead of bubbling up as a DB error → 500.
const SOURCES        = ['web', 'phone', 'referral', 'kohler', 'other'] as const;
const CONTACT_METHODS = ['email', 'phone'] as const;
const INTEREST_LEVELS = ['unknown', 'warm', 'hot', 'not-interested'] as const;
const STAGES = ['new', 'contacted', 'vetting', 'quoted', 'site-scheduled',
  'site-complete', 'proposal-sent', 'won', 'lost'] as const;

const leadCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  source: z.enum(SOURCES).optional(),
  contact_method: z.enum(CONTACT_METHODS).optional(),
  interest_level: z.enum(INTEREST_LEVELS).optional(),
  notes: z.string().optional(),
  follow_up_date: z.string().trim().optional().nullable().or(z.literal('')),
  salesperson_id: z.string().uuid('Invalid salesperson_id').optional().nullable().or(z.literal('')),
  salesperson_name: z.string().optional(),
  external_lead_id: z.string().optional(),
});

const leadPatchSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Invalid email').or(z.literal('')),
  phone: z.string(),
  address: z.string(),
  source: z.enum(SOURCES),
  contact_method: z.enum(CONTACT_METHODS),
  interest_level: z.enum(INTEREST_LEVELS),
  stage: z.enum(STAGES),
  notes: z.string(),
  site_notes: z.string(),
  quoted_range: z.string(),
  follow_up_date: z.string().nullable().or(z.literal('')),
  salesperson_id: z.string().uuid('Invalid salesperson_id').nullable().or(z.literal('')),
  salesperson_name: z.string(),
}).partial();

// Throttle lead writes to stop flooding/lead-spam. Automation callers authenticate
// with a shared X-API-Key, so key the limiter by that header when present and fall
// back to the client IP for JWT users.
const leadWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Single-IP-fallback validation is intentionally off: automation callers are
  // distinguished by their X-API-Key, JWT users fall back to client IP.
  validate: { ip: false },
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'];
    return typeof apiKey === 'string' && apiKey ? `apikey:${apiKey}` : (req.ip ?? 'unknown');
  },
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

/**
 * Automated first contact for a brand-new (or not-yet-contacted) lead.
 *
 * Idempotent and safe to call on every POST: it atomically *claims* the lead by
 * stamping first_contact_sent_at, so re-pulls / upserts from the browser
 * extension can never trigger a second send. Email leads get the first-contact
 * email; phone-only leads are flagged needs_call and the team is notified to
 * place a call. On any send failure the claim is released (first_contact_sent_at
 * back to NULL) so the next upsert retries. Fully non-blocking — never throws.
 */
async function handleLeadFirstContact(leadId: string): Promise<void> {
  // Atomic claim: only one caller wins, and only while first contact is pending.
  const { rows } = await pool.query(
    `UPDATE leads SET first_contact_sent_at = now()
       WHERE id = $1 AND first_contact_sent_at IS NULL AND deleted_at IS NULL
       RETURNING id, name, email, phone, contact_method`,
    [leadId]
  );
  if (!rows.length) return; // already contacted, or being contacted concurrently
  const lead = rows[0];

  try {
    if (lead.contact_method === 'email' && lead.email) {
      await sendLeadFirstContactEmail(lead);
      await pool.query(
        'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
        [lead.id, 'email_sent', `First-contact email sent to ${lead.email}`]
      ).catch(() => {});
    } else {
      // Phone-only lead: flag for a manual call and notify the team.
      await pool.query('UPDATE leads SET needs_call = true WHERE id = $1', [lead.id]);
      await sendNeedsCallNotification(lead);
      await pool.query(
        'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
        [lead.id, 'note', 'No email on lead — flagged for a call and notified the team']
      ).catch(() => {});
    }
  } catch (err) {
    // Release the claim so the next upsert can retry, and keep the create OK.
    await pool.query(
      'UPDATE leads SET first_contact_sent_at = NULL WHERE id = $1',
      [lead.id]
    ).catch(() => {});
    logger.error({ err, leadId: lead.id }, '[lead first-contact] send failed; will retry');
  }
}

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
// Reachable by the frontend (JWT) and by external automation / the browser
// extension (X-API-Key). When external_lead_id is supplied it acts as a dedupe
// key: a repeat call with the same id updates the existing lead instead of
// creating a duplicate.
router.post('/', leadWriteLimiter, requireAuthOrApiKey, validateBody(leadCreateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const {
    name, email, phone, address,
    source = 'phone',
    contact_method,
    interest_level = 'unknown',
    notes,
    follow_up_date,
    salesperson_id,
    salesperson_name,
    external_lead_id,
  } = req.body;

  if (!name?.trim()) { res.status(400).json({ error: 'Name is required' }); return; }

  // Split the lead on whether we captured an email: with one we can email the
  // first-contact message, without one it must be a phone call. An explicit
  // contact_method in the request still wins.
  const hasEmail = typeof email === 'string' && email.trim() !== '';
  const resolvedContactMethod = contact_method ?? (hasEmail ? 'email' : 'phone');

  const extId = external_lead_id?.trim() || null;

  const values = [
    name.trim(), email || null, phone || null, address || null,
    source, resolvedContactMethod, interest_level,
    notes || null,
    follow_up_date || null,
    salesperson_id || null,
    salesperson_name || null,
    extId,
  ];

  // Upsert on external_lead_id when present, otherwise a plain insert. On update
  // we refresh the contact fields but deliberately leave `stage` untouched so a
  // re-pull never resets pipeline progress. `inserted` (xmax=0) tells us whether
  // a new row was created so we only fire the new-lead webhook for real creates.
  const sql = extId
    ? `INSERT INTO leads
         (name, email, phone, address, source, contact_method, interest_level, notes,
          follow_up_date, salesperson_id, salesperson_name, external_lead_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (external_lead_id) WHERE external_lead_id IS NOT NULL
       DO UPDATE SET
         name=EXCLUDED.name, email=EXCLUDED.email, phone=EXCLUDED.phone,
         address=EXCLUDED.address, source=EXCLUDED.source,
         contact_method=EXCLUDED.contact_method, interest_level=EXCLUDED.interest_level,
         notes=EXCLUDED.notes, follow_up_date=EXCLUDED.follow_up_date,
         salesperson_id=EXCLUDED.salesperson_id, salesperson_name=EXCLUDED.salesperson_name,
         updated_at=now()
       RETURNING *, (xmax = 0) AS inserted`
    : `INSERT INTO leads
         (name, email, phone, address, source, contact_method, interest_level, notes,
          follow_up_date, salesperson_id, salesperson_name, external_lead_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *, true AS inserted`;

  let rows;
  try {
    ({ rows } = await pool.query(sql, values));
  } catch (err) {
    const msg = inputErrorMessage(err);
    if (msg) { res.status(400).json({ error: msg }); return; }
    throw err;
  }
  const { inserted, ...lead } = rows[0];

  // Only a brand-new lead triggers the stage webhook; re-pulling an existing
  // lead must not re-fire it. Fire-and-forget (does NOT await).
  if (inserted) {
    fireAndLogWebhook(lead, lead.stage, lead.contact_method).catch(() => {});
  }

  // First-contact email / call notification. Safe to call on every POST: it is
  // guarded by an atomic claim so it runs at most once per lead. Non-blocking —
  // the create response is returned regardless of email outcome.
  handleLeadFirstContact(lead.id).catch(() => {});

  res.status(inserted ? 201 : 200).json(lead);
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
router.patch('/:id', leadWriteLimiter, requireAuth, validateBody(leadPatchSchema), asyncHandler(async (req: AuthRequest, res) => {
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
  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE leads SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    ));
  } catch (err) {
    const msg = inputErrorMessage(err);
    if (msg) { res.status(400).json({ error: msg }); return; }
    throw err;
  }
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
