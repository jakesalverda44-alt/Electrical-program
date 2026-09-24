-- Next round A4 — the supplement pass (a referenced sheet uploaded after the run is
-- analysed and counted into the same run): what was added, by whom, and a
-- failure message (the run is put back as it was when a supplement fails).
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS supplement JSONB;
