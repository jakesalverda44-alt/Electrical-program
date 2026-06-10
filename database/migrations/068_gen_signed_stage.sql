-- Add 'signed' back to the generator_proposals stage constraint.
-- Migration 033 removed it (collapsing signed → sent), but the customer-facing
-- e-sign flow re-introduced the signed stage. Without this the public sign
-- endpoint fails the CHECK and the card never moves to Signed.
-- Also expands documents.category to include 'photo' for job-site photo uploads.

ALTER TABLE generator_proposals DROP CONSTRAINT IF EXISTS generator_proposals_stage_check;
ALTER TABLE generator_proposals ADD CONSTRAINT generator_proposals_stage_check
  CHECK (stage IN ('building', 'sent', 'signed', 'awarded', 'declined'));

-- Expand documents.category: 'photo' is used when uploading job-site photos.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN ('plans','contract','proposal','permit','invoice','photo','other'));
