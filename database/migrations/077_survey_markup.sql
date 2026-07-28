-- Labeled site-plan survey: click-to-place electrical service / gas meter / generator
-- markers over the uploaded survey, kept separate from the raw survey upload.

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN ('plans','contract','proposal','permit','invoice','photo','sizer_report','survey','site_checklist','labeled_survey','other'));

-- Editable marker state (base file ref + placed markers), re-opened/adjusted until finalized.
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS survey_markup JSONB;
