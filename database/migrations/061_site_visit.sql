-- 061_site_visit.sql
-- Site-visit scheduling for the Generator Leads -> Site Scheduled handoff. The visit
-- datetime is captured on the lead and carried onto the proposal created in the handoff.
-- site_visit_needs_time flags a visit that was scheduled without a time yet ("no time yet").
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS site_visit_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_visit_needs_time BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS site_visit_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS site_visit_needs_time BOOLEAN NOT NULL DEFAULT false;
