import { Resend } from 'resend';
import { pool } from '../db/pool';
import { getSetting } from '../db/getSetting';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/escapeHtml';
import { parseDueDays } from '../utils/dueDate';
import { purgeExpired } from '../utils/audit';
import {
  ReminderType, getReminderPrefs, resolveRecipients, ownerAdminIds,
} from './prefs';

interface NewNotif { type: ReminderType; title: string; body: string; linkView: string; linkId: string | null }

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

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Scan for follow-up tasks due, proposals viewed-but-unsigned, and bids due soon.
 * Creates in-app notifications (deduped) and sends an email digest per type when enabled.
 * Safe to run repeatedly — dedup_key prevents duplicate notifications.
 */
export async function runReminderScan(): Promise<void> {
  const prefs = await getReminderPrefs();
  const owners = await ownerAdminIds();
  const day = today();
  // Collect newly created notifications per type for the email digest.
  const fresh: Record<ReminderType, string[]> = { followup_due: [], proposal_viewed_unsigned: [], bid_due_soon: [] };

  const targetsFor = (salespersonId: string | null) => (salespersonId ? [salespersonId] : owners);

  const emit = async (type: ReminderType, targets: string[], n: NewNotif, dedupBase: string, digestLine: string) => {
    let created = false;
    for (const uid of targets) {
      if (await createNotification(uid, { ...n, dedupKey: `${dedupBase}:${uid}` })) created = true;
    }
    if (created) fresh[type].push(digestLine);
  };

  // 1. Follow-up tasks due today or overdue.
  if (prefs.types.followup_due.app || prefs.types.followup_due.email) {
    const { rows } = await pool.query(
      `SELECT id, title, due_date, assigned_to, linked_name FROM tasks
       WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= CURRENT_DATE`
    );
    for (const t of rows) {
      if (!prefs.types.followup_due.app) break;
      await emit('followup_due', targetsFor(t.assigned_to),
        { type: 'followup_due', title: 'Follow-up due', body: t.title + (t.linked_name ? ` · ${t.linked_name}` : ''), linkView: 'followups', linkId: t.id },
        `followup:${t.id}:${day}`,
        `${t.title}${t.linked_name ? ` (${t.linked_name})` : ''} — due ${t.due_date}`);
    }
  }

  // 2. Generator proposals viewed but not signed for > N days.
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
      for (const g of rows) {
        if (!cfg.app) break;
        await emit('proposal_viewed_unsigned', targetsFor(g.salesperson_id),
          { type: 'proposal_viewed_unsigned', title: 'Proposal viewed, not signed', body: `${g.customer} opened their proposal but hasn't signed`, linkView: 'gen-proposals', linkId: g.id },
          `propunsigned:${g.id}`,
          `${g.customer} — viewed ${new Date(g.viewed_at).toLocaleDateString()}, not signed`);
      }
    }
  }

  // 3. Bids due within N days.
  {
    const cfg = prefs.types.bid_due_soon;
    if (cfg.app || cfg.email) {
      const within = cfg.days ?? 3;
      const { rows } = await pool.query(
        `SELECT id, name, due, salesperson_id FROM bids WHERE stage IN ('due','submitted') AND deleted_at IS NULL`
      );
      for (const b of rows) {
        const dd = parseDueDays(String(b.due || ''));
        if (dd < 0 || dd > within || !cfg.app) continue;
        await emit('bid_due_soon', targetsFor(b.salesperson_id),
          { type: 'bid_due_soon', title: 'Bid due soon', body: `${b.name} is due in ${dd} day${dd === 1 ? '' : 's'}`, linkView: 'elec-proposals', linkId: b.id },
          `biddue:${b.id}:${day}`,
          `${b.name} — due in ${dd} day${dd === 1 ? '' : 's'}`);
      }
    }
  }

  await sendDigests(prefs, fresh);
}

const TYPE_LABELS: Record<ReminderType, string> = {
  followup_due: 'Follow-ups Due',
  proposal_viewed_unsigned: 'Proposals Awaiting Signature',
  bid_due_soon: 'Bids Due Soon',
};

async function sendDigests(
  prefs: Awaited<ReturnType<typeof getReminderPrefs>>,
  fresh: Record<ReminderType, string[]>,
): Promise<void> {
  const sections = (Object.keys(fresh) as ReminderType[])
    .filter(t => prefs.types[t].email && fresh[t].length);
  if (!sections.length) return;

  const [apiKey, fromAddress, fromName] = await Promise.all([
    getSetting('email_resend_api_key'), getSetting('email_from_address'), getSetting('email_from_name'),
  ]);
  if (!apiKey || !fromAddress) { logger.warn('[reminders] email enabled but email delivery not configured'); return; }

  const recipients = await resolveRecipients(prefs);
  if (!recipients.length) return;

  const html = sections.map(t =>
    `<h3 style="margin:18px 0 6px;font-family:sans-serif">${TYPE_LABELS[t]}</h3>` +
    `<ul style="font-family:sans-serif;color:#334">${fresh[t].map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
  ).join('');
  const text = sections.map(t => `${TYPE_LABELS[t]}\n${fresh[t].map(l => ` - ${l}`).join('\n')}`).join('\n\n');

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      to: recipients,
      subject: 'Your CRM reminders',
      html: `<div style="max-width:560px"><h2 style="font-family:sans-serif">Reminders</h2>${html}</div>`,
      text,
    });
    logger.info({ sections, recipients: recipients.length }, '[reminders] digest sent');
  } catch (err) {
    logger.error({ err }, '[reminders] digest email failed');
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
    try { await runReminderScan(); }
    catch (err) { logger.error({ err }, '[reminders] scan failed'); }
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
