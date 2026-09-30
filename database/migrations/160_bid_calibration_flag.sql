-- Accuracy round (docs/superpowers/plans/2026-09-30-accuracy-round.md),
-- Builder P — Jake's decision 4: a per-bid "Calibration job" flag. A
-- calibration bid (an old, already-submitted job re-run to measure the
-- estimator against Chris's real numbers) gets the generated / allowance /
-- default rows a bid still being estimated gets (box / fitting / hardware
-- allowance, feeder and site estimates, default equipment / GE lines),
-- whatever its stage. Default false: every existing bid is unchanged.
ALTER TABLE bids ADD COLUMN IF NOT EXISTS calibration BOOLEAN NOT NULL DEFAULT false;
