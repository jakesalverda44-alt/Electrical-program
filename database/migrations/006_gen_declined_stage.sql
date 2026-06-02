-- Add 'declined' stage to generator_proposals so rejected quotes are tracked
ALTER TABLE generator_proposals DROP CONSTRAINT IF EXISTS generator_proposals_stage_check;
ALTER TABLE generator_proposals ADD CONSTRAINT generator_proposals_stage_check
  CHECK (stage IN ('building','sent','awarded','declined'));
