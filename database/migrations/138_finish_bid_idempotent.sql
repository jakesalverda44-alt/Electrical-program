-- Fix round N4 — finish-bid idempotency: one eval case per (bid, run,
-- source). Evidence fix round 3 (migration nit): the unique index moved to
-- 139, which first removes duplicate rows a pre-merge dev database may hold
-- (creating the index here failed on such a database). Databases that
-- already ran this file have the index; 139 is then a no-op for them.
SELECT 1;
