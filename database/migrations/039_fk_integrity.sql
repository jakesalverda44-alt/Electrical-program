-- Add referential integrity that was previously missing. Constraints are added
-- NOT VALID: existing rows are grandfathered (so the migration can't fail on
-- legacy data), but every new insert/update is enforced. The orphaned project_*
-- rows are backfilled with parents in 038, so in practice these are clean.

DO $$
BEGIN
  -- project_* children must point at a real project; cascade on project deletion.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pco_project_fk') THEN
    ALTER TABLE project_change_orders
      ADD CONSTRAINT pco_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pfn_project_fk') THEN
    ALTER TABLE project_field_notes
      ADD CONSTRAINT pfn_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prfi_project_fk') THEN
    ALTER TABLE project_rfis
      ADD CONSTRAINT prfi_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psec_project_fk') THEN
    ALTER TABLE project_sections
      ADD CONSTRAINT psec_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
  END IF;

  -- activity.user_id should reference a real user (added late, never constrained).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_user_fk') THEN
    ALTER TABLE activity
      ADD CONSTRAINT activity_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
