import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';
import { graphSendMail, isGraphMailConfigured } from '../email/graphMailer';
import { parseDueDays } from '../utils/dueDate';
import { purgeExpired } from '../utils/audit';
import {
  ReminderType, getReminderPrefs, resolveRecipients, ownerAdminIds,
} from './prefs';
import { getStageConfig } from '../utils/leadStageConfig';
import { ensureLeadFollowups } from '../utils/leadFollowups';

const DAILY_DIGEST_RECIPIENT = 'jakes@accuratepowerandtechnology.com';

// ReminderType covers the scanner-driven reminder categories (each has a user-configurable
// pref under runReminderScan); other callers (e.g. the proposal-quiet-sweep) mint their own
// notification "type" tag that has no corresponding pref row, hence the plain-string escape hatch.
interface NewNotif { type: ReminderType | (string & {}); title: string; body: string; linkView: string; linkId: string | null }

/**
 * Insert an in-app notification, skipping duplicates via dedup_key.
 * Returns true if a new row was created (so we know whether to also email).
 */
export async function createNotification(userId: string, n: NewNotif & { dedupKey: string }): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link_view, link_id, dedup_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [userId, n.type, n.title, n.body, n.linkView, n.linkId, n.dedupKey]
  );
  return rows.length > 0;
}

/**
 * Insert many notifications in one round trip, deduped via dedup_key — used
 * by runReminderScan's per-type scans instead of one createNotification call
 * per (record × target-user) pair (audit data #17: ~194 sequential inserts/hour
 * today, 6,000+ at 1,000 tasks × 6 users). Returns the dedup_keys that were
 * actually newly inserted (already-present ones are silently skipped by the
 * same partial unique index createNotification relies on).
 */
async function createNotificationsBulk(
  rows: Array<NewNotif & { userId: string; dedupKey: string }>
): Promise<Set<string>> {
  if (!rows.length) return new Set();
  const { rows: inserted } = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link_view, link_id, dedup_key)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::text[]
     ) AS t(user_id, type, title, body, link_view, link_id, dedup_key)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
     RETURNING dedup_key`,
    [
      rows.map(r => r.userId),
      rows.map(r => r.type),
      rows.map(r => r.title),
      rows.map(r => r.body),
      rows.map(r => r.linkView),
      rows.map(r => r.linkId),
      rows.map(r => r.dedupKey),
    ]
  );
  return new Set(inserted.map(r => r.dedup_key as string));
}

/**
 * Build and bulk-insert the notifications for one reminder type in a single
 * INSERT, then push one digest line per source record that produced at
 * least one newly-created row (mirrors the old per-record "created" flag,
 * just computed from the batch result instead of from N round trips).
 */
async function scanAndNotify<T>(
  type: ReminderType,
  items: T[],
  build: (item: T) => { targets: string[]; notif: NewNotif; dedupBase: string; digestLine: string },
  fresh: Record<ReminderType, string[]>,
): Promise<void> {
  const batch: Array<NewNotif & { userId: string; dedupKey: string }> = [];
  const perRecord: Array<{ keys: string[]; line: string }> = [];
  for (const item of items) {
    const { targets, notif, dedupBase, digestLine } = build(item);
    const keys = targets.map(uid => `${dedupBase}:${uid}`);
    perRecord.push({ keys, line: digestLine });
    for (const uid of targets) batch.push({ ...notif, userId: uid, dedupKey: `${dedupBase}:${uid}` });
  }
  const created = await createNotificationsBulk(batch);
  for (const { keys, line } of perRecord) {
    if (keys.some(k => created.has(k))) fresh[type].push(line);
  }
}

/**
 * Scan for follow-up tasks due, proposals viewed-but-unsigned, and bids due soon.
 * Creates in-app notifications (deduped) and sends an email digest per type when enabled.
 * Safe to run repeatedly — dedup_key prevents duplicate notifications.
 *
 * Post-review hardening (5g), follow-up not implemented here: dedup_key has
 * no day component (see the followup_due comment below), so once a task/lead
 * has notified once, its row is the permanent record of that — reopening the
 * item (closing then reopening a task, a lead going quiet again after being
 * worked) does NOT produce a new notification, because ON CONFLICT sees the
 * same dedup_key already exists. It will notify again only once retention
 * (audit batch 3 Task 2) ages that old row out of the notifications table.
 * Filed as a follow-up — not implemented in this batch — because fixing it
 * needs a real decision about what "reopened" means per notification type
 * (e.g. does a task's status changing open→closed→open count, and should the
 * dedup key incorporate a version/generation counter instead of just the
 * item id) rather than a mechanical change.
 */
export async function runReminderScan(): Promise<void> {
  const prefs = await getReminderPrefs();
  const owners = await ownerAdminIds();
  // Collect newly created notifications per type for the email digest.
  const fresh: Record<ReminderType, string[]> = { followup_due: [], proposal_viewed_unsigned: [], bid_due_soon: [], lead_overdue: [] };

  const targetsFor = (salespersonId: string | null) => (salespersonId ? [salespersonId] : owners);

  // 1. Follow-up tasks due today or overdue. Dedup key has no day component
  // (audit data #2) — a still-open task produces one row, not one per day it
  // stays open; ON CONFLICT makes re-running the scan a no-op for it.
  if (prefs.types.followup_due.app || prefs.types.followup_due.email) {
    const { rows } = await pool.query(
      `SELECT id, title, due_date, assigned_to, linked_name FROM tasks
       WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= CURRENT_DATE`
    );
    if (prefs.types.followup_due.app) {
      await scanAndNotify('followup_due', rows, t => ({
        targets: targetsFor(t.assigned_to),
        notif: { type: 'followup_due', title: 'Follow-up due', body: t.title + (t.linked_name ? ` · ${t.linked_name}` : ''), linkView: 'followups', linkId: t.id },
        dedupBase: `followup:${t.id}`,
        digestLine: `${t.title}${t.linked_name ? ` (${t.linked_name})` : ''} — due ${t.due_date}`,
      }), fresh);
    }
  }

  // 2. Generator proposals viewed but not signed for > N days. (Already had
  // no day in its dedup key — unchanged.)
  {
    const cfg = prefs.types.proposal_viewed_unsigned;
    if (cfg.app || cfg.email) {
      const days = cfg.days ?? 3;
      const { rows } = await pool.query(
        `SELECT id, customer, salesperson_id, viewed_at FROM generator_proposals
         WHERE viewed_at IS NOT NULL AND signed_at IS NULL AND stage <> 'declined'
           AND deleted_at IS NULL
           AND viewed_at < now() - ($1 || ' days')::interval`,
        [String(days)]
      );
      if (cfg.app) {
        await scanAndNotify('proposal_viewed_unsigned', rows, g => ({
          targets: targetsFor(g.salesperson_id),
          notif: { type: 'proposal_viewed_unsigned', title: 'Proposal viewed, not signed', body: `${g.customer} opened their proposal but hasn't signed`, linkView: 'generators/pipeline', linkId: g.id },
          dedupBase: `propunsigned:${g.id}`,
          digestLine: `${g.customer} — viewed ${new Date(g.viewed_at).toLocaleDateString()}, not signed`,
        }), fresh);
      }
    }
  }

  // 3. Bids due within N days. Dedup key has no day component (audit data #2).
  {
    const cfg = prefs.types.bid_due_soon;
    if (cfg.app || cfg.email) {
      const within = cfg.days ?? 3;
      const { rows } = await pool.query(
        `SELECT id, name, due, salesperson_id FROM bids WHERE stage IN ('due','submitted') AND deleted_at IS NULL`
      );
      const dueSoon = rows
        .map(b => ({ ...b, dd: parseDueDays(String(b.due || '')) }))
        .filter(b => b.dd >= 0 && b.dd <= within);
      if (cfg.app) {
        await scanAndNotify('bid_due_soon', dueSoon, b => ({
          targets: targetsFor(b.salesperson_id),
          notif: { type: 'bid_due_soon', title: 'Bid due soon', body: `${b.name} is due in ${b.dd} day${b.dd === 1 ? '' : 's'}`, linkView: 'electrical/bids', linkId: b.id },
          dedupBase: `biddue:${b.id}`,
          digestLine: `${b.name} — due in ${b.dd} day${b.dd === 1 ? '' : 's'}`,
        }), fresh);
      }
    }
  }

  // 4. Overdue leads — last_activity_at older than the per-stage threshold.
  // Dedup key has no day component (audit data #2).
  if (prefs.types.lead_overdue.app || prefs.types.lead_overdue.email) {
    const stageConfig = await getStageConfig();
    for (const [stage, cfg] of Object.entries(stageConfig)) {
      if (!cfg.overdue_after_hours) continue;
      const { rows: overdueLeads } = await pool.query(
        `SELECT id, name, salesperson_id, last_activity_at, stage FROM leads
         WHERE stage = $1 AND deleted_at IS NULL
           AND (
             last_activity_at IS NULL AND created_at < now() - ($2 || ' hours')::interval
             OR last_activity_at < now() - ($2 || ' hours')::interval
           )`,
        [stage, String(cfg.overdue_after_hours)]
      );
      if (prefs.types.lead_overdue.app) {
        await scanAndNotify('lead_overdue', overdueLeads, l => {
          const lastLabel = l.last_activity_at
            ? `last activity ${new Date(l.last_activity_at).toLocaleDateString()}`
            : 'no activity yet';
          return {
            targets: targetsFor(l.salesperson_id),
            notif: { type: 'lead_overdue', title: 'Lead overdue — no recent activity',
              body: `${l.name} (${l.stage}) — ${lastLabel}`,
              linkView: 'generators/leads', linkId: l.id },
            dedupBase: `lead_overdue:${l.id}`,
            digestLine: `${l.name} — stage: ${l.stage}, ${lastLabel}`,
          };
        }, fresh);
      }
    }
  }

  await sendDigests(prefs, fresh);
}

// Still used by maybeSendDailyLeadDigest's once-per-calendar-day dedup below
// (a genuine once-per-day digest by design, per the plan's environment note —
// not one of the three reminder dedup keys that had `:${day}` removed above).
const today = () => new Date().toISOString().slice(0, 10);

const TYPE_LABELS: Record<ReminderType, string> = {
  followup_due: 'Follow-ups Due',
  proposal_viewed_unsigned: 'Proposals Awaiting Signature',
  bid_due_soon: 'Bids Due Soon',
  lead_overdue: 'Overdue Leads',
};

/**
 * Deliver a digest email through Microsoft Graph (the shared JakeS@ mailbox, so replies
 * land in the inbox). Returns true if an email was actually sent.
 */
async function deliverDigestEmail(
  to: string | string[], subject: string, html: string,
): Promise<boolean> {
  if (!isGraphMailConfigured()) {
    logger.warn('[reminders] Microsoft Graph not configured — skipping digest email');
    return false;
  }
  await graphSendMail({ to, subject, html });
  return true;
}

async function sendDigests(
  prefs: Awaited<ReturnType<typeof getReminderPrefs>>,
  fresh: Record<ReminderType, string[]>,
): Promise<void> {
  const sections = (Object.keys(fresh) as ReminderType[])
    .filter(t => prefs.types[t].email && fresh[t].length);
  if (!sections.length) return;

  const recipients = await resolveRecipients(prefs);
  if (!recipients.length) return;

  const html = sections.map(t =>
    `<h3 style="margin:18px 0 6px;font-family:sans-serif">${TYPE_LABELS[t]}</h3>` +
    `<ul style="font-family:sans-serif;color:#334">${fresh[t].map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
  ).join('');
  const text = sections.map(t => `${TYPE_LABELS[t]}\n${fresh[t].map(l => ` - ${l}`).join('\n')}`).join('\n\n');

  try {
    const sent = await deliverDigestEmail(
      recipients, 'Your CRM reminders',
      `<div style="max-width:560px"><h2 style="font-family:sans-serif">Reminders</h2>${html}</div>`,
    );
    if (sent) logger.info({ sections, recipients: recipients.length }, '[reminders] digest sent');
  } catch (err) {
    logger.error({ err }, '[reminders] digest email failed');
  }
}

/**
 * Send a daily digest email of all overdue leads to jakes@accuratepowerandtechnology.com.
 * Runs at most once per calendar day (deduped via app_settings key).
 */
export async function maybeSendDailyLeadDigest(): Promise<void> {
  const day = today();
  try {
    const lastSent = await getSetting('lead_digest_last_sent');
    if (lastSent === day) return; // already sent today

    const stageConfig = await getStageConfig();
    const lines: string[] = [];
    for (const [stage, cfg] of Object.entries(stageConfig)) {
      if (!cfg.overdue_after_hours) continue;
      const { rows } = await pool.query(
        `SELECT l.name, l.stage, l.last_activity_at, l.salesperson_name
         FROM leads l
         WHERE l.stage = $1 AND l.deleted_at IS NULL
           AND (
             l.last_activity_at IS NULL AND l.created_at < now() - ($2 || ' hours')::interval
             OR l.last_activity_at < now() - ($2 || ' hours')::interval
           )
         ORDER BY l.last_activity_at ASC NULLS FIRST`,
        [stage, String(cfg.overdue_after_hours)]
      );
      for (const l of rows) {
        const lastLabel = l.last_activity_at
          ? `last contact ${new Date(l.last_activity_at).toLocaleDateString()}`
          : 'never contacted';
        const rep = l.salesperson_name ? ` · ${l.salesperson_name}` : '';
        lines.push(`${l.name} (${l.stage}${rep}) — ${lastLabel}`);
      }
    }
    if (!lines.length) {
      // Mark as sent so we don't keep re-querying throughout the day
      await pool.query(
        `INSERT INTO app_settings (key, value) VALUES ('lead_digest_last_sent', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [day]
      );
      return;
    }

    const html = `<div style="max-width:560px;font-family:sans-serif">
      <h2 style="color:#d97706">Generator Leads — Daily Overdue Summary</h2>
      <p style="color:#666;font-size:14px">${lines.length} lead${lines.length === 1 ? '' : 's'} need attention today.</p>
      <ul style="color:#334;font-size:14px">${lines.map(l => `<li style="margin-bottom:6px">${escapeHtml(l)}</li>`).join('')}</ul>
      <p style="color:#999;font-size:12px">Log into the CRM to view and update these leads.</p>
    </div>`;
    const text = `Generator Leads — Daily Overdue Summary\n\n${lines.map(l => ` - ${l}`).join('\n')}`;

    const sent = await deliverDigestEmail(
      DAILY_DIGEST_RECIPIENT,
      `${lines.length} lead${lines.length === 1 ? '' : 's'} overdue — ${day}`,
      html,
    );
    if (!sent) return; // no mailer configured — try again next run rather than marking sent
    logger.info({ count: lines.length }, '[lead-digest] daily digest sent');

    // Mark sent for today
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('lead_digest_last_sent', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [day]
    );
  } catch (err) {
    logger.error({ err }, '[lead-digest] daily digest failed');
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the periodic reminder scan (hourly). No-op in tests or when disabled. */
export function startReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test' || process.env.REMINDERS_DISABLED === 'true') return;
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    // Self-healing backfill: make sure every active lead has its stage follow-up task,
    // including leads that entered a stage before the auto follow-up feature existed.
    try { await ensureLeadFollowups(); }
    catch (err) { logger.error({ err }, '[lead-followups] backfill failed'); }
    try { await runReminderScan(); }
    catch (err) { logger.error({ err }, '[reminders] scan failed'); }
    try { await maybeSendDailyLeadDigest(); }
    catch (err) { logger.error({ err }, '[lead-digest] daily digest failed'); }
    // Retention: purge expired audit rows and trashed records (best-effort).
    try {
      const months = parseInt((await getSetting('audit_retention_months')) || '12');
      const purged = await purgeExpired(months);
      if (Object.keys(purged).length) logger.info({ purged, months }, '[retention] purged expired records');
    } catch (err) { logger.error({ err }, '[retention] purge failed'); }
    finally { running = false; }
  };
  setTimeout(tick, 30_000);               // first run shortly after startup
  timer = setInterval(tick, 60 * 60 * 1000); // then hourly
}
