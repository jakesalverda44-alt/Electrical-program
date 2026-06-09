import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool';
import { requireAuth, requireAuthOrApiKey, AuthRequest, ownScopeId } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { validateBody, inputErrorMessage } from '../utils/validate';
import { logger } from '../utils/logger';
import { sendLeadFirstContactEmail, sendNeedsCallNotification } from '../email/leadFirstContact';
import { createStageFollowup, closeLeadFollowups } from '../utils/leadFollowups';
import { getStageConfig } from '../utils/leadStageConfig';
import { pushSiteVisitToCalendar } from '../integrations/outlookCalendar';
import { enqueueStageWebhook } from '../webhooks/outbox';

const router = Router();

// Enum values mirror the CHECK constraints in 049_create_leads.sql so a bad value
// is rejected with a clear 400 instead of bubbling up as a DB error → 500.
const SOURCES        = ['web', 'phone', 'referral', 'kohler', 'other'] as const;
const CONTACT_METHODS = ['email', 'phone'] as const;
const INTEREST_LEVELS = ['unknown', 'warm', 'hot', 'not-interested'] as const;
// Reduced lead pipeline. 'site-scheduled' is the handoff trigger (a lead moved there
// is immediately converted to a proposal), and 'converted' is the terminal state set
// automatically on handoff. 'lost' is an exit reachable from any stage.
const STAGES = ['new', 'contacted', 'site-scheduled', 'lost', 'converted'] as const;

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
  // Site-visit scheduling, sent with the Site Scheduled handoff.
  site_visit_at: z.string().datetime().nullable().or(z.literal('')),
  site_visit_needs_time: z.boolean(),
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
      // First contact made → auto-advance New -> Contacted.
      await advanceToContacted(lead.id, 'System');
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

// Per-stage default text for quick-log activity kinds (stored when body is empty)
const KIND_DEFAULTS: Record<string, string> = {
  call:     'Outgoing call',
  text:     'Text sent',
  voicemail:'Left voicemail',
  note:     '',
  email:    'Email sent',
  system:   '',
};

type LeadRow = {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; notes: string | null; source: string; stage: string;
  contact_method: string; linked_gen_id: string | null;
  salesperson_id: string | null; salesperson_name: string | null;
  site_visit_at: string | Date | null; site_visit_needs_time: boolean;
};

// FL-based business — render the site-visit time in Eastern for activity logs.
function fmtSiteVisit(at: string | Date | null): string {
  if (!at) return 'a time to be determined';
  return new Date(at).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York',
  });
}

/**
 * Lead -> proposal handoff. Idempotent. Creates a generator proposal in the pipeline's
 * "Building" column (carrying the lead's contact details + full activity timeline),
 * links it to the originating lead in both directions, marks the lead 'converted', and
 * logs the conversion on both the lead and the new proposal. Returns the proposal id.
 */
async function convertLeadToProposal(lead: LeadRow, actingUser?: { name: string }): Promise<string> {
  const actor = actingUser?.name || 'System';
  let genId = lead.linked_gen_id;

  if (!genId) {
    const formData = {
      customer: lead.name,
      attn:     lead.name,
      address:  lead.address ?? '',
      phone:    lead.phone ?? '',
      email:    lead.email ?? '',
      notes:    lead.notes ?? '',
      lead_source: lead.source,
    };
    const { rows } = await pool.query(
      `INSERT INTO generator_proposals
         (customer, loc, salesperson_id, salesperson_name, stage, form_data, lead_id,
          site_visit_at, site_visit_needs_time)
       VALUES ($1, $2, $3, $4, 'building', $5::jsonb, $6, $7, $8)
       RETURNING id`,
      [lead.name, (lead.address && lead.address.trim()) || '—',
       lead.salesperson_id, lead.salesperson_name, JSON.stringify(formData), lead.id,
       lead.site_visit_at || null, !!lead.site_visit_needs_time]
    );
    genId = rows[0].id as string;

    // Carry over the full lead activity timeline onto the proposal.
    await pool.query(
      `INSERT INTO proposal_activity (proposal_id, kind, direction, text, created_by, created_at)
       SELECT $1, kind, direction, text, created_by, created_at
         FROM lead_activity WHERE lead_id = $2`,
      [genId, lead.id]
    );
  } else {
    await pool.query(
      `UPDATE generator_proposals
          SET lead_id = COALESCE(lead_id, $1),
              site_visit_at = $2, site_visit_needs_time = $3
        WHERE id = $4`,
      [lead.id, lead.site_visit_at || null, !!lead.site_visit_needs_time, genId]
    );
  }

  // Link forward + mark converted (removes it from the active leads board).
  await pool.query(
    "UPDATE leads SET linked_gen_id=$1, stage='converted', updated_at=now() WHERE id=$2",
    [genId, lead.id]
  );

  // Log the conversion + the scheduled site visit on both sides.
  const visitText = `Site visit scheduled for ${fmtSiteVisit(lead.site_visit_at)}`;
  await pool.query(
    "INSERT INTO lead_activity (lead_id, kind, created_by, text) VALUES ($1,'system',$2,$3),($1,'system',$2,$4)",
    [lead.id, actor, 'Site scheduled — converted to generator proposal', visitText]
  ).catch(() => {});
  await pool.query(
    "INSERT INTO proposal_activity (proposal_id, kind, created_by, text) VALUES ($1,'system',$2,$3),($1,'system',$2,$4)",
    [genId, actor, `Converted from lead "${lead.name}"`, visitText]
  ).catch(() => {});

  // Fire-and-forget Outlook calendar push (non-blocking; updates on re-run).
  pushSiteVisitToCalendar(genId, {
    id: lead.id, name: lead.name, address: lead.address, phone: lead.phone,
    email: lead.email, notes: lead.notes, site_visit_at: lead.site_visit_at,
    salesperson_name: lead.salesperson_name,
  }).catch(() => {});

  // A converted lead is terminal — close out any open follow-up tasks.
  await closeLeadFollowups(lead.id);

  return genId;
}

/**
 * Auto-advance a lead from 'new' to 'contacted'. Fires when first contact is made
 * (first-contact email sent, or a call logged). No-op unless the lead is currently
 * 'new'. Logs the transition and schedules the contacted follow-up.
 */
async function advanceToContacted(leadId: string, actorName: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      "UPDATE leads SET stage='contacted', updated_at=now() WHERE id=$1 AND stage='new' AND deleted_at IS NULL RETURNING *",
      [leadId]
    );
    if (!rows.length) return;
    const lead = rows[0];
    await pool.query(
      "INSERT INTO lead_activity (lead_id, kind, created_by, text) VALUES ($1,'stage_change',$2,$3)",
      [leadId, actorName, 'Stage changed from "new" to "contacted" (auto)']
    ).catch(() => {});
    createStageFollowup({ id: lead.id, name: lead.name, salesperson_id: lead.salesperson_id }, 'contacted').catch(() => {});
    enqueueStageWebhook(lead, 'contacted', lead.contact_method).catch(() => {});
  } catch (err) {
    logger.error({ err, leadId }, '[advanceToContacted] failed');
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

// GET /api/leads
// Converted leads are hidden from the active board by default. Pass ?stage=converted
// to fetch them for history, or ?include_converted=1 to include them in the full list.
router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const scope = ownScopeId(req.user!);
  const params: unknown[] = [];
  const where = ['deleted_at IS NULL'];
  if (scope) { params.push(scope); where.push(`salesperson_id = $${params.length}`); }

  if (typeof req.query.stage === 'string') {
    params.push(req.query.stage);
    where.push(`stage = $${params.length}`);
  } else if (req.query.include_converted !== '1') {
    where.push(`stage <> 'converted'`);
  }

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
  // lead must not re-fire it. Queued durably — delivery and retries happen in
  // the outbox dispatcher, so a Zapier outage can't lose the trigger.
  if (inserted) {
    enqueueStageWebhook(lead, lead.stage, lead.contact_method).catch(() => {});
    // Auto-log creation and schedule the first follow-up task.
    pool.query(
      'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
      [lead.id, 'system', 'Lead created']
    ).catch(() => {});
    createStageFollowup(lead, lead.stage, req.user).catch(() => {});
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
    'SELECT * FROM lead_activity WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 200',
    [lead.id]
  );
  res.json({ ...lead, activity });
}));

// PATCH /api/leads/:id
router.patch('/:id', leadWriteLimiter, requireAuth, validateBody(leadPatchSchema), asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  // Moving to "Site Scheduled" is the handoff trigger: the lead is converted to a
  // proposal and ends in 'converted', so don't write the transient stage itself.
  const isHandoff = req.body.stage === 'site-scheduled' && lead.stage !== 'converted';

  const allowed = [
    'name', 'email', 'phone', 'address', 'source', 'contact_method',
    'interest_level', 'stage', 'notes', 'site_notes', 'quoted_range',
    'follow_up_date', 'salesperson_id', 'salesperson_name',
  ];
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];

  for (const key of allowed) {
    if (key === 'stage' && isHandoff) continue; // handoff sets 'converted' itself
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

  if (isHandoff) {
    // Capture the scheduled site visit on the lead before converting. "No time yet"
    // arrives as a null datetime and flags the lead/proposal as needing a time.
    const siteVisitAt = req.body.site_visit_at || null;
    const needsTime = req.body.site_visit_needs_time ?? !siteVisitAt;
    await pool.query(
      'UPDATE leads SET site_visit_at=$1, site_visit_needs_time=$2, updated_at=now() WHERE id=$3',
      [siteVisitAt, needsTime, lead.id]
    );
    updated.site_visit_at = siteVisitAt;
    updated.site_visit_needs_time = needsTime;

    const genId = await convertLeadToProposal(updated, req.user);
    const { rows: converted } = await pool.query('SELECT * FROM leads WHERE id=$1', [lead.id]);
    // Return the new proposal too so the client can drop the new card into the Pipeline
    // "Building" column without a manual refresh.
    const { rows: gen } = await pool.query('SELECT * FROM generator_proposals WHERE id=$1', [genId]);
    res.json({ ...converted[0], linked_gen_id: genId, proposal: gen[0] ?? null });
    return;
  }

  // Log stage change, fire webhook, and schedule follow-up task when stage changes.
  if (req.body.stage && req.body.stage !== lead.stage) {
    await pool.query(
      'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
      [lead.id, 'stage_change', `Stage changed from "${lead.stage}" to "${req.body.stage}"`]
    ).catch(() => {});

    enqueueStageWebhook(updated, updated.stage, updated.contact_method).catch(() => {});
    if (updated.stage === 'lost') {
      // Terminal exit — close any open follow-ups instead of creating a new one.
      await closeLeadFollowups(lead.id);
    } else {
      createStageFollowup({ id: lead.id, name: updated.name, salesperson_id: updated.salesperson_id }, updated.stage, req.user).catch(() => {});
    }
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

  const queued = await enqueueStageWebhook(lead, lead.stage, lead.contact_method);
  res.json({ ok: true, queued });
}));

const ALLOWED_ACTIVITY_KINDS = ['call', 'text', 'voicemail', 'note', 'email'] as const;
const logActivitySchema = z.object({
  kind:      z.enum(ALLOWED_ACTIVITY_KINDS),
  direction: z.enum(['in', 'out']).optional(),
  body:      z.string().optional(),
});

// POST /api/leads/:id/log-activity  — write a timeline activity (quick-log or note)
router.post('/:id/log-activity', requireAuth, validateBody(logActivitySchema), asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  const { kind, direction, body } = req.body as z.infer<typeof logActivitySchema>;
  const text = body?.trim() || KIND_DEFAULTS[kind] || kind;

  const { rows } = await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, direction, created_by, text) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [lead.id, kind, direction ?? null, req.user!.name, text]
  );
  // A logged call counts as first contact → auto-advance New -> Contacted.
  if (kind === 'call') await advanceToContacted(lead.id, req.user!.name);
  res.status(201).json(rows[0]);
}));

// POST /api/leads/:id/log-call  (kept for backward compatibility — proxies to log-activity)
router.post('/:id/log-call', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  const { text } = req.body;
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  const { rows } = await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, direction, created_by, text) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [lead.id, 'call', 'out', req.user!.name, text.trim()]
  );
  await advanceToContacted(lead.id, req.user!.name);
  res.status(201).json(rows[0]);
}));

// POST /api/leads/:id/create-gen  (create a linked generator proposal)
router.post('/:id/create-gen', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const lead = await loadOwnedLead(req, res);
  if (!lead) return;

  // Create the proposal carrying contact details, link both directions, and copy the
  // lead's activity timeline onto the proposal (does not convert/close the lead).
  const formData = {
    customer: lead.name, attn: lead.name, address: lead.address ?? '',
    phone: lead.phone ?? '', email: lead.email ?? '', notes: lead.notes ?? '',
    lead_source: lead.source,
  };
  const { rows: genRows } = await pool.query(
    `INSERT INTO generator_proposals
       (customer, loc, salesperson_id, salesperson_name, stage, form_data, lead_id)
     VALUES ($1,$2,$3,$4,'building',$5::jsonb,$6)
     RETURNING *`,
    [lead.name, (lead.address && lead.address.trim()) || '—',
     lead.salesperson_id, lead.salesperson_name, JSON.stringify(formData), lead.id]
  );
  const gen = genRows[0];

  await pool.query(
    `INSERT INTO proposal_activity (proposal_id, kind, direction, text, created_by, created_at)
     SELECT $1, kind, direction, text, created_by, created_at FROM lead_activity WHERE lead_id = $2`,
    [gen.id, lead.id]
  ).catch(() => {});

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
