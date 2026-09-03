-- Phase 3 Task 1: the bid_data contract. A per-job JS.MMDDYYYY job number,
-- persisted once generated (composeBidData persists it back to bids.job_number
-- on first use — see backend/src/bidstd/boilerplate.ts's jobNumber()), and a
-- 'bid_data' document category so the composed BidData JSON can be filed
-- alongside the docx/xlsx (the desktop APT_Bid_System and the CRM stay
-- interchangeable — either can read the other's bid_data.json).
ALTER TABLE bids ADD COLUMN IF NOT EXISTS job_number TEXT;

-- Restate the whole category list (068/076/077/079/080/082 each rewrote this
-- constraint; amending rather than restating is how categories got silently
-- dropped before — see 082's comment). Adds 'bid_data' only.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','photo',
    'sizer_report','survey','site_checklist','labeled_survey',
    'takeoff','cost_breakdown',
    'change_order','submittal','rfi',
    'prebid_takeoff','prebid_scope',
    'bid_data',
    'other'
  ));
