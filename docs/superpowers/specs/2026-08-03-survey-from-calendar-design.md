# Site Survey from an Outlook Appointment

**Date:** 2026-08-03
**Status:** Approved, ready for implementation

## Problem

A rep standing at a site can only run the Site Survey wizard against a lead that already
exists in the CRM. Appointments frequently live in Outlook and nowhere else — the lead was
never entered. Today the rep has to create a lead by hand, on a phone, before they can
start the survey, so the survey either gets skipped or gets typed up later from memory.

## What already exists

- `backend/src/integrations/outlookCalendar.ts` — app-only Microsoft Graph access against
  `JakeS@accuratepowerandtechnology.com`. `Calendars.ReadWrite` is already scoped to that
  mailbox by an Application Access Policy.
  - `fetchUpcomingEvents(daysForward, daysBack)` returns events with attendees.
  - `fetchEventDetail(eventId)` returns subject, location, attendees, and plain-text body.
- `GET /api/gens/calendar-events` and `POST /api/gens/from-calendar-event` — an existing
  path that turns an appointment into a **generator proposal** via AI extraction, reached
  from the Gen Pipeline page.
- `frontend/src/features/leads/LeadSiteSurvey.tsx` — the 9-step survey wizard. Already
  standalone: it takes `lead`, `onUpdated`, `onBuildProposal`, `onClose` and owns its own
  debounced autosave and save-error banner.
- `POST /api/leads/:id/create-gen` — survey answers to a prefilled proposal.
- The Home brief already carries `todayEvents` to the frontend.

## Gap

Nothing turns a calendar appointment into a **lead**, and the survey has no entry point
that a field rep would reach on a phone.

## Design

### Backend

**Migration `085_lead_outlook_event.sql`**

```sql
ALTER TABLE leads ADD COLUMN outlook_event_id text;
CREATE UNIQUE INDEX leads_outlook_event_id_key
  ON leads (outlook_event_id) WHERE outlook_event_id IS NOT NULL;
```

Mirrors the existing `leads_external_lead_id_key` partial-unique pattern. This column is
the dedupe key.

**`GET /api/calendar/events`** — new `backend/src/routes/calendar.ts`, mounted at
`/api/calendar`, `requireAuth`.

Returns `fetchUpcomingEvents(7, 7)` with one added field per event:

```ts
{ ...event, linkedLeadId: string | null }
```

resolved by a single `SELECT id, outlook_event_id FROM leads WHERE outlook_event_id = ANY($1)
AND deleted_at IS NULL` over the returned event ids. `/gens/calendar-events` is left
untouched — this is a second, neutral route, not a migration of the first.

**`POST /api/leads/from-calendar-event`** — in `routes/leads.ts`, `requireAuth`, body
`{ eventId: string }`, response `{ lead: Lead, created: boolean }`.

1. Look up an existing non-deleted lead by `outlook_event_id`. If found, return it with
   `created: false` and insert nothing.
2. Otherwise `fetchEventDetail(eventId)`; 404 if the event does not exist.
3. Map plainly — **no LLM on this path**:

| Outlook | Lead column | Note |
|---|---|---|
| `subject` | `name` | falls back to `Untitled appointment — {date}` when blank |
| `location` | `address` | |
| first attendee whose email domain is not `accuratepowerandtechnology.com` | `email` | that attendee's display name goes into `notes`, since `leads` has no contact-name column |
| `bodyText` | `notes` | appended after the attendee line |
| event `start` | `site_visit_at` | |
| — | `stage` | `'site-scheduled'` — the visit is on the calendar |
| — | `source` | `'other'` — the only value the `leads_source_check` constraint allows for this path |
| — | `salesperson_id` / `salesperson_name` | the authenticated caller |
| `eventId` | `outlook_event_id` | |

Plain mapping is deliberate: it returns instantly and cannot fail on a weak connection,
which is the situation this feature exists for. The rep corrects anything wrong inside the
survey, where they are already typing.

**`POST /api/leads/blank-survey`** — creates a lead named `Walk-up — {today}` with
`stage: 'new'`, `source: 'other'`, and the caller as salesperson. Backs the walk-up case
where there is no appointment at all.

Neither fallback name may begin with "Site Survey". The wizard header renders
`Site Survey — {lead name}`, so such a name renders as
"SITE SURVEY — SITE SURVEY — AUG 3, 2026" the moment the survey opens.

### Frontend

**`features/leads/SurveyFromCalendarModal.tsx`** (new)

Full-screen on mobile, centered card on desktop. Fetches `GET /api/calendar/events` on
open. Each event is a large tappable row: subject, formatted time, location. Events with a
`linkedLeadId` render a "Survey started" badge and reopen that lead rather than creating a
second one. A footer button — **No appointment — blank survey** — hits
`POST /api/leads/blank-survey`.

Empty and error states both render the footer button, so a Graph outage never blocks a
survey.

**Home (`CommandCenterPage.tsx`)**

One primary action, `Start Site Survey`, below the hero and above "Needs action", sized as
a real thumb target on mobile. Tapping opens the modal.

On pick, the returned lead is held in Home state and `LeadSiteSurvey` mounts directly on
it. `onBuildProposal` calls `POST /api/leads/:id/create-gen` and hands the new proposal to
an `onEditGen` prop — the same `g => { setEditGen(g); setView('builder') }` handler `App`
already passes to the leads hub — so the rep lands in the builder with the proposal
loaded rather than on a list.

**Mobile z-index.** `.overlay` sits at z-index 150 and `.mobile-nav` at 200, so on a phone
the fixed bottom nav covered the bottom 64px of every centered modal and silently
swallowed taps there — the picker's footer button lands exactly in that band. The ≤768px
block raises `.overlay` to 240, matching what `.drawer-overlay` already does. This fixes
every modal in the app, not just this one.

### Data flow

```
Home → SurveyFromCalendarModal
     → POST /api/leads/from-calendar-event  (or /blank-survey)
     → LeadSiteSurvey (existing autosave to leads.survey_data)
     → POST /api/leads/:id/create-gen → builder
```

### Failure modes

- Graph unreachable — `fetchUpcomingEvents` already returns `[]` on failure, so the list is
  empty and the blank-survey path still works.
- Duplicate tap or two reps on one visit — the partial unique index plus the pre-check
  means the same lead comes back both times.
- Connection drops mid-survey — the wizard's existing save-error banner covers it. No new
  behavior.

### Tests

Backend:
- attendee selection skips internal domains, picks the first external one
- missing location, missing body, all-day event, blank subject all map without throwing
- second call with the same `eventId` returns the first lead and inserts nothing
- both routes reject unauthenticated callers

Frontend:
- modal lists events and renders the "Survey started" badge only for linked ones
- blank-survey footer button is present in the empty state

## Out of scope

- AI extraction on this path. `/gens/from-calendar-event` keeps its LLM flow; this one
  stays plain.
- Writing anything back to Outlook.
- Two-way calendar sync.
- Any calendar UI beyond this picker. `CalendarPage` is untouched.
