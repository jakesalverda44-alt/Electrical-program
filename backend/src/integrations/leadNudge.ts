import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { isPlaceholderLeadEmail, sendLeadNudgeEmail } from '../email/leadFirstContact';

// Day-2 engagement nudge for Kohler email leads that have gone quiet.
//
// The morning after a lead was accepted into the system (ET calendar day), if the
// first-contact email went out but the lead has not replied and nobody has logged a
// call/text/voicemail or manual email, they automatically get one engagement email
// asking what they want out of a generator install. One per lead, ever
// (leads.nudge_sent_at), claimed atomically like the first-contact send.

const MORNING_START_ET = 8;   // don't email people before 8am
const MORNING_END_ET = 12;    // "morning" window closes at noon
const POLL_MS = 15 * 60 * 1000;

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
           AND l.first_contact_sent_at IS NOT NULL
           AND l.nudge_sent_at IS NULL
           -- accepted before today (ET): "the next morning after"
           AND (l.created_at AT TIME ZONE 'America/New_York')::date
             < (now() AT TIME ZONE 'America/New_York')::date
           -- no reply, and no human outreach logged (call / text / voicemail / manual email)
           AND NOT EXISTS (
             SELECT 1 FROM lead_activity a
              WHERE a.lead_id = l.id
                AND (a.direction = 'in' OR a.kind IN ('call','voicemail','text','email'))
           )
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
