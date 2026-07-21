-- Expand leads.source with manufacturer-specific options (Generac, Cummins) and a
-- 'call-in' option. Legacy values ('web','phone','referral','other') stay valid so
-- existing leads keep their recorded source — new leads are created with the
-- narrowed set (Kohler, Generac, Cummins, Call-in) from the app going forward.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('web','phone','referral','kohler','other','generac','cummins','call-in'));
