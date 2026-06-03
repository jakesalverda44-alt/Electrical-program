CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Seed default email settings (blank until configured)
INSERT INTO app_settings (key, value) VALUES
  ('email_resend_api_key',  ''),
  ('email_from_address',    'proposals@accuratepowerandtechnology.com'),
  ('email_from_name',       'Accurate Power & Technology'),
  ('email_reply_to',        'jakes@accuratepowerandtechnology.com'),
  ('frontend_url',          '')
ON CONFLICT (key) DO NOTHING;
