-- Expand users table with additional fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS job_title  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Drop old role constraint and add expanded one
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'owner','administrator','sales_manager','salesperson','estimator',
  'project_manager','technician','accounting','read_only'
));

-- Add status constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active','inactive'));

-- Seed company profile defaults in app_settings
INSERT INTO app_settings (key, value) VALUES
  ('company_name',        'Accurate Power & Technology'),
  ('company_address',     ''),
  ('company_city',        ''),
  ('company_state',       'FL'),
  ('company_zip',         ''),
  ('company_phone',       ''),
  ('company_email',       ''),
  ('company_website',     ''),
  ('company_license_ec',  'EC13007737'),
  ('company_license_cfc', 'CFC1430965'),
  ('company_license_li',  'LI45063'),
  ('gen_default_labor',   '3000'),
  ('gen_default_permit',  '1250'),
  ('gen_default_startup', '695'),
  ('gen_default_tax_rate','7'),
  ('gen_default_pad',     '485'),
  ('gen_default_smm',     '250'),
  ('gen_default_surge_pro','395'),
  ('gen_default_battery', '185'),
  ('gen_default_extra_wire','25'),
  ('gen_default_lull',    '1100'),
  ('gen_default_crane',   '1800'),
  ('gen_pricing_table',   ''),
  ('ai_anthropic_key',    ''),
  ('ai_model',            'claude-sonnet-4-6'),
  ('ai_max_tokens',       '4096'),
  ('ai_temperature',      '0.3'),
  ('notifications_json',  '{}'),
  ('security_session_timeout', '480')
ON CONFLICT (key) DO NOTHING;
