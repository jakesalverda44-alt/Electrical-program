-- 086_gen_initials.sql
-- Customer initials captured alongside the signature: the sales contract has
-- six CUST INIT ____ spots (plus the Exhibit A pages) that e-signing has
-- never filled. Nullable and separate from signature_data so a stale client
-- that still posts only a signature keeps working unchanged.
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS initials_data text;
