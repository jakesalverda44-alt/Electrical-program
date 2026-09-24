-- Next round A1 — the page inventory as a first-class record (sheet check).
--
-- sheet_page_cache: the title-block classification of one page of one PDF,
-- keyed by the file's content hash. The Documents-step sheet check and the
-- analysis share it, so an unchanged file is never classified twice.
-- ai_refs: references read by Haiku (vague notes text) or Sonnet vision
-- (a scanned sheet's notes region) — cached for the same reason.
CREATE TABLE IF NOT EXISTS sheet_page_cache (
  content_sha256  TEXT NOT NULL,
  page            INTEGER NOT NULL,
  sheet_no        TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  discipline      TEXT NOT NULL DEFAULT 'unknown',
  cls             TEXT NOT NULL DEFAULT 'schedule',
  text_chars      INTEGER NOT NULL DEFAULT 0,
  has_text_layer  BOOLEAN NOT NULL DEFAULT false,
  ai_refs         JSONB,
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_sha256, page)
);

-- bid_sheet_check: the bid's current sheet check — the inventory with each
-- page's role (analysis / reference / excluded) and why, the references and
-- which are missing — plus the estimator's decisions, which outlive any one
-- check: overrides {"<sha>#<page>": {decision, reason, by, at}} and skips
-- {"<ref id>": {reason, by, at, auto}}. run_token: a newer check supersedes
-- an older one still running (its write is refused).
CREATE TABLE IF NOT EXISTS bid_sheet_check (
  bid_id       UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'idle',
  run_token    TEXT,
  input_key    TEXT,
  result       JSONB,
  overrides    JSONB NOT NULL DEFAULT '{}',
  skips        JSONB NOT NULL DEFAULT '{}',
  error        TEXT,
  usage        JSONB,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bid_sheet_check DROP CONSTRAINT IF EXISTS bid_sheet_check_status_check;
ALTER TABLE bid_sheet_check ADD CONSTRAINT bid_sheet_check_status_check
  CHECK (status IN ('idle', 'running', 'complete', 'error'));

