-- 059_lead_proposal_handoff.sql
-- Restructure Generator Leads into a lead -> proposal handoff.
-- Stages reduce to: new, contacted, site-scheduled, lost, converted.
-- Removed stages (vetting, quoted, site-complete, proposal-sent, won) are migrated:
--   vetting/quoted                    -> contacted
--   site-complete/proposal-sent/won   -> handoff (create/link a proposal, mark converted)
-- Adds a reverse link (generator_proposals.lead_id) and a proposal_activity timeline
-- so a lead's history carries over to its proposal.

-- 1. Reverse link: proposal -> originating lead (lead.linked_gen_id is the forward link).
ALTER TABLE generator_proposals
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS generator_proposals_lead_id_idx ON generator_proposals (lead_id);

-- 2. Proposal-side activity timeline (mirrors lead_activity, incl. 058's columns).
CREATE TABLE IF NOT EXISTS proposal_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES generator_proposals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  direction   TEXT CHECK (direction IN ('in','out')),
  text        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_activity_proposal_id_at_idx
  ON proposal_activity (proposal_id, created_at DESC);

-- 3. Drop the old stage CHECK before migrating data: the handoff below sets
--    stage='converted', which the old constraint does not allow. The tightened
--    constraint is re-added at the end once all rows conform.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_stage_check;

-- Simple removed-stage migrations: vetting/quoted collapse back to contacted.
UPDATE leads SET stage = 'contacted', updated_at = now()
 WHERE stage IN ('vetting', 'quoted') AND deleted_at IS NULL;

-- 4. Handoff migration for site-complete/proposal-sent/won: ensure a linked proposal
--    exists (create one carrying contact details + the activity timeline if missing),
--    link both directions, mark the lead converted, and log on both sides.
DO $$
DECLARE
  v_lead   RECORD;
  v_gen_id UUID;
BEGIN
  FOR v_lead IN
    SELECT * FROM leads
     WHERE stage IN ('site-complete', 'proposal-sent', 'won') AND deleted_at IS NULL
  LOOP
    v_gen_id := v_lead.linked_gen_id;

    IF v_gen_id IS NULL THEN
      INSERT INTO generator_proposals
        (customer, loc, salesperson_id, salesperson_name, stage, form_data, lead_id)
      VALUES (
        v_lead.name,
        COALESCE(NULLIF(v_lead.address, ''), '—'),
        v_lead.salesperson_id,
        v_lead.salesperson_name,
        'building',
        jsonb_build_object(
          'customer', v_lead.name,
          'attn',     v_lead.name,
          'address',  COALESCE(v_lead.address, ''),
          'phone',    COALESCE(v_lead.phone, ''),
          'email',    COALESCE(v_lead.email, ''),
          'notes',    COALESCE(v_lead.notes, ''),
          'lead_source', v_lead.source
        ),
        v_lead.id
      )
      RETURNING id INTO v_gen_id;

      -- Carry over the full lead activity timeline.
      INSERT INTO proposal_activity (proposal_id, kind, direction, text, created_by, created_at)
      SELECT v_gen_id, kind, direction, text, created_by, created_at
        FROM lead_activity WHERE lead_id = v_lead.id;
    ELSE
      -- A proposal already exists; just ensure the reverse link is set.
      UPDATE generator_proposals SET lead_id = v_lead.id
       WHERE id = v_gen_id AND lead_id IS NULL;
    END IF;

    -- Link forward + mark converted.
    UPDATE leads SET linked_gen_id = v_gen_id, stage = 'converted', updated_at = now()
     WHERE id = v_lead.id;

    -- Log the conversion on both sides.
    INSERT INTO lead_activity (lead_id, kind, text)
      VALUES (v_lead.id, 'system', 'Converted to generator proposal (migrated from ' || v_lead.stage || ')');
    INSERT INTO proposal_activity (proposal_id, kind, text)
      VALUES (v_gen_id, 'system', 'Converted from lead "' || v_lead.name || '" (migrated)');
  END LOOP;
END $$;

-- 5. Re-add the tightened stage CHECK now that no lead sits in a removed stage.
ALTER TABLE leads ADD CONSTRAINT leads_stage_check
  CHECK (stage IN ('new', 'contacted', 'site-scheduled', 'lost', 'converted'));
