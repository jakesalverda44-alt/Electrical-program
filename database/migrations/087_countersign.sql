-- 087_countersign.sql
-- Countersigning a signed proposal: APT's own signature on file, plus the stamp
-- of when/who applied it. signature_data on users is the reusable saved
-- signature a rep draws once in Settings; countersignature_data on the proposal
-- is a copy taken at countersign time (not a reference to the user row), so a
-- rep re-saving their signature later can never silently alter an
-- already-executed contract.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_data text;

ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersigned_at   timestamptz;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersignature_data text;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersigned_by   uuid REFERENCES users(id);
