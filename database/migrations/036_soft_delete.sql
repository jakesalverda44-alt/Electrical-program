-- Soft delete: records are flagged with deleted_at instead of being destroyed,
-- so they can be restored from the admin Trash and remain available to the audit
-- trail. The hard-delete cascades are replaced by a soft flag in application code;
-- a "purge" action (admin-only) performs the real delete for trashed rows.
ALTER TABLE bids                ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE won_jobs            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes keep the common "active rows only" queries fast.
CREATE INDEX IF NOT EXISTS bids_active_idx      ON bids (created_at DESC)               WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS gens_active_idx      ON generator_proposals (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_active_idx ON documents (created_at DESC)          WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS wonjobs_active_idx   ON won_jobs (date_won DESC)             WHERE deleted_at IS NULL;
