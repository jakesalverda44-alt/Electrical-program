-- Pre-bid package: the Cowork scope + quantity takeoff produced when a bid invite is
-- accepted, before any pricing exists. Pre-bid takeoffs are the comparison corpus, so a
-- later "Import Finished Bid" must not overwrite them — hence a kind discriminator
-- rather than reusing the single-row-per-bid shape from 078.

ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'final';
ALTER TABLE bid_takeoffs DROP CONSTRAINT IF EXISTS bid_takeoffs_kind_check;
ALTER TABLE bid_takeoffs ADD CONSTRAINT bid_takeoffs_kind_check
  CHECK (kind IN ('prebid','final'));

-- Existing rows are all finished-bid imports and default to 'final', so widening the
-- key changes no data.
ALTER TABLE bid_takeoffs DROP CONSTRAINT IF EXISTS bid_takeoffs_pkey;
ALTER TABLE bid_takeoffs ADD PRIMARY KEY (bid_id, kind);

-- Trailing "LEGEND & KEY FINDINGS" narrative from the pre-bid workbook: confidence key,
-- counting methodology, and sheets that were not in the reviewed set.
ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS key_findings JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS bid_prebid_scope (
  bid_id                UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  meta                  JSONB NOT NULL DEFAULT '{}',
  furnish_model         TEXT,
  furnish_note          TEXT,
  general_items         JSONB NOT NULL DEFAULT '[]',
  sections              JSONB NOT NULL DEFAULT '[]',
  ai_comparison         JSONB,
  ai_comparison_against UUID REFERENCES bids(id) ON DELETE SET NULL,
  ai_status             TEXT,
  ai_error              TEXT,
  source_file           TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bid_prebid_scope DROP CONSTRAINT IF EXISTS bid_prebid_scope_furnish_check;
ALTER TABLE bid_prebid_scope ADD CONSTRAINT bid_prebid_scope_furnish_check
  CHECK (furnish_model IS NULL OR furnish_model IN ('OFEI','ECFECI','mixed'));

-- Restate the whole category list (068/076/077/079/080 each rewrote this constraint;
-- amending rather than restating is how categories got silently dropped before).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','photo',
    'sizer_report','survey','site_checklist','labeled_survey',
    'takeoff','cost_breakdown',
    'change_order','submittal','rfi',
    'prebid_takeoff','prebid_scope',
    'other'
  ));
