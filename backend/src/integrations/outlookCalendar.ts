import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import { getGraphToken, GRAPH_BASE } from './graphAuth';

// Calendar that the site-visit events are created on. App-only Calendars.ReadWrite
// must be scoped to this mailbox via an Application Access Policy (same approach as
// the first-contact mailbox).
const CALENDAR_USER = 'JakeS@accuratepowerandtechnology.com';
const EVENT_TZ = 'America/New_York';
const VISIT_MINUTES = 30;

export interface SiteVisitLead {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  site_visit_at: string | Date | null;
  salesperson_name: string | null;
}

/**
 * Format an absolute instant as a Graph "dateTime" string (local wall-clock in
 * EVENT_TZ, no offset) to pair with timeZone: America/New_York. e.g. a visit picked
 * at 2:00 PM Eastern is stored as an instant and rendered back to "...T14:00:00".
 */
function toGraphDateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Resolve a due-date input to the literal calendar day (YYYY-MM-DD), no timezone math. The
 * Intake review sends an ISO date from a date picker ("2026-06-20"); we use those components
 * verbatim so an all-day event lands on exactly that day. Falls back to parsing other inputs
 * via the ET wall-clock. Returns null when the value isn't a real date.
 */
export function toCalendarDay(value: string | Date): string | null {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return toGraphDateTime(d).slice(0, 10);
}

/** YYYY-MM-DD one day after the given calendar day (string math, no timezone drift). */
export function nextCalendarDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Add a bid's due date to the calendar as an all-day event with a reminder 2 days before,
 * built from the bid's explicit due_date (not a date parsed out of the email). Used by the
 * Intake Inbox accept flow. Non-blocking: logs and swallows all errors so an accept never
 * fails because of the calendar. No-op only when dueDate is empty. Returns the event id.
 */
export async function pushBidDueToCalendar(
  bid: { id: string; name: string; gc: string | null; loc: string | null; source_email_link?: string | null },
  dueDate: string | Date | null,
): Promise<string | null> {
  if (!dueDate) return null;
  try {
    const dayStart = toCalendarDay(dueDate);
    if (!dayStart) {
      logger.warn({ bidId: bid.id, dueDate }, '[calendar] bid-due skipped — unparseable due date');
      return null;
    }
    const dayEnd = nextCalendarDay(dayStart);

    const bodyLines = [
      bid.gc ? `GC: ${bid.gc}` : null,
      bid.loc ? `Location: ${bid.loc}` : null,
      bid.source_email_link ? `Email: ${bid.source_email_link}` : null,
    ].filter(Boolean) as string[];

    const event = {
      subject: `Bid Due – ${bid.name}`,
      isAllDay: true,
      start: { dateTime: `${dayStart}T00:00:00`, timeZone: EVENT_TZ },
      end:   { dateTime: `${dayEnd}T00:00:00`,   timeZone: EVENT_TZ },
      location: { displayName: bid.loc || '' },
      body: { contentType: 'Text', content: bodyLines.join('\n') },
      isReminderOn: true,
      reminderMinutesBeforeStart: 2 * 24 * 60, // 2 days before
    };

    const token = await getGraphToken();
    const resp = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(CALENDAR_USER)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Graph bid-due event create failed: HTTP ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as { id: string };
    logger.info({ bidId: bid.id, eventId: json.id }, '[calendar] bid-due event created');
    return json.id;
  } catch (err) {
    logger.error({ err, bidId: bid.id }, '[calendar] pushBidDueToCalendar failed (accept not blocked)');
    return null;
  }
}

/**
 * Create (or update) an Outlook calendar event for a lead's scheduled site visit via
 * Microsoft Graph, using the same app-only client-credentials auth as the first-contact
 * email. The Graph event id is stored on the proposal so a re-run updates the same event
 * rather than creating a duplicate.
 *
 * Non-blocking: any failure (incl. missing GRAPH_* config) is logged and swallowed so
 * the Site Scheduled handoff always succeeds. No-op when there is no scheduled time yet.
 */
export async function pushSiteVisitToCalendar(proposalId: string, lead: SiteVisitLead): Promise<void> {
  if (!lead.site_visit_at) return; // "no time yet" — nothing to put on the calendar
  try {
    const start = new Date(lead.site_visit_at);
    if (isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + VISIT_MINUTES * 60 * 1000);

    const bodyLines = [
      lead.phone ? `Phone: ${lead.phone}` : null,
      lead.email ? `Email: ${lead.email}` : null,
      lead.notes ? `Notes: ${lead.notes}` : null,
    ].filter(Boolean) as string[];

    const event = {
      subject: `Site Visit – ${lead.name}`,
      start: { dateTime: toGraphDateTime(start), timeZone: EVENT_TZ },
      end:   { dateTime: toGraphDateTime(end),   timeZone: EVENT_TZ },
      location: { displayName: lead.address || '' },
      body: { contentType: 'Text', content: bodyLines.join('\n') },
      isReminderOn: true,
      reminderMinutesBeforeStart: 60,
    };

    // Re-run? Update the existing event; otherwise create a new one and store its id.
    const { rows } = await pool.query(
      'SELECT calendar_event_id FROM generator_proposals WHERE id=$1',
      [proposalId]
    );
    const existingId: string | null = rows[0]?.calendar_event_id ?? null;

    const token = await getGraphToken();
    const eventsUrl = `${GRAPH_BASE}/users/${encodeURIComponent(CALENDAR_USER)}/events`;
    const resp = await fetch(
      existingId ? `${eventsUrl}/${existingId}` : eventsUrl,
      {
        method: existingId ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Graph events ${existingId ? 'update' : 'create'} failed: HTTP ${resp.status} ${text}`);
    }

    if (existingId) {
      logger.info({ proposalId, eventId: existingId }, '[calendar] site-visit event updated');
    } else {
      const json = (await resp.json()) as { id: string };
      await pool.query(
        'UPDATE generator_proposals SET calendar_event_id=$1 WHERE id=$2',
        [json.id, proposalId]
      );
      logger.info({ proposalId, eventId: json.id }, '[calendar] site-visit event created');
    }
  } catch (err) {
    logger.error({ err, proposalId }, '[calendar] pushSiteVisitToCalendar failed (handoff not blocked)');
  }
}
