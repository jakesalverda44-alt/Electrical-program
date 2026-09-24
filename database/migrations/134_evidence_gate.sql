-- Evidence round Part 4.1 — every GC-facing takeoff line carries evidence
-- (a marker, a schedule cell, a typical expansion, a family/gap-fill note —
-- all already on count_result) or, for a line the estimator typed by hand
-- (a manual line, or a manual override of a takeoff qty), a reason text.
-- This column is that reason; ai/evidence/evidenceGate.ts is the pure gate
-- that checks for it (and for a missing AI-side evidence trail) before a
-- GC-facing document is generated. The pre-bid package is exempt (internal,
-- confidence-coded already).
ALTER TABLE est_bid_lines ADD COLUMN IF NOT EXISTS evidence_note TEXT;

-- Grandfather EVERY manual/allowance line that already existed before this
-- gate did: the gate must never retroactively lock an in-flight bid out of
-- its own GC documents the moment this migration runs. Only a manual line
-- (or a hand-overridden qty) CREATED FROM HERE ON has no note and needs a
-- real one; the placeholder is deliberately not a "real reason" (isRealReason
-- style text would look like an actual explanation) — it flags a still-empty
-- evidence_note wherever it's shown, but it IS >=10 chars, matching the
-- gate's own rule, so it never blocks the estimator's existing work.
UPDATE est_bid_lines
   SET evidence_note = 'Carried over from before the evidence gate (2026-09) — add a real reason next time this line is touched.'
 WHERE evidence_note IS NULL
   AND (source = 'manual' OR qty_source = 'manual');
