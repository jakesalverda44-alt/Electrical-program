-- 064_takeoff_heartbeat.sql
-- Liveness marker for the in-process AI pipeline. The worker stamps this every
-- 15s while a pipeline (agents 1-3) or Agent 4 run is in flight. Startup/periodic
-- recovery only touches rows whose heartbeat has gone stale, so an overlapping
-- instance (Render zero-downtime deploy) never double-runs an active analysis.
ALTER TABLE takeoff_results
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ;
