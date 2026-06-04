-- Keep generator install phases aligned with the current project Kanban keys.
ALTER TABLE generator_proposals
  ALTER COLUMN gen_install_phase SET DEFAULT 'deposit';

UPDATE generator_proposals SET gen_install_phase = 'deposit'      WHERE gen_install_phase = 'scheduled';
UPDATE generator_proposals SET gen_install_phase = 'engineering'  WHERE gen_install_phase = 'ordered';
UPDATE generator_proposals SET gen_install_phase = 'permitting'   WHERE gen_install_phase = 'delivered';
UPDATE generator_proposals SET gen_install_phase = 'installation' WHERE gen_install_phase = 'install';
UPDATE generator_proposals SET gen_install_phase = 'deposit'      WHERE gen_install_phase IS NULL;

-- A signed proposal remains in the sent proposal column; signed_at tracks the signature.
UPDATE generator_proposals
SET stage = 'sent'
WHERE stage = 'signed';

ALTER TABLE generator_proposals DROP CONSTRAINT IF EXISTS generator_proposals_stage_check;
ALTER TABLE generator_proposals ADD CONSTRAINT generator_proposals_stage_check
  CHECK (stage IN ('building','sent','awarded','declined'));
