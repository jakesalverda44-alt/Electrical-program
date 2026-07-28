-- 068 rewrote the documents.category CHECK and dropped change_order/submittal/rfi
-- (added by 045); 076/077/079 rewrites never restored them, so those uploads
-- fail with 23514. Restore the full set on top of 079's baseline.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','photo',
    'sizer_report','survey','site_checklist','labeled_survey',
    'takeoff','cost_breakdown',
    'change_order','submittal','rfi',
    'other'
  ));
