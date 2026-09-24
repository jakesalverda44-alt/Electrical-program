-- Evidence round (Parts 1-3) — what the narrow evidence readers found on one
-- page of one PDF: its viewports (1.1), the typical packages in its legends
-- and notes (2.1), and each schedule table read row by row (3.1). Keyed by
-- the file's content hash, the page, what was read (`kind`, e.g.
-- 'viewports', 'typicals:5,9', 'table:u3:1.20,0.10,10.40,6.60') and the
-- reader's model + prompt version (`cache_key`), so an unchanged file is
-- never read twice and a new model or prompt re-reads.
CREATE TABLE IF NOT EXISTS sheet_evidence_cache (
  content_sha256  TEXT NOT NULL,
  page            INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  cache_key       TEXT NOT NULL,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_sha256, page, kind, cache_key)
);
