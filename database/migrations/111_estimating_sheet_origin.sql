-- Fix round 1 / S1 — overlay.ts (and the backend title-block strip test)
-- assumed every page's MediaBox/CropBox starts at (0,0). Most PDFs do, but
-- CAD-exported PDFs routinely use a non-zero origin (e.g. MediaBox
-- [100 200 712 992]) — every stored/clicked marker point, and every
-- suggested-marker/title-block-strip position derived from raw text-item
-- coordinates, was off by (origin_x_pt, origin_y_pt), worse at 90/180/270
-- rotation (see the review's own hand-verified per-rotation numbers).
-- est_sheets only ever stored width/height (the page's extents), never the
-- origin itself, so there was nothing for the render-space transform to
-- correct with even once the bug was found. Default 0/0 — the origin
-- pdf.js's own page tree normalizes to for the overwhelming majority of
-- real-world PDFs, and exactly what every existing transform already
-- assumed, so this is a no-op for every sheet already indexed.
ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS origin_x_pt NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE est_sheets ADD COLUMN IF NOT EXISTS origin_y_pt NUMERIC(10,2) NOT NULL DEFAULT 0;
