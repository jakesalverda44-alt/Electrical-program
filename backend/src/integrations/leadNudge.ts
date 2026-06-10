import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { isPlaceholderLeadEmail, sendLeadNudgeEmail, sendLeadColdEmail } from '../email/leadFirstContact';

// Automated follow-up sequence for Kohler email leads that go quiet.
//
//   Email 1 (first contact)  — sent immediately on lead create (routes/leads.ts).
//   Email 2 (day-2 nudge)     — the next morning, asks what they want from the project.
//   Email 3 ("going cold")    — ~3 days after the nudge, a no-pressure final touch.
//
// Every step past the first only fires while the lead has had NO inbound reply and NO
// human outreach logged (call / voicemail / text / manual email) — i.e. it has truly
// gone quiet. Each email is one per lead, ever, claimed atomically (nudge_sent_at /
// cold_email_sent_at) so concurrent ticks can never double-send.

const MORNING_START_ET = 8;   // don't email people before 8am
const MORNING_END_ET = 12;    // "morning" window closes at noon
const POLL_MS = 15 * 60 * 1000;
const COLD_AFTER_NUDGE_DAYS = 3; // wait this long after the nudge before the cold touch

// A lead is still "quiet" when there is no inbound reply and no human-logged outreach.
// The auto-sent emails log kind='email_sent' (not 'email'), so they never count here.
const STILL_QUIET = `NOT EXISTS (
  SELECT 1 FROM lead_activity a
   WHERE a.lead_id = l.id
     AND (a.direction = 'in' OR a.kind IN ('call','voicemail','text','email'))
)`;

export function etHour(d: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(d),
    10
  );
}

/**
 * Claim + send all due nudges. Exported for tests / manual runs.
 * Returns the number of emails actually sent.
 */
export async function sendDueLeadNudges(): Promise<number> {
  // Atomic claim: stamp nudge_sent_at first so concurrent ticks can't double-send.
  const { rows } = await pool.query(
    `UPDATE leads SET nudge_sent_at = now()
      WHERE id IN (
        SELECT l.id FROM leads l
         WHERE l.deleted_at IS NULL
           AND l.source = 'kohler'
           AND l.stage IN ('new','contacted')
           AND l.contact_method = 'email'
           AND l.email IS NOT NULL AND l.email <> ''
           AND coalesce(l.interest_level,'') <> 'not-interested'
           AND l.first_contact_sent_at IS NOT NULL
           AND l.nudge_sent_at IS NULL
           -- accepted before today (ET): "the next morning after"
           AND (l.created_at AT TIME ZONE 'America/New_York')::date
             < (now() AT TIME ZONE 'America/New_York')::date
           -- no reply, and no human outreach logged (call / text / voicemail / manual email)
           AND ${STILL_QUIET}
         LIMIT 25
      )
      RETURNING id, name, email, phone`
  );

  let sent = 0;
  for (const lead of rows) {
    // Safety net — placeholder addresses keep the claim so they are never retried.
    if (isPlaceholderLeadEmail(lead.email)) continue;
    try {
      await sendLeadNudgeEmail(lead);
      sent++;
      await pool.query(
        `INSERT INTO lead_activity (lead_id, kind, direction, created_by, text)
         VALUES ($1, 'email_sent', 'out', 'System', $2)`,
        [lead.id, `Day-2 engagement email sent to ${lead.email} (no response since first contact)`]
      ).catch(() => {});
    } catch (err) {
      // Release the claim so the next morning tick retries.
      await pool.query('UPDATE leads SET nudge_sent_at = NULL WHERE id = $1', [lead.id]).catch(() => {});
      logger.error({ err, leadId: lead.id }, '[lead-nudge] send failed; will retry');
    }
  }
  return sent;
}

/**
 * Claim + send all due "going cold" final-touch emails. A lead qualifies once its
 * day-2 nudge went out at least COLD_AFTER_NUDGE_DAYS ago and it is still quiet
 * (no reply, no human outreach). Exported for tests / manual runs. Returns the
 * number of emails actually sent.
 */
export async function sendDueColdEmails(): Promise<number> {
  // Atomic claim: stamp cold_email_sent_at first so concurrent ticks can't double-send.
  const { rows } = await pool.query(
    `UPDATE leads SET cold_email_sent_at = now()
      WHERE id IN (
        SELECT l.id FROM leads l
         WHERE l.deleted_at IS NULL
           AND l.source = 'kohler'
           AND l.stage IN ('new','contacted')
           AND l.contact_method = 'email'
           AND l.email IS NOT NULL AND l.email <> ''
           AND coalesce(l.interest_level,'') <> 'not-interested'
           AND l.nudge_sent_at IS NOT NULL
           AND l.cold_email_sent_at IS NULL
           -- a few days have passed since the nudge went out
           AND l.nudge_sent_at < now() - ($1 || ' days')::interval
           -- still no reply, and still no human outreach logged
           AND ${STILL_QUIET}
         LIMIT 25
      )
      RETURNING id, name, email, phone`,
    [String(COLD_AFTER_NUDGE_DAYS)]
  );

  let sent = 0;
  for (const lead of rows) {
    if (isPlaceholderLeadEmail(lead.email)) continue;
    try {
      await sendLeadColdEmail(lead);
      sent++;
      await pool.query(
        `INSERT INTO lead_activity (lead_id, kind, direction, created_by, text)
         VALUES ($1, 'email_sent', 'out', 'System', $2)`,
        [lead.id, `"Going cold" final-touch email sent to ${lead.email} (no response after nudge)`]
      ).catch(() => {});
    } catch (err) {
      // Release the claim so the next morning tick retries.
      await pool.query('UPDATE leads SET cold_email_sent_at = NULL WHERE id = $1', [lead.id]).catch(() => {});
      logger.error({ err, leadId: lead.id }, '[lead-cold] send failed; will retry');
    }
  }
  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startLeadNudgeScheduler(): void {
  if (process.env.NODE_ENV === 'test' || process.env.LEAD_NUDGE_DISABLED === 'true') return;
  if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
    logger.info('[lead-nudge] GRAPH_* not configured — nudge scheduler disabled');
    return;
  }
  if (timer) return;

  const tick = async () => {
    if (running) return;
    const h = etHour();
    if (h < MORNING_START_ET || h >= MORNING_END_ET) return;
    running = true;
    try {
      const n = await sendDueLeadNudges();
      if (n) logger.info({ sent: n }, '[lead-nudge] morning engagement emails sent');
      const c = await sendDueColdEmails();
      if (c) logger.info({ sent: c }, '[lead-nudge] going-cold final-touch emails sent');
    } catch (err) {
      logger.error({ err }, '[lead-nudge] tick failed');
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 90_000);          // first check shortly after startup
  timer = setInterval(tick, POLL_MS); // then every 15 minutes
  logger.info('[lead-nudge] scheduler started (8am–noon ET window, checked every 15m)');
}
