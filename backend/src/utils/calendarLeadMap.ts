import type { EventAttendee, EventDetail } from '../integrations/outlookCalendar';

// The mailbox every appointment lives on. Attendees on this domain are us (the rep who
// booked the visit, or anyone else on our team CC'd on the invite), not the customer —
// so the first attendee from any OTHER domain is the actual point of contact.
const INTERNAL_DOMAIN = 'accuratepowerandtechnology.com';

// What POST /api/leads/from-calendar-event needs out of an Outlook event. A subset of
// EventDetail (plus `start`, which fetchEventDetail also returns) so this file has no
// runtime dependency on Graph — only a type import, which disappears at compile time.
export type CalendarEventSource = Pick<EventDetail, 'subject' | 'location' | 'attendees' | 'bodyText' | 'start'>;

export interface CallerInfo {
  id: string;
  name: string;
}

export interface MappedLeadFields {
  name: string;
  address: string | null;
  email: string | null;
  notes: string | null;
  site_visit_at: string | null;
  stage: 'site-scheduled';
  source: 'other';
  salesperson_id: string;
  salesperson_name: string;
  outlook_event_id: string;
}

/**
 * First attendee whose email domain isn't ours. An attendee with no email at all
 * (name-only — a common shape for a contact added by hand rather than picked from
 * the address book) still counts as external: an empty domain is never our domain.
 */
function pickExternalAttendee(attendees: EventAttendee[]): EventAttendee | null {
  for (const a of attendees) {
    const domain = a.email.split('@')[1]?.toLowerCase();
    if (domain !== INTERNAL_DOMAIN) return a;
  }
  return null;
}

function todayLabel(now: Date): string {
  return now.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
  });
}

/**
 * Names below deliberately avoid the words "Site Survey": the survey wizard's header
 * already renders "Site Survey — {lead name}", so a lead called "Site Survey — Aug 3"
 * reads as "SITE SURVEY — SITE SURVEY — AUG 3" once it's open.
 */

/** "Walk-up — Aug 3, 2026" — a from-scratch survey with no appointment behind it. */
export function walkUpLeadName(now: Date = new Date()): string {
  return `Walk-up — ${todayLabel(now)}`;
}

/** "Untitled appointment — Aug 3, 2026" — an event that had no subject to borrow. */
export function untitledEventLeadName(now: Date = new Date()): string {
  return `Untitled appointment — ${todayLabel(now)}`;
}

/**
 * Plain, LLM-free mapping from a calendar appointment to the fields
 * POST /api/leads/from-calendar-event inserts. No Graph calls, no database — pure so
 * it can be unit-tested directly, and fast/reliable so it never fails on a weak
 * connection (the whole point of this entry point). The rep corrects anything wrong
 * inside the survey wizard, where they are already typing, so this never needs to be
 * smart about it.
 */
export function mapCalendarEventToLead(
  event: CalendarEventSource,
  eventId: string,
  caller: CallerInfo,
): MappedLeadFields {
  const attendee = pickExternalAttendee(event.attendees);
  const attendeeLine = attendee?.name ? `Contact: ${attendee.name}` : null;
  const notes = [attendeeLine, event.bodyText].filter(Boolean).join('\n') || null;

  return {
    name: event.subject?.trim() || untitledEventLeadName(),
    address: event.location || null,
    email: attendee?.email || null,
    notes,
    site_visit_at: event.start,
    stage: 'site-scheduled',
    source: 'other',
    salesperson_id: caller.id,
    salesperson_name: caller.name,
    outlook_event_id: eventId,
  };
}
