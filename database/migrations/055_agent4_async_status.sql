-- Add async-run tracking columns for Agent 4 (Proposal Formatter).
-- agent4_status: null | 'running' | 'complete' | 'error'
-- agent4_error:  error message when agent4_status = 'error'
ALTER TABLE takeoff_results
  ADD COLUMN IF NOT EXISTS agent4_status TEXT,
  ADD COLUMN IF NOT EXISTS agent4_error  TEXT;
