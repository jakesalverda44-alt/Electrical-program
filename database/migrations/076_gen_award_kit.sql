-- Awarded-job "kit": sizer report / survey uploads + digitized site visit checklist,
-- bundled into the kickoff email drafted when a gen proposal moves to Awarded.

-- Expand documents.category for the new upload types.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN ('plans','contract','proposal','permit','invoice','photo','sizer_report','survey','site_checklist','other'));

-- Digitized Site Visit Checklist, filled in any time up to Award (Gen Detail Drawer).
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS checklist_data JSONB;
