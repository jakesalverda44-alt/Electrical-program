-- 072_ai_feature_models.sql
--
-- Make the model for two standalone AI features configurable from Settings → AI:
--   ai_reply_draft_model      — Command Center "AI draft reply" (default Opus, highest quality)
--   ai_build_from_notes_model — Build Proposal from Notes (default Haiku, fast/cheap)
-- Defaults match the values previously hardcoded, so behavior is unchanged until edited.

INSERT INTO app_settings (key, value) VALUES
  ('ai_reply_draft_model', 'claude-opus-4-8'),
  ('ai_build_from_notes_model', 'claude-haiku-4-5-20251001')
ON CONFLICT (key) DO NOTHING;
