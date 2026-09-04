-- Audit batch 3, Task 2 (audit-data-perf.md #2, #17) — notifications regenerate
-- every day a follow-up/bid/lead stays open (dedup key included the calendar
-- day) and are never purged. The application-level fix (dedup keys without
-- the day, retention windows in purgeExpired) ships alongside this migration
-- in the same commit; this file does the two things only a migration can do:
-- add the supporting index, and collapse the duplicate rows the bug already
-- produced.

-- Index the retention job's own WHERE clause (created_at) and any future
-- "notifications since X" query.
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at);

-- One-time cleanup of the existing flood: for the three reminder types whose
-- dedup key used to include the day (followup_due, lead_overdue,
-- bid_due_soon — "biddue" in the old key text), collapse every group of rows
-- sharing the same (type, link_id, user_id) down to the single newest row.
-- link_id is the source record's id and user_id is the notified user, so this
-- reconstructs "duplicates of the same (type, record, user)" without having
-- to parse the old dedup_key text at all. Idempotent: once no group has more
-- than one row, a second run's ranked CTE has nothing with rn > 1, so the
-- DELETE affects zero rows.
DO $$
DECLARE
  deleted_count int;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY type, link_id, user_id
             ORDER BY created_at DESC, id DESC
           ) AS rn
      FROM notifications
     WHERE type IN ('followup_due', 'lead_overdue', 'bid_due_soon')
       AND link_id IS NOT NULL
       AND user_id IS NOT NULL
  ),
  removed AS (
    DELETE FROM notifications
     WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
     RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM removed;
  RAISE NOTICE 'notifications retention cleanup (096): deleted % duplicate followup_due/lead_overdue/bid_due_soon rows', deleted_count;
END $$;
