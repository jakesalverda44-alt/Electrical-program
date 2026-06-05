-- Commissions: a flat percentage of contract value, earned when a proposal is
-- awarded/signed. Rate is configurable in Settings. Amounts live on won_jobs.
INSERT INTO app_settings (key, value) VALUES ('commission_default_rate', '3')
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE won_jobs
  ADD COLUMN IF NOT EXISTS commission_rate      NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS commission_amount    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS commission_status    TEXT NOT NULL DEFAULT 'earned' CHECK (commission_status IN ('earned','paid')),
  ADD COLUMN IF NOT EXISTS commission_earned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS commission_paid_at   TIMESTAMPTZ;

-- Backfill existing won jobs at the configured default rate.
UPDATE won_jobs
SET commission_rate   = (SELECT value::numeric FROM app_settings WHERE key = 'commission_default_rate'),
    commission_amount = ROUND(COALESCE(value, 0) * (SELECT value::numeric FROM app_settings WHERE key = 'commission_default_rate') / 100, 2),
    commission_earned_at = COALESCE(commission_earned_at, date_won::timestamptz, created_at)
WHERE commission_amount IS NULL;
