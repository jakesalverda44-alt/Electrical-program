-- Fix round 1 / B7 — the title-block-parsed scale used to be written
-- straight into est_sheets.ft_per_pt/scale_source/scale_label by the
-- indexer itself (upsertSheetPage), auto-applying it with no estimator
-- action at all: a half-size set, or an enlarged-detail callout's own
-- "SCALE: 1/4" = 1'-0"" appearing before the main plan's real scale in
-- content-stream order, silently measured every linear run wrong (half
-- or double its true length) with nothing on screen suggesting the
-- number needed a second look.
--
-- Fix: the parse is now stored SEPARATELY as a suggestion
-- (suggested_ft_per_pt/suggested_label), never touching
-- ft_per_pt/scale_source/scale_label — those three are set ONLY by an
-- explicit confirm click or a two-point calibration (sheets.ts's
-- setSheetScale, unchanged). scale_ambiguous marks a page where more than
-- one DISTINCT scale value was found in its text (an enlarged detail
-- alongside the main plan) — no one-click suggestion is ever offered for
-- those; the estimator must calibrate directly.
ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS suggested_ft_per_pt NUMERIC(14,8);
ALTER TABLE est_sheets DROP CONSTRAINT IF EXISTS est_sheets_suggested_ft_per_pt_check;
ALTER TABLE est_sheets ADD CONSTRAINT est_sheets_suggested_ft_per_pt_check
  CHECK (suggested_ft_per_pt IS NULL OR suggested_ft_per_pt > 0);

ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS suggested_label TEXT;
ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS scale_ambiguous BOOLEAN NOT NULL DEFAULT false;

-- Fix round 1 / B7 — a visible "Half-size set?" toggle per DOCUMENT (every
-- sheet in that PDF was printed at half its designed physical size, so its
-- title-block-stated scale reads half what the drawing actually measures
-- at): doubles ft_per_pt/suggested_ft_per_pt for every sheet of that
-- document when turned on (sheets.ts's setHalfSize toggles all of a
-- document's rows together, dividing back out if turned off).
ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS half_size BOOLEAN NOT NULL DEFAULT false;

-- One-time migration of any sheet already indexed under the OLD rule
-- (scale_source='titleblock' means the indexer's own guess was written
-- straight to ft_per_pt with no estimator confirmation ever having
-- happened) — move that value into the new suggestion columns instead of
-- leaving it looking "confirmed" when nobody ever clicked anything. A
-- genuinely 'calibrated' sheet (an estimator's own two-point measurement)
-- is untouched.
UPDATE est_sheets
SET suggested_ft_per_pt = ft_per_pt,
    suggested_label = scale_label,
    ft_per_pt = NULL,
    scale_source = NULL,
    scale_label = NULL
WHERE scale_source = 'titleblock';
