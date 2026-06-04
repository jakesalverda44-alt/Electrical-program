-- Phase 2C+: lifecycle timestamps for electrical bids, to power the bid timeline.

ALTER TABLE bids ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS awarded_at   TIMESTAMPTZ;

-- Approximate historical timestamps from updated_at so existing bids aren't blank.
UPDATE bids SET awarded_at   = updated_at WHERE stage = 'awarded'   AND awarded_at   IS NULL;
UPDATE bids SET submitted_at = updated_at WHERE stage = 'submitted' AND submitted_at IS NULL;
