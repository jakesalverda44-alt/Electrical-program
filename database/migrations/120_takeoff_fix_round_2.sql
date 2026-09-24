-- Takeoff accuracy, fix round 2 (review 2026-09-23, "Round 2").
--
-- S-R2-5 — an estimator override binds to the exact line AND the flag it was
-- made for ('non_electrical', 'excluded_scope', 'spec', 'count_line:<KEY>').
ALTER TABLE bid_scope_items ADD COLUMN IF NOT EXISTS flag_code TEXT;

-- R2-B1 — every filed GC document / pre-bid package carries the hash of the
-- inputs it was composed from; sending refuses a file whose inputs changed.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS compose_inputs_hash TEXT;

-- R2-B3 — the bare "711" alias (migration 119) matched store numbers,
-- street numbers and suites. Keep the word forms only.
UPDATE account_rules
   SET match_aliases = array_remove(match_aliases, '711')
 WHERE name = '7-Eleven';
