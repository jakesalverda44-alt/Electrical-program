-- Level 2 learning (docs/superpowers/plans/2026-09-30-fewer-questions.md,
-- addendum Tasks 9-16) — symbol examples captured from the estimator's own
-- corrections, approved lessons, and the releases that gate both. Insert-
-- only and idempotent. takeoff_labeled_events (migration 135) stays
-- write-only exhaust: nothing here reads it.
CREATE TABLE IF NOT EXISTS symbol_examples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop            BYTEA NOT NULL,                 -- grayscale PNG, 300 DPI, 1.2" square, symbol centred
  crop_sha256     TEXT NOT NULL,
  dhash           BIGINT NOT NULL,
  half_in         NUMERIC NOT NULL DEFAULT 0.6,
  polarity        TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
  meaning         JSONB NOT NULL,                 -- {label, description, category, deviceClass, meaningFp, statusMeaning?}
  confused_with   JSONB,                          -- negatives: what the AI wrongly called it
  not_a_device    BOOLEAN NOT NULL DEFAULT false,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('marker_create', 'marker_move', 'marker_confirm', 'marker_reclass', 'marker_delete', 'review_unlisted', 'review_statuscrop', 'review_pole_type')),
  source_ref      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {markupId?, itemId?, memberKey?, runId?}
  source_bid_id   UUID REFERENCES bids(id) ON DELETE SET NULL,
  source_doc_sha  TEXT,
  page_index      INT,
  sheet_label     TEXT,
  x_pt            NUMERIC,
  y_pt            NUMERIC,
  legend_quote    TEXT,
  account_rule_id TEXT,                           -- provenance only
  project_type    TEXT,                           -- provenance only
  quality         SMALLINT NOT NULL DEFAULT 1,
  verified_by     TEXT,
  status          TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'retired')),
  retired_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS symbol_examples_status_idx ON symbol_examples (status);
CREATE INDEX IF NOT EXISTS symbol_examples_class_idx ON symbol_examples ((meaning->>'deviceClass'));
CREATE INDEX IF NOT EXISTS symbol_examples_bid_idx ON symbol_examples (source_bid_id);
CREATE UNIQUE INDEX IF NOT EXISTS symbol_examples_source_crop_uq ON symbol_examples (source_kind, polarity, (source_ref->>'markupId'), (source_ref->>'memberKey'), crop_sha256);

CREATE TABLE IF NOT EXISTS symbol_example_captures (
  id          BIGSERIAL PRIMARY KEY,
  bid_id      UUID REFERENCES bids(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS symbol_example_captures_pending_idx ON symbol_example_captures (status, bid_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS counting_lessons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineage_id      UUID NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  text            TEXT NOT NULL CHECK (length(text) <= 300),
  applies_to      TEXT[] NOT NULL DEFAULT '{review}' CHECK (applies_to <@ ARRAY['counter', 'review']::text[]),
  scope_kind      TEXT NOT NULL DEFAULT 'all' CHECK (scope_kind IN ('all', 'project_type', 'account')),
  scope_value     TEXT,
  match           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {deviceClass?, meaningFp?, unlistedSymbolFp?, itemPrefix?}
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'dismissed', 'retired')),
  evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{bidId, bidName, itemId, answer, reason, at}]
  pattern         TEXT NOT NULL,
  suggested_scope JSONB,
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  UNIQUE (lineage_id, version)
);
CREATE INDEX IF NOT EXISTS counting_lessons_status_idx ON counting_lessons (status);

CREATE TABLE IF NOT EXISTS learning_releases (
  id           SERIAL PRIMARY KEY,
  example_ids  UUID[] NOT NULL DEFAULT '{}',
  lesson_ids   UUID[] NOT NULL DEFAULT '{}',
  eval         JSONB,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checking', 'passed', 'failed', 'rolled_back')),
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bid_learning_off (
  bid_id     UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  ref_kind   TEXT NOT NULL CHECK (ref_kind IN ('example', 'lesson', 'all')),
  ref_id     UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bid_learning_off_uq ON bid_learning_off (bid_id, ref_kind, COALESCE(ref_id, '00000000-0000-0000-0000-000000000000'::uuid));
