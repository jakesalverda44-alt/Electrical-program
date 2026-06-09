-- 060_close_terminal_lead_followups.sql
-- A lead in a terminal stage (converted to a proposal, or lost) should not keep an
-- open auto follow-up task. Close out any that are lingering from before this rule
-- existed (e.g. leads converted via the Site Scheduled handoff).
UPDATE tasks t
   SET status = 'done', completed_at = now()
  FROM leads l
 WHERE t.linked_type = 'lead'
   AND t.linked_id = l.id
   AND t.status = 'open'
   AND l.stage IN ('converted', 'lost');
