-- Fix round 1 / B9 — sheet indexing (a Drive download + a whole-file
-- buffer + a pdfjs parse of every page) used to run SYNCHRONOUSLY inside
-- GET /sheets: a real 50-150 MB plan set blows well past the frontend's
-- 30s axios timeout (api/client.ts), the browser shows "timeout of
-- 30000ms exceeded" or "No plan sheets found", and if indexing dies
-- partway (one bad document, a process restart) the partial est_sheets
-- rows become permanent — nothing ever retries them.
--
-- Fix: indexing becomes a background job per document_id, tracked here.
-- GET /sheets now returns whatever est_sheets rows already exist PLUS
-- this status map, and kicks off (fire-and-forget) indexing for any
-- document that's still 'pending' — the client polls until every
-- document reaches a terminal status.
--
-- Fix round 2 / R2-N3 — corrected from an earlier, inaccurate version of
-- this comment ("'failed' is always retried on the NEXT GET /sheets"),
-- which never matched what the code actually does: 'failed' is STICKY —
-- a plain (unrefreshed) GET /sheets never silently re-claims it (see
-- backend/src/estimating/sheets.ts's own claimDocumentsForIndexing doc
-- comment for why: re-claiming it automatically would flip it back to
-- 'indexing' before the estimator ever got to SEE the failure, and would
-- hammer a persistently-down Drive link on every single poll tick). Only
-- an explicit `?refresh=1` (the "Refresh sheets" button) resets a
-- 'failed' document back to 'pending' so it becomes eligible again —
-- never a permanent dead end, but never a silent one either. Separately
-- (Fix round 2 / R2-B3), a document stuck 'indexing' past a 10-minute
-- stale lease, or left over from a process that died mid-index, is
-- reclaimed automatically (a plain poll, or on the next server boot) —
-- see claimDocumentsForIndexing and resetStuckIndexingOnBoot.
CREATE TABLE IF NOT EXISTS est_document_index_status (
  bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'done', 'failed')),
  error TEXT,
  page_count INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bid_id, document_id)
);

CREATE INDEX IF NOT EXISTS est_document_index_status_bid_id_idx ON est_document_index_status (bid_id);

-- Any bid that already has est_sheets rows was indexed under the old
-- synchronous rule — backfill it as 'done' so GET /sheets doesn't try to
-- re-index (and briefly show a "pending"/"indexing" state) for a set
-- that's already fully built.
INSERT INTO est_document_index_status (bid_id, document_id, status, page_count, updated_at)
SELECT bid_id, document_id, 'done', count(*), now()
FROM est_sheets
GROUP BY bid_id, document_id
ON CONFLICT (bid_id, document_id) DO NOTHING;
