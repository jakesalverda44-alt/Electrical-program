-- Phase 2 Task 2: page-level classification inventory. Today a low-fidelity run
-- (poppler missing -> whole-PDF document-block fallback) is silent — one log line
-- nobody sees. Persisting the inventory + a fidelity flag on the takeoff makes a
-- low-fidelity run visible in the Plan Review UI instead ("Prep: 14 of 62 pages
-- sent (tiled+text)"), and gives a durable record of which pages were classified
-- into which discipline/class and whether they were actually sent to Agent 1.

ALTER TABLE takeoff_results
  ADD COLUMN IF NOT EXISTS prep_inventory JSONB,
  ADD COLUMN IF NOT EXISTS prep_fidelity TEXT;

ALTER TABLE takeoff_results DROP CONSTRAINT IF EXISTS takeoff_results_prep_fidelity_check;
ALTER TABLE takeoff_results ADD CONSTRAINT takeoff_results_prep_fidelity_check
  CHECK (prep_fidelity IS NULL OR prep_fidelity IN ('tiled+text', 'tiled', 'document-fallback'));
