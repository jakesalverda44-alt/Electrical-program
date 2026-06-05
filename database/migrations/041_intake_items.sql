-- Intake inbox: incoming bid invitations awaiting accept/decline. Accepting
-- creates a bid; declining keeps the record (with a reason) for reporting.
CREATE TABLE IF NOT EXISTS intake_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  gc              TEXT,
  loc             TEXT,
  contact         TEXT,
  amount          NUMERIC(12,2),
  sheets          INT,
  due             TEXT,
  notes           TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',   -- manual | onedrive | email (future feeds)
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  decline_reason  TEXT,
  accepted_bid_id UUID,
  created_by      UUID REFERENCES users(id),
  created_by_name TEXT,
  accepted_at     TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_status_idx ON intake_items (status, created_at DESC);
