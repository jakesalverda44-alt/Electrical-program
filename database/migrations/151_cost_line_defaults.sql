-- Remodel + footage round (docs/superpowers/plans/2026-09-29-remodel-footage-round.md),
-- Builder B, B4 — default Equipment / General Expenses lines.
--
-- auto_default: a line the server seeded from the rule and the estimator
-- hasn't edited yet; it follows the rule as the bid's hours change. Any
-- edit through the cost-line route clears it — from then on it is the
-- estimator's line and is never touched again.
ALTER TABLE est_bid_cost_lines ADD COLUMN IF NOT EXISTS auto_default BOOLEAN NOT NULL DEFAULT false;

-- One row per (bid, kind) the server ever seeded a default for, so a
-- default the estimator deleted is never seeded back.
CREATE TABLE IF NOT EXISTS est_bid_cost_line_seeds (
  bid_id     UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  seeded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bid_id, kind)
);
ALTER TABLE est_bid_cost_line_seeds DROP CONSTRAINT IF EXISTS est_bid_cost_line_seeds_kind_check;
ALTER TABLE est_bid_cost_line_seeds ADD CONSTRAINT est_bid_cost_line_seeds_kind_check
  CHECK (kind IN ('equipment', 'general_expense'));

-- The rule, fitted to Chris's 2025–26 breakdowns only (Jake's rule: pricing
-- defaults from 2025–2026 jobs — Kissimmee, Bubble Down, Gulf Simulator,
-- Seminole; backend/src/estimating/costLineDefaults.ts, re-fitted by
-- costLineDefaults.test.ts): equipment max($890 one scissor lift,
-- $7.30/labor hour); general expenses $270 up to 300 hours (permits only),
-- $2,500 above (permits + temp power/lighting). Editable in Settings >
-- Labor Library > Allowances. Insert-if-absent.
INSERT INTO app_settings (key, value)
SELECT 'est_cost_line_defaults', '{"version":1,"equipment":{"smallJobMaxHours":0,"smallJobAmount":0,"perHour":7.3,"minimum":890},"generalExpenses":{"smallJobMaxHours":300,"smallJobAmount":270,"perHour":0,"minimum":2500}}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_cost_line_defaults');
