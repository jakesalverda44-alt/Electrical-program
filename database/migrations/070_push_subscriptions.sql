-- 070_push_subscriptions.sql
--
-- Web Push (PWA) subscriptions. Each row is one browser/device a user has opted in on.
-- The endpoint is the push service URL and is globally unique, so a device that
-- re-subscribes upserts rather than duplicating. Dead endpoints (404/410 from the push
-- service) are pruned automatically when a send fails.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
