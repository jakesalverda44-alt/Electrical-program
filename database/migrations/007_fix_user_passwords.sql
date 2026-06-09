-- (Retired) This migration previously reset the seed accounts
-- (jake@accuratepower.com / david@accuratepower.com) to a hardcoded bcrypt hash of
-- a known password. That credential has been removed from the repository for
-- security. Account bootstrap now happens in backend/src/migrate.ts using
-- SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the environment.
--
-- Left as an intentional no-op so the migration ledger (schema_migrations) stays
-- consistent on databases that already applied it. Rotate any real account
-- passwords that ever used the old default.
SELECT 1;
