import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { ownerAdminIds } from '../notifications/prefs';

/**
 * Durable outbox for outbound Zapier stage webhooks.
 *
 * Enqueue writes a point-in-time payload snapshot to webhook_outbox and kicks the
 * dispatcher for immediate delivery. Failed deliveries retry with exponential
 * backoff until MAX_ATTEMPTS, then the row is marked 'failed', the failure is
 * logged on the lead timeline, and owners/admins get an in-app notification.
 *
 * Delivery is at-least-once: a crash between a successful POST and the
 * 'delivered' update re-delivers after the claim lease expires, so downstream
 * Zaps should treat lead_id + stage as an idempotency key.
 *
 * Multi-instance safe: claims use FOR UPDATE SKIP LOCKED and push
 * next_attempt_at forward as a lease, so concurrent dispatchers never deliver
 * the same row twice while one is working on it.
 */

// Webhook URL map: key = 'stage:contact_method' or 'stage:any'. Resolved lazily
// (not at module load) so tests and key rotation see current env values.
function webhookUrls(): Record<string, string | undefined> {
  return {
    'new:email':          process.env.ZAPIER_WEBHOOK_EMAIL_NEW_LEAD,
    'new:phone':          process.env.ZAPIER_WEBHOOK_PHONE_NEW_LEAD,
    'quoted:any':         process.env.ZAPIER_WEBHOOK_QUOTED,
    'site-scheduled:any': process.env.ZAPIER_WEBHOOK_SITE_SCHEDULED,
  };
}

export function resolveWebhookUrl(stage: string, contactMethod: string): string | undefined {
  const urls = webhookUrls();
  return urls[`${stage}:${contactMethod}`] ?? urls[`${stage}:any`];
}

export const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_MS = 2 * 60 * 1000;   // re-delivery window if a dispatcher dies mid-attempt
const DELIVERY_TIMEOUT_MS = 15 * 1000;  // per-request fetch timeout
const CLAIM_BATCH = 10;

/** Backoff before the next try after `attempt` failed attempts (1-based). */
export function backoffMs(attempt: number): number {
  const steps = [
    60_000,            // 1m
    5 * 60_000,        // 5m
    15 * 60_000,       // 15m
    60 * 60_000,       // 1h
    3 * 60 * 60_000,   // 3h
    6 * 60 * 60_000,   // 6h
    12 * 60 * 60_000,  // 12h
  ];
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1];
}

/** The payload snapshot sent to Zapier — kept identical to the legacy inline send. */
export function buildWebhookPayload(lead: Record<string, unknown>, stage: string): Record<string, unknown> {
  return {
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
  };
}

/**
 * Queue the stage webhook for a lead. No-op (returns false) when no Zapier URL
 * is configured for the stage. Never throws — automation must not break the
 * request that triggered it.
 */
export async function enqueueStageWebhook(
  lead: Record<string, unknown>,
  stage: string,
  contactMethod: string,
): Promise<boolean> {
  if (!resolveWebhookUrl(stage, contactMethod)) return false;
  try {
    await pool.query(
      `INSERT INTO webhook_outbox (lead_id, stage, contact_method, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [lead.id, stage, contactMethod || 'any', JSON.stringify(buildWebhookPayload(lead, stage))]
    );
    kickDispatcher();
    return true;
  } catch (err) {
    logger.error({ err, leadId: lead.id, stage }, '[webhooks] enqueue failed');
    return false;
  }
}

type OutboxRow = {
  id: string; lead_id: string | null; stage: string; contact_method: string;
  payload: Record<string, unknown>; attempts: number;
};

/**
 * Claim a batch of due rows. The claim itself bumps attempts and pushes
 * next_attempt_at forward as a lease — if this process dies before recording
 * an outcome, the row simply becomes due again after the lease.
 */
async function claimBatch(): Promise<OutboxRow[]> {
  const { rows } = await pool.query(
    `UPDATE webhook_outbox o
        SET attempts = o.attempts + 1,
            next_attempt_at = now() + ($1 || ' milliseconds')::interval
      WHERE o.id IN (
        SELECT id FROM webhook_outbox
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT ${CLAIM_BATCH}
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, lead_id, stage, contact_method, payload, attempts`,
    [String(CLAIM_LEASE_MS)]
  );
  return rows;
}

async function logLeadActivity(leadId: string | null, kind: string, text: string): Promise<void> {
  if (!leadId) return;
  await pool.query(
    'INSERT INTO lead_activity (lead_id, kind, text) VALUES ($1,$2,$3)',
    [leadId, kind, text]
  ).catch(err => logger.error({ err, leadId }, '[webhooks] lead_activity insert failed'));
}

/** In-app alert to owners/admins when a webhook is permanently dead. */
async function notifyPermanentFailure(row: OutboxRow, error: string): Promise<void> {
  try {
    const name = (row.payload?.name as string) || 'a lead';
    for (const uid of await ownerAdminIds()) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, link_view, link_id, dedup_key)
         VALUES ($1,'webhook_failed',$2,$3,'gen-leads',$4,$5)
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [uid, 'Automation failed',
         `Zapier webhook for "${name}" (stage ${row.stage}) failed after ${MAX_ATTEMPTS} attempts: ${error}`.slice(0, 500),
         row.lead_id, `webhook_failed:${row.id}:${uid}`]
      );
    }
  } catch (err) {
    logger.error({ err, outboxId: row.id }, '[webhooks] failure notification insert failed');
  }
}

async function attemptDelivery(row: OutboxRow): Promise<void> {
  const url = resolveWebhookUrl(row.stage, row.contact_method);
  if (!url) {
    // URL was removed from the environment — nothing to deliver to, retire the row.
    await pool.query(
      `UPDATE webhook_outbox SET status='failed', last_error='No webhook URL configured for stage' WHERE id=$1`,
      [row.id]
    );
    return;
  }

  let error: string | null = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!resp.ok) error = `HTTP ${resp.status}`;
  } catch (err) {
    error = String(err);
  }

  if (!error) {
    await pool.query(
      `UPDATE webhook_outbox SET status='delivered', delivered_at=now(), last_error=NULL WHERE id=$1`,
      [row.id]
    );
    await logLeadActivity(row.lead_id, 'webhook_ok',
      `Automation triggered for stage "${row.stage}"${row.attempts > 1 ? ` (attempt ${row.attempts})` : ''}`);
    return;
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE webhook_outbox SET status='failed', last_error=$2 WHERE id=$1`,
      [row.id, error]
    );
    logger.error({ outboxId: row.id, leadId: row.lead_id, stage: row.stage, error },
      '[webhooks] permanently failed');
    await logLeadActivity(row.lead_id, 'webhook_fail',
      `Automation failed for stage "${row.stage}" after ${row.attempts} attempts: ${error}`);
    await notifyPermanentFailure(row, error);
    return;
  }

  // Transient failure — reschedule with backoff (overrides the claim lease).
  await pool.query(
    `UPDATE webhook_outbox SET next_attempt_at = now() + ($2 || ' milliseconds')::interval, last_error=$3 WHERE id=$1`,
    [row.id, String(backoffMs(row.attempts)), error]
  );
  logger.warn({ outboxId: row.id, leadId: row.lead_id, stage: row.stage, attempt: row.attempts, error },
    '[webhooks] delivery failed, will retry');
}

let dispatching = false;

/** Deliver every due row. Safe to call concurrently — overlapping calls no-op. */
export async function deliverDueWebhooks(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    for (;;) {
      const claimed = await claimBatch();
      if (!claimed.length) break;
      for (const row of claimed) await attemptDelivery(row);
    }
  } finally {
    dispatching = false;
  }
}

function kickDispatcher(): void {
  if (process.env.NODE_ENV === 'test') return; // tests call deliverDueWebhooks() explicitly
  setImmediate(() => deliverDueWebhooks().catch(err => logger.error({ err }, '[webhooks] dispatch failed')));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic retry sweep (every minute). No-op in tests or when disabled. */
export function startWebhookDispatcher(): void {
  if (process.env.NODE_ENV === 'test' || process.env.WEBHOOKS_DISABLED === 'true') return;
  if (timer) return;
  timer = setInterval(() => {
    deliverDueWebhooks().catch(err => logger.error({ err }, '[webhooks] dispatch failed'));
  }, 60_000);
  kickDispatcher(); // drain anything that came due while we were down
}

export function stopWebhookDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
