-- 095_public_bid_gate.sql
-- Post-review FIX-3 — the public proposal page was composing + rendering +
-- verifying the docx LIVE on every unauthenticated view (execSync-probing
-- for `soffice` on every request — an uncapped, unauthenticated event-loop
-- blocker), and "most recent filed proposal" was never actually gated on
-- having passed the verify gate — a competitor's bid imported under
-- category='proposal' could theoretically be what gets emailed to a GC as
-- ours. This migration adds the two columns that let the app instead serve
-- (and email, and pin a signature to) a FILED, GATE-PASSED snapshot:
--
--   documents.gate_passed  — set true ONLY by the Phase 3 generate-*
--     endpoints (generate-docx, generate-takeoff-xlsx, generate-prebid-
--     package), and only on the rows they file, and only after their own
--     verify gate has passed. Nothing else ever sets it.
--   bids.signed_document_id — the bid_data.json document id that was on
--     screen when the customer e-signed, so a signature pins to an exact
--     document version rather than "whatever composes today."

ALTER TABLE documents ADD COLUMN IF NOT EXISTS gate_passed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS signed_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;
