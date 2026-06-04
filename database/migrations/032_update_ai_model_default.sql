-- Move only the old seeded default to the current configurable pipeline default.
UPDATE app_settings
SET value = 'claude-sonnet-4-5'
WHERE key = 'ai_model'
  AND value = 'claude-sonnet-4-6';
