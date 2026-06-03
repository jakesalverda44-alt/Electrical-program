-- New bid email notification settings
INSERT INTO app_settings (key, value) VALUES
  ('bid_notify_enabled', 'true'),
  ('bid_notify_emails',  '[]')
ON CONFLICT (key) DO NOTHING;
