-- Fewer-questions round Task 6 (docs/superpowers/plans/2026-09-30-fewer-questions.md)
-- — remembered answers per account read the other bids of the same
-- (non-default) account rule: takeoff_results.account_terms->>'ruleId'.
-- Read-only lookup index; no data change.
CREATE INDEX IF NOT EXISTS takeoff_results_account_rule_idx ON takeoff_results ((account_terms->>'ruleId'));
