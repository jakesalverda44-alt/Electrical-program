-- Evidence round 5.1 — every marker confirm/reject/move/reclass, review
-- resolution, crop-check decision and gap-fill acceptance, logged as
-- labeled data (client + project type tags) for a future accuracy model /
-- eval set. Append-only; nothing here is read back into the live pipeline —
-- it is training/analysis exhaust, never authoritative for a bid's own
-- numbers (count_result / est_bid_lines / review_items stay authoritative).
CREATE TABLE IF NOT EXISTS takeoff_labeled_events (
  id           BIGSERIAL PRIMARY KEY,
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  run_id       UUID,
  event_kind   TEXT NOT NULL, -- 'marker_update' | 'review_resolution' | 'crop_check' | 'gapfill_accept'
  type_key     TEXT,
  sheet_key    TEXT,
  client       TEXT,          -- the bid's brand, at the time of the event
  project_type TEXT,
  crop_ref     JSONB,         -- {sheetKey, rectIn} pointer — never image bytes
  detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS takeoff_labeled_events_bid_idx ON takeoff_labeled_events(bid_id);
CREATE INDEX IF NOT EXISTS takeoff_labeled_events_kind_idx ON takeoff_labeled_events(event_kind);
