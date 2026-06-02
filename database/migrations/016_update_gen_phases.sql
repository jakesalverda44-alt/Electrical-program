-- Remap generator install phases to new Kanban column keys
UPDATE generator_proposals SET gen_install_phase = 'deposit'       WHERE gen_install_phase = 'scheduled';
UPDATE generator_proposals SET gen_install_phase = 'engineering'   WHERE gen_install_phase = 'ordered';
UPDATE generator_proposals SET gen_install_phase = 'permitting'    WHERE gen_install_phase = 'delivered';
UPDATE generator_proposals SET gen_install_phase = 'installation'  WHERE gen_install_phase = 'install';
-- 'startup' and 'complete' keep their values
