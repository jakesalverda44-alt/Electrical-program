-- Takeoff accuracy fix round 1 / S8 — "7-11 #41234" / "711" bids got the
-- Default rule (Southern Lighting, APT-furnished fixtures). Add the aliases
-- to the seeded 7-Eleven rule (an estimator's own edit of the list is kept).
UPDATE account_rules
   SET match_aliases = match_aliases || ARRAY['7-11', '711']
 WHERE name = '7-Eleven' AND NOT ('7-11' = ANY(match_aliases));
