-- Re-run reset (docs/superpowers/plans/2026-09-24-rerun-reset-report.md).
--
-- "When we re-run the analysis it should clear out all the old outputs."
-- Each /analyze is a run (migration 118). Starting a run now also resets,
-- in the same transaction, everything the previous run produced, and keeps
-- the estimator's own work. The columns below let the reset flag instead of
-- delete where the estimator's work or a filed file is involved.

-- ── est_bid_lines: a takeoff line the estimator touched survives a re-run ──
-- Set by the reset to the NEW run's id on every takeoff line that is kept
-- because the estimator overrode it (qty, material, labor, a markup-applied
-- qty, a manual match or a deliberate exclusion). The UI shows "From previous
-- run — re-check" until the estimator marks it checked (the client sends
-- null). sync-takeoff re-binds these lines to the new takeoff.
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS recheck_run_id UUID;

-- ── documents ───────────────────────────────────────────────────────────────
-- generated: the CRM made this file (proposal docx/pdf, bid_data.json, GC
-- takeoff xlsx, pre-bid scope docx / takeoff xlsx). Such a file is never an
-- analysis input and is superseded by a re-run. Set by storeDocument for
-- every generate-* route; backfilled here from the markers those routes have
-- always written (gate_passed / takeoff_run_id / compose_inputs_hash) and
-- from the generated-only category bid_data.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS generated BOOLEAN NOT NULL DEFAULT false;
UPDATE documents SET generated = true
 WHERE generated = false
   AND (gate_passed = true OR takeoff_run_id IS NOT NULL OR compose_inputs_hash IS NOT NULL OR category = 'bid_data');

-- sha256 of the file bytes, recorded at upload time (not backfilled: the
-- bytes of older rows may live in Drive). Used to drop duplicate analysis
-- inputs; name + size is the fallback when it is missing.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

-- A re-run flags (never deletes) the previous runs' generated GC / pre-bid
-- files. A superseded file is never attached to an email.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS superseded_by_run_id UUID;

-- ── takeoff_results: what the last reset did ────────────────────────────────
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS reset_run_id UUID;
ALTER TABLE takeoff_results ADD COLUMN IF NOT EXISTS reset_summary JSONB;

-- ── bid_workspaces.rfis: every RFI records where it came from ───────────────
-- origin 'ai' = imported from the analysis ("Import from AI"), 'manual' =
-- typed by the estimator. Existing RFIs had no origin. They are AI when:
--   * their id has the import's shape: Date.now() + Math.random() (the only
--     writer that puts a '.' in an RFI id; a typed RFI's id is digits only), or
--   * their question matches one of the current analysis' Agent 2 rfis.
DO $$
DECLARE
  r        RECORD;
  a2       JSONB;
  qs       TEXT[];
  next     JSONB;
BEGIN
  FOR r IN
    SELECT w.bid_id, w.rfis, t.agent2_output
      FROM bid_workspaces w
      LEFT JOIN takeoff_results t ON t.bid_id = w.bid_id
     WHERE jsonb_typeof(w.rfis) = 'array' AND jsonb_array_length(w.rfis) > 0
  LOOP
    a2 := NULL;
    BEGIN
      a2 := substring(coalesce(r.agent2_output, '') from '\{.*\}')::jsonb;
    EXCEPTION WHEN others THEN
      a2 := NULL;
    END;
    qs := ARRAY(
      SELECT lower(btrim(x->>'question'))
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a2->'rfis') = 'array' THEN a2->'rfis' ELSE '[]'::jsonb END) x
       WHERE x ? 'question'
    );
    SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(e) <> 'object' OR e ? 'origin' THEN e
               WHEN coalesce(e->>'id', '') LIKE '%.%'
                 OR lower(btrim(coalesce(e->>'question', ''))) = ANY(qs)
                 THEN e || '{"origin":"ai"}'::jsonb
               ELSE e || '{"origin":"manual"}'::jsonb
             END ORDER BY ord)
      INTO next
      FROM jsonb_array_elements(r.rfis) WITH ORDINALITY AS t(e, ord);
    UPDATE bid_workspaces SET rfis = next WHERE bid_id = r.bid_id;
  END LOOP;
END $$;
