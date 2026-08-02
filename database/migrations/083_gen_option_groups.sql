-- Link sibling generator proposals created as alternates of each other
-- (e.g. good/better/best or brand-A-vs-brand-B options via the Duplicate
-- action) so that awarding one can auto-close the others without counting
-- them as losses. group_id is NULL for proposals not created via Duplicate
-- (including two genuinely separate generator needs for the same customer,
-- which must stay independent and each count toward win rate on their own).

ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS group_id UUID;
CREATE INDEX IF NOT EXISTS idx_generator_proposals_group_id ON generator_proposals(group_id) WHERE group_id IS NOT NULL;

-- 'superseded' = an option in a group that lost out to a sibling that got
-- awarded. Distinct from 'declined' (a genuine loss) so win-rate math can
-- exclude it.
ALTER TABLE generator_proposals DROP CONSTRAINT IF EXISTS generator_proposals_stage_check;
ALTER TABLE generator_proposals ADD CONSTRAINT generator_proposals_stage_check
  CHECK (stage IN ('building', 'sent', 'signed', 'awarded', 'declined', 'superseded'));
