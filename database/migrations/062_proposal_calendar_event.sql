-- 062_proposal_calendar_event.sql
-- Stores the Microsoft Graph calendar event id for a proposal's site visit so the
-- handoff can update the same Outlook event on re-run instead of creating duplicates.
ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
