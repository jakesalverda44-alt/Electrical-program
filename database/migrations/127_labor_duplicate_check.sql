-- Next round A7 — the blocking duplicate check in Labor & Pricing. A line
-- kept from the previous run that sync could not re-bind (recheck_reason)
-- next to a fresh takeoff line for the same fixture/device is a possible
-- double count; the estimator resolves it (remove one, or keep both with a
-- reason). dup_ok records "different items — keep both":
-- {"with": [<new line's line_key>, ...], "reason": "...", "by": "...", "at": "..."}.
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS dup_ok JSONB;
