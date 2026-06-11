-- 071_backfill_elec_contract_date_to_won.sql
--
-- The Electrical "Contract Date" (stored per project in project_sections) now drives the
-- sales month via won_jobs.date_won. Backfill awarded electrical jobs from any contract_date
-- already entered, so contracts that were back-dated before this wiring existed land in the
-- correct month on the Sales Dashboard.
--
-- project_sections.project_id is UUID; won_jobs.proposal_id is TEXT — cast to compare.
-- When the same project has a contract_date in more than one section, the most recently
-- updated one wins.

UPDATE won_jobs wj
   SET date_won = sub.cd
  FROM (
    SELECT DISTINCT ON (project_id)
           project_id, (data->>'contract_date')::date AS cd
      FROM project_sections
     WHERE project_type IN ('elec', 'electrical')
       AND data->>'contract_date' ~ '^\d{4}-\d{2}-\d{2}$'
     ORDER BY project_id, updated_at DESC
  ) sub
 WHERE sub.project_id::text = wj.proposal_id
   AND wj.proposal_type = 'Electrical'
   AND wj.deleted_at IS NULL;
