-- Fix Agent 4 config: bump max tokens and switch default model.
-- Haiku has an 8192-token output cap which isn't enough for large proposal JSON.
-- Sonnet supports up to 64K output tokens.

-- Update max tokens from old default of 4000 → 8000
INSERT INTO app_settings (key, value)
  VALUES ('ai_max_tokens_agent4', '8000')
  ON CONFLICT (key) DO UPDATE
    SET value = '8000'
    WHERE app_settings.value = '4000';

-- Switch default model from Haiku → Sonnet for Agent 4
INSERT INTO app_settings (key, value)
  VALUES ('ai_takeoff_agent4_model', 'claude-sonnet-4-6')
  ON CONFLICT (key) DO UPDATE
    SET value = 'claude-sonnet-4-6'
    WHERE app_settings.value IN ('claude-haiku-4-5-20251001', 'claude-haiku-4-5');
