import { logger } from '../utils/logger';

export interface SiteVisitLead {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  site_visit_at: string | Date | null;
  salesperson_name: string | null;
}

/**
 * Create an Outlook calendar event for a lead's scheduled site visit.
 *
 * STUB — intentionally a no-op for now so the Site Scheduled handoff works without
 * calendar access. Wire this to Microsoft Graph (POST /me/events or
 * /users/{id}/calendar/events) to create the real event. Keep it isolated and
 * non-throwing: the handoff must succeed even if the calendar push fails.
 *
 * TODO(graph): build the Graph client (reuse GRAPH_* creds from email/leadFirstContact),
 * map site_visit_at -> event start/end, set subject/location/attendees, and create
 * the event. Until then this just logs intent.
 */
export async function pushSiteVisitToCalendar(lead: SiteVisitLead): Promise<void> {
  if (!lead.site_visit_at) return; // nothing scheduled yet ("no time yet")
  try {
    logger.info(
      { leadId: lead.id, siteVisitAt: lead.site_visit_at },
      '[calendar] pushSiteVisitToCalendar (stub) — would create an Outlook event'
    );
    // No-op until wired to Microsoft Graph.
  } catch (err) {
    logger.error({ err, leadId: lead.id }, '[calendar] pushSiteVisitToCalendar failed');
  }
}
