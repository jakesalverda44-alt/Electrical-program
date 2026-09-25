-- Bid Overview plans upload + job profile (2026-09-24 plan). New bid card
-- fields the job-profile extractor can fill/suggest, plus the per-bid
-- profile record: the last extraction's fields (each with sheet + quote
-- evidence), the current suggestion state (pending/accepted/ignored, so a
-- re-run doesn't re-nag about a value the user already dismissed), the
-- sheet-check one-liner shown on Overview, and what it cost to produce.
--
-- name/gc are NEVER written by this table's consumer: gc is never touched
-- from plans at all, and name is only ever a suggestion, never auto-applied
-- — see backend/src/estimating/jobProfileCardRules.ts.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS prototype     TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS plan_date     DATE;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS owner_name    TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS architect     TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS engineer      TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS store_number  TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS build_type    TEXT
  CHECK (build_type IS NULL OR build_type IN ('new', 'remodel', 'tenant'));

CREATE TABLE IF NOT EXISTS bid_job_profile (
  bid_id         UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  -- The sorted ids of the plan documents this profile was read from (NOT the
  -- sheet check's content-hash input_key — see migration 142's comment).
  input_key      TEXT,
  -- { [field]: { value, sheet, quote, confidence } } — the extractor's own
  -- output, kept even for fields that were empty-filled or left alone
  -- because the card already agreed, so the panel can always show "what the
  -- plans say" next to "what the card says".
  profile        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { [field]: { value, sheet, quote, status: 'pending'|'accepted'|'ignored', at, by } }
  -- — only fields where the card's current value differs from the plans'.
  suggestions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The Overview one-liner ("N sheets in set · N electrical · N missing refs").
  sheet_summary  JSONB,
  model          TEXT,
  cost_cents     NUMERIC(8,4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
