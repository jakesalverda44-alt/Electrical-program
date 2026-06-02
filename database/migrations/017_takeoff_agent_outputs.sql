-- Add columns for 3-agent pipeline outputs
ALTER TABLE takeoff_results
  ADD COLUMN IF NOT EXISTS agent1_output TEXT,
  ADD COLUMN IF NOT EXISTS agent2_output TEXT,
  ADD COLUMN IF NOT EXISTS agent3_output TEXT;
