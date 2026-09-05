-- Audit batch 4, Task 2 (audit ux #5) — Undo on deletes.
--
-- The three soft-delete restore routes (bids, generator_proposals, documents)
-- were requireAdmin-only. To offer a toast "Undo" to whoever just deleted the
-- row (not just an admin) without handing out blanket admin rights, the
-- restore route needs to know who deleted it. None of the three tables
-- tracked that, so this adds it alongside the existing deleted_at.
ALTER TABLE bids                ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
ALTER TABLE documents           ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);
