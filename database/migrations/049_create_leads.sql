-- Generator lead pipeline: tracks inbound leads from first contact through
-- won/lost, with optional link to a generator proposal once one is built.

CREATE TABLE leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  address          TEXT,
  source           TEXT NOT NULL DEFAULT 'phone'
                     CHECK (source IN ('web','phone','referral','kohler','other')),
  contact_method   TEXT NOT NULL DEFAULT 'phone'
                     CHECK (contact_method IN ('email','phone')),
  interest_level   TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (interest_level IN ('unknown','warm','hot','not-interested')),
  stage            TEXT NOT NULL DEFAULT 'new'
                     CHECK (stage IN ('new','contacted','vetting','quoted',
                                      'site-scheduled','site-complete',
                                      'proposal-sent','won','lost')),
  notes            TEXT,
  site_notes       TEXT,
  quoted_range     TEXT,
  follow_up_date   DATE,
  linked_gen_id    UUID REFERENCES generator_proposals(id) ON DELETE SET NULL,
  salesperson_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  salesperson_name TEXT,
  deleted_at       TIMESTAMPTZ
);

-- Per-lead activity/timeline: stage changes, call logs, webhook results.
CREATE TABLE lead_activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL, -- 'stage_change' | 'note' | 'call' | 'webhook_ok' | 'webhook_fail'
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leads_salesperson_id_idx ON leads (salesperson_id);
CREATE INDEX leads_stage_idx          ON leads (stage);
CREATE INDEX lead_activity_lead_id_idx ON lead_activity (lead_id);
