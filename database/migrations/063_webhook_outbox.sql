-- 063_webhook_outbox.sql
-- Durable delivery for outbound Zapier stage webhooks. Rows are enqueued at the
-- trigger point (lead created / stage changed) with a point-in-time payload
-- snapshot, then delivered by the in-process dispatcher with exponential backoff.
-- The target URL is NOT stored — it is resolved from env at delivery time so a
-- rotated Zapier hook URL also applies to pending retries.

CREATE TABLE IF NOT EXISTS webhook_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  stage           TEXT NOT NULL,
  contact_method  TEXT NOT NULL DEFAULT 'any',
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','delivered','failed')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

-- The dispatcher's claim query: pending rows that are due.
CREATE INDEX IF NOT EXISTS webhook_outbox_due_idx
  ON webhook_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS webhook_outbox_lead_idx ON webhook_outbox (lead_id);
