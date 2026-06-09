import { pool } from '../db/pool';
import { logger } from './logger';
import { getStageConfig } from './leadStageConfig';

type ActingUser = { id: string; role: string } | undefined;
type FollowupLead = { id: string; name: string; salesperson_id: string | null };

/**
 * Create a real follow-up task when a lead enters a stage, using the per-stage config
 * (delay + title) from app_settings key "lead_stage_config_json" (falls back to coded
 * defaults). Non-blocking — errors are logged but never thrown.
 *
 * The task is assigned so it actually surfaces in someone's Follow-ups view: the lead's
 * salesperson if set, otherwise the (real) user who triggered the transition. API-key
 * automation has no user record, so those are left unassigned for managers/owners (who
 * see every task) to triage. A lead re-entering the same stage does not stack duplicate
 * open follow-ups.
 */
export async function createStageFollowup(
  lead: FollowupLead,
  stage: string,
  actingUser?: ActingUser,
): Promise<void> {
  try {
    const config = await getStageConfig();
    const cfg = config[stage];
    if (!cfg?.followup_delay_hours) return;

    const title = cfg.followup_title.replace('{name}', lead.name);

    const fallbackAssignee = actingUser && actingUser.role !== 'api' ? actingUser.id : null;
    const assignee: string | null = lead.salesperson_id ?? fallbackAssignee;

    // Don't stack duplicate auto follow-ups when a lead bounces back into a stage.
    const { rows: dupe } = await pool.query(
      `SELECT 1 FROM tasks WHERE linked_type='lead' AND linked_id=$1 AND title=$2 AND status='open' LIMIT 1`,
      [lead.id, title]
    );
    if (dupe.length) return;

    const dueMs = Date.now() + cfg.followup_delay_hours * 60 * 60 * 1000;
    const dueDate = new Date(dueMs).toISOString().slice(0, 10);

    await pool.query(
      `INSERT INTO tasks (title, due_date, linked_type, linked_id, linked_name, assigned_to)
       VALUES ($1, $2, 'lead', $3, $4, $5)`,
      [title, dueDate, lead.id, lead.name, assignee]
    );
  } catch (err) {
    logger.error({ err, leadId: lead.id, stage }, '[createStageFollowup] failed');
  }
}

/**
 * Backfill: ensure every active lead currently sitting in a follow-up-bearing stage has
 * an open follow-up task. Idempotent (createStageFollowup dedupes), so it is safe to run
 * on startup and on every reminder tick — it self-heals leads that entered a stage before
 * the auto follow-up feature existed (or that somehow slipped through). Terminal stages
 * (lost/converted) and stages without a configured delay are skipped automatically.
 * Returns the number of leads that received a new follow-up.
 */
export async function ensureLeadFollowups(): Promise<number> {
  try {
    const config = await getStageConfig();
    const stages = Object.entries(config)
      .filter(([, cfg]) => cfg.followup_delay_hours)
      .map(([stage]) => stage);
    if (!stages.length) return 0;

    const { rows } = await pool.query(
      `SELECT id, name, salesperson_id, stage FROM leads
        WHERE deleted_at IS NULL AND stage = ANY($1::text[])`,
      [stages]
    );

    let created = 0;
    for (const lead of rows) {
      const before = await openFollowupCount(lead.id);
      await createStageFollowup(lead, lead.stage);
      const after = await openFollowupCount(lead.id);
      if (after > before) created++;
    }
    if (created) logger.info({ created }, '[ensureLeadFollowups] backfilled missing follow-ups');
    return created;
  } catch (err) {
    logger.error({ err }, '[ensureLeadFollowups] failed');
    return 0;
  }
}

/**
 * Mark a lead's open follow-up tasks as done. Called when a lead reaches a terminal
 * state (converted to a proposal, or lost) — those leads should not keep an open
 * "follow up" task hanging around in the Follow-ups view.
 */
export async function closeLeadFollowups(leadId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE tasks SET status='done', completed_at=now()
        WHERE linked_type='lead' AND linked_id=$1 AND status='open'`,
      [leadId]
    );
  } catch (err) {
    logger.error({ err, leadId }, '[closeLeadFollowups] failed');
  }
}

async function openFollowupCount(leadId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM tasks WHERE linked_type='lead' AND linked_id=$1 AND status='open'`,
    [leadId]
  );
  return rows[0].n as number;
}
