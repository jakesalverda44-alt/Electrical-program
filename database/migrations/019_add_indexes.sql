CREATE INDEX IF NOT EXISTS bids_stage_idx         ON bids(stage);
CREATE INDEX IF NOT EXISTS bids_salesperson_idx   ON bids(salesperson_id);
CREATE INDEX IF NOT EXISTS gens_stage_idx         ON generator_proposals(stage);
CREATE INDEX IF NOT EXISTS comms_linked_idx       ON communications(linked_id);
CREATE INDEX IF NOT EXISTS docs_linked_idx        ON documents(linked_id);
