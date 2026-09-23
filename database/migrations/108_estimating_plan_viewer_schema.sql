-- Estimating Phase B (plan viewer / markups), Task 1 — schema only.
-- See docs/superpowers/plans/2026-09-23-estimating-phase-b-plan-viewer.md.

-- ── est_bid_lines: a stable key that survives a full replace-on-save ────────
-- Phase A's saveBidEstimate() DELETEs every est_bid_lines row for a bid and
-- re-INSERTs the full set on every save — `id` is never stable across a save.
-- Markups (est_markups, below) need something stable to point at. line_key is
-- minted once (DEFAULT gen_random_uuid() covers both brand-new rows AND every
-- existing row when this column is added) and the application layer (Task 3's
-- update to saveBidEstimate/syncTakeoff) is responsible for round-tripping it
-- on every save rather than letting it regenerate.
--
-- Deliberately NOT a FOREIGN KEY target for est_markups.line_key: a plain
-- save DELETEs and re-INSERTs every line_key value in the same statement set
-- (not row-by-row UPDATEs), which a same-transaction DEFERRABLE FK could only
-- satisfy with extra care that has no other benefit here. line_key is
-- validated at the application layer instead (the same trust level this
-- schema already gives est_bid_lines.takeoff_key, which isn't FK-enforced
-- either despite anchoring sync-takeoff's own line identity).
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS line_key UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_est_bid_lines_line_key ON est_bid_lines (line_key);

-- qty_source distinguishes WHY a line's current qty is what it is, so a
-- markup-applied qty (Decision 4: "confirmed quantities win, explicitly")
-- reads as its own category rather than folding into 'manual'. Backfill: any
-- row already flagged qty_overridden=true predates this column and was set
-- by hand through the Labor & Pricing UI — that's 'manual', not 'markup'
-- (nothing wrote a markup-sourced qty before this migration exists).
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS qty_source TEXT NOT NULL DEFAULT 'takeoff';
ALTER TABLE est_bid_lines DROP CONSTRAINT IF EXISTS est_bid_lines_qty_source_check;
ALTER TABLE est_bid_lines ADD CONSTRAINT est_bid_lines_qty_source_check
  CHECK (qty_source IN ('takeoff', 'manual', 'markup'));
UPDATE est_bid_lines SET qty_source = 'manual' WHERE qty_overridden = true AND qty_source = 'takeoff';

-- ── est_sheets: one row per plan-set PDF page (Task 2) ──────────────────────
CREATE TABLE IF NOT EXISTS est_sheets (
  bid_id          UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index      INTEGER NOT NULL,
  sheet_no        TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  discipline      TEXT NOT NULL DEFAULT 'other',
  kind            TEXT NOT NULL DEFAULT 'other',
  width_pt        NUMERIC(10,2) NOT NULL,
  height_pt       NUMERIC(10,2) NOT NULL,
  rotation        INTEGER NOT NULL DEFAULT 0,
  -- feet-per-PDF-point, so a markup's polyline length (in points, Decision 5)
  -- converts to real feet with one multiply. NULL = not yet scaled; the
  -- measuring tools stay disabled until this is set (Decision 6).
  ft_per_pt       NUMERIC(14,8),
  scale_source    TEXT,
  scale_label     TEXT,
  has_text_layer  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (document_id, page_index)
);

ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_discipline_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_discipline_check
  CHECK (discipline IN ('E', 'A', 'M', 'P', 'other'));

ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_kind_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_kind_check
  CHECK (kind IN ('plan', 'schedule', 'detail', 'riser', 'cover', 'other'));

ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_scale_source_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_scale_source_check
  CHECK (scale_source IS NULL OR scale_source IN ('calibrated', 'titleblock'));

ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_ft_per_pt_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_ft_per_pt_check
  CHECK (ft_per_pt IS NULL OR ft_per_pt > 0);

ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_width_pt_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_width_pt_check CHECK (width_pt > 0);
ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_height_pt_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_height_pt_check CHECK (height_pt > 0);

CREATE INDEX IF NOT EXISTS idx_est_sheets_bid_id ON est_sheets (bid_id);

-- ── est_markups: count/linear markers on a sheet (Task 3) ───────────────────
CREATE TABLE IF NOT EXISTS est_markups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id        UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_index    INTEGER NOT NULL,
  -- NULL = unassigned (Task 6's "unassigned markers" bucket). Not a hard FK —
  -- see the comment on est_bid_lines.line_key above; the same
  -- delete-and-reinsert-per-save shape makes a same-transaction FK more
  -- trouble than it's worth. The application layer (Task 3) is the source of
  -- truth for line_key validity when it reads/writes markups.
  line_key      UUID,
  kind          TEXT NOT NULL,
  -- Array of [x, y] pairs in PDF user-space points (Decision 5). A 'count'
  -- markup always has exactly one point; a 'linear' markup has 2+.
  points        JSONB NOT NULL,
  drops         INTEGER NOT NULL DEFAULT 0,
  drop_ft       NUMERIC(10,2),
  slack_pct     NUMERIC(6,2),
  status        TEXT NOT NULL DEFAULT 'confirmed',
  label         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  -- Soft delete (undo) — a deleted markup never counts toward a rollup.
  deleted_at    TIMESTAMPTZ
);

ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_kind_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_kind_check
  CHECK (kind IN ('count', 'linear'));

ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_status_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_status_check
  CHECK (status IN ('confirmed', 'suggested'));

ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_drops_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_drops_check CHECK (drops >= 0);

ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_drop_ft_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_drop_ft_check
  CHECK (drop_ft IS NULL OR drop_ft >= 0);

ALTER TABLE est_markups DROP CONSTRAINT IF EXISTS est_markups_slack_pct_check;
ALTER TABLE est_markups ADD CONSTRAINT est_markups_slack_pct_check
  CHECK (slack_pct IS NULL OR slack_pct >= 0);

CREATE INDEX IF NOT EXISTS idx_est_markups_bid_id ON est_markups (bid_id);
CREATE INDEX IF NOT EXISTS idx_est_markups_document_page ON est_markups (document_id, page_index);
CREATE INDEX IF NOT EXISTS idx_est_markups_line_key ON est_markups (line_key);

-- ── App settings defaults (insert-if-absent) ────────────────────────────────
INSERT INTO app_settings (key, value)
SELECT 'est_default_drop_ft', '10'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_drop_ft');

INSERT INTO app_settings (key, value)
SELECT 'est_default_slack_pct', '10'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'est_default_slack_pct');
