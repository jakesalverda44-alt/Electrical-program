-- One-time cleanup: remove the test leads added while exercising the lead
-- intake API. The leads table held only test data at this point, so this
-- clears it (and the cascading lead_activity timeline) outright.
TRUNCATE TABLE leads CASCADE;
