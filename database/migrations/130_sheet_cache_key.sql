-- Fix round S6 — the page-classification cache is keyed by the classifier
-- model and prompt version as well as the file's content: a new model or a
-- changed prompt re-classifies, never reuses an old answer. Rows from
-- before this (cache_key '') are simply never matched again.
ALTER TABLE sheet_page_cache ADD COLUMN IF NOT EXISTS cache_key TEXT NOT NULL DEFAULT '';
ALTER TABLE sheet_page_cache DROP CONSTRAINT IF EXISTS sheet_page_cache_pkey;
ALTER TABLE sheet_page_cache ADD CONSTRAINT sheet_page_cache_pkey PRIMARY KEY (content_sha256, page, cache_key);
