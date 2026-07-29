# Award Kickoff Modal — Design

**Date:** 2026-07-29
**Status:** Approved

## Problem

Moving a gen proposal to `awarded` fires the kickoff email draft immediately (fire-and-forget in `PATCH /stage`), usually before the signed proposal, sizer, survey, or site checklist exist. The team receives a skeleton email; the user re-drafts later and duplicate drafts pile up in Outlook. There is no prompt to upload the signed proposal at award time and no visibility into which kickoff documents exist.

## Decisions (user-confirmed)

- Kickoff email drafts only via an **explicit button** in a new Award Kickoff modal. Auto-draft on stage transition is removed.
- Signed proposals arrive as a **mix** of e-sign (auto-stored `contract` doc via `/p/:token`) and paper/external. The modal always shows the signed-proposal slot, marked done when the e-sign doc already exists.
- Drafting requires the **signed proposal (`contract` doc) at minimum**; other docs optional, with a "To follow" list in the email body.
- Site checklist and survey work stays in their existing drawer tabs; the modal only shows status and **links to those tabs** (light modal, not a wizard).

## Flow

Any award trigger (drawer stage button, pipeline board drag) → stage PATCH runs as today (won_job insert, activity, audit) minus the auto-draft → the Gen Detail Drawer opens (if not already open) with the **Award Kickoff modal** displayed over it.

## Modal contents (single screen)

1. **Doc checklist** — five rows with have/missing status: Signed proposal (`contract`), Sizer report (`sizer_report`), Survey (`survey`), Labeled survey (`labeled_survey`), Site checklist (`site_checklist`). Status derives from the documents list; checklist/survey rows also show an "in progress" state when `checklist_data` / `survey_markup` JSONB exists but no finalized doc does.
2. **Signed proposal slot** — DocSlot with `category='contract'`, always visible. Shows "signed via e-sign" note when the contract doc was auto-stored by the public signing flow. Accepts PDF/image upload.
3. **Sizer slot** — existing DocSlot behavior, `category='sizer_report'`.
4. **Survey and Checklist rows** — status plus an "Open tab" button that closes the modal and activates that drawer tab.
5. **Footer** — "Draft kickoff email" button (disabled until a `contract` doc exists, with tooltip explaining why) calling `POST /gens/:id/kickoff-email`, and a "Later" dismiss button. Button label becomes "Re-draft kickoff email" once `kickoff_email_drafted_at` is set.

## Re-entry

When the gen is awarded, the Overview tab gains a **Kickoff section**: doc status chips, drafted-at stamp, and an "Open kickoff" button that reopens the modal. Replaces the bare "Draft Kickoff Email" button.

## Backend changes (`backend/src/routes/gens.ts`)

- Remove the `draftAwardKickoffEmail` fire-and-forget call from the `awarded` transition in `PATCH /stage`.
- `POST /kickoff-email`:
  - Returns 400 when no `contract` document exists for the gen.
  - Adds a "To follow:" line to the email body listing missing categories among sizer_report / survey / labeled_survey / site_checklist.
  - On success, stamps `generator_proposals.kickoff_email_drafted_at = now()`.
  - Re-drafting stays allowed (no dedup block).
- New migration `081_kickoff_email_drafted.sql`: adds nullable `kickoff_email_drafted_at timestamptz` to `generator_proposals`.

## Edge cases

- Board-drag award while the drawer is closed → open the drawer for that gen with the modal shown.
- Award → lost → awarded again → modal reopens; `kickoff_email_drafted_at` is preserved (button reads "Re-draft").
- E-sign lands after a manual contract upload → existing idempotent check in the public proposal-pdf route already skips the duplicate.
- Modal dismissed with "Later" → no nag; re-entry via the Overview Kickoff section.

## Testing

- Backend route tests: 400 when contract missing; stamp set on success; "To follow" line lists exactly the missing categories; stage PATCH no longer drafts.
- Frontend builds green; manual smoke via `./crm.sh up` (award a seeded gen, verify modal, upload contract, draft).

## Out of scope

- Full wizard embedding checklist/survey editors in the modal.
- "Pull from Sizer" checklist autofill (previously discussed, still not built).
- Any change to email recipients logic or the public signing flow.
