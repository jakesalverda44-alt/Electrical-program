-- Automated first-contact for inbound leads.
--   first_contact_sent_at: set once the first-contact email (email leads) or the
--     "needs a call" notification (phone leads) has been delivered. Stays NULL
--     until a send succeeds so a failed attempt can be retried on the next
--     upsert. Guarantees we never contact the same lead twice, even when the
--     browser extension re-pulls / upserts the same lead repeatedly.
--   needs_call: flagged true for leads with no email so they surface for a
--     manual phone follow-up.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contact_sent_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_call BOOLEAN NOT NULL DEFAULT false;
