-- 084_lead_survey.sql
-- Site-survey answers captured on the lead by the mobile survey wizard; shape
-- mirrors GenForm field names so create-gen can merge them into form_data.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS survey_data JSONB;
