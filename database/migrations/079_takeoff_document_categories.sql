-- The bid-import flow uploads a quantity takeoff and an Accubid cost breakdown
-- alongside the proposal. They need their own categories so the Files tab can label
-- them and Drive routing can file them under Estimates.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','photo',
    'sizer_report','survey','site_checklist','labeled_survey',
    'takeoff','cost_breakdown','other'
  ));
