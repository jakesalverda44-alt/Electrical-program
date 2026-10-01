-- Gap-closing fix round 1 (review B1). A bid that is no longer being estimated prices against the library
-- as it was when it LEFT estimating. submitted_at is set once (COALESCE) and never reset, so a bid that was
-- moved back to Due for an addendum and re-submitted priced against its FIRST submission's library; a
-- due -> lost bid fell back to updated_at, which drifts on every later edit. priced_as_of is stamped on every
-- transition out of an estimating stage and when the Calibration flag is turned off (bidStage.ts, PATCH /bids/:id).
-- submitted_at stays for the timeline and win-rate figures.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS priced_as_of TIMESTAMPTZ;

-- Backfill (the transition history is not stored): every bid that is not in Due gets its submission time,
-- else its last update at migration time (a fixed date from here on). Due bids stay NULL (they price live).
UPDATE bids
   SET priced_as_of = COALESCE(submitted_at, updated_at, now())
 WHERE priced_as_of IS NULL
   AND stage <> 'due';
